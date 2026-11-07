"use client";

// The $LOOT contract address with a copy button, so nobody has to retype (or trust a lookalike of) it.
// Addresses are case-sensitive, so it's never uppercased. `onLight` is for the cream hero ticket.
import { useState } from "react";

export function CopyAddress({ address, label = "CA", onLight = false }: { address: string; label?: string; onLight?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the full address is in the title and selectable.
    }
  };
  const tone = onLight
    ? { box: "border-ink/25 text-ink/85 hover:border-ink/60 hover:text-ink", soft: "text-ink/60", done: "text-ink" }
    : { box: "border-line text-cream/80 hover:border-loot hover:text-cream", soft: "text-mute", done: "text-loot" };
  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      aria-label={`Copy the $LOOT contract address, ${address}`}
      className={`inline-flex max-w-full items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-xs normal-case transition-colors ${tone.box}`}
    >
      <span className={`font-sans font-semibold uppercase tracking-wider ${tone.soft}`}>{label}</span>
      <span className="truncate">
        {address.slice(0, 6)}…{address.slice(-6)}
      </span>
      <span aria-live="polite" className={copied ? tone.done : tone.soft}>
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
