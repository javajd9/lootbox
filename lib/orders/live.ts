// The real outside world for ./order and ./delivery: the private orders and claim_addresses
// tables, Zinc, Reclaim's zkFetch, the public proofs table and the Solana memo.
import { randomUUID } from "node:crypto";
import type { Connection, Keypair } from "@solana/web3.js";
import { postMemo } from "@/lib/chain/memo";
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";
import type { DropRecord } from "@/lib/engine/types";
import type { ShippingAddress } from "@/lib/proofs/commitment";
import type { ProofPackage } from "@/lib/proofs/package";
import { trackingPackage, type DeliveryDeps, type DeliveryRow } from "./delivery";
import { orderPackage, type OrderDeps, type OrderRow, type Winner } from "./order";
import { milestoneFacts, orderFacts, zkOptions, type Fact } from "./redact";
import { isTestKey, orderUrl, timelineUrl, zincClient, zincSettings, type ZincSettings } from "./zinc";

// Reclaim's zkFetch, loaded only when a proof is due (it's a large package).
async function zkProof(s: ZincSettings, url: string, facts: Fact[]): Promise<unknown> {
  const appId = process.env.RECLAIM_APP_ID;
  const secret = process.env.RECLAIM_APP_SECRET;
  if (!appId || !secret) throw new Error("Reclaim is not configured (RECLAIM_APP_ID, RECLAIM_APP_SECRET)");
  const { ReclaimClient } = await import("@reclaimprotocol/zk-fetch");
  const { publicOptions, privateOptions } = zkOptions(facts, s.authHeader);
  return new ReclaimClient(appId, secret).zkFetch(url, publicOptions as any, privateOptions as any, 2, 5_000);
}

function settings(): ZincSettings {
  const zinc = zincSettings();
  // Devnet test drops only ever use Zinc's sandbox, so a test run can't buy anything for real.
  if (CLUSTER === "devnet" && !isTestKey(zinc.apiKey) && process.env.ZINC_ALLOW_LIVE_ON_DEVNET !== "yes") {
    throw new Error("devnet drops need a Zinc test key (zn_test_...), so test runs never spend real money");
  }
  return zinc;
}

// The finished claim's private address, for the order and for the leak checks.
async function winnerOf(d: DropRecord): Promise<Winner | null> {
  const db = serverDb();
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
}

async function updateOrder(dropId: string, patch: Record<string, unknown>) {
  check(await serverDb().from("orders").update({ ...patch, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("drop_id", dropId), "save order");
}

// Each drop's proofs form a hash chain (lib/proofs/package): a new one links to the last.
async function lastProof(dropId: string) {
  const { data } = check(
    await serverDb().from("proofs").select("id, package, package_hash, type").eq("drop_id", dropId).order("seq", { ascending: false }).limit(1).maybeSingle(),
    "load proofs",
  );
  return data as { id: number; package: ProofPackage; package_hash: string; type: string } | null;
}

export function liveOrderDeps(conn: Connection, ops: Keypair): OrderDeps {
  const db = serverDb();
  const zinc = settings();

  return {
    config: (id) => dropConfig(id),
    winner: winnerOf,
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

    update: updateOrder,

    zinc: zincClient(zinc),
    prove: (order) => zkProof(zinc, orderUrl(zinc, order.id), orderFacts(order)),

    async saveProof(d, revealed, proof) {
      const last = await lastProof(d.id);
      if (last?.type === "order") return { hash: last.package_hash }; // saved already, before a crash
      const { pkg, hash } = orderPackage(d, revealed, proof, new Date().toISOString(), last?.package ?? undefined);
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

export function liveDeliveryDeps(conn: Connection, ops: Keypair): DeliveryDeps {
  const db = serverDb();
  const zinc = settings();

  return {
    winner: winnerOf,

    async load(dropId) {
      const { data } = check(
        await db
          .from("orders")
          .select("drop_id, status, zinc_request_id, delivery_status, packages, shipped_at, shipped_proof_hash, shipped_memo_tx, delivered_at, delivered_proof_hash, delivered_memo_tx")
          .eq("drop_id", dropId)
          .maybeSingle(),
        "load order",
      );
      return data as DeliveryRow | null;
    },

    update: updateOrder,

    zinc: zincClient(zinc),
    prove: (timeline, milestone) => zkProof(zinc, timelineUrl(zinc, timeline.order_id), milestoneFacts(timeline, milestone)),

    async saveProof(d, milestone, revealed, proof) {
      const last = await lastProof(d.id);
      let saved = last?.type === "tracking" && last.package.revealed.milestone === milestone ? { id: last.id, hash: last.package_hash } : null; // saved already, before a crash
      if (!saved) {
        const { pkg, hash } = trackingPackage(d, revealed, proof, new Date().toISOString(), last?.package ?? undefined);
        const { data } = check(
          await db.from("proofs").insert({ drop_id: d.id, seq: pkg.seq, type: "tracking", package: pkg, package_hash: hash }).select("id").single(),
          "save proof",
        );
        saved = { id: data!.id as number, hash };
      }
      check(await db.from("orders").update({ [`${milestone}_proof_id`]: saved.id }).eq("drop_id", d.id), "link proof");
      return { hash: saved.hash };
    },

    async postMemo(d, milestone, text) {
      const tx = await postMemo(conn, ops, text);
      const { data } = check(await db.from("orders").select(`${milestone}_proof_id`).eq("drop_id", d.id).single(), "load proof id");
      const proofId = (data as Record<string, number> | null)?.[`${milestone}_proof_id`];
      check(await db.from("proofs").update({ memo_tx: tx }).eq("id", proofId), "save proof memo");
      return tx;
    },

    now: () => new Date(),
  };
}

const dropIdOf = (memo: string) => memo.split("|")[2];
