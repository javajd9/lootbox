"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV, DOCS_PAGES } from "@/lib/config/docs-nav";
import { GITHUB_URL } from "@/lib/config/source";

function VerifyTag() {
  return <span className="ml-2 rounded-sm border border-loot/40 px-1 font-mono text-[9px] uppercase tracking-wider text-loot/80">Verify</span>;
}

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="space-y-8">
      {DOCS_NAV.map((g) => (
        <div key={g.group}>
          <p className="hud mb-3">{g.group}</p>
          <ul className="space-y-1 border-l border-line">
            {g.pages.map((p) => {
              const active = path === p.href;
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px flex items-center border-l py-1 pl-4 text-sm transition ${
                      active ? "border-loot font-bold text-cream" : "border-transparent text-cream/60 hover:border-mute hover:text-cream"
                    }`}
                  >
                    {p.title}
                    {p.verify && <VerifyTag />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hud block transition hover:text-loot">
        Source on GitHub ↗
      </a>
    </nav>
  );
}

export function DocsSidebar() {
  return (
    <aside className="docs-scroll sticky top-20 hidden h-[calc(100vh-6rem)] w-60 shrink-0 overflow-y-auto pb-10 lg:block">
      <Links />
    </aside>
  );
}

// Phones and tablets: the same links in a collapsible menu above the page.
export function DocsMobileNav() {
  const path = usePathname();
  const current = DOCS_PAGES.find((p) => p.href === path);
  return (
    <details className="group mb-8 border border-line bg-panel lg:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span className="hud">
          Docs · <span className="text-cream">{current?.title ?? "Menu"}</span>
        </span>
        <span className="text-loot transition group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-line px-4 py-6">
        <Links onNavigate={() => document.querySelector("details[open]")?.removeAttribute("open")} />
      </div>
    </details>
  );
}

export function DocsPager() {
  const path = usePathname();
  const i = DOCS_PAGES.findIndex((p) => p.href === path);
  if (i === -1) return null;
  const prev = DOCS_PAGES[i - 1];
  const next = DOCS_PAGES[i + 1];
  return (
    <div className="mt-20 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className="border border-line p-4 transition hover:border-loot">
          <span className="hud">← Previous</span>
          <span className="mt-1 block font-bold">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="border border-line p-4 text-right transition hover:border-loot">
          <span className="hud">Next →</span>
          <span className="mt-1 block font-bold">{next.title}</span>
        </Link>
      )}
    </div>
  );
}
