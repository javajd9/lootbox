// Building blocks the docs pages use inside MDX.
import { RULE_TEXT } from "@/lib/config/rules";
import { sourceUrl } from "@/lib/config/source";

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

// A table built from data, styled like the Markdown tables (for rows read from the code).
export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="my-8 overflow-x-auto border-y border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="hud whitespace-nowrap border-b border-line py-3 pr-6 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="border-b border-line py-3 pr-6 align-top leading-6 text-cream/80 [tr:last-child_&]:border-b-0">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A file or folder in the source, linked to it on GitHub.
export function Src({ path }: { path: string }) {
  return (
    <a
      href={sourceUrl(path)}
      target="_blank"
      rel="noreferrer"
      className="whitespace-nowrap rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[0.85em] text-loot transition hover:border-loot"
    >
      {path}
    </a>
  );
}

// The end of a page: the files that do what the page describes, each linked on GitHub.
export function Source({ files }: { files: [path: string, what: string][] }) {
  return (
    <div className="mt-16 border border-line bg-panel px-5 py-4">
      <p className="hud mb-3 text-loot">In the code</p>
      <ul className="space-y-2 text-sm">
        {files.map(([path, what]) => (
          <li key={path} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <Src path={path} />
            <span className="text-cream/70">{what}</span>
          </li>
        ))}
      </ul>
    </div>
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
