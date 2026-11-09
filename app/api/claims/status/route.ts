// Where a claim stands, for the winner's claim page. Only someone holding the claim token (the
// winner, who got it after signing) can ask. Once finished, it returns the salt, so the winner can
// check the on-chain fingerprint against their own address, until the drop completes and the
// address and salt are deleted (lib/engine/live.ts, complete).
import { NextResponse } from "next/server";
import { explorerTx } from "@/lib/chain/solana";
import type { ClaimView } from "@/lib/claims/status";
import { claimStore } from "@/lib/claims/store";
import { check, serverDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const claim = token ? await claimStore.byToken(token) : null;
  if (!claim) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  if (claim.status !== "checkout_complete") {
    // The checkout link again while it's open, so a winner who closed the tab doesn't have to sign twice.
    const view: ClaimView = { status: claim.status, dropId: claim.drop_id, checkoutUrl: (claim.status === "checkout_sent" && claim.checkout_url) || undefined };
    return NextResponse.json(view);
  }
  const { data } = check(await serverDb().from("claim_addresses").select("salt, normalized").eq("claim_id", claim.id).maybeSingle(), "load address");
  const view: ClaimView = {
    status: claim.status,
    dropId: claim.drop_id,
    commitment: claim.address_commitment,
    memoTx: claim.address_memo_tx,
    memoUrl: claim.address_memo_tx ? explorerTx(claim.address_memo_tx) : undefined,
    salt: data?.salt,
    normalized: data?.normalized,
  };
  return NextResponse.json(view);
}
