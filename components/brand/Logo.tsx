// The LOOTBOX mark: a box whose top edges form a gold check. "A box, verified."
export function LogoMark({ className = "h-8 w-8", glow = false }: { className?: string; glow?: boolean }) {
  return (
    <svg viewBox="222 186 556 628" className={`${className} ${glow ? "animate-glow" : ""}`} aria-hidden="true">
      <path d="M500 236 L728 368 L728 632 L500 764 L272 632 L272 368 Z" fill="none" stroke="#F2EFE8" strokeWidth="40" strokeLinejoin="miter" />
      <path d="M500 505 V764" stroke="#F2EFE8" strokeWidth="40" />
      <path d="M374 428 L500 500 L728 368" fill="none" stroke="#E3A82E" strokeWidth="40" strokeLinejoin="miter" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-7 w-7" />
      {/* phones show the mark alone, leaving room for the live pool and the Buy button */}
      <span className="text-lg font-black tracking-tight max-sm:hidden">LOOTBOX</span>
    </span>
  );
}

// The brand's check stroke, used wherever something is verified.
export function CheckMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 11.5 L9 15 L21 8" fill="none" stroke="#E3A82E" strokeWidth="3.2" />
    </svg>
  );
}

export function CrossMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="#FF5C5C" strokeWidth="3" />
    </svg>
  );
}
