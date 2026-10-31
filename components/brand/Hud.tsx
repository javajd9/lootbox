// A full-width page section in the reel's style: dark (or light) with a soft vignette.

export function HudSection({
  index,
  label,
  tone = "dark",
  className = "",
  children,
  id,
}: {
  index: string;
  label: string;
  tone?: "dark" | "light";
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  const light = tone === "light";
  return (
    <section id={id} aria-label={`${index} ${label}`} className={`relative scroll-mt-14 overflow-hidden ${light ? "bg-cream-dim text-ink" : "bg-ink"} ${className}`}>
      <div className={`pointer-events-none absolute inset-0 ${light ? "vignette-light" : "vignette"}`} />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        {children}
      </div>
    </section>
  );
}
