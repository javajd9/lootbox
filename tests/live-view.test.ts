import { describe, expect, it } from "vitest";
import { applyView } from "../lib/live/fromView";
import type { LiveDrop } from "../lib/live/useLiveDrop";
import type { LiveView } from "../lib/live/view";

let id = 0;
const nextId = () => ++id;

const page: LiveDrop = {
  phase: "filling",
  upcoming: true,
  drop: { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalUsd: 2000 },
  fundedUsd: 0,
  tickets: 0,
  watching: 0,
  trades: [],
  history: [],
};

const view = (drop: Partial<NonNullable<LiveView["drop"]>> | null, extra: Partial<LiveView> = {}): LiveView => ({
  cluster: "mainnet-beta",
  poolCents: 0,
  drop: drop && { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalCents: 200_000, stage: "funding", round: 0, tickets: null, ...drop },
  lastWinner: null,
  updatedAt: "2026-11-19T00:00:00Z",
  ...extra,
});

const winner = { id: "DROP-001", number: 1, title: "GTA VI Bundle", wallet: "Win111", ticket: 42, totalTickets: 900, walletTickets: 30 };

describe("homepage from the live feed", () => {
  it("before launch: the pre-launch ticket at $0", () => {
    const s = applyView(page, view({ stage: "upcoming" }), nextId);
    expect(s).toMatchObject({ upcoming: true, phase: "filling", fundedUsd: 0 });
  });

  it("fees coming in raise the pool and drop a coin for each gain", () => {
    let s = applyView(page, view({}, { poolCents: 12_000 }), nextId);
    s = applyView(s, view({ tickets: 5_000 }, { poolCents: 19_500 }), nextId);
    expect(s).toMatchObject({ upcoming: false, fundedUsd: 195, tickets: 5_000 });
    expect(s.trades.at(-1)?.usd).toBe(75);
  });

  it("the pool never shows more than the goal", () => {
    const s = applyView(page, view({}, { poolCents: 250_000 }), nextId);
    expect(s.fundedUsd).toBe(2000);
  });

  it("once full: the funded screen, counting down to the draw", () => {
    const s = applyView(page, view({ stage: "drawing", drawAt: "2026-11-19T00:02:00Z", tickets: 900 }), nextId);
    expect(s).toMatchObject({ phase: "funded", fundedUsd: 2000, drawAt: "2026-11-19T00:02:00Z", tickets: 900 });
  });

  it("the drop on stage gets its winner: the draw plays, and nothing interrupts it", () => {
    const funded = applyView(page, view({ stage: "drawing", tickets: 900 }), nextId);
    const next = view({ id: "DROP-002", number: 2, title: "Mystery Drop", stage: "funding" }, { lastWinner: winner, poolCents: 3_000 });
    const drawing = applyView(funded, next, nextId);
    expect(drawing).toMatchObject({ phase: "drawing", drop: { id: "DROP-001" }, draw: { ticket: 42, totalTickets: 900, wallet: "Win111", walletTickets: 30 } });
    expect(applyView(drawing, next, nextId)).toBe(drawing);

    // After the winner has been on stage, the next drop takes over, without replaying the draw.
    const after = applyView({ ...drawing, phase: "filling", draw: undefined }, next, nextId);
    expect(after).toMatchObject({ phase: "filling", drop: { id: "DROP-002" }, fundedUsd: 30, lastWinner: { dropId: "DROP-001", ticket: 42 } });
    expect(after.trades).toEqual([]);
  });

  it("arriving after a draw just shows the current drop, with the last winner", () => {
    const s = applyView(page, view({ id: "DROP-002", number: 2, title: "Mystery Drop" }, { lastWinner: winner }), nextId);
    expect(s).toMatchObject({ phase: "filling", drop: { id: "DROP-002" }, lastWinner: { wallet: "Win111" } });
  });
});
