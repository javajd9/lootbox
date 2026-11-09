// Where a drop stands and what it's waiting on, in words: for the status command
// (npm run engine:status) and anyone reading the engine's state. Nothing here decides anything.
// What the engine will really do on its next tick is asked of decide() itself, so this can't
// drift from the rules.
//
// Never the snapshot schedule: those times stay private until each snapshot has been taken.
import { decide, poolCents, RECEIPT_WAIT_DAYS } from "./decide";
import { isDrawn } from "./stages";
import type { DropRecord, EngineState, Stage } from "./types";

// Who or what has the next move.
export type WaitingOn =
  | "launch" // the first drop's opening time
  | "earlier drop" // the drop before it hasn't been drawn
  | "pool" // creator fees filling the pool
  | "draw pause" // the pause between the pool filling and the draw
  | "randomness" // ORAO's answer
  | "winner" // a claim, or a signed receipt
  | "retailer" // Zinc placing the order
  | "carrier" // the packages on their way
  | "operator" // on hold: a person has to look
  | "engine" // nothing outside: the next tick does it
  | "nothing"; // complete

export interface DropProgress {
  id: string;
  stage: Stage;
  round: number;
  waitingOn: WaitingOn;
  summary: string;
  until?: string; // when the wait ends on its own (an opening time, a deadline)
  next: string[]; // the steps the engine would take for this drop on a tick right now
}

const DAY = 864e5;
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function waiting(state: EngineState, d: DropRecord, now: Date): Pick<DropProgress, "waitingOn" | "summary" | "until"> {
  const t = now.getTime();
  const past = (iso?: string) => !iso || t >= Date.parse(iso);
  if (d.hold) return { waitingOn: "operator", summary: `on hold: ${d.hold}. The engine leaves it alone until the hold is cleared` };

  switch (d.stage) {
    case "upcoming": {
      const before = state.drops.slice(0, state.drops.indexOf(d)).find((b) => !isDrawn(b.stage));
      if (before) return { waitingOn: "earlier drop", summary: `opens the moment ${before.id} is drawn` };
      if (!past(d.opensAt)) return { waitingOn: "launch", summary: "opens at its launch time", until: d.opensAt };
      return { waitingOn: "engine", summary: "due to open" };
    }
    case "funding": {
      const pool = poolCents(state);
      if (pool >= d.goalCents) return { waitingOn: "engine", summary: `the pool is full (${usd(pool)} of ${usd(d.goalCents)}): fees are collected, then the prize is funded` };
      return { waitingOn: "pool", summary: `the pool is at ${usd(pool)} of ${usd(d.goalCents)} (${Math.floor((pool / d.goalCents) * 100)}%), with ${d.snapshotsTaken} snapshot${d.snapshotsTaken === 1 ? "" : "s"} taken` };
    }
    case "snapshotting":
      return { waitingOn: "engine", summary: d.snapshotDue.length ? "funded: the final snapshot is due" : "funded: the ticket list is due to be locked" };
    case "drawing":
      if (!d.randomnessRequestedAt) {
        if (!past(d.drawAt)) return { waitingOn: "draw pause", summary: `tickets locked; draw round ${d.round} starts after the pause`, until: d.drawAt };
        return { waitingOn: "engine", summary: `due to request the randomness for draw round ${d.round}` };
      }
      return { waitingOn: "randomness", summary: `randomness for draw round ${d.round} was requested at ${d.randomnessRequestedAt}; waiting for ORAO to answer` };
    case "claiming":
      if (d.claimedAt) return { waitingOn: "retailer", summary: `claimed at ${d.claimedAt}; the order is being placed, proven and fingerprinted` };
      if (past(d.claimDeadline)) return { waitingOn: "engine", summary: `unclaimed past the deadline: due to be redrawn as round ${d.round + 1}` };
      return { waitingOn: "winner", summary: `drawn in round ${d.round}; waiting for ${d.winner} to claim, or it's redrawn`, until: d.claimDeadline };
    case "fulfilling":
      if (d.deliveredAt) return { waitingOn: "engine", summary: "marked delivered by hand; due to move on" };
      return { waitingOn: "carrier", summary: `ordered at ${d.orderedAt}; following the delivery${d.deliveryProblem ? ` (${d.deliveryProblem})` : ""}` };
    case "delivered": {
      if (d.receivedAt) return { waitingOn: "engine", summary: "the winner signed for it; due to complete" };
      const closes = d.deliveredAt ? new Date(Date.parse(d.deliveredAt) + RECEIPT_WAIT_DAYS * DAY).toISOString() : undefined;
      if (past(closes)) return { waitingOn: "engine", summary: "the receipt window has closed; due to complete without a signature" };
      return { waitingOn: "winner", summary: `delivered at ${d.deliveredAt}; waiting for the winner's signed receipt, or it completes without one`, until: closes };
    }
    case "complete":
      return { waitingOn: "nothing", summary: "complete" };
  }
}

export function dropProgress(state: EngineState, d: DropRecord, now = new Date()): DropProgress {
  const next = decide(state, now)
    .filter((s) => s.dropId === d.id && s.effect.type !== "alert")
    .map((s) => s.effect.type);
  return { id: d.id, stage: d.stage, round: d.round, ...waiting(state, d, now), next };
}

export const engineProgress = (state: EngineState, now = new Date()) => state.drops.map((d) => dropProgress(state, d, now));
