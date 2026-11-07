"use client";

import { useEffect, useState } from "react";
import bs58 from "bs58";
import type { DropStatus } from "@/lib/data/types";
import { mono } from "@/lib/fonts";
import { shortWallet } from "@/lib/live/format";
import { findWallet, walletError } from "@/lib/live/wallet";
import { WalletMissing } from "@/components/WalletMissing";

// A drawn drop, as the claim page lists it. `open` means it's still waiting for its winner.
export interface ClaimDrop {
  id: string;
  number: number;
  title: string;
  winner: string;
  status: DropStatus;
  open: boolean;
}

const CLOSED: Partial<Record<DropStatus, string>> = {
  claiming: "Claimed · ordering",
  fulfilling: "Claimed · shipping",
  delivered: "Delivered",
  complete: "Complete",
};

interface ClaimStatus {
  status: string;
  dropId: string;
  commitment?: string;
  memoUrl?: string;
  salt?: string;
  normalized?: string;
}

// The claim token stays in this browser only, so the winner can come back after the checkout.
const TOKEN_KEY = "lootbox-claim";
const remember = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

export function ClaimForm({ drops }: { drops: ClaimDrop[] | null }) {
  const open = (drops ?? []).filter((d) => d.open);
  const [dropId, setDropId] = useState(open.length === 1 ? open[0].id : "");
  const [wallet, setWallet] = useState<string>();
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false); // no wallet in this browser
  const [token, setToken] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string>();
  const [claim, setClaim] = useState<ClaimStatus>();

  useEffect(() => {
    // A link like /claim?drop=DROP-001 picks that drop, if it's waiting for a claim.
    const asked = new URLSearchParams(window.location.search).get("drop");
    if (asked && open.some((d) => d.id === asked)) setDropId(asked);
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
    const provider = findWallet();
    setMissing(!provider);
    if (!provider) return;
    let address: string;
    try {
      address = await provider.connect();
    } catch (err) {
      return setStatus({ tone: "bad", text: walletError(err) });
    }
    setWallet(address);
    setStatus(undefined);
    // The connected wallet won one of the open drops: pick it for them.
    const won = open.find((d) => d.winner === address);
    if (won) setDropId(won.id);
  };

  const sign = async () => {
    const provider = findWallet();
    if (!provider || !wallet) return;
    setBusy(true);
    try {
      const start = await fetch("/api/claims/nonce", { method: "POST", body: JSON.stringify({ dropId, wallet }) });
      const startBody = await start.json();
      if (!start.ok) return setStatus({ tone: "bad", text: startBody.error });

      let signature: Uint8Array;
      try {
        signature = await provider.signMessage(startBody.message);
      } catch (err) {
        return setStatus({ tone: "bad", text: walletError(err) });
      }
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
  const picked = open.find((d) => d.id === dropId);

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

      {!done && drops === null && (
        <div className="card">
          <p className="text-cream/70">The drop list can&apos;t be loaded right now. Try again in a minute.</p>
        </div>
      )}

      {!done && drops !== null && drops.length === 0 && (
        <div className="card">
          <p className="text-cream/70">No drop has been drawn yet. Once one is, it shows up here for its winner to claim.</p>
        </div>
      )}

      {!done && drops !== null && drops.length > 0 && (
        <div className="card space-y-4">
          <div className="space-y-2">
            <span className="hud">Drop</span>
            <ul className="space-y-2">
              {drops.map((d) => {
                const isPicked = d.id === dropId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      disabled={!d.open}
                      aria-pressed={isPicked}
                      onClick={() => setDropId(d.id)}
                      className={`grid w-full grid-cols-[2.5rem_1fr] items-center gap-x-3 rounded-sm border px-4 py-3 text-left transition sm:grid-cols-[2.5rem_1fr_auto] ${
                        isPicked ? "border-loot bg-ink" : d.open ? "border-line hover:border-loot" : "border-line text-cream/50"
                      }`}
                    >
                      <span className="row-span-2 font-mono text-loot sm:row-span-1">{String(d.number).padStart(3, "0")}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{d.title}</span>
                        <span className="hud block whitespace-nowrap">
                          Won by <span className="text-xs normal-case tracking-normal text-cream/80">{shortWallet(d.winner)}</span>
                        </span>
                      </span>
                      <span className={`hud mt-1 whitespace-nowrap sm:mt-0 ${d.open ? "text-loot" : ""}`}>
                        {d.open ? (isPicked ? "Selected" : "Claim open") : CLOSED[d.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {open.length === 0 && <p className="text-mute text-sm">Every drawn drop has been claimed. The next winner&apos;s drop shows up here.</p>}
          </div>
          {open.length > 0 && (
            <>
              {wallet ? (
                <p className="break-all text-sm">
                  Connected: <span className="font-mono">{wallet}</span>
                </p>
              ) : (
                <button onClick={connect} className="btn-ghost w-full">Connect wallet</button>
              )}
              {missing && !wallet && <WalletMissing />}
              {wallet && picked && picked.winner !== wallet && (
                <p className="text-bad text-sm">This wallet didn&apos;t win drop {String(picked.number).padStart(3, "0")}. Connect the winning wallet.</p>
              )}
              <button onClick={sign} disabled={!wallet || !picked || busy} className="btn-loot w-full">
                {busy ? "Waiting for signature…" : "Sign & claim"}
              </button>
            </>
          )}
          {status && (
            <p className={status.tone === "ok" ? "text-ok" : status.tone === "bad" ? "text-bad" : "text-mute"}>{status.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
