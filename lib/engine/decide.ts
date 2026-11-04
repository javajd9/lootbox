// The drop engine's rules, as pure functions: decide() looks at every drop and says what's due;
// apply() says what a finished step changes. No clocks, network or randomness of their own, so
// every rule can be tested by moving time forward.
import { RULES } from "@/lib/config/rules";
import { CLAIM_DAYS } from "@/lib/live/types";
import { nextSnapshotAt } from "./schedule";
import type { DeliveryResult, DropRecord, Effect, EngineState, OrderResult, Stage, Step } from "./types";

const DAY = 864e5;
const RECEIPT_WAIT_DAYS = 14; // after delivery, how long to wait for the winner's signed receipt
const SLOW_RANDOMNESS_MS = 10 * 60_000;
const SLOW_ORDER_MS = DAY; // Zinc usually places an order within hours
const SLOW_DELIVERY_MS = 21 * DAY; // retailer orders usually arrive within a week or two

// The winner is known.
const DRAWN = new Set<Stage>(["claiming", "fulfilling", "delivered", "complete"]);

// The pool now filling: the treasury, plus creator fees pump.fun is still holding for it. Each
// prize leaves the treasury the moment its pool fills, so whatever a drop collected past its goal
// is still in here and rolls into the next drop on its own.
export const poolCents = (state: EngineState) => state.treasuryCents + (state.uncollected?.cents ?? 0);
const COLLECT_MIN_LAMPORTS = Math.round(RULES.collectMinSol * 1e9);

const alert = (key: string, message: string): Effect => ({ type: "alert", key, message });

export function decide(state: EngineState, now: Date): Step[] {
  const t = now.getTime();
  const at = (iso?: string) => (iso ? Date.parse(iso) : Infinity);
  const steps: Step[] = [];
  const add = (d: DropRecord, effect: Effect) => steps.push({ dropId: d.id, effect });

  state.drops.forEach((d, i) => {
    if (d.hold) {
      add(d, alert(`hold:${d.id}:${d.hold}`, `${d.id} is on hold: ${d.hold}. The engine won't touch it until the hold is cleared.`));
      return;
    }
    switch (d.stage) {
      case "upcoming":
        // First in line: every drop before it has been drawn, and its launch time (if any) has come.
        if (state.drops.slice(0, i).every((b) => DRAWN.has(b.stage)) && t >= (d.opensAt ? Date.parse(d.opensAt) : 0)) {
          add(d, { type: "open" });
        }
        break;
      case "funding":
        if (t >= at(d.snapshotDue[0])) add(d, { type: "snapshot" });
        else if (poolCents(state) >= d.goalCents) {
          // Full, counting fees not collected yet: those come in first, so the treasury can pay.
          const waiting = state.uncollected?.lamports ?? 0;
          add(d, state.treasuryCents < d.goalCents && waiting > 0 ? { type: "collect", lamports: waiting } : { type: "fund", lockedCents: d.goalCents });
        }
        break;
      case "snapshotting":
        // The final snapshot, then the ticket list is locked straight away.
        add(d, d.snapshotDue.length ? { type: "snapshot" } : { type: "lockTickets" });
        break;
      case "drawing":
        if (!d.randomnessRequestedAt) {
          if (t >= at(d.drawAt)) add(d, { type: "requestRandomness", round: d.round });
        } else {
          add(d, { type: "readRandomness", round: d.round });
          if (t - at(d.randomnessRequestedAt) > SLOW_RANDOMNESS_MS) {
            add(d, alert(`slow-randomness:${d.id}:${d.round}`, `${d.id}: the randomness for draw round ${d.round} hasn't arrived after 10 minutes.`));
          }
        }
        break;
      case "claiming":
        if (d.claimedAt) {
          add(d, { type: "placeOrder" });
          if (t - at(d.claimedAt) > SLOW_ORDER_MS) add(d, alert(`slow-order:${d.id}`, `${d.id}: the prize was claimed over a day ago and the order still isn't placed.`));
        } else if (t >= at(d.claimDeadline)) add(d, { type: "redraw", round: d.round + 1 });
        break;
      case "fulfilling":
        if (d.deliveredAt) add(d, { type: "markDelivered" }); // set by hand
        else {
          add(d, { type: "trackDelivery" });
          if (d.deliveryProblem) add(d, alert(`delivery-problem:${d.id}:${d.deliveryProblem}`, `${d.id}: ${d.deliveryProblem}.`));
          if (t - at(d.orderedAt) > SLOW_DELIVERY_MS) add(d, alert(`slow-delivery:${d.id}`, `${d.id}: the prize was ordered 3 weeks ago and still isn't delivered.`));
        }
        break;
      case "delivered":
        if (d.receivedAt || t >= at(d.deliveredAt) + RECEIPT_WAIT_DAYS * DAY) add(d, { type: "complete" });
        break;
    }
  });

  // Enough creator fees waiting: collect them, fingerprinted under the drop they're filling.
  const waiting = state.uncollected?.lamports ?? 0;
  const filling = state.drops.find((d) => d.stage === "funding") ?? [...state.drops].reverse().find((d) => !d.hold);
  if (filling && waiting >= COLLECT_MIN_LAMPORTS && !steps.some((s) => s.effect.type === "collect")) {
    steps.unshift({ dropId: filling.id, effect: { type: "collect", lamports: waiting } });
  }

  // Everything has been drawn and nothing is queued: the homepage has no pool to fill.
  const last = state.drops.at(-1);
  if (last && state.drops.every((d) => DRAWN.has(d.stage))) {
    steps.push({ dropId: last.id, effect: alert(`no-next-drop:${last.id}`, `No drop is queued after ${last.id}. Add the next one so the homepage has a pool to fill.`) });
  }

  return steps.filter((s) => s.effect.type !== "alert" || !state.sentAlerts.includes(s.effect.key));
}

// What a finished step changes. `result` is what the effect returned (see Effects).
export function apply(d: DropRecord, effect: Effect, result: unknown, now: Date, rng: () => number): DropRecord {
  const iso = now.toISOString();
  switch (effect.type) {
    case "open":
      return { ...d, stage: "funding", openedAt: iso, snapshotDue: [nextSnapshotAt(now, rng)] };
    case "snapshot":
      return {
        ...d,
        snapshotsTaken: d.snapshotsTaken + 1,
        // While filling, schedule the next one; the one taken when the pool fills is the last.
        snapshotDue: d.stage === "funding" ? [nextSnapshotAt(now, rng)] : d.snapshotDue.slice(1),
      };
    case "fund":
      // A final snapshot right now, then a short pause before the draw.
      return {
        ...d,
        stage: "snapshotting",
        fundedAt: iso,
        snapshotDue: [iso],
        drawAt: new Date(now.getTime() + RULES.drawPauseMinutes * 60_000).toISOString(),
      };
    case "lockTickets": {
      const r = result as { hash: string; totalTickets: number };
      if (r.totalTickets <= 0) return { ...d, hold: "no tickets in the box" };
      return { ...d, stage: "drawing", ticketsHash: r.hash, totalTickets: r.totalTickets, round: 1 };
    }
    case "requestRandomness":
      return { ...d, randomnessRequestedAt: iso };
    case "readRandomness": {
      const r = result as { winner: string; ticket: number } | null;
      if (!r) return d; // not on-chain yet
      return {
        ...d,
        stage: "claiming",
        winner: r.winner,
        ticket: r.ticket,
        drawnAt: iso,
        claimDeadline: new Date(now.getTime() + CLAIM_DAYS * DAY).toISOString(),
      };
    }
    case "redraw":
      // Unclaimed: the same locked ticket list, new randomness.
      return {
        ...d,
        stage: "drawing",
        round: effect.round,
        randomnessRequestedAt: undefined,
        winner: undefined,
        ticket: undefined,
        drawnAt: undefined,
        claimDeadline: undefined,
      };
    case "placeOrder": {
      const r = result as OrderResult;
      if ("waiting" in r) return d; // Zinc is still working on it; look again next tick
      return r.ok ? { ...d, stage: "fulfilling", orderedAt: iso } : { ...d, hold: r.reason };
    }
    case "trackDelivery": {
      const r = result as DeliveryResult;
      if ("waiting" in r) return r.problem === d.deliveryProblem ? d : { ...d, deliveryProblem: r.problem }; // still on its way
      return r.ok ? { ...d, stage: "delivered", deliveredAt: r.deliveredAt, deliveryProblem: undefined } : { ...d, hold: r.reason };
    }
    case "markDelivered":
      return { ...d, stage: "delivered" };
    case "complete":
      return { ...d, stage: "complete" };
    case "collect": // the treasury changes, not the drop
    case "alert":
      return d;
  }
}
