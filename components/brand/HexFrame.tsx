// Gold hexagon frame used for prizes, as in the reel's "THE FIRST DROP" shot.
export function HexFrame({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  const clip = "polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)";
  return (
    <div className={`relative aspect-[0.866] w-full ${className}`}>
      <div className="absolute inset-0 bg-loot" style={{ clipPath: clip }} />
      <div
        className="absolute inset-[3px] flex items-center justify-center bg-gradient-to-b from-panel to-ink"
        style={{ clipPath: clip }}
      >
        {children}
      </div>
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-full bg-loot/10 blur-2xl" />
    </div>
  );
}
