// The LOOTBOX mark as a vessel, printed in the ticket's two inks: an ink outline, flat gold
// liquid rising with the prize pool. Each fee that lands makes the surface slosh; at 100% the
// gold check draws itself on and the box is complete. The inside is paper, so the level still
// reads when the stub around it turns gold.

const HEX_INNER = "M500 259 L708 379 L708 621 L500 741 L292 621 L292 379 Z";
const LEVEL_RANGE = 500; // px between empty (hidden below) and full

// A wavy surface wider than the box; sliding it by whole periods loops seamlessly.
const WAVE = (() => {
  const top = 252;
  let d = `M122 ${top}`;
  for (let x = 122; x < 1078; x += 100) d += ` Q${x + 25} ${top - 9} ${x + 50} ${top} Q${x + 75} ${top + 9} ${x + 100} ${top}`;
  return `${d} L1078 820 L122 820 Z`;
})();

const INK = "#0E0E10";
const GOLD = "#E3A82E";
const PAPER = "#F2EFE8";

export function FillBox({
  pct,
  complete,
  shaking = false,
  splash = 0,
  className = "",
}: {
  pct: number;
  complete: boolean;
  shaking?: boolean;
  splash?: number; // change this number to make the liquid slosh once
  className?: string;
}) {
  const level = Math.max(0, Math.min(1, pct));
  return (
    <div className={`relative ${shaking ? "animate-shake" : ""} ${className}`}>
      <svg viewBox="222 186 556 628" className="h-full w-full" role="img" aria-label={`Prize pool ${Math.round(level * 100)}% full`}>
        <defs>
          <clipPath id="lootbox-inner">
            <path d={HEX_INNER} />
          </clipPath>
        </defs>
        <path d={HEX_INNER} fill={PAPER} fillOpacity={0.92} />
        <g clipPath="url(#lootbox-inner)">
          <g style={{ transform: `translateY(${(1 - level) * LEVEL_RANGE}px)`, transition: "transform 0.9s cubic-bezier(.2,.8,.2,1)" }}>
            <g key={splash} className={splash ? "animate-slosh motion-reduce:animate-none" : ""}>
              <g className="animate-wave motion-reduce:animate-none">
                <path d={WAVE} fill={GOLD} />
              </g>
            </g>
          </g>
        </g>
        <path d="M500 236 L728 368 L728 632 L500 764 L272 632 L272 368 Z" fill="none" stroke={INK} strokeWidth="40" />
        <path d="M500 505 V764" stroke={INK} strokeWidth="40" opacity={complete ? 1 : 0.25} />
        {complete ? (
          <path d="M374 428 L500 500 L728 368" fill="none" stroke={INK} strokeWidth="40" strokeDasharray="420" className="animate-draw" />
        ) : (
          <path d="M374 428 L500 500 L728 368" fill="none" stroke={INK} strokeWidth="40" opacity="0.18" />
        )}
      </svg>
    </div>
  );
}
