import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { LogoMark, Wordmark } from "@/components/brand/Logo";
import "./globals.css";
import "./legacy.css";

// The brand's one typeface: Inter (latin, variable weight), kept in the repo so builds never depend on
// Google Fonts. (Monospace, for real code only, loads in the docs and proof pages: lib/fonts.ts.)
const sans = localFont({ src: "./fonts/inter-latin.woff2", weight: "100 900", display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "LOOTBOX — Don't trust. Check.", template: "%s — LOOTBOX" },
  description: "Hold $LOOT. Trading fees fund real prizes. Every drop is publicly proven: funded, drawn fairly, bought and delivered.",
};

const NAV = [
  ["Live", "/"],
  ["Docs", "/docs"],
  ["Proof", "/proof/DROP-000"],
  ["Claim", "/claim"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script below adds the `js` class before React loads.
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        {/* Motion that hides things before they animate in only applies once this has run. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="min-h-[100svh]">
        <header className="sticky top-0 z-50 bg-ink">
          <nav className="frame flex h-[60px] items-center justify-between gap-4" aria-label="Main">
            <Link href="/" aria-label="LOOTBOX home" className="shrink-0">
              <Wordmark />
            </Link>
            {/* The homepage puts the live prize pool here once its ticket has scrolled away. */}
            <div id="header-live" className="flex min-w-0 flex-1 justify-center" />
            <div className="flex shrink-0 items-center gap-5 lg:gap-7">
              <div className="hidden gap-5 text-base md:flex lg:gap-7">
                {NAV.map(([label, href]) => (
                  <Link key={href} href={href} className="link font-medium text-cream/80 hover:text-cream">
                    {label}
                  </Link>
                ))}
              </div>
              {/* TODO: link to the pump.fun page once the contract address exists */}
              <Link href="/docs/addresses" className="button px-4 py-2 text-base">Buy $LOOT</Link>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center sm:px-10">
            <LogoMark className="h-10 w-10" />
            <p className="hud">Don&apos;t trust. Check.</p>
            <div className="flex gap-6 text-xs text-mute">
              {NAV.map(([label, href]) => (
                <Link key={href} href={href} className="hover:text-loot">{label}</Link>
              ))}
            </div>
            <p className="max-w-md text-xs text-mute">
              Prizes are funded by $LOOT creator fees. Every step, from funding to delivery, is publicly verifiable.
            </p>          </div>
        </footer>
      </body>
    </html>
  );
}
