"use client";

// Shown when the page can't find a Solana wallet. On a phone that's usually Safari or Chrome, so it
// offers to open this page inside the Phantom or Solflare app; on a computer, to install one.
import { useEffect, useState } from "react";
import { onPhone, openInWalletLinks } from "@/lib/live/wallet";

export function WalletMissing({ fallback }: { fallback?: string }) {
  const [links, setLinks] = useState<{ name: string; href: string }[] | null>(null);
  useEffect(() => setLinks(onPhone() ? openInWalletLinks() : []), []);
  if (links === null) return null;
  if (!links.length) {
    return (
      <p className="mt-3 text-sm text-bad">
        No Solana wallet found in this browser. Install Phantom or Solflare and refresh{fallback ? `, or ${fallback}` : ""}.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-cream/80">Your wallet lives in its app. Open this page there:</p>
      <div className="mt-2 flex gap-2">
        {links.map((l) => (
          <a key={l.name} href={l.href} className="btn-ghost flex-1 text-center">
            Open in {l.name}
          </a>
        ))}
      </div>
    </div>
  );
}
