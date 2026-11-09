// Where every drop stands: its stage, what it's waiting on, and what the engine would do for it on
// a tick right now. For a drop being claimed, bought or shipped, also how far the claim and the
// order have got. The first thing to run when a drop looks stuck.
//
// Read only: it never ticks, saves or takes the engine's lock. It reads no key and no shipping
// address, and never prints a snapshot time.
//
//   npm run engine:status             a few lines per drop
//   npm run engine:status -- --json   the same, as JSON
import "dotenv/config";
import type { ClaimStatus } from "@/lib/claims/status";
import { check, serverDb } from "@/lib/db";
import { poolCents } from "@/lib/engine/decide";
import { initialState, withQueuedDrops } from "@/lib/engine/drops";
import { engineProgress } from "@/lib/engine/status";
import { supabaseStore } from "@/lib/engine/supabase-store";
import type { DeliveryRow } from "@/lib/orders/delivery";
import type { OrderRow } from "@/lib/orders/order";
import { milestonePhase, orderPhase } from "@/lib/orders/phase";

// Only the columns that say how far the order has got: never its Zinc key.
type StatusOrder = Pick<OrderRow, "zinc_status" | "error" | "proof_hash" | "memo_tx"> & DeliveryRow;
const ORDER_COLUMNS =
  "drop_id, status, zinc_request_id, zinc_status, error, proof_hash, memo_tx, delivery_status, packages, shipped_at, shipped_proof_hash, shipped_memo_tx, delivered_at, delivered_proof_hash, delivered_memo_tx";

const now = new Date();
const state = await withQueuedDrops(supabaseStore(initialState())).load();
const db = serverDb();

// The private rows behind the stages that wait on something outside the engine.
const busy = state.drops.filter((d) => d.stage === "claiming" || d.stage === "fulfilling" || d.stage === "delivered").map((d) => d.id);
const [claimRows, orderRows] = busy.length
  ? await Promise.all([
      db.from("claims").select("drop_id, round, status, updated_at").in("drop_id", busy).order("updated_at", { ascending: false }),
      db.from("orders").select(ORDER_COLUMNS).in("drop_id", busy),
    ])
  : [null, null];
const claims = (claimRows ? check(claimRows, "load claims").data : []) as { drop_id: string; round: number; status: ClaimStatus; updated_at: string }[];
const orders = (orderRows ? check(orderRows, "load orders").data : []) as unknown as StatusOrder[];

const drops = engineProgress(state, now).map((p) => {
  const claim = claims.find((c) => c.drop_id === p.id && c.round === p.round); // this round's latest
  const order = orders.find((o) => o.drop_id === p.id);
  return {
    ...p,
    claim: claim ? { status: claim.status, updatedAt: claim.updated_at } : undefined,
    order: order
      ? {
          phase: orderPhase(order),
          zincStatus: order.zinc_status,
          error: order.error,
          packages: order.packages,
          delivery: order.delivery_status,
          shipped: milestonePhase(order, "shipped"),
          delivered: milestonePhase(order, "delivered"),
        }
      : undefined,
  };
});

const report = {
  at: now.toISOString(),
  poolCents: poolCents(state),
  poolReadAt: state.poolReadAt ?? null,
  failingSince: state.failingSince ?? {}, // each step that has failed on every tick, and since when
  drops,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const age = state.poolReadAt ? `${Math.round((now.getTime() - Date.parse(state.poolReadAt)) / 1000)}s ago` : "never";
  console.log(`Pool $${(report.poolCents / 100).toFixed(2)}, read ${age}${state.poolReadAt && now.getTime() - Date.parse(state.poolReadAt) > 5 * 60_000 ? "  ! the engine hasn't read it for over 5 minutes: npm run schedule:tick -- --status" : ""}`);
  for (const d of drops) {
    console.log(`\n${d.id}  ${d.stage}  (waiting on: ${d.waitingOn})`);
    console.log(`  ${d.summary}${d.until ? ` (until ${d.until})` : ""}`);
    if (d.claim) console.log(`  claim: ${d.claim.status}, last changed ${d.claim.updatedAt}`);
    if (d.order) {
      const o = d.order;
      console.log(`  order: ${o.phase}${o.zincStatus ? `, Zinc says ${o.zincStatus}` : ""}${o.error ? `, error ${o.error}` : ""}`);
      if (o.phase === "fingerprinted") console.log(`  delivery: ${o.delivery ?? "not checked yet"}, ${o.packages ?? 0} package(s); shipped proof ${o.shipped}, delivered proof ${o.delivered}`);
    }
    console.log(`  next tick: ${d.next.length ? d.next.join(", ") : "nothing due"}`);
  }
  const failing = Object.entries(report.failingSince);
  console.log(failing.length ? `\nFailing on every tick:` : `\nNo step is failing.`);
  for (const [what, since] of failing) console.log(`  ${what}, since ${since}`);
}
