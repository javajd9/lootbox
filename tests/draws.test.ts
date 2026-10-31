import { describe, expect, it } from "vitest";
import { buildSnapshot, combineWeights, hashSnapshot, hashWeights, toRanges } from "../lib/draws/snapshot";
import { findRange, pickIndex, pickWinner } from "../lib/draws/weighted-pick";
import { toTickets } from "../lib/draws/tickets";

describe("tickets", () => {
  const T = 10_000n * 1_000_000n; // one ticket in base units

  it("gives 1 ticket per 10,000 $LOOT of average balance, rounding down", () => {
    const weights = [
      { wallet: "whale", weight: 3n * 1_000n * T }, // 1,000 tickets avg over 3 snapshots
      { wallet: "small", weight: 3n * T - 1n }, // just under 1 ticket on average
      { wallet: "mid", weight: 3n * 25n * T },
    ];
    expect(toTickets(weights, 3)).toEqual([
      { wallet: "whale", weight: 1_000n },
      { wallet: "mid", weight: 25n },
    ]);
  });

  it("ticket numbers map to exactly one wallet", () => {
    const { ranges, total } = toRanges([{ wallet: "A", weight: 2n }, { wallet: "B", weight: 3n }]);
    expect(total).toBe(5n);
    expect([0n, 1n, 2n, 3n, 4n].map((t) => findRange(ranges, t).wallet)).toEqual(["A", "A", "B", "B", "B"]);
  });
});

const CURVE = "BondingCurve111";
const TEAM = "TeamWallet111";

describe("snapshots", () => {
  it("adds up accounts per wallet, drops excluded and empty wallets, sorts deterministically", () => {
    const s = buildSnapshot("DROP-001", 100, "2026-11-10T00:00:00Z", [
      { owner: "Cwallet", amount: 5n },
      { owner: CURVE, amount: 900n },
      { owner: "Awallet", amount: 1n },
      { owner: "Cwallet", amount: 5n },
      { owner: TEAM, amount: 50n },
      { owner: "Bwallet", amount: 0n },
    ], [CURVE, TEAM]);
    expect(s.holders).toEqual([
      { wallet: "Awallet", balance: "1" },
      { wallet: "Cwallet", balance: "10" },
    ]);
  });

  it("same input gives the same hash regardless of account order", () => {
    const a = buildSnapshot("DROP-001", 1, "t", [{ owner: "x", amount: 1n }, { owner: "y", amount: 2n }], []);
    const b = buildSnapshot("DROP-001", 1, "t", [{ owner: "y", amount: 2n }, { owner: "x", amount: 1n }], []);
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it("a last-minute buyer only gets weight from snapshots after the buy", () => {
    const snaps = [1, 2, 3, 4].map((slot) =>
      buildSnapshot("DROP-001", slot, "t", [
        { owner: "holder", amount: 1000n },
        ...(slot === 4 ? [{ owner: "sniper", amount: 1000n }] : []),
      ], []),
    );
    const w = combineWeights(snaps);
    expect(w).toEqual([
      { wallet: "holder", weight: 4000n },
      { wallet: "sniper", weight: 1000n },
    ]);
    expect(hashWeights(w)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to mix drops", () => {
    const a = buildSnapshot("DROP-001", 1, "t", [], []);
    const b = buildSnapshot("DROP-002", 1, "t", [], []);
    expect(() => combineWeights([a, b])).toThrow();
  });
});

describe("weighted pick", () => {
  const entries = [
    { wallet: "A", weight: 1_000_000n },
    { wallet: "B", weight: 3_000_000n },
    { wallet: "C", weight: 6_000_000n },
  ];

  it("is deterministic for the same randomness", () => {
    const r = new Uint8Array(64).fill(7);
    expect(pickWinner(r, entries)).toEqual(pickWinner(r, entries));
  });

  it("maps range boundaries correctly", () => {
    const { ranges } = toRanges(entries);
    expect(findRange(ranges, 0n).wallet).toBe("A");
    expect(findRange(ranges, 999_999n).wallet).toBe("A");
    expect(findRange(ranges, 1_000_000n).wallet).toBe("B");
    expect(findRange(ranges, 9_999_999n).wallet).toBe("C");
    expect(() => findRange(ranges, 10_000_000n)).toThrow();
  });

  it("matches the advertised odds (10% / 30% / 60%)", () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    const N = 100_000;
    for (let i = 0; i < N; i++) counts[pickWinner(crypto.getRandomValues(new Uint8Array(64)), entries).wallet]++;
    expect(counts.A / N).toBeCloseTo(0.1, 1);
    expect(counts.B / N).toBeCloseTo(0.3, 1);
    expect(counts.C / N).toBeCloseTo(0.6, 1);
  });

  it("rejects bad input", () => {
    expect(() => pickIndex(new Uint8Array(32), 10n)).toThrow();
    expect(() => pickWinner(new Uint8Array(64), [{ wallet: "A", weight: 0n }])).toThrow();
  });
});
