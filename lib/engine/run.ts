// One "tick" of the drop engine: look at every drop, do whatever is due, and save after each step.
// The scheduler calls it every minute; webhooks can call it early (e.g. the moment fees land).
import { apply, decide, poolCents } from "./decide";
import { secureRandom } from "./schedule";
import type { DropRecord, Effect, Effects, EngineState, Step } from "./types";

export interface EngineStore {
  load(): Promise<EngineState>;
  save(state: EngineState): Promise<void>;
  // One tick at a time, across every server. Resolves to undefined if another tick holds the lock.
  withLock<T>(fn: () => Promise<T>): Promise<T | undefined>;
}

export interface TickReport {
  steps: Step[];
  errors: { what: string; error: string }[]; // e.g. "DROP-001 requestRandomness"
  poolCents: number;
}

const MAX_PASSES = 50;

export async function tick(store: EngineStore, effects: Effects, now = new Date(), rng = secureRandom): Promise<TickReport | undefined> {
  return store.withLock(async () => {
    let state = await store.load();
    const steps: Step[] = [];
    const errors: TickReport["errors"] = [];
    const stuck = new Set<string>(); // a drop whose step failed waits for the next tick
    let collected = false; // fees are collected at most once a tick

    // The pool is the treasury's SOL at today's price, plus the creator fees not collected yet, so
    // it's read fresh: at the start, and after fees come in or a prize is swapped out. If either
    // can't be read, its last known value stands.
    const refreshPool = async () => {
      try {
        state = { ...state, treasuryCents: await effects.readTreasury(), poolReadAt: now.toISOString() };
      } catch (err) {
        errors.push({ what: "read treasury", error: err instanceof Error ? err.message : String(err) });
      }
      if (!effects.readCreatorFees) return;
      try {
        state = { ...state, uncollected: await effects.readCreatorFees() };
      } catch (err) {
        errors.push({ what: "read creator fees", error: err instanceof Error ? err.message : String(err) });
      }
    };
    await refreshPool();

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let moved = false;
      for (const step of decide(state, now)) {
        if (stuck.has(step.dropId) || (step.effect.type === "collect" && collected)) continue;
        const drop = state.drops.find((d) => d.id === step.dropId)!;
        let next: DropRecord;
        try {
          next = await perform(effects, drop, step.effect, now, rng);
        } catch (err) {
          errors.push({ what: `${step.dropId} ${step.effect.type}`, error: err instanceof Error ? err.message : String(err) });
          stuck.add(step.dropId);
          continue;
        }
        if (step.effect.type === "alert") state = { ...state, sentAlerts: [...state.sentAlerts, step.effect.key] };
        else if (step.effect.type === "collect") collected = true;
        else if (next !== drop) state = { ...state, drops: state.drops.map((d) => (d.id === next.id ? next : d)) };
        else continue; // nothing changed yet, e.g. the randomness isn't on-chain
        steps.push(step);
        moved = true;
        if (step.effect.type === "fund" || step.effect.type === "collect") await refreshPool();
        await store.save(state); // after every step, so a finished step is never repeated
      }
      if (!moved) break;
    }
    return { steps, errors, poolCents: poolCents(state) };
  });
}

async function perform(fx: Effects, d: DropRecord, e: Effect, now: Date, rng: () => number): Promise<DropRecord> {
  let result: unknown;
  switch (e.type) {
    case "open":
      await fx.open(d);
      break;
    case "snapshot":
      result = await fx.snapshot(d);
      break;
    case "collect":
      if (!fx.collect) throw new Error("collecting creator fees isn't set up");
      await fx.collect(d, e.lamports);
      break;
    case "fund":
      await fx.fund(d, e.lockedCents);
      break;
    case "lockTickets":
      result = await fx.lockTickets(d);
      break;
    case "requestRandomness":
      await fx.requestRandomness(d, e.round);
      break;
    case "readRandomness":
      result = await fx.readRandomness(d, e.round);
      break;
    case "placeOrder":
      result = await fx.placeOrder(d);
      break;
    case "alert":
      await fx.alert(e.message);
      break;
    // redraw, markDelivered and complete are bookkeeping only
  }
  return apply(d, e, result, now, rng);
}

// For tests and local development. Production keeps the state in Supabase.
export function memoryStore(initial: EngineState): EngineStore & { peek(): EngineState } {
  let state = structuredClone(initial);
  let busy = false;
  return {
    async load() {
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
    async withLock(fn) {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
    peek: () => structuredClone(state),
  };
}
