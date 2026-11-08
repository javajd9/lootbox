// How Markdown elements in the docs are styled, plus the custom blocks available in every .mdx page.
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Callout, CodeBlock, Flow, Rule, Source, Src } from "@/components/docs/DocsBlocks";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (p) => <h1 className="display text-4xl sm:text-6xl" {...p} />,
    h2: (p) => <h2 className="display mb-4 mt-16 text-2xl sm:text-3xl" {...p} />,
    h3: (p) => <h3 className="mb-2 mt-10 text-lg font-bold" {...p} />,
    p: (p) => <p className="my-4 leading-7 text-cream/80" {...p} />,
    ul: (p) => <ul className="my-4 list-disc space-y-2 pl-5 leading-7 text-cream/80 marker:text-loot" {...p} />,
    ol: (p) => <ol className="my-4 list-decimal space-y-2 pl-5 leading-7 text-cream/80 marker:font-mono marker:text-loot" {...p} />,
    strong: (p) => <strong className="font-bold text-cream" {...p} />,
    a: ({ href = "", ...p }) =>
      href.startsWith("/") ? (
        <Link href={href} className="text-loot underline decoration-loot/40 underline-offset-4 hover:decoration-loot" {...p} />
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className="text-loot underline decoration-loot/40 underline-offset-4 hover:decoration-loot" {...p} />
      ),
    code: (p) => <code className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[0.85em] text-cream" {...p} />,
    pre: (p) => (
      <pre
        className="my-6 overflow-x-auto border border-line bg-panel p-4 font-mono text-[13px] leading-6 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0"
        {...p}
      />
    ),
    blockquote: (p) => <blockquote className="my-6 border-l-2 border-loot pl-5 text-lg text-cream [&>p]:text-cream" {...p} />,
    hr: () => <hr className="my-14 border-line" />,
    table: (p) => (
      <div className="my-8 overflow-x-auto border-y border-line">
        <table className="w-full border-collapse text-left text-sm" {...p} />
      </div>
    ),
    th: (p) => <th className="hud whitespace-nowrap border-b border-line py-3 pr-6 font-normal" {...p} />,
    td: (p) => <td className="border-b border-line py-3 pr-6 align-top leading-6 text-cream/80 [tr:last-child_&]:border-b-0" {...p} />,
    Callout,
    CodeBlock,
    Rule,
    Flow,
    Source,
    Src,
    ...components,
  };
}
