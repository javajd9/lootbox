// The real outside world for ./order and ./delivery: the private orders and claim_addresses
// tables, Zinc, Reclaim's zkFetch, the public proofs table and the Solana memo.
//
// How an order is paid: on mainnet with PRIZE_WALLET_SECRET set, in USDC from the prize wallet, order
// by order (Zinc's agent endpoint, ./x402); otherwise from a prepaid Zinc balance (ZINC_API_KEY),
// which on devnet is always Zinc's sandbox.
import { randomUUID } from "node:crypto";
import { Keypair, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { postMemo } from "@/lib/chain/memo";
import { CLUSTER, heliusUrl } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";
import type { DropRecord } from "@/lib/engine/types";
import type { ShippingAddress } from "@/lib/proofs/commitment";
import type { ProofPackage } from "@/lib/proofs/package";
import { trackingPackage, type DeliveryDeps, type DeliveryRow } from "./delivery";
import { orderPackage, type OrderDeps, type OrderRow, type Winner } from "./order";
import { milestoneFacts, orderFacts, zkOptions, type Fact } from "./redact";
import { agentZincClient, type AgentKeys } from "./x402";
import { isTestKey, zincClient, zincSettings, type ZincClient, type ZincSettings, type ZincTracker } from "./zinc";

// Reclaim's zkFetch, loaded only when a proof is due (it's a large package). The Authorization header
// stays private: it's never part of the proof.
async function zkProof(authHeader: string, url: string, facts: Fact[]): Promise<unknown> {
  const appId = process.env.RECLAIM_APP_ID;
  const secret = process.env.RECLAIM_APP_SECRET;
  if (!appId || !secret) throw new Error("Reclaim is not configured (RECLAIM_APP_ID, RECLAIM_APP_SECRET)");
  const { ReclaimClient } = await import("@reclaimprotocol/zk-fetch");
  const { publicOptions, privateOptions } = zkOptions(facts, authHeader);
  return new ReclaimClient(appId, secret).zkFetch(url, publicOptions as any, privateOptions as any, 2, 5_000);
}

export const zincPaidInUsdc = (env: Record<string, string | undefined> = process.env) => CLUSTER === "mainnet-beta" && Boolean(env.PRIZE_WALLET_SECRET);
export const zincConfigured = (env: Record<string, string | undefined> = process.env) => zincPaidInUsdc(env) || Boolean(env.ZINC_API_KEY);

// The prize wallet, which pays for orders. Checked against PRIZE_WALLET, where the prize money is sent.
function prizePayer(): Keypair {
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIZE_WALLET_SECRET!.trim()));
  const published = process.env.PRIZE_WALLET?.trim();
  if (published && payer.publicKey.toBase58() !== published) throw new Error("PRIZE_WALLET_SECRET isn't the key for PRIZE_WALLET");
  return payer;
}

// Each USDC-paid order's key, kept in the private orders table.
function agentKeys(): AgentKeys {
  const db = serverDb();
  return {
    async get(orderId) {
      const { data } = check(await db.from("orders").select("zinc_api_key").eq("zinc_request_id", orderId).maybeSingle(), "load Zinc key");
      return (data?.zinc_api_key as string | null) ?? null;
    },
    async save(dropId, orderId, apiKey, paymentTx) {
      const patch = { zinc_request_id: orderId, zinc_api_key: apiKey, ...(paymentTx ? { payment_tx: paymentTx } : {}) };
      check(await db.from("orders").update(patch).eq("drop_id", dropId), "save Zinc key");
    },
  };
}

interface Zinc {
  client: ZincClient & ZincTracker;
  url(path: string): string;
  auth(orderId: string): Promise<string>; // the Authorization header for reading this order
}

function zinc(conn: Connection): Zinc {
  if (zincPaidInUsdc()) {
    const baseUrl = "https://api.zinc.com";
    const keys = agentKeys();
    const rpcUrl = process.env.SOLANA_RPC_URL || heliusUrl() || undefined;
    const client = agentZincClient({ baseUrl, payer: prizePayer(), conn, rpcUrl, keys });
    return {
      client,
      url: (path) => `${baseUrl}${path}`,
      async auth(orderId) {
        const key = await keys.get(orderId);
        if (!key) throw new Error(`no Zinc key saved for order ${orderId}`);
        return `Bearer ${key}`;
      },
    };
  }
  const s = settings();
  return { client: zincClient(s), url: (path) => `${s.baseUrl}${path}`, auth: async () => s.authHeader };
}

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

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
  const z = zinc(conn);

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

    zinc: z.client,
    prove: async (order) => zkProof(await z.auth(order.id), z.url(orderPath(order.id)), orderFacts(order)),

    async saveProof(d, revealed, proof) {
      const last = await lastProof(d.id);
      if (last?.type === "order") return { hash: last.package_hash }; // saved already, before a crash
      // Paid in USDC: the payment to Zinc is a public Solana transaction, so it goes in the proof too.
      const { data: paid } = check(await db.from("orders").select("payment_tx").eq("drop_id", d.id).maybeSingle(), "load payment");
      const facts = paid?.payment_tx ? { ...revealed, paymentTx: paid.payment_tx as string, paymentCluster: CLUSTER } : revealed;
      const { pkg, hash } = orderPackage(d, facts, proof, new Date().toISOString(), last?.package ?? undefined);
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
  const z = zinc(conn);

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

    zinc: z.client,
    prove: async (timeline, milestone) =>
      zkProof(await z.auth(timeline.order_id), z.url(`${orderPath(timeline.order_id)}/timeline`), milestoneFacts(timeline, milestone)),

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
