import type { Metadata } from "next";
import { legalReady } from "@/lib/config/legal";
import { mono } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Official Rules",
  description: "The official rules for LOOTBOX prize drops: who can win, how tickets and the draw work, claiming, shipping and taxes.",
  // A draft (lib/config/legal.ts not filled in yet) stays out of search results.
  robots: legalReady() ? undefined : { index: false, follow: false },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${mono.variable} mx-auto max-w-3xl px-4 py-12 sm:px-10 lg:py-16`}>
      <article>{children}</article>
    </div>
  );
}
