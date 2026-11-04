"use client";

// The winner confirms the prize arrived by signing one message with the winning wallet. It
// becomes the drop's last public proof. No claim link needed: the signature is the proof.
import { useEffect, useState } from "react";
import bs58 from "bs58";
import { mono } from "@/lib/fonts";
import "../legacy.css";

interface SolanaProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding: "utf8"): Promise<{ signature: Uint8Array }>;
}

function getProvider(): SolanaProvider | undefined {
  const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider };
  return w.phantom?.solana ?? w.solana;
}

export default function ReceivedPage() {
  const [dropId, setDropId] = useState("");
  const [wallet, setWallet] = useState<string>();
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDropId(new URLSearchParams(window.location.search).get("drop") ?? "");
  }, []);

  const connect = async () => {
    const provider = getProvider();
    if (!provider) return setStatus({ tone: "bad", text: "No Solana wallet found. Install Phantom or Solflare and refresh." });
    const { publicKey } = await provider.connect();
    setWallet(publicKey.toString());
    setStatus(undefined);
  };

  const sign = async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    setBusy(true);
    try {
      const ask = await fetch("/api/receipts/message", { method: "POST", body: JSON.stringify({ dropId, wallet }) });
      const askBody = await ask.json();
      if (!ask.ok) return setStatus({ tone: "bad", text: askBody.error });

      const { signature } = await provider.signMessage(new TextEncoder().encode(askBody.message), "utf8");
      const confirm = await fetch("/api/receipts/confirm", {
        method: "POST",
        body: JSON.stringify({ dropId, wallet, message: askBody.message, signature: bs58.encode(signature) }),
      });
      const confirmBody = await confirm.json();
      if (!confirm.ok) return setStatus({ tone: "bad", text: confirmBody.error });
      setDone(true);
    } catch (e) {
      setStatus({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${mono.variable} mx-auto max-w-lg space-y-6 px-4 py-20`}>
      <p className="eyebrow">Winners only</p>
      <h1 className="display text-5xl">Got your prize?</h1>
      <p className="text-cream/70">
        Once it has arrived, connect the winning wallet and sign one message saying you received it. Signing is free and can&apos;t move
        funds. Your signature becomes the drop&apos;s last public proof: the one only the winner can give.
      </p>

      {done ? (
        <div className="card space-y-3">
          <p className="text-ok">Thanks! Your receipt for {dropId} is published, with its fingerprint on Solana.</p>
          <a className="btn-loot block w-full text-center" href={`/proof/${encodeURIComponent(dropId)}`}>
            See the drop&apos;s proofs
          </a>
        </div>
      ) : (
        <div className="card space-y-4">
          <label className="block text-sm">
            <span className="hud">Drop</span>
            <input className="input mt-1" placeholder="DROP-001" value={dropId} onChange={(e) => setDropId(e.target.value.trim())} />
          </label>
          {wallet ? (
            <p className="break-all text-sm">
              Connected: <span className="font-mono">{wallet}</span>
            </p>
          ) : (
            <button onClick={connect} className="btn-ghost w-full">Connect wallet</button>
          )}
          <button onClick={sign} disabled={!wallet || !dropId || busy} className="btn-loot w-full">
            {busy ? "Waiting for signature…" : "Sign: I received it"}
          </button>
          {status && <p className={status.tone === "ok" ? "text-ok" : "text-bad"}>{status.text}</p>}
        </div>
      )}
    </div>
  );
}
