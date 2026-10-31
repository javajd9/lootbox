// The room the ticket sits in: the same ink as the rest of the page, with the LOOTBOX cube drawn
// huge and faint behind the ticket (its points showing above and below it, as on the banner) and
// gold dust drifting up. Purely decorative. The ticket's own backlight lives with the ticket.

// Fixed, seeded positions so the server and browser draw the same dust.
const DUST = (() => {
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 34 }, () => ({
    x: Math.round(rnd() * 100),
    size: 2 + Math.round(rnd() * 2),
    dur: 16 + Math.round(rnd() * 18),
    delay: -Math.round(rnd() * 34),
    o: (0.3 + rnd() * 0.5).toFixed(2),
    dx: Math.round((rnd() - 0.5) * 90),
  }));
})();

// The logo (same geometry as LogoMark: the hexagon, the stem, and the gold check running up to
// the right corner) as a thin outline, centred on the section.
function Cube({ height, alpha }: { height: string; alpha: number }) {
  return (
    <svg
      viewBox="222 186 556 628"
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ height, aspectRatio: "556 / 628" }}
      aria-hidden="true"
    >
      <g fill="none" stroke={`rgba(242,239,232,${alpha})`} strokeWidth="1.5">
        <path d="M500 236 L728 368 L728 632 L500 764 L272 632 L272 368 Z" vectorEffect="non-scaling-stroke" />
        <path d="M500 500 V764" vectorEffect="non-scaling-stroke" />
      </g>
      <path d="M374 428 L500 500 L728 368" fill="none" stroke={`rgba(227,168,46,${alpha * 1.8})`} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <Cube height="128%" alpha={0.09} />
      <Cube height="176%" alpha={0.05} />

      {/* gold dust drifting up */}
      <div className="absolute inset-0 motion-reduce:hidden">
        {DUST.map((d, i) => (
          <span
            key={i}
            className="absolute -bottom-2 animate-dust rounded-full bg-loot opacity-0"
            style={
              {
                left: `${d.x}%`,
                width: d.size,
                height: d.size,
                animationDuration: `${d.dur}s`,
                animationDelay: `${d.delay}s`,
                "--o": d.o,
                "--dx": `${d.dx}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* darker toward the edges, like the sections below */}
      <div className="vignette absolute inset-0" />
    </div>
  );
}
