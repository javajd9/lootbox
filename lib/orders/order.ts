// Buying a claimed prize, one small step per engine tick. Nothing here waits for Zinc: each call
// looks at the saved order record, does the next thing that's due, saves it, and returns.
//
//   1. no record yet       -> check the price caps, save the record (with its idempotency key), send the order
//   2. sent, not confirmed -> read Zinc's status; still working means "try again next tick"
//   3. placed              -> zkTLS proof of Zinc's order record (personal details left out), saved publicly
//   4. proof saved         -> its fingerprint on-chain: LOOTBOX|v1|<drop>|ordered|<hash>
//   5. memo posted         -> done; the drop moves on to `fulfilling`
//
// Never two orders for one drop: the record is saved before Zinc is asked, a repeat sends the same
// idempotency key (Zinc makes at most one order per key), and the database allows one row per drop.
import { fingerprintMemo } from "@/lib/chain/memo";
import type { DropConfig } from "@/lib/engine/drops";
import type { DropRecord, OrderResult } from "@/lib/engine/types";
import type { ShippingAddress } from "@/lib/proofs/commitment";
import { buildPackage, hashPackage, type ProofPackage } from "@/lib/proofs/package";
import { assertNoPII, PIILeakError } from "@/lib/proofs/pii-guard";
import { orderCap, overCap, ZINC_ORDER_FEE_CENTS, type OrderLine } from "./price";
import { winnerPII } from "./redact";
import { ZincError, type ZincAddress, type ZincClient, type ZincOrder, type ZincStatus } from "./zinc";

export interface OrderRow {
  drop_id: string;
  claim_id: string;
  round: number;
  idempotency_key: string;
  max_price_cents: number;
  items: OrderLine[];
  zinc_request_id: string | null;
  zinc_status: ZincStatus | null;
  status: "pending" | "placed" | "failed" | "cancelled";
  merchant_order_ids: string[] | null;
  total_cents: number | null;
  error: string | null;
  placed_at: string | null;
  proof_hash: string | null;
  memo_tx: string | null;
}

export interface Winner {
  claimId: string;
  address: ShippingAddress;
  email?: string;
}

export interface OrderDeps {
  config(dropId: string): DropConfig | undefined;
  winner(drop: DropRecord): Promise<Winner | null>; // the finished claim's private address
  load(dropId: string): Promise<OrderRow | null>;
  create(row: OrderRow): Promise<OrderRow>; // inserts once; if a row already exists, returns that one
  update(dropId: string, patch: Partial<OrderRow>): Promise<void>;
  zinc: ZincClient;
  prove(order: ZincOrder): Promise<unknown>; // Reclaim zkFetch of GET /orders/{id}, proving the facts in ./redact
  saveProof(drop: DropRecord, revealed: Record<string, unknown>, proof: unknown): Promise<{ hash: string }>;
  postMemo(text: string): Promise<string>;
  newKey(): string;
  fallbackPhone?: string;
  now(): Date;
}

const WORKING = new Set<ZincStatus>(["pending", "in_progress"]);

export async function orderStep(drop: DropRecord, deps: OrderDeps): Promise<OrderResult> {
  let row = await deps.load(drop.id);

  if (!row) {
    const cap = orderCap(deps.config(drop.id)?.prize, drop.goalCents, ZINC_ORDER_FEE_CENTS);
    if (!cap.ok) return { ok: false, reason: `can't order: ${cap.reason}` };
    const winner = await deps.winner(drop);
    if (!winner) return { ok: false, reason: "can't order: no finished claim with an address for this draw round" };
    row = await deps.create({
      drop_id: drop.id,
      claim_id: winner.claimId,
      round: drop.round,
      idempotency_key: deps.newKey(),
      max_price_cents: cap.maxPriceCents,
      items: cap.lines,
      zinc_request_id: null,
      zinc_status: null,
      status: "pending",
      merchant_order_ids: null,
      total_cents: null,
      error: null,
      placed_at: null,
      proof_hash: null,
      memo_tx: null,
    });
  }
  if (row.status === "failed" || row.status === "cancelled") return { ok: false, reason: `the order ${row.status}: ${row.error ?? "see the orders table"}` };

  // 1. Send it (again, after a crash: the same key can't make a second order).
  if (!row.zinc_request_id) {
    const winner = await deps.winner(drop);
    if (!winner || winner.claimId !== row.claim_id) return { ok: false, reason: "can't order: the saved claim's address is missing" };
    const address = zincAddress(winner.address, deps.fallbackPhone);
    if (!address.ok) return { ok: false, reason: `can't order: ${address.reason}` };
    let order: ZincOrder;
    try {
      order = await deps.zinc.createOrder({
        products: row.items.map((l) => ({ url: l.url, quantity: l.quantity })),
        max_price: row.max_price_cents,
        shipping_address: address.value,
        idempotency_key: row.idempotency_key,
        metadata: { lootbox_drop: drop.id },
        po_number: drop.id,
      });
    } catch (err) {
      const existing = err instanceof ZincError && err.code === "already_exists" ? String(err.details?.identifier ?? "") : "";
      if (existing) order = await deps.zinc.getOrder(existing);
      else if (err instanceof ZincError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        // Zinc refused it (bad address, no funds, ...). Only the error code is kept: messages can echo the address.
        await deps.update(drop.id, { status: "failed", error: err.code });
        return { ok: false, reason: `Zinc refused the order (${err.code})` };
      } else throw err; // network trouble or Zinc down: try again next tick
    }
    row = { ...row, zinc_request_id: order.id, zinc_status: order.status };
    await deps.update(drop.id, { zinc_request_id: order.id, zinc_status: order.status });
  }

  // 2. Placed with the retailer yet?
  if (row.status !== "placed") {
    const order = await deps.zinc.getOrder(row.zinc_request_id!);
    const checked = { zinc_status: order.status };
    if (WORKING.has(order.status)) {
      await deps.update(drop.id, checked);
      return { waiting: `Zinc is still placing the order (${order.status})` };
    }
    if (order.status !== "order_placed") {
      const error = order.job_result?.error_type || order.status;
      await deps.update(drop.id, { ...checked, status: order.status === "order_failed" ? "failed" : "cancelled", error });
      return { ok: false, reason: `the Zinc order didn't go through (${error})` };
    }
    const total = order.job_result?.price_components?.total ?? null;
    row = { ...row, status: "placed", total_cents: total, merchant_order_ids: order.merchant_order_ids ?? [], placed_at: deps.now().toISOString() };
    await deps.update(drop.id, { ...checked, status: "placed", total_cents: total, merchant_order_ids: row.merchant_order_ids, placed_at: row.placed_at });
    if (overCap(total, row.max_price_cents)) return { ok: false, reason: `Zinc's total (${total}c) is over the ${row.max_price_cents}c cap; check the order before it ships` };
  }

  // 3. The proof, with nothing personal in it.
  if (!row.proof_hash) {
    const winner = await deps.winner(drop);
    if (!winner) return { ok: false, reason: "can't check the proof: the claim's address is missing" };
    const proof = await deps.prove(await deps.zinc.getOrder(row.zinc_request_id!));
    if (!proof) throw new Error("zkFetch returned no proof"); // try again next tick
    const revealed = revealedOf(proof);
    try {
      assertNoPII(proof, winnerPII(winner.address, winner.email));
    } catch (err) {
      if (err instanceof PIILeakError) return { ok: false, reason: `the order proof contained personal details (${err.fields.join(", ")}); it was not saved` };
      throw err;
    }
    const { hash } = await deps.saveProof(drop, revealed, proof);
    row = { ...row, proof_hash: hash };
    await deps.update(drop.id, { proof_hash: hash });
  }

  // 4. Its fingerprint, on-chain.
  if (!row.memo_tx) {
    const memo = await deps.postMemo(fingerprintMemo(drop.id, "ordered", row.proof_hash!));
    await deps.update(drop.id, { memo_tx: memo });
  }
  return { ok: true };
}

// The proven facts (the regexes' named groups), plus the product links the proof matched.
export function revealedOf(proof: unknown): Record<string, unknown> {
  const p = proof as { extractedParameterValues?: Record<string, unknown>; claimData?: { parameters?: string } } | null;
  const out: Record<string, unknown> = { ...(p?.extractedParameterValues ?? {}) };
  try {
    const params = JSON.parse(p?.claimData?.parameters ?? "{}") as { url?: string; responseMatches?: { value: string }[] };
    out.zincUrl = params.url;
    out.products = (params.responseMatches ?? [])
      .map((m) => /^"url":\\s\*"(.*)"$/.exec(m.value)?.[1]?.replace(/\\(.)/g, "$1"))
      .filter(Boolean);
  } catch {
    // no parameters to read; the extracted values stand alone
  }
  return out;
}

// The proof package that's published and hashed (see lib/proofs/package).
export function orderPackage(drop: DropRecord, revealed: Record<string, unknown>, proof: unknown, createdAt: string, prev?: ProofPackage) {
  const pkg = buildPackage({ dropId: drop.id, type: "order", createdAt, revealed: { source: "zinc", ...revealed }, attestation: proof }, prev);
  return { pkg, hash: hashPackage(pkg) };
}

export function zincAddress(a: ShippingAddress, fallbackPhone?: string): { ok: true; value: ZincAddress } | { ok: false; reason: string } {
  const parts = a.name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ok: false, reason: "the address has no name" };
  const phone = (a.phone || fallbackPhone || "").trim();
  if (!phone) return { ok: false, reason: "the address has no phone number (set ZINC_FALLBACK_PHONE)" };
  return {
    ok: true,
    value: {
      first_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0],
      last_name: parts.at(-1)!,
      address_line1: a.line1,
      address_line2: a.line2 || null,
      city: a.city,
      state: a.state || null,
      postal_code: a.zip,
      phone_number: phone,
      country: a.country || "US",
    },
  };
}
