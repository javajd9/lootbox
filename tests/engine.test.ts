import { describe, expect, it } from "vitest";
import { memoryStore, tick } from "../lib/engine/run";
import type { DropRecord, Effects, EngineState } from "../lib/engine/types";

const T0 = new Date("2026-11-18T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const GOAL = 200_000; // $2,000

function seeded(seed = 7) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const drop = (id: string, extra: Partial<DropRecord> = {}): DropRecord => ({
  id,
  goalCents: GOAL,
  stage: "upcoming",
  snapshotsTaken: 0,
  snapshotDue: [],
  round: 0,
  ...extra,
});

function world(state: Partial<EngineState> = {}) {
  const store = memoryStore({
    drops: [drop("DROP-001", { opensAt: T0.toISOString() }), drop("DROP-002")],
    treasuryCents: 0,
    sentAlerts: [],
    ...state,
  });
  const calls: string[] = [];
  const w = {
    store,
    calls,
    treasury: 0, // USD cents of SOL in the treasury
    randomness: new Map<number, { winner: string; ticket: number }>(), // by draw round
    tickets: 1_000,
    order: { ok: true } as { ok: true } | { ok: false; reason: string },
    failOnce: "" as string,
    rng: seeded(),
    effects: {} as Effects,
    first: () => store.peek().drops[0],
    second: () => store.peek().drops[1],
    run: (time: Date) => tick(store, w.effects, time, w.rng),
    async edit(id: string, patch: Partial<DropRecord>) {
      const s = store.peek();
      await store.save({ ...s, drops: s.drops.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    },
  };
  const log = (name: string) => {
    if (w.failOnce === name) {
      w.failOnce = "";
      throw new Error(`${name} failed`);
    }
    calls.push(name);
  };
  w.effects = {
    readTreasury: async () => w.treasury,
    open: async (d) => log(`open ${d.id}`),
    snapshot: async (d) => (log(`snapshot ${d.id}`), { hash: `snap-${d.snapshotsTaken}`, holders: 10 }),
    fund: async (d, cents) => {
      log(`fund ${d.id} ${cents}`);
      w.treasury -= cents; // the prize's worth of SOL is swapped out to USDC
    },
    lockTickets: async (d) => (log(`lockTickets ${d.id}`), { hash: "tickets-hash", totalTickets: w.tickets }),
    requestRandomness: async (d, round) => log(`requestRandomness ${d.id} ${round}`),
    readRandomness: async (_d, round) => w.randomness.get(round) ?? null,
    placeOrder: async (d) => (log(`placeOrder ${d.id}`), w.order),
    alert: async (message) => log(`alert ${message}`),
  };
  return w;
}

// The quickest way to a drawn drop: it fills at launch, pauses 2 minutes, and the randomness lands.
async function toClaiming(w: ReturnType<typeof world>) {
  w.treasury = GOAL;
  await w.run(at(0));
  await w.run(at(2 * MIN));
  w.randomness.set(1, { winner: "Winner1111", ticket: 42 });
  await w.run(at(3 * MIN));
  return at(3 * MIN);
}

describe("drop engine: filling", () => {
  it("opens the first drop at launch, not before", async () => {
    const w = world();
    await w.run(at(-MIN));
    expect(w.first().stage).toBe("upcoming");
    await w.run(at(0));
    expect(w.first().stage).toBe("funding");
    expect(w.second().stage).toBe("upcoming"); // the next drop waits its turn
  });

  it("takes snapshots at private random times, 2 to 8 hours apart", async () => {
    const w = world();
    await w.run(at(0));
    let last = T0.getTime();
    for (let i = 1; i <= 4; i++) {
      const due = Date.parse(w.first().snapshotDue[0]);
      expect(due - last).toBeGreaterThanOrEqual(2 * HOUR);
      expect(due - last).toBeLessThanOrEqual(8 * HOUR);
      await w.run(new Date(due - 1)); // a moment early: nothing happens
      expect(w.first().snapshotsTaken).toBe(i - 1);
      await w.run(new Date(due));
      expect(w.first().snapshotsTaken).toBe(i);
      last = due;
    }
  });

  it("the pool rises and falls with the treasury's value", async () => {
    const w = world();
    w.treasury = GOAL - 1; // e.g. SOL dipped just short of the goal
    const report = await w.run(at(0));
    expect(report?.poolCents).toBe(GOAL - 1);
    expect(w.first().stage).toBe("funding");
  });

  it("when the pool fills: a final snapshot, the tickets locked, a 2-minute pause, then the draw", async () => {
    const w = world();
    await w.run(at(0));
    const due = Date.parse(w.first().snapshotDue[0]) - T0.getTime();
    await w.run(at(due)); // one random snapshot while filling

    w.treasury = GOAL;
    const filled = due + MIN;
    await w.run(at(filled));
    expect(w.calls.slice(-3)).toEqual(["fund DROP-001 200000", "snapshot DROP-001", "lockTickets DROP-001"]);
    expect(w.first()).toMatchObject({ stage: "drawing", snapshotsTaken: 2, ticketsHash: "tickets-hash" });

    await w.run(at(filled + 2 * MIN - 1)); // still in the pause
    expect(w.calls.some((c) => c.startsWith("requestRandomness"))).toBe(false);
    await w.run(at(filled + 2 * MIN));
    expect(w.calls).toContain("requestRandomness DROP-001 1");

    w.randomness.set(1, { winner: "Winner1111", ticket: 42 });
    await w.run(at(filled + 3 * MIN));
    expect(w.first()).toMatchObject({ stage: "claiming", winner: "Winner1111", ticket: 42 });
    expect(Date.parse(w.first().claimDeadline!) - at(filled + 3 * MIN).getTime()).toBe(14 * DAY);
    expect(w.second().stage).toBe("funding"); // straight to the next drop
  });

  it("a pool that fills before any random snapshot draws from the fill snapshot", async () => {
    const w = world();
    w.treasury = GOAL;
    await w.run(at(0));
    expect(w.first()).toMatchObject({ stage: "drawing", snapshotsTaken: 1 });
  });

  it("rolls whatever a drop collects past its goal into the next drop", async () => {
    const w = world();
    w.treasury = GOAL + 30_000;
    const report = await w.run(at(0));
    expect(report?.poolCents).toBe(30_000);
  });
});

describe("drop engine: after the draw", () => {
  it("redraws an unclaimed prize from the same ticket list with new randomness", async () => {
    const w = world();
    await toClaiming(w);
    const deadline = Date.parse(w.first().claimDeadline!);
    await w.run(new Date(deadline - MIN));
    expect(w.first().stage).toBe("claiming");
    await w.run(new Date(deadline));
    expect(w.first()).toMatchObject({ stage: "drawing", round: 2, ticketsHash: "tickets-hash", winner: undefined });
    expect(w.calls.filter((c) => c.startsWith("lockTickets"))).toHaveLength(1);
    expect(w.calls).toContain("requestRandomness DROP-001 2"); // no second pause
  });

  it("orders a claimed prize, then completes after delivery and the winner's receipt", async () => {
    const w = world();
    const t = (await toClaiming(w)).getTime();
    await w.edit("DROP-001", { claimedAt: new Date(t + HOUR).toISOString() });
    await w.run(new Date(t + HOUR));
    expect(w.first().stage).toBe("fulfilling");
    expect(w.calls).toContain("placeOrder DROP-001");

    await w.edit("DROP-001", { deliveredAt: new Date(t + 3 * DAY).toISOString() });
    await w.run(new Date(t + 3 * DAY));
    expect(w.first().stage).toBe("delivered");
    await w.edit("DROP-001", { receivedAt: new Date(t + 4 * DAY).toISOString() });
    await w.run(new Date(t + 4 * DAY));
    expect(w.first().stage).toBe("complete");
  });

  it("puts a drop on hold when the price is over its cap, and alerts once", async () => {
    const w = world();
    const t = (await toClaiming(w)).getTime();
    w.order = { ok: false, reason: "price over cap" };
    await w.edit("DROP-001", { claimedAt: new Date(t).toISOString() });
    await w.run(new Date(t + MIN));
    await w.run(new Date(t + 2 * MIN));
    expect(w.first()).toMatchObject({ stage: "claiming", hold: "price over cap" });
    expect(w.calls.filter((c) => c.startsWith("alert"))).toHaveLength(1);
    expect(w.calls.filter((c) => c.startsWith("placeOrder"))).toHaveLength(1);
  });

  it("holds a drop with no tickets in the box instead of drawing", async () => {
    const w = world();
    w.treasury = GOAL;
    w.tickets = 0;
    await w.run(at(0));
    await w.run(at(5 * MIN));
    expect(w.first().hold).toBe("no tickets in the box");
    expect(w.calls.some((c) => c.startsWith("requestRandomness"))).toBe(false);
  });

  it("alerts once when nothing is queued after the last drop", async () => {
    const w = world({ drops: [drop("DROP-001", { opensAt: T0.toISOString() })] });
    await toClaiming(w);
    await w.run(at(HOUR));
    expect(w.calls.filter((c) => c.includes("No drop is queued"))).toHaveLength(1);
  });
});

describe("drop engine: running safely", () => {
  it("skips a tick while another one is running", async () => {
    const w = world();
    const [a, b] = await Promise.all([w.run(at(0)), w.run(at(0))]);
    expect(a).toBeDefined();
    expect(b).toBeUndefined();
    expect(w.calls.filter((c) => c.startsWith("open"))).toHaveLength(1);
  });

  it("keeps finished steps when a later one fails, and retries it next tick", async () => {
    const w = world();
    w.treasury = GOAL;
    await w.run(at(0));
    w.failOnce = "requestRandomness DROP-001 1";
    const report = await w.run(at(2 * MIN));
    expect(report?.errors).toEqual([{ what: "DROP-001 requestRandomness", error: "requestRandomness DROP-001 1 failed" }]);
    expect(w.first().stage).toBe("drawing");
    expect(w.first().randomnessRequestedAt).toBeUndefined();
    await w.run(at(3 * MIN));
    expect(w.first().randomnessRequestedAt).toBeDefined();
    expect(w.calls.filter((c) => c.startsWith("lockTickets"))).toHaveLength(1);
  });

  it("keeps the last known pool if the treasury can't be read", async () => {
    const w = world({ treasuryCents: 12_345 });
    w.effects.readTreasury = async () => {
      throw new Error("RPC down");
    };
    const report = await w.run(at(0));
    expect(report?.poolCents).toBe(12_345);
    expect(report?.errors[0]).toEqual({ what: "read treasury", error: "RPC down" });
  });
});
