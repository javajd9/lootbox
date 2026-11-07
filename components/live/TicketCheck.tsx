"use client";

// "Your tickets": paste or connect a wallet to see how many tickets it has in the box, worked out
// from the drop's snapshots exactly as the draw will (GET /api/tickets).
import { useState } from "react";
import bs58 from "bs58";
import { RULES } from "@/lib/config/rules";
import { dropNo } from "@/lib/live/format";
import { findWallet, walletError } from "@/lib/live/wallet";
import { WalletMissing } from "@/components/WalletMissing";
import type { TicketsView } from "@/app/api/tickets/route";
import { useLive } from "./LiveProvider";

function isWallet(s: string) {
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

const per = RULES.tokensPerTicket.toLocaleString("en-US");
const n = (x: number) => x.toLocaleString("en-US");

function Result({ view }: { view: TicketsView }) {
  if (!view.drop) {
    return <p className="mt-4 text-sm text-cream/70">No drop is filling right now. Tickets are counted from the next drop&apos;s snapshots.</p>;
  }
  const drop = `Drop ${dropNo(view.drop.number)}`;
  if (!view.snapshots) {
    return (
      <p className="mt-4 text-sm text-cream/70">
        {drop} hasn&apos;t had its first snapshot yet. At each one, every {per} $LOOT in this wallet counts as a ticket.
      </p>
    );
  }
  const odds = view.totalTickets ? ` (${((view.tickets / view.totalTickets) * 100).toFixed(2)}% chance)` : "";
  return (
    <div className="mt-4">
      <p className="text-4xl font-black tabular-nums text-cream">
        {n(view.tickets)} <span className="text-lg font-bold text-cream/70">ticket{view.tickets === 1 ? "" : "s"}</span>
      </p>
      <p className="mt-1 text-sm text-cream/70">
        {view.locked
          ? `Locked for the ${drop} draw, out of ${n(view.totalTickets)}${odds}.`
          : `In ${drop} so far, out of ${n(view.totalTickets)}${odds}. Averaged over ${view.snapshots} snapshot${view.snapshots === 1 ? "" : "s"}, so it moves as more are taken.`}
      </p>
      {view.tickets === 0 && !view.locked && (
        <p className="mt-2 text-sm text-cream/70">
          Hold at least {per} $LOOT in this wallet (a regular wallet like Phantom or Solflare, not an exchange or pool) through the snapshots.
        </p>
      )}
    </div>
  );
}

export function YourTickets() {
  const { live } = useLive();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<TicketsView>();
  const [checked, setChecked] = useState(false);

  const check = async (w: string) => {
    const value = w.trim();
    setView(undefined);
    setChecked(false);
    if (!isWallet(value)) return setError("That doesn't look like a Solana wallet address.");
    setError(undefined);
    if (!live) return setChecked(true); // before launch there's no drop to count
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets?wallet=${encodeURIComponent(value)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Ticket counts are unavailable right now.");
      setView(body as TicketsView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticket counts are unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setMissing(false);
    const wallet = findWallet();
    if (!wallet) return setMissing(true);
    try {
      const address = await wallet.connect();
      setInput(address);
      await check(address);
    } catch (err) {
      setError(walletError(err));
    }
  };

  return (
    <section aria-labelledby="your-tickets" className="border-b border-line bg-ink px-4 py-16 sm:px-10">
      <div className="mx-auto grid max-w-6xl items-center gap-8 md:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="eyebrow">Your tickets</p>
          <h2 id="your-tickets" className="display mt-3 text-4xl sm:text-5xl">How many do you have?</h2>
          <p className="mt-3 text-cream/70">1 ticket for every {per} $LOOT you hold, averaged across the drop&apos;s snapshots.</p>
        </div>
        <div className="border border-line bg-panel p-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              check(input);
            }}
          >
            <input
              className="input font-mono"
              placeholder="Paste your wallet address"
              aria-label="Your Solana wallet address"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
            <button className="btn-loot shrink-0 px-4 py-2 text-xs" disabled={busy}>
              {busy ? "Checking…" : "Check"}
            </button>
          </form>
          <button type="button" onClick={connect} className="btn-ghost mt-3 w-full text-sm">
            Or connect your wallet
          </button>

          <div aria-live="polite">
            {missing && <WalletMissing fallback="paste your address above" />}
            {error && <p className="mt-3 text-sm text-bad">{error}</p>}
            {view && <Result view={view} />}
            {checked && <p className="mt-4 text-sm text-cream/70">Ticket counts show here once the first drop opens and its first snapshot is taken.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
