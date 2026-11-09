// Claims, kept in Supabase's private `claims` table (server only: it uses the service role key).
// Serverless instances share nothing in memory, so every step of a claim is saved here.
import { check, serverDb } from "@/lib/db";
import type { PendingClaim } from "./claims";
import { comesFrom, nonceUsed, type ClaimStatus } from "./status";

export interface ClaimRow {
  id: string;
  drop_id: string;
  wallet: string;
  round: number;
  nonce: string;
  nonce_expires_at: string;
  message: string;
  status: ClaimStatus; // see ./status for what each one means and where it can go
  token: string | null;
  checkout_url: string | null;
  shopify_order_id: string | null;
  address_commitment: string | null;
  address_memo_tx: string | null;
  memo_started_at: string | null;
  completed_at: string | null;
}

const COLUMNS =
  "id, drop_id, wallet, round, nonce, nonce_expires_at, message, status, token, checkout_url, shopify_order_id, address_commitment, address_memo_tx, memo_started_at, completed_at";

export const toPending = (r: ClaimRow): PendingClaim => ({
  dropId: r.drop_id,
  wallet: r.wallet,
  nonce: r.nonce,
  message: r.message,
  expiresAt: Date.parse(r.nonce_expires_at),
  used: nonceUsed(r.status),
});

export const claimStore = {
  async save(claim: PendingClaim, round: number) {
    check(
      await serverDb().from("claims").insert({
        drop_id: claim.dropId,
        wallet: claim.wallet,
        round,
        nonce: claim.nonce,
        nonce_expires_at: new Date(claim.expiresAt).toISOString(),
        message: claim.message,
      }),
      "save claim",
    );
  },

  async byNonce(nonce: string): Promise<ClaimRow | null> {
    const { data } = check(await serverDb().from("claims").select(COLUMNS).eq("nonce", nonce).maybeSingle(), "load claim");
    return data as ClaimRow | null;
  },

  async byToken(token: string): Promise<ClaimRow | null> {
    const { data } = check(await serverDb().from("claims").select(COLUMNS).eq("token", token).maybeSingle(), "load claim");
    return data as ClaimRow | null;
  },

  // Uses the nonce up. Only one request can win this, so a signature can never be replayed.
  async markVerified(nonce: string, token: string): Promise<boolean> {
    const { data } = check(
      await serverDb()
        .from("claims")
        .update({ status: "wallet_verified", token, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("nonce", nonce)
        .eq("status", "nonce_issued")
        .select("id"),
      "verify claim",
    );
    return (data ?? []).length === 1;
  },

  // A checkout this winner already has for this draw round, so signing twice doesn't make two.
  async openCheckout(dropId: string, round: number, wallet: string): Promise<ClaimRow | null> {
    const { data } = check(
      await serverDb()
        .from("claims")
        .select(COLUMNS)
        .eq("drop_id", dropId)
        .eq("round", round)
        .eq("wallet", wallet)
        .eq("status", "checkout_sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "load checkout",
    );
    return data as ClaimRow | null;
  },

  async saveCheckout(id: string, draftOrderId: string, checkoutUrl: string) {
    check(
      await serverDb()
        .from("claims")
        .update({ status: "checkout_sent", shopify_draft_order_id: draftOrderId, checkout_url: checkoutUrl, updated_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", comesFrom("checkout_sent")),
      "save checkout",
    );
  },

  // Finished claims for these drops, for the engine to read on every tick.
  async completed(dropIds: string[]): Promise<ClaimRow[]> {
    if (!dropIds.length) return [];
    const { data } = check(
      await serverDb().from("claims").select(COLUMNS).in("drop_id", dropIds).eq("status", "checkout_complete"),
      "load finished claims",
    );
    return (data ?? []) as ClaimRow[];
  },
};
