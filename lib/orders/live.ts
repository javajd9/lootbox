// The real outside world for ./order: the private orders and claim_addresses tables, Zinc,
// Reclaim's zkFetch, the public proofs table and the Solana memo.
import { randomUUID } from "node:crypto";
import type { Connection, Keypair } from "@solana/web3.js";
import { postMemo } from "@/lib/chain/memo";
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";
import type { DropRecord } from "@/lib/engine/types";
import type { ShippingAddress } from "@/lib/proofs/commitment";
import type { ProofPackage } from "@/lib/proofs/package";
import { orderPackage, type OrderDeps, type OrderRow } from "./order";
import { zkFetchOptions } from "./redact";
import { isTestKey, orderUrl, zincClient, zincSettings, type ZincOrder, type ZincSettings } from "./zinc";

// Reclaim's zkFetch, loaded only when a proof is due (it's a large package).
async function zkProof(s: ZincSettings, order: ZincOrder): Promise<unknown> {
  const appId = process.env.RECLAIM_APP_ID;
  const secret = process.env.RECLAIM_APP_SECRET;
  if (!appId || !secret) throw new Error("Reclaim is not configured (RECLAIM_APP_ID, RECLAIM_APP_SECRET)");
  const { ReclaimClient } = await import("@reclaimprotocol/zk-fetch");
  const { publicOptions, privateOptions } = zkFetchOptions(order, s.authHeader);
  return new ReclaimClient(appId, secret).zkFetch(orderUrl(s, order.id), publicOptions as any, privateOptions as any, 2, 5_000);
}

export function liveOrderDeps(conn: Connection, ops: Keypair): OrderDeps {
  const db = serverDb();
  const zinc = zincSettings();
  // Devnet test drops only ever use Zinc's sandbox, so a test run can't buy anything for real.
  if (CLUSTER === "devnet" && !isTestKey(zinc.apiKey) && process.env.ZINC_ALLOW_LIVE_ON_DEVNET !== "yes") {
    throw new Error("devnet drops need a Zinc test key (zn_test_...), so test runs never spend real money");
  }

  return {
    config: (id) => dropConfig(id),

    async winner(d: DropRecord) {
      const { data: claim } = check(
        await db
          .from("claims")
          .select("id")
          .eq("drop_id", d.id)
          .eq("round", d.round)
          .eq("wallet", d.winner!)
          .eq("status", "checkout_complete")
          .maybeSingle(),
        "load claim",
      );
      if (!claim) return null;
      const { data: row } = check(await db.from("claim_addresses").select("address").eq("claim_id", claim.id).maybeSingle(), "load address");
      return row ? { claimId: claim.id as string, address: row.address as ShippingAddress } : null;
    },

    async load(dropId) {
      const { data } = check(await db.from("orders").select("*").eq("drop_id", dropId).maybeSingle(), "load order");
      return data as OrderRow | null;
    },

    async create(row) {
      // One row per drop (unique): if another tick got here first, keep its row.
      check(await db.from("orders").upsert(row, { onConflict: "drop_id", ignoreDuplicates: true }), "save order");
      const { data } = check(await db.from("orders").select("*").eq("drop_id", row.drop_id).single(), "reload order");
      return data as OrderRow;
    },

    async update(dropId, patch) {
      check(await db.from("orders").update({ ...patch, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("drop_id", dropId), "save order");
    },

    zinc: zincClient(zinc),
    prove: (order) => zkProof(zinc, order),

    async saveProof(d, revealed, proof) {
      // Each drop's proofs form a hash chain (lib/proofs/package): this one links to the last.
      const { data: last } = check(
        await db.from("proofs").select("id, package, package_hash, type").eq("drop_id", d.id).order("seq", { ascending: false }).limit(1).maybeSingle(),
        "load proofs",
      );
      if (last?.type === "order") return { hash: last.package_hash as string }; // saved already, before a crash
      const { pkg, hash } = orderPackage(d, revealed, proof, new Date().toISOString(), (last?.package as ProofPackage | undefined) ?? undefined);
      const { data: saved } = check(
        await db.from("proofs").insert({ drop_id: d.id, seq: pkg.seq, type: "order", package: pkg, package_hash: hash }).select("id").single(),
        "save proof",
      );
      check(await db.from("orders").update({ proof_id: saved!.id }).eq("drop_id", d.id), "link proof");
      return { hash };
    },

    async postMemo(text) {
      const tx = await postMemo(conn, ops, text);
      check(await db.from("proofs").update({ memo_tx: tx }).eq("drop_id", dropIdOf(text)).eq("type", "order"), "save proof memo");
      return tx;
    },

    newKey: () => randomUUID(),
    fallbackPhone: process.env.ZINC_FALLBACK_PHONE,
    now: () => new Date(),
  };
}

const dropIdOf = (memo: string) => memo.split("|")[2];
