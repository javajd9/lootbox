// Docs sidebar order. Also drives the previous / next links at the bottom of each page.
// "verify" marks the technical, check-it-yourself pages.

export interface DocsPage {
  title: string;
  href: string;
  verify?: boolean;
}

export const DOCS_NAV: { group: string; pages: DocsPage[] }[] = [
  {
    group: "Basics",
    pages: [
      { title: "Overview", href: "/docs" },
      { title: "Tickets", href: "/docs/tickets" },
      { title: "The prize pool", href: "/docs/prize-pool" },
    ],
  },
  {
    group: "The draw",
    pages: [
      { title: "How the winner is picked", href: "/docs/the-draw" },
      { title: "Reproduce a draw", href: "/docs/reproduce", verify: true },
    ],
  },
  {
    group: "Winning",
    pages: [
      { title: "Claiming a prize", href: "/docs/claiming" },
      { title: "Buying & delivery", href: "/docs/buying-and-delivery" },
      { title: "Privacy", href: "/docs/privacy" },
    ],
  },
  {
    group: "Proof",
    pages: [
      { title: "The 8 proofs", href: "/docs/proofs" },
      { title: "What you're trusting", href: "/docs/trust" },
      { title: "Verify it yourself", href: "/docs/verify", verify: true },
    ],
  },
  {
    group: "Reference",
    pages: [
      { title: "Addresses", href: "/docs/addresses", verify: true },
      { title: "FAQ", href: "/docs/faq" },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((g) => g.pages);
