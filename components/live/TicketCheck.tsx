"use client";

// "Your tickets": paste or connect a wallet to see how many tickets it has in the box and its odds.
// Demo mode makes up a stable number per wallet. Live, this reads the drop's snapshot data.
import { useState } from "react";
import bs58 from "bs58";
import { sha256 } from "@noble/hashes/sha256";
import { RULES } from "@/lib/config/rules";
import { shortWallet } from "@/lib/live/format";
import { useLive } from "./LiveProvider";

interface SolanaProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
}

function isWallet(s: string) {
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

// Stable fake count per wallet, so the demo feels real and repeatable.
function demoTickets(wallet: string) {
  const b = sha256(new TextEncoder().encode(wallet));
  const r = (b[0] << 8) | b[1];
  return r % 5 === 0 ? 0 : 1 + (r % 1400);
}

const per = RULES.tokensPerTicket.toLocaleString("en-US");

export function YourTickets() {
  const { state, demo } = useLive();
  const totalTickets = state.tickets;
  const [input, setInput] = useState("");
  const [wallet, setWallet] = useState<string>();
  const [error, setError] = useState<string>();

  const check = (w: string) => {
    const value = w.trim();
    if (!isWallet(value)) {
      setError("That doesn't look like a Solana wallet address.");
      setWallet(undefined);
      return;
    }
    setError(undefined);
    setWallet(value);
  };

  const connect = async () => {
    const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider };
    const provider = w.phantom?.solana ?? w.solana;
    if (!provider) return setError("No Solana wallet found. Paste your address instead.");
    const { publicKey } = await provider.connect();
    setInput(publicKey.toString());
    check(publicKey.toString());
  };

  const mine = wallet && demo ? demoTickets(wallet) : 0;
  const odds = totalTickets > 0 ? (mine / totalTickets) * 100 : 0;

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
            <button className="btn-loot shrink-0 px-4 py-2 text-xs">Check</button>
          </form>
          <button onClick={connect} className="hud mt-2 hover:text-loot">or connect wallet</button>

          <div aria-live="polite">
            {error && <p className="mt-3 text-sm text-bad">{error}</p>}
            {wallet && !demo && <p className="mt-4 text-sm text-cream/70">Ticket counts go live when the first snapshot is taken after launch.</p>}
            {wallet && demo && (
              <div className="mt-4">
                <p className="hud normal-case">{shortWallet(wallet)}</p>
                {mine > 0 ? (
                  <>
                    <p className="mt-1 flex items-baseline gap-3">
                      <span className="display text-5xl text-loot">{mine.toLocaleString("en-US")}</span>
                      <span className="hud text-cream">tickets in the box</span>
                    </p>
                    <div className="mt-3 h-1.5 w-full bg-line">
                      <div className="h-full bg-loot" style={{ width: `${Math.max(1, Math.min(100, odds * 20))}%` }} />
                    </div>
                    <p className="hud mt-2">
                      {odds < 0.01 ? "<0.01" : odds.toFixed(2)}% chance to win this drop · 1 ticket = {per} $LOOT
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-cream/70">
                    No tickets yet. Hold at least <span className="text-loot">{per} $LOOT</span> to get your first ticket in the box.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
