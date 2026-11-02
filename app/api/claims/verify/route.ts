// Step 2 of a claim: the signed message comes back. If it's from the winning wallet (and the prize
// is still theirs to claim), the winner gets a $0 Shopify checkout for their shipping address.
import { NextResponse } from "next/server";
import bs58 from "bs58";
import { claimable, CLAIMABLE_MESSAGES, verifyClaimSignature } from "@/lib/claims/claims";
import { createClaimCheckout, shopifyConfigured } from "@/lib/claims/shopify";
import { claimStore, toPending } from "@/lib/claims/store";
import { dropConfig } from "@/lib/engine/drops";
import { liveStore } from "@/lib/engine/live";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const MESSAGES = {
  unknown_nonce: "Claim session not found. Start again.",
  used: "This claim link was already used.",
  expired: "This claim session expired. Start again.",
  bad_signature: "Signature doesn't match the winning wallet.",
} as const;

export async function POST(req: Request) {
  const { nonce, signature } = (await req.json().catch(() => ({}))) as { nonce?: string; signature?: string };
  if (!nonce || !signature) return NextResponse.json({ error: "Missing nonce or signature." }, { status: 400 });

  const row = await claimStore.byNonce(nonce);
  const result = verifyClaimSignature(row ? toPending(row) : undefined, signature);
  if (!result.ok) return NextResponse.json({ error: MESSAGES[result.reason] }, { status: 401 });

  // Checked again: the deadline may have passed, or the drop been redrawn, since the nonce was issued.
  const drop = (await liveStore().load()).drops.find((d) => d.id === row!.drop_id);
  const ok = claimable(drop, row!.wallet);
  if (!ok.ok) return NextResponse.json({ error: CLAIMABLE_MESSAGES[ok.reason] }, { status: 409 });
  if (drop!.round !== row!.round) return NextResponse.json({ error: CLAIMABLE_MESSAGES.not_winner }, { status: 409 });

  const token = bs58.encode(crypto.getRandomValues(new Uint8Array(24)));
  if (!(await claimStore.markVerified(nonce, token))) return NextResponse.json({ error: MESSAGES.used }, { status: 401 });

  // Signed before and already has a checkout: send them back to it.
  const open = await claimStore.openCheckout(row!.drop_id, row!.round, row!.wallet);
  if (open?.checkout_url && open.token) return NextResponse.json({ status: "checkout_sent", token: open.token, checkoutUrl: open.checkout_url });

  if (!shopifyConfigured()) {
    return NextResponse.json({ error: "Wallet verified, but the address checkout isn't set up yet. Try again soon." }, { status: 503 });
  }
  try {
    const { draftOrderId, checkoutUrl } = await createClaimCheckout(row!.drop_id, dropConfig(row!.drop_id)?.title ?? "Prize", token);
    await claimStore.saveCheckout(row!.id, draftOrderId, checkoutUrl);
    return NextResponse.json({ status: "checkout_sent", token, checkoutUrl });
  } catch (err) {
    console.error("claim checkout failed", err);
    return NextResponse.json({ error: "Wallet verified, but the checkout couldn't be created. Sign again in a minute." }, { status: 502 });
  }
}
