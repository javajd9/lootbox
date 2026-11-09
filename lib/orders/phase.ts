// How far the private orders row has got, as a name. ./order and ./delivery keep no phase of
// their own: each column is written the moment its step is done, so the row itself says how far
// things got, and a crash can never leave a saved phase that disagrees with what really happened.
// These read the same columns, in the order those steps check them, for status output
// (scripts/engine-status.ts). The engine itself never reads them.
import type { DeliveryRow } from "./delivery";
import type { OrderRow } from "./order";
import type { Milestone } from "./redact";

// Buying the prize (./order):
//
//   saved → sent → placed → proven → fingerprinted          failed / cancelled: a person steps in
export type OrderPhase = "saved" | "sent" | "placed" | "proven" | "fingerprinted" | "failed" | "cancelled";

export function orderPhase(row: Pick<OrderRow, "status" | "zinc_request_id" | "proof_hash" | "memo_tx">): OrderPhase {
  if (row.status === "failed" || row.status === "cancelled") return row.status;
  if (!row.zinc_request_id) return "saved"; // recorded with its idempotency key; Zinc doesn't have it yet
  if (row.status !== "placed") return "sent"; // Zinc is placing it with the retailer
  if (!row.proof_hash) return "placed"; // the retailer has it; the zkTLS proof is next
  if (!row.memo_tx) return "proven"; // the proof is saved; its fingerprint is next
  return "fingerprinted"; // done: the drop moves on to `fulfilling`
}

// Each delivery milestone, shipped and then delivered (./delivery):
//
//   waiting → seen → proven → fingerprinted
export type MilestonePhase = "waiting" | "seen" | "proven" | "fingerprinted";

export function milestonePhase(row: DeliveryRow, milestone: Milestone): MilestonePhase {
  if (row[`${milestone}_memo_tx`]) return "fingerprinted";
  if (row[`${milestone}_proof_hash`]) return "proven";
  if (row[`${milestone}_at`]) return "seen"; // Zinc reported it and its time is saved; the proof is next
  return "waiting";
}
