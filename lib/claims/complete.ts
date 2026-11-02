// The last step of a claim: Shopify's order webhook brings the winner's shipping address. It's
// stored privately, its salted hash is posted on-chain as the public fingerprint, and the claim is
// marked finished. The engine picks that up on its next tick (see lib/engine/claims.ts).
//
// Shopify retries a webhook until it gets a 200, so every step here is safe to repeat.
import { fingerprintMemo, postMemo } from "@/lib/chain/memo";
import { connection, opsWallet } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { liveStore } from "@/lib/engine/live";
import { makeCommitment, normalizeAddress } from "@/lib/proofs/commitment";
import { claimable } from "./claims";
import { claimTokenOf, shippingAddressOf, type ShopifyOrder } from "./shopify";
import { claimStore } from "./store";

const MEMO_RETRY_MS = 2 * 60_000; // a delivery that started posting and died frees the claim after this

// `retry`: answer with an error so Shopify sends it again later.
export type Outcome = { retry: false; note: string } | { retry: true; note: string };

export async function completeClaim(order: ShopifyOrder): Promise<Outcome> {
  const token = claimTokenOf(order);
  if (!token) return { retry: false, note: "not a LOOTBOX claim order" };
  const claim = await claimStore.byToken(token);
  if (!claim) return { retry: false, note: "unknown claim token" };
  if (claim.status === "checkout_complete") return { retry: false, note: "already complete" };

  const db = serverDb();
  const orderId = String(order.id);
  const now = new Date();

  // Still this winner's prize, in this draw round, before the deadline?
  const drop = (await liveStore().load()).drops.find((d) => d.id === claim.drop_id);
  const ok = claimable(drop, claim.wallet, now.getTime());
  if (!ok.ok || drop!.round !== claim.round) {
    check(await db.from("claims").update({ status: "expired", shopify_order_id: orderId, updated_at: now.toISOString() }).eq("id", claim.id), "expire claim");
    console.warn(`claim ${claim.id} for ${claim.drop_id} arrived but can't count: ${ok.ok ? "the drop was redrawn" : ok.reason}`);
    return { retry: false, note: "claim no longer valid" };
  }

  const address = shippingAddressOf(order);
  if (!address) return { retry: false, note: "order has no shipping address" };

  // The address and its salted hash, made once: a repeat delivery reuses the same salt and hash.
  const { data: saved } = check(await db.from("claim_addresses").select("commitment").eq("claim_id", claim.id).maybeSingle(), "load address");
  let commitment = saved?.commitment as string | undefined;
  if (!commitment) {
    const c = makeCommitment(address);
    check(
      await db.from("claim_addresses").upsert(
        { claim_id: claim.id, drop_id: claim.drop_id, shopify_order_id: orderId, address, normalized: normalizeAddress(address), salt: c.salt, commitment: c.commitment },
        { onConflict: "claim_id", ignoreDuplicates: true },
      ),
      "save address",
    );
    const { data } = check(await db.from("claim_addresses").select("commitment").eq("claim_id", claim.id).single(), "reload address");
    commitment = data!.commitment as string;
  }

  // The public fingerprint, posted once even if two deliveries arrive together.
  let memoTx = claim.address_memo_tx;
  if (!memoTx) {
    const { data: mine } = check(
      await db
        .from("claims")
        .update({ memo_started_at: now.toISOString() })
        .eq("id", claim.id)
        .is("address_memo_tx", null)
        .or(`memo_started_at.is.null,memo_started_at.lt.${new Date(now.getTime() - MEMO_RETRY_MS).toISOString()}`)
        .select("id"),
      "start fingerprint",
    );
    if (!mine?.length) return { retry: true, note: "another delivery is posting the fingerprint" };
    memoTx = await postMemo(connection(), opsWallet(), fingerprintMemo(claim.drop_id, "address", commitment));
    check(await db.from("claims").update({ address_memo_tx: memoTx }).eq("id", claim.id), "save fingerprint");
  }

  check(
    await db
      .from("claims")
      .update({
        status: "checkout_complete",
        shopify_order_id: orderId,
        address_commitment: commitment,
        completed_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", claim.id),
    "finish claim",
  );
  return { retry: false, note: `claimed; fingerprint ${memoTx}` };
}
