"use client";

import { useEffect, useState } from "react";
import bs58 from "bs58";
import { mono } from "@/lib/fonts";
import "../legacy.css";

interface SolanaProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding: "utf8"): Promise<{ signature: Uint8Array }>;
}

interface ClaimStatus {
  status: string;
  dropId: string;
  commitment?: string;
  memoUrl?: string;
  salt?: string;
  normalized?: string;
}

function getProvider(): SolanaProvider | undefined {
  const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider };
  return w.phantom?.solana ?? w.solana;
}

// The claim token stays in this browser only, so the winner can come back after the checkout.
const TOKEN_KEY = "lootbox-claim";
const remember = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

export default function ClaimPage() {
  const [dropId, setDropId] = useState("");
  const [wallet, setWallet] = useState<string>();
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string>();
  const [claim, setClaim] = useState<ClaimStatus>();

  useEffect(() => {
    setDropId(new URLSearchParams(window.location.search).get("drop") ?? "");
    try {
      setToken(localStorage.getItem(TOKEN_KEY));
    } catch {}
  }, []);

  // After signing: check every few seconds until Shopify's checkout is finished.
  useEffect(() => {
    if (!token || claim?.status === "checkout_complete") return;
    let stop = false;
    const poll = async () => {
      const res = await fetch(`/api/claims/status?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (stop || !res) return;
      if (res.status === 404) return remember(null), setToken(null);
      if (res.ok) setClaim(await res.json());
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token, claim?.status]);

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
      remember(verifyBody.token);
      setToken(verifyBody.token);
      setCheckoutUrl(verifyBody.checkoutUrl);
      setStatus({ tone: "ok", text: "Wallet verified. Now enter your shipping address at the $0 checkout." });
    } catch (e) {
      setStatus({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const done = claim?.status === "checkout_complete";

  return (
    <div className={`${mono.variable} mx-auto max-w-lg space-y-6 px-4 py-20`}>
      <p className="eyebrow">Winners only</p>
      <h1 className="display text-5xl">Claim your prize</h1>
      <p className="text-cream/70">
        Won a drop? Connect the winning wallet and sign a message to prove it&apos;s yours. Signing is free and can&apos;t move funds.
        Then you&apos;ll enter your shipping address at a $0 checkout. Your details are never published.
      </p>

      {done ? (
        <div className="card space-y-3">
          <p className="text-ok">Claimed! Your prize for {claim.dropId} is being ordered.</p>
          <p className="text-sm text-cream/70">
            Your address is private. Only its fingerprint is public
            {claim.memoUrl && (
              <>
                {" "}
                (
                <a className="underline" href={claim.memoUrl} target="_blank" rel="noreferrer">
                  on-chain
                </a>
                )
              </>
            )}
            . Save the secret code below: with it you can check the fingerprint is your address. Don&apos;t share it.
          </p>
          <p className="break-all font-mono text-xs">
            <span className="hud">Fingerprint</span> {claim.commitment}
          </p>
          {claim.salt ? (
            <>
              <p className="break-all font-mono text-xs">
                <span className="hud">Secret code</span> {claim.salt}
              </p>
              <p className="break-all font-mono text-xs">
                <span className="hud">Address as hashed</span> {claim.normalized}
              </p>
            </>
          ) : (
            <p className="text-mute text-sm">This drop is complete, so LOOTBOX has deleted its copy of your address and secret code.</p>
          )}
          <p className="text-sm text-cream/70">
            When it arrives,{" "}
            <a className="underline" href={`/received?drop=${encodeURIComponent(claim.dropId)}`}>
              confirm you received it
            </a>{" "}
            with the same wallet.
          </p>
        </div>
      ) : token && claim ? (
        <div className="card space-y-4">
          <p className="text-sm">Wallet verified for {claim.dropId}. Enter your shipping address at the $0 checkout; this page updates once it&apos;s done.</p>
          {checkoutUrl && (
            <a className="btn-loot block w-full text-center" href={checkoutUrl} target="_blank" rel="noreferrer">
              Open $0 checkout
            </a>
          )}
          {!checkoutUrl && <p className="text-mute text-sm">Lost the checkout tab? Sign again below to get the link back.</p>}
          <p className="text-mute text-sm">Waiting for the checkout…</p>
        </div>
      ) : null}

      {!done && (
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
            {busy ? "Waiting for signature…" : "Sign & claim"}
          </button>
          {status && (
            <p className={status.tone === "ok" ? "text-ok" : status.tone === "bad" ? "text-bad" : "text-mute"}>{status.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
