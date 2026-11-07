import type { Metadata } from "next";
import { DocsMobileNav, DocsPager, DocsSidebar } from "@/components/docs/DocsNav";
import { mono } from "@/lib/fonts";

export const metadata: Metadata = {
  title: { default: "Docs — LOOTBOX", template: "%s — LOOTBOX Docs" },
  description: "How LOOTBOX works, and how to verify every drop yourself.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${mono.variable} mx-auto flex max-w-6xl gap-12 px-4 py-12 sm:px-10 lg:py-16`}>
      <DocsSidebar />
      <div className="min-w-0 flex-1">
        <DocsMobileNav />
        <article className="max-w-3xl">{children}</article>
        <div className="max-w-3xl">
          <DocsPager />
        </div>
      </div>
    </div>
  );
}
