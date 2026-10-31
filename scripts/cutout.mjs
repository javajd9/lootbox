// Turns product photos on white / fake-checkerboard backgrounds into transparent WebPs for the site.
// The background is flood-filled from the image edges inward, so light areas *inside* a product
// (like the PS5's white panels) are kept. Edge pixels get a soft alpha so cutouts don't look jagged.
// Usage: node scripts/cutout.mjs
import sharp from "sharp";

const JOBS = [
  // minLight: how bright a pixel must be to count as background; maxChroma: how gray it must be.
  { src: "assets/prizes-src/oled-monitor.jpg", out: "public/prizes/oled-monitor.webp", minLight: 214, maxChroma: 16 },
  { src: "assets/prizes-src/ps5-pro.webp", out: "public/prizes/ps5-pro.webp", minLight: 247, maxChroma: 8 },
  // Box art is a solid rectangle with a white header band that touches the margin, so a flood fill
  // would eat it. Just crop the white margin instead.
  { src: "assets/prizes-src/gta6.webp", out: "public/prizes/gta6.webp", crop: true },
];

for (const job of JOBS) {
  if (job.crop) {
    await sharp(job.src)
      .trim({ background: "#ffffff", threshold: 40 })
      .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toFile(job.out);
    const meta = await sharp(job.out).metadata();
    console.log(`${job.out}: cropped → ${meta.width}x${meta.height}`);
    continue;
  }
  const { data, info } = await sharp(job.src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isBg = (i) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    return Math.min(r, g, b) >= job.minLight && Math.max(r, g, b) - Math.min(r, g, b) <= job.maxChroma;
  };

  // Flood fill from every edge pixel that looks like background.
  const bg = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    const i = y * w + x;
    if (!bg[i] && isBg(i)) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) (seed(x, 0), seed(x, h - 1));
  for (let y = 0; y < h; y++) (seed(0, y), seed(w - 1, y));
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }

  // Remove background; soften the 1px rim next to it based on how light it is.
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) {
      data[i * 4 + 3] = 0;
      continue;
    }
    const x = i % w, y = (i - x) / w;
    const touchesBg = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
    if (touchesBg) {
      const light = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      const a = Math.max(0.35, Math.min(1, (255 - light) / (255 - job.minLight + 40)));
      data[i * 4 + 3] = Math.round(255 * a);
    }
  }

  const removed = bg.reduce((n, v) => n + v, 0);
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 100 })
    .toFile(job.out);
  const meta = await sharp(job.out).metadata();
  console.log(`${job.out}: removed ${((removed / (w * h)) * 100).toFixed(1)}% background → ${meta.width}x${meta.height}`);
}
