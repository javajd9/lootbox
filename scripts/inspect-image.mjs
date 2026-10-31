// Prints image size and the colors along the edges, to tune background removal.
// Usage: node scripts/inspect-image.mjs <file>
import sharp from "sharp";

const file = process.argv[2];
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
console.log(file, `${info.width}x${info.height}`);
const counts = new Map();
for (let x = 0; x < info.width; x += 2) {
  for (const y of [0, 1, 2, info.height - 1, info.height - 2]) {
    const key = px(x, y).map((v) => Math.round(v / 4) * 4).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
for (let y = 0; y < info.height; y += 2) {
  for (const x of [0, 1, 2, info.width - 1, info.width - 2]) {
    const key = px(x, y).map((v) => Math.round(v / 4) * 4).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
console.log("top edge colors:", [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8));
