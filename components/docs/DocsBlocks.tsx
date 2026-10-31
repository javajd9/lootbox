// Building blocks the docs pages use inside MDX.
import { RULE_TEXT } from "@/lib/config/rules";

// One of the drop rules, quoted from lib/config/rules.ts so docs and code say the same thing.
export function Rule({ rule }: { rule: keyof typeof RULE_TEXT }) {
  return (
    <div className="my-6 border-l-2 border-loot bg-panel px-5 py-4">
      <p className="hud mb-1 text-loot">Rule</p>
      <p className="text-cream/80">{RULE_TEXT[rule]}</p>
    </div>
  );
}

export function Callout({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="my-6 border-l-2 border-loot bg-panel px-5 py-4 [&>p]:my-1">
      {title && <p className="hud mb-1 text-loot">{title}</p>}
      {children}
    </div>
  );
}

// Text produced by the real code (claim messages, receipts, formats), shown as-is.
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="my-6">
      {label && <figcaption className="hud mb-2">{label}</figcaption>}
      <pre className="whitespace-pre-wrap border border-line bg-panel p-4 font-mono text-[13px] leading-6 text-cream/90 [overflow-wrap:anywhere]">{children}</pre>
    </figure>
  );
}

// A left-to-right sequence of steps, numbered, for processes like the draw.
export function Flow({ steps }: { steps: [string, string][] }) {
  return (
    <ol className="my-8 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([title, body], i) => (
        <li key={title} className="bg-ink p-5">
          <p className="hud text-loot">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-2 font-bold uppercase tracking-wide">{title}</p>
          <p className="mt-2 text-sm text-cream/70">{body}</p>
        </li>
      ))}
    </ol>
  );
}
