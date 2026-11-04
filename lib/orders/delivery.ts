// Following the prize to the winner's door, one small step per engine tick, like ./order:
//
//   1. not delivered yet  -> read the order from Zinc: how its packages are doing (counted, never kept)
//   2. a package moving   -> zkTLS proof of Zinc's `shipped` milestone (carrier, time), fingerprinted:
//                            LOOTBOX|v1|<drop>|shipped|<hash>
//   3. every package in   -> Zinc's timeline shows the `delivered` milestone; its time is saved
//   4. delivered          -> zkTLS proof of that milestone (time), fingerprinted:
//                            LOOTBOX|v1|<drop>|delivered|<hash>
//   5. memo posted        -> done; the drop moves on to `delivered`
//
// Each proof shows only the order id, the milestone and its time (and the carrier, once shipped).
// Tracking numbers and carrier scans never leave Zinc: a carrier's page can show the delivery city
// or ZIP, so the engine only counts packages and reads their status.
import { fingerprintMemo } from "@/lib/chain/memo";
import type { DeliveryResult, DropRecord } from "@/lib/engine/types";
import { buildPackage, hashPackage, type ProofPackage } from "@/lib/proofs/package";
import { assertNoPII, findPII, PIILeakError } from "@/lib/proofs/pii-guard";
import type { OrderRow, Winner } from "./order";
import { milestoneFacts, revealedSpans, winnerPII, type Milestone } from "./redact";
import type { ZincOrder, ZincTimeline, ZincTracker } from "./zinc";

export type ShipmentState = "awaiting_tracking" | "pending" | "in_transit" | "available_for_pickup" | "undeliverable" | "delivered";

// The delivery columns of the private orders row (see migration 0007).
export interface DeliveryRow extends Pick<OrderRow, "drop_id" | "status" | "zinc_request_id"> {
  delivery_status: ShipmentState | null;
  packages: number | null;
  shipped_at: string | null;
  shipped_proof_hash: string | null;
  shipped_memo_tx: string | null;
  delivered_at: string | null;
  delivered_proof_hash: string | null;
  delivered_memo_tx: string | null;
}

export interface DeliveryDeps {
  winner(drop: DropRecord): Promise<Winner | null>; // for the leak check only
  load(dropId: string): Promise<DeliveryRow | null>;
  update(dropId: string, patch: Partial<DeliveryRow>): Promise<void>;
  zinc: ZincTracker;
  prove(timeline: ZincTimeline, milestone: Milestone): Promise<unknown>; // Reclaim zkFetch of GET /orders/{id}/timeline, proving ./redact's milestoneFacts
  saveProof(drop: DropRecord, milestone: Milestone, revealed: Record<string, unknown>, proof: unknown): Promise<{ hash: string }>;
  postMemo(drop: DropRecord, milestone: Milestone, text: string): Promise<string>;
  now(): Date;
}

// All of an order's packages, as one state. Delivered only once every package is.
export function shipmentState(order: ZincOrder): ShipmentState {
  const statuses = (order.tracking_numbers ?? []).map((p) => p.status ?? "pending");
  if (!statuses.length) return "awaiting_tracking";
  if (statuses.includes("undeliverable")) return "undeliverable";
  if (statuses.every((s) => s === "delivered")) return "delivered";
  if (statuses.includes("available_for_pickup")) return "available_for_pickup";
  return statuses.some((s) => s === "in_transit" || s === "delivered") ? "in_transit" : "pending";
}

const WAITING: Record<Exclude<ShipmentState, "delivered" | "undeliverable">, string> = {
  awaiting_tracking: "the retailer hasn't shipped it yet",
  pending: "a shipping label is made; the carrier hasn't picked it up yet",
  in_transit: "on its way",
  available_for_pickup: "a package is waiting at a carrier facility for the winner to collect",
};

export async function deliveryStep(drop: DropRecord, deps: DeliveryDeps): Promise<DeliveryResult> {
  let row = await deps.load(drop.id);
  if (!row?.zinc_request_id || row.status !== "placed") return { ok: false, reason: "can't follow the delivery: no placed order on record for this drop" };
  const id = row.zinc_request_id;

  // 1. How the packages are doing.
  let state: ShipmentState = "delivered";
  if (!row.delivered_at) {
    const order = await deps.zinc.getOrder(id);
    if (order.status === "cancelled" || order.status === "cancelled_by_retailer") {
      await deps.update(drop.id, { status: "cancelled" });
      return { ok: false, reason: `the order was ${order.status.replaceAll("_", " ")} after it was placed (Zinc refunds its wallet); it needs ordering again by hand` };
    }
    state = shipmentState(order);
    const packages = order.tracking_numbers?.length ?? 0;
    if (state !== row.delivery_status || packages !== row.packages) await deps.update(drop.id, { delivery_status: state, packages });
    if (state === "awaiting_tracking" || state === "pending") return { waiting: WAITING[state] };
  }

  // 2. Shipped, proven once. Skipped if Zinc never reports a package moving before it's delivered.
  const shippedDue = !row.shipped_memo_tx && !row.delivered_proof_hash;
  if (!shippedDue && state !== "delivered") return state === "undeliverable" ? undeliverable() : { waiting: WAITING[state] };
  const timeline = await deps.zinc.getTimeline(id);
  const shipped = timeline.milestones.find((m) => m.type === "shipped");
  if (shippedDue && shipped) {
    const r = await proveMilestone(drop, deps, row, timeline, "shipped", zincTime(shipped.occurred_at) ?? deps.now().toISOString());
    if ("reason" in r) return { ok: false, reason: r.reason };
    row = r.row;
  }
  if (state === "undeliverable") return undeliverable();
  if (state !== "delivered") return { waiting: WAITING[state] };

  // 3-4. Delivered: Zinc's own word that every package is in, then its proof.
  const delivered = timeline.milestones.find((m) => m.type === "delivered");
  if (!row.delivered_at && !delivered) return { waiting: "every package shows delivered; waiting for Zinc to mark the order delivered" };
  const r = await proveMilestone(drop, deps, row, timeline, "delivered", row.delivered_at ?? zincTime(delivered!.occurred_at) ?? deps.now().toISOString());
  if ("reason" in r) return { ok: false, reason: r.reason };
  return { ok: true, deliveredAt: r.row.delivered_at! };
}

const undeliverable = (): DeliveryResult => ({
  waiting: "the carrier couldn't deliver a package",
  problem: "the carrier marked a package undeliverable (on hold, or going back to the sender). Check the order in Zinc's dashboard",
});

// One milestone's time, proof and fingerprint, each saved as soon as it's done, so a crash or a
// tick running out of time picks up where it left off.
async function proveMilestone(
  drop: DropRecord,
  deps: DeliveryDeps,
  row: DeliveryRow,
  timeline: ZincTimeline,
  milestone: Milestone,
  at: string,
): Promise<{ row: DeliveryRow } | { reason: string }> {
  const col = { at: `${milestone}_at`, hash: `${milestone}_proof_hash`, memo: `${milestone}_memo_tx` } as const;
  if (!row[col.at]) {
    row = { ...row, [col.at]: at };
    await deps.update(drop.id, { [col.at]: at });
  }

  if (!row[col.hash]) {
    const winner = await deps.winner(drop);
    if (!winner) return { reason: `can't check the ${milestone} proof: the claim's address is missing` };
    const pii = winnerPII(winner.address, winner.email);
    // What the proof will reveal is checked before Reclaim is asked, then the proof itself after.
    const leaks = findPII(revealedSpans(JSON.stringify(timeline), milestoneFacts(timeline, milestone)).spans.join("\n"), pii);
    if (leaks.length) return { reason: `the ${milestone} proof would show personal details (${leaks.join(", ")}); it was not made` };
    const proof = await deps.prove(timeline, milestone);
    if (!proof) throw new Error("zkFetch returned no proof"); // try again next tick
    try {
      assertNoPII(proof, pii);
    } catch (err) {
      if (err instanceof PIILeakError) return { reason: `the ${milestone} proof contained personal details (${err.fields.join(", ")}); it was not saved` };
      throw err;
    }
    const { hash } = await deps.saveProof(drop, milestone, provenOf(proof), proof);
    row = { ...row, [col.hash]: hash };
    await deps.update(drop.id, { [col.hash]: hash });
  }

  if (!row[col.memo]) {
    const memo = await deps.postMemo(drop, milestone, fingerprintMemo(drop.id, milestone, row[col.hash]!));
    row = { ...row, [col.memo]: memo };
    await deps.update(drop.id, { [col.memo]: memo });
  }
  return { row };
}

// Zinc's times are UTC, sometimes written without the Z.
function zincTime(s: string): string | null {
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// The proven facts (the regexes' named groups), plus the Zinc URL the proof was made against.
export function provenOf(proof: unknown): Record<string, unknown> {
  const p = proof as { extractedParameterValues?: Record<string, unknown>; claimData?: { parameters?: string } } | null;
  const out: Record<string, unknown> = { ...(p?.extractedParameterValues ?? {}) };
  try {
    out.zincUrl = (JSON.parse(p?.claimData?.parameters ?? "{}") as { url?: string }).url;
  } catch {
    // no parameters to read; the extracted values stand alone
  }
  return out;
}

// The proof package that's published and hashed (see lib/proofs/package). Shipped and delivered
// are both "tracking" packages, told apart by `revealed.milestone`, as the proof page reads them.
export function trackingPackage(drop: DropRecord, revealed: Record<string, unknown>, proof: unknown, createdAt: string, prev?: ProofPackage) {
  const pkg = buildPackage({ dropId: drop.id, type: "tracking", createdAt, revealed: { source: "zinc", ...revealed }, attestation: proof }, prev);
  return { pkg, hash: hashPackage(pkg) };
}
