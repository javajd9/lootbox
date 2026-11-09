// A drop's stages, and the one table of how the engine moves a drop between them. Everything that
// asks "where is this drop?" reads this file (the engine, the claim and receipt routes, the live
// feed, the proof pages), so the answer is the same everywhere.
//
//   upcoming → funding → snapshotting → drawing → claiming → fulfilling → delivered → complete
//                                          ↑__________│  unclaimed: redrawn
//
// Nothing here runs on its own and nothing is imported at runtime, so the browser can use it too.
// Every other lifecycle in the app is mapped in STATE-MACHINES.md.
import type { Effect } from "./types";

// Same names, same order, as the database's drop_status.
export const STAGES = ["upcoming", "funding", "snapshotting", "drawing", "claiming", "fulfilling", "delivered", "complete"] as const;
export type Stage = (typeof STAGES)[number];

// Each engine step: the stages it may run in, and the stage it moves the drop to. A step with no
// `to` never moves the drop. One with a `to` may also leave the drop where it is: the randomness
// isn't on-chain yet, the order is still being placed, or the drop went on hold.
export const FLOW: Record<Effect["type"], { from: readonly Stage[]; to?: Stage }> = {
  open: { from: ["upcoming"], to: "funding" },
  snapshot: { from: ["funding", "snapshotting"] },
  fund: { from: ["funding"], to: "snapshotting" },
  lockTickets: { from: ["snapshotting"], to: "drawing" },
  requestRandomness: { from: ["drawing"] },
  readRandomness: { from: ["drawing"], to: "claiming" },
  redraw: { from: ["claiming"], to: "drawing" },
  placeOrder: { from: ["claiming"], to: "fulfilling" },
  trackDelivery: { from: ["fulfilling"], to: "delivered" },
  markDelivered: { from: ["fulfilling"], to: "delivered" },
  complete: { from: ["delivered"], to: "complete" },
  // About the treasury and the team, not the drop they're filed under.
  collect: { from: STAGES },
  alert: { from: STAGES },
};

// What's wrong with running this step from `from` (and leaving the drop in `to`), or null if
// nothing is. The engine checks every step against this before and after it runs (./run).
export function flowProblem(step: Effect["type"], from: Stage, to: Stage = from): string | null {
  const rule = FLOW[step];
  if (!rule.from.includes(from)) return `${step} can't run on a drop that is ${from}`;
  if (to !== from && to !== rule.to) return `${step} can't move a drop from ${from} to ${to}`;
  return null;
}

const reached = (stage: Stage, mark: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf(mark);

// On the homepage's stage: its pool is filling, or its draw is about to land.
export const LIVE_STAGES: readonly Stage[] = ["funding", "snapshotting", "drawing"];
export const isLive = (stage: Stage) => LIVE_STAGES.includes(stage);

// The pool is full and the prize is paid for; the winner isn't known yet.
export const isPoolFull = (stage: Stage) => stage === "snapshotting" || stage === "drawing";

// The winner is known. (A redraw goes back to `drawing`: the last round's winner no longer is one.)
export const isDrawn = (stage: Stage) => reached(stage, "claiming");

// The prize has been bought, so the claim is long finished.
export const isOrdered = (stage: Stage) => reached(stage, "fulfilling");

// Every package has arrived, so the winner can sign for it.
export const isDelivered = (stage: Stage) => reached(stage, "delivered");

const LABELS: Record<Stage, string> = {
  upcoming: "Not open yet",
  funding: "Pool filling",
  snapshotting: "Locking tickets",
  drawing: "Drawing",
  claiming: "Claim open",
  fulfilling: "Ordered · shipping",
  delivered: "Delivered",
  complete: "Complete",
};

// A stage in a few words, as the site shows it. `claimed`: the winner has finished the claim, so a
// drop still in `claiming` is waiting on its order, not on its winner.
export const stageLabel = (stage: Stage, claimed = false) => (stage === "claiming" && claimed ? "Claimed · ordering" : LABELS[stage]);
