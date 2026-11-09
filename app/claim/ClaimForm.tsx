"use client";

// The claim page, as three steps the winner moves through:
//
//   sign      pick the drop, connect the winning wallet, sign the one-time message
//   checkout  signed: the $0 Shopify checkout is open, and this page waits for it to finish
//   claimed   the address arrived and its fingerprint is on-chain
//
// The step is worked out in one place (`step`, below) from the claim token kept in this browser
// and what /api/claims/status says about it. A claim that can no longer count (`expired`) goes
// back to `sign` with the reason, rather than waiting on a checkout that will never finish.
import { useEffect, useState } from "react";
import bs58 from "bs58";
import type { ClaimView } from "@/lib/claims/status";
import type { DropStatus } from "@/lib/data/types";
import { stageLabel } from "@/lib/engine/stages";
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

type Step = "sign" | "checkout" | "claimed";

// How far a claimed prize has got, for the winner coming back to this page later.
const AFTER_CLAIM: Partial<Record<DropStatus, string>> = {
  fulfilling: "has been ordered and is on its way",
  delivered: "has been delivered",
  complete: "has been delivered",
};

const EXPIRED = "That claim can no longer be used: the claim window closed, or the prize was redrawn or already claimed. If this wallet is still the winner, sign again.";

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
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string }>(); // the last thing that happened, in words
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false); // no wallet in this browser
  const [token, setToken] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string>(); // from signing just now; after a reload it comes from `claim`
  const [claim, setClaim] = useState<ClaimView>();

  const forget = () => {
    remember(null);
    setToken(null);
    setClaim(undefined);
    setCheckoutUrl(undefined);
  };

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
      if (res.status === 404) return forget();
      if (!res.ok) return;
      const view = (await res.json()) as ClaimView;
      if (stop) return;
      if (view.status === "expired") {
        forget();
        setNote({ tone: "bad", text: EXPIRED });
      } else setClaim(view);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token, claim?.status]); // eslint-disable-line react-hooks/exhaustive-deps -- forget only sets state

  const connect = async () => {
    const provider = findWallet();
    setMissing(!provider);
    if (!provider) return;
    let address: string;
    try {
      address = await provider.connect();
    } catch (err) {
      return setNote({ tone: "bad", text: walletError(err) });
    }
    setWallet(address);
    setNote(undefined);
    // The connected wallet won one of the open drops: pick it for them.
    const won = open.find((d) => d.winner === address);
    if (won) setDropId(won.id);
  };

  const sign = async () => {
    const provider = findWallet();
    if (!provider || !wallet) return;
    setBusy(true);
    setNote(undefined); // the last try's message doesn't sit next to this one
    try {
      const start = await fetch("/api/claims/nonce", { method: "POST", body: JSON.stringify({ dropId, wallet }) });
      const startBody = await start.json();
      if (!start.ok) return setNote({ tone: "bad", text: startBody.error });

      let signature: Uint8Array;
      try {
        signature = await provider.signMessage(startBody.message);
      } catch (err) {
        return setNote({ tone: "bad", text: walletError(err) });
      }
      const verify = await fetch("/api/claims/verify", {
        method: "POST",
        body: JSON.stringify({ nonce: startBody.nonce, signature: bs58.encode(signature) }),
      });
      const verifyBody = await verify.json();
      if (!verify.ok) return setNote({ tone: "bad", text: verifyBody.error });
      remember(verifyBody.token);
      setToken(verifyBody.token);
      setClaim(undefined); // a claim from before (an earlier drop's, say) is no longer the one on this page
      setCheckoutUrl(verifyBody.checkoutUrl);
      setNote({ tone: "ok", text: "Wallet verified. Now enter your shipping address at the $0 checkout." });
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const step: Step = claim?.status === "checkout_complete" ? "claimed" : token && (claim || checkoutUrl) ? "checkout" : "sign";
  const checkout = checkoutUrl ?? claim?.checkoutUrl;
  const picked = open.find((d) => d.id === dropId);
  const claimedDrop = drops?.find((d) => d.id === claim?.dropId);
  // Once claimed, the form comes back only if another drop is waiting for this visitor to claim it.
  const showForm = (step !== "claimed" || open.length > 0) && drops !== null && drops.length > 0;

  return (
    <div className={`${mono.variable} mx-auto max-w-lg space-y-6 px-4 py-20`}>
      <p className="eyebrow">Winners only</p>
      <h1 className="display text-5xl">Claim your prize</h1>
      <p className="text-cream/70">
        Won a drop? Connect the winning wallet and sign a message to prove it&apos;s yours. Signing is free and can&apos;t move funds.
        Then you&apos;ll enter your shipping address at a $0 checkout. Your details are never published.
      </p>

      {step === "claimed" && claim ? (
        <div className="card space-y-3">
          <p className="text-ok">
            Claimed! Your prize for {claim.dropId} {(claimedDrop && AFTER_CLAIM[claimedDrop.status]) ?? "is being ordered"}.
          </p>
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
      ) : step === "checkout" ? (
        <div className="card space-y-4">
          <p className="text-sm">
            Wallet verified for {claim?.dropId ?? dropId}. Enter your shipping address at the $0 checkout; this page updates once it&apos;s done.
          </p>
          {checkout && (
            <a className="btn-loot block w-full text-center" href={checkout} target="_blank" rel="noreferrer">
              Open $0 checkout
            </a>
          )}
          {!checkout && <p className="text-mute text-sm">The checkout link isn&apos;t ready. Sign again below to get it.</p>}
          <p className="text-mute text-sm">Waiting for the checkout…</p>
        </div>
      ) : null}

      {step !== "claimed" && drops === null && (
        <div className="card">
          <p className="text-cream/70">The drop list can&apos;t be loaded right now. Try again in a minute.</p>
        </div>
      )}

      {step !== "claimed" && drops !== null && drops.length === 0 && (
        <div className="card">
          <p className="text-cream/70">No drop has been drawn yet. Once one is, it shows up here for its winner to claim.</p>
        </div>
      )}

      {showForm && drops && (
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
                        {d.open ? (isPicked ? "Selected" : "Claim open") : stageLabel(d.status, true)}
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
          {note && <p className={note.tone === "ok" ? "text-ok" : "text-bad"}>{note.text}</p>}
        </div>
      )}
      {/* with no form to sit under (say the drop is being redrawn right now), the message still shows */}
      {note && !showForm && <p className={note.tone === "ok" ? "text-ok" : "text-bad"}>{note.text}</p>}
    </div>
  );
}
