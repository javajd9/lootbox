"use client";

import { useState } from "react";
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

export default function ClaimPage() {
  const [dropId, setDropId] = useState("DROP-001");
  const [wallet, setWallet] = useState<string>();
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const provider = getProvider();
    if (!provider) return setStatus({ tone: "bad", text: "No Solana wallet found. Install Phantom or Solflare and refresh." });
    const { publicKey } = await provider.connect();
    setWallet(publicKey.toString());
    setStatus(undefined);
  };

  const claim = async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    setBusy(true);
    try {
      const start = await fetch("/api/claims/nonce", { method: "POST", body: JSON.stringify({ dropId, wallet }) });
      const startBody = await start.json();
      if (!start.ok) return setStatus({ tone: "bad", text: startBody.error });

      const { signature } = await provider.signMessage(new TextEncoder().encode(startBody.message), "utf8");
      const verify = await fetch("/api/claims/verify", {
        method: "POST",
        body: JSON.stringify({ nonce: startBody.nonce, signature: bs58.encode(signature) }),
      });
      const verifyBody = await verify.json();
      if (!verify.ok) return setStatus({ tone: "bad", text: verifyBody.error });
      if (verifyBody.checkoutUrl) window.location.href = verifyBody.checkoutUrl;
      else setStatus({ tone: "ok", text: verifyBody.next });
    } catch (e) {
      setStatus({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${mono.variable} mx-auto max-w-lg space-y-6 px-4 py-20`}>
      <p className="eyebrow">Winners only</p>
      <h1 className="display text-5xl">Claim your prize</h1>
      <p className="text-cream/70">
        Won a drop? Connect the winning wallet and sign a message to prove it&apos;s yours. Signing is free and can&apos;t move funds.
        Then you&apos;ll enter your shipping address at a $0 checkout. Your details are never published.
      </p>
      <div className="card space-y-4">
        <label className="block text-sm">
          <span className="hud">Drop</span>
          <input className="input mt-1" value={dropId} onChange={(e) => setDropId(e.target.value.trim())} />
        </label>
        {wallet ? (
          <p className="break-all text-sm">
            Connected: <span className="font-mono">{wallet}</span>
          </p>
        ) : (
          <button onClick={connect} className="btn-ghost w-full">Connect wallet</button>
        )}
        <button onClick={claim} disabled={!wallet || busy} className="btn-loot w-full">
          {busy ? "Waiting for signature…" : "Sign & claim"}
        </button>
        {status && (
          <p className={status.tone === "ok" ? "text-ok" : status.tone === "bad" ? "text-bad" : "text-mute"}>{status.text}</p>
        )}
      </div>
    </div>
  );
}
