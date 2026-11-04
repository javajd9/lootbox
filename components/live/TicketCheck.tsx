"use client";

// "Your tickets": paste or connect a wallet to see how many tickets it has in the box.
import { useState } from "react";
import bs58 from "bs58";
import { RULES } from "@/lib/config/rules";

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

const per = RULES.tokensPerTicket.toLocaleString("en-US");

export function YourTickets() {
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
            {wallet && <p className="mt-4 text-sm text-cream/70">Ticket counts show here after the drop&apos;s first snapshot.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
