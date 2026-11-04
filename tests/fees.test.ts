import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import pumpBuy from "./fixtures/helius-raw-pump-buy.json";
import poolBuy from "./fixtures/helius-raw-pumpswap-buy.json";
import { bondingCurveAddress, coinCreatorVaultAta, creatorVaultAddress, decodeBondingCurve, decodePool, poolAddress, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, readCreatorFees } from "../lib/chain/pump";
import { decide, poolCents } from "../lib/engine/decide";
import { memoryStore, tick } from "../lib/engine/run";
import type { DropRecord, Effects, EngineState } from "../lib/engine/types";
import { isHeliusPayload, parseFeeEvents } from "../lib/fees/events";
import { randomSignature, sampleTx, type SampleTrade } from "../lib/fees/sample";
import { applyView } from "../lib/live/fromView";
import { coinPx, feeLabel } from "../lib/live/format";
import type { LiveDrop } from "../lib/live/useLiveDrop";
import type { LiveFee, LiveView } from "../lib/live/view";
import { collectTransaction } from "../lib/treasury/fees";

const T0 = new Date("2026-11-18T12:00:00Z");
const SOL = 1_000_000_000;
const mint = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const ops = Keypair.generate().publicKey;

// --- pump.fun accounts -------------------------------------------------------------------------

function curveData({ complete = false, creator = treasury, creatorFee = 0n, short = false } = {}) {
  const b = Buffer.alloc(short ? 150 : 200);
  b[48] = complete ? 1 : 0;
  creator.toBuffer().copy(b, 49);
  if (!short) b.writeBigUInt64LE(creatorFee, 125);
  return b;
}

function poolData(creatorFees: bigint) {
  const b = Buffer.alloc(300);
  new PublicKey("So11111111111111111111111111111111111111112").toBuffer().copy(b, 75);
  treasury.toBuffer().copy(b, 211);
  b.writeBigUInt64LE(creatorFees, 279);
  return b;
}

function tokenAccount(amount: bigint) {
  const b = Buffer.alloc(165);
  b.writeBigUInt64LE(amount, 64);
  return b;
}

// A connection that only answers getMultipleAccountsInfo, from a map of address → account.
function chain(accounts: Map<string, { owner: PublicKey; data: Buffer; lamports?: number }>) {
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[]) =>
      keys.map((k) => {
        const a = accounts.get(k.toBase58());
        return a ? { owner: a.owner, data: a.data, lamports: a.lamports ?? 0, executable: false } : null;
      }),
  } as unknown as Connection;
}

describe("creator fees on pump.fun", () => {
  it("reads the fields the IDL appends, as 0 on older, shorter accounts", () => {
    expect(decodeBondingCurve(curveData({ creatorFee: 1234n }))).toMatchObject({ complete: false, creatorFee: 1234n });
    expect(decodeBondingCurve(curveData({ short: true })).creatorFee).toBe(0n);
    expect(decodeBondingCurve(curveData()).creator.equals(treasury)).toBe(true);
    expect(decodePool(poolData(99n))).toMatchObject({ creatorFees: 99n });
  });

  it("adds up every place the fee is waiting: on the curve, in the vault, on the pool, in the pool's vault", async () => {
    const conn = chain(
      new Map([
        [bondingCurveAddress(mint).toBase58(), { owner: PUMP_PROGRAM_ID, data: curveData({ complete: true, creatorFee: 1_000n }) }],
        [creatorVaultAddress(treasury).toBase58(), { owner: PublicKey.default, data: Buffer.alloc(0), lamports: 890_880 + 20_000 }],
        [poolAddress(mint).toBase58(), { owner: PUMP_AMM_PROGRAM_ID, data: poolData(300_000n) }],
        [coinCreatorVaultAta(treasury).toBase58(), { owner: PublicKey.default, data: tokenAccount(4_000_000n) }],
      ]),
    );
    const fees = await readCreatorFees(conn, mint, treasury);
    expect(fees).toMatchObject({ coin: true, graduated: true, curveWaiting: 1_000n, curveVault: 20_000n, poolWaiting: 300_000n, poolVault: 4_000_000n, total: 4_321_000n });
  });

  it("finds nothing for a token that isn't a pump.fun coin (the devnet test token)", async () => {
    const fees = await readCreatorFees(chain(new Map()), mint, treasury);
    expect(fees).toMatchObject({ coin: false, total: 0n });
  });

  it("collects from the curve, and from the pool too once graduated, with a fingerprint", async () => {
    const accounts = new Map([[bondingCurveAddress(mint).toBase58(), { owner: PUMP_PROGRAM_ID, data: curveData({ creatorFee: 70_000_000n }) }]]);
    const onCurve = collectTransaction(ops, treasury, mint, await readCreatorFees(chain(accounts), mint, treasury), "DROP-001");
    expect(onCurve.instructions.map((i) => i.programId.toBase58().slice(0, 4))).toEqual(["6EF8", "6EF8", "Memo"]);
    expect(onCurve.instructions[2].data.toString()).toBe("LOOTBOX|v1|DROP-001|collected|70000000");

    accounts.set(bondingCurveAddress(mint).toBase58(), { owner: PUMP_PROGRAM_ID, data: curveData({ complete: true }) });
    accounts.set(poolAddress(mint).toBase58(), { owner: PUMP_AMM_PROGRAM_ID, data: poolData(5n) });
    const graduated = collectTransaction(ops, treasury, mint, await readCreatorFees(chain(accounts), mint, treasury), "DROP-001");
    // curve sweep + collect, pool sweep, WSOL account, pool collect, unwrap, memo
    expect(graduated.instructions).toHaveLength(7);
  });

  it("refuses to collect when pump.fun pays someone other than the treasury (a fee sharing config)", async () => {
    const other = Keypair.generate().publicKey;
    const conn = chain(new Map([[bondingCurveAddress(mint).toBase58(), { owner: PUMP_PROGRAM_ID, data: curveData({ creator: other, creatorFee: 1n }) }]]));
    const fees = await readCreatorFees(conn, mint, treasury);
    expect(() => collectTransaction(ops, treasury, mint, fees, "DROP-001")).toThrow(/not the treasury/);
  });
});

// --- the engine ----------------------------------------------------------------------------------

const drop = (extra: Partial<DropRecord> = {}): DropRecord => ({ id: "DROP-001", goalCents: 200_000, stage: "funding", snapshotsTaken: 1, snapshotDue: ["2099-01-01T00:00:00Z"], round: 0, ...extra });
const state = (treasuryCents: number, uncollected?: { lamports: number; cents: number }): EngineState => ({ drops: [drop()], treasuryCents, uncollected, sentAlerts: [] });

describe("the pool counts fees not collected yet", () => {
  it("pool = treasury + uncollected", () => {
    expect(poolCents(state(150_000, { lamports: 2 * SOL, cents: 30_000 }))).toBe(180_000);
    expect(poolCents(state(150_000))).toBe(150_000);
  });

  it("collects once 0.05 SOL is waiting, not before", () => {
    const below = decide(state(0, { lamports: 0.049 * SOL, cents: 900 }), T0);
    expect(below.filter((s) => s.effect.type === "collect")).toEqual([]);
    const at = decide(state(0, { lamports: 0.05 * SOL, cents: 1_000 }), T0);
    expect(at).toContainEqual({ dropId: "DROP-001", effect: { type: "collect", lamports: 0.05 * SOL } });
  });

  it("when the uncollected fees fill the pool, collects first, then funds", () => {
    // $1,990 in the treasury, $15 waiting on pump.fun: full, but the treasury can't pay yet.
    const steps = decide(state(199_000, { lamports: 1_000, cents: 1_500 }), T0);
    expect(steps.map((s) => s.effect.type)).toEqual(["collect"]);
    expect(decide(state(201_000, { lamports: 0, cents: 0 }), T0).map((s) => s.effect.type)).toEqual(["fund"]);
  });

  it("a tick collects, reads the pool again, and funds in the same minute", async () => {
    let treasuryCents = 199_000;
    let waiting = { lamports: 0.1 * SOL, cents: 1_500 };
    const calls: string[] = [];
    const effects = {
      readTreasury: async () => treasuryCents,
      readCreatorFees: async () => waiting,
      collect: async (d: DropRecord, lamports: number) => {
        calls.push(`collect ${d.id} ${lamports}`);
        treasuryCents += waiting.cents;
        waiting = { lamports: 0, cents: 0 };
      },
      fund: async (d: DropRecord, cents: number) => {
        calls.push(`fund ${d.id} ${cents}`);
        treasuryCents -= cents;
      },
      snapshot: async () => ({ hash: "h", holders: 1 }),
      lockTickets: async () => ({ hash: "t", totalTickets: 10 }),
    } as unknown as Effects;
    const store = memoryStore(state(0));
    const report = await tick(store, effects, T0, () => 0.5);
    expect(calls).toEqual([`collect DROP-001 ${0.1 * SOL}`, "fund DROP-001 200000"]);
    expect(report?.errors).toEqual([]);
    expect(store.peek()).toMatchObject({ treasuryCents: 500, uncollected: { lamports: 0 }, poolReadAt: T0.toISOString() });
  });

  it("collects at most once a tick, even if the vault still reads full", async () => {
    let collects = 0;
    const effects = {
      readTreasury: async () => 0,
      readCreatorFees: async () => ({ lamports: SOL, cents: 100 }),
      collect: async () => void collects++,
    } as unknown as Effects;
    await tick(memoryStore(state(0)), effects, T0, () => 0.5);
    expect(collects).toBe(1);
  });
});

// --- fee events from Helius ------------------------------------------------------------------------

describe("fee events from a Helius webhook", () => {
  it("reads a real bonding curve buy (mainnet, Nov 2026): the creator fee from the trade's event", () => {
    const [e] = parseFeeEvents([pumpBuy], "CR7jxNgXamCzuQFopATAWfkNDKbgZjasBNVDjTTJpe5n", "unused");
    expect(e).toEqual({
      signature: "RSw514zbeork5YuwjrFBWQzbuVU73GcnGyoopdXwyu4m54MHJfdbK3gPBVTyusPCcgXhwHh32cPnt3E8iPAb2iw",
      slot: 465442853,
      at: "2026-11-04T20:53:13.000Z",
      venue: "curve",
      side: "buy",
      trader: "DefYnFe5WfyzNTNmrJyz4qUrPV73bvBrEBvxTb7rLAe1",
      feeLamports: 296_297, // 0.30% of the trade
      tradeLamports: 98_765_431,
    });
  });

  it("reads a real PumpSwap buy, after graduation", () => {
    const [e] = parseFeeEvents([poolBuy], "unused", "Ebo2ipNynYTFrY7vR5M46UdRqSJp4x8zVNVxWJrR8DtX");
    expect(e).toMatchObject({ venue: "pool", side: "buy", trader: "8KkY2orPxQg5vGNwnUB2cKVRUKCPdc4MoD9XSmXhsbw4", feeLamports: 8_557_316, tradeLamports: 900_770_015 });
  });

  it("ignores other coins' trades", () => {
    expect(parseFeeEvents([pumpBuy, poolBuy], mint.toBase58(), poolAddress(mint).toBase58())).toEqual([]);
  });

  const trade = (extra: Partial<SampleTrade> = {}): SampleTrade => ({
    mint: mint.toBase58(),
    side: "buy",
    trader: ops.toBase58(),
    tradeLamports: 2 * SOL,
    feeLamports: 6_000_000,
    time: 1_795_000_000,
    ...extra,
  });

  it("reads made-up trades the same way (what npm run fees:simulate sends)", () => {
    const pool = poolAddress(mint).toBase58();
    const events = parseFeeEvents([sampleTx(trade()), sampleTx(trade({ pool, side: "sell", feeLamports: 9 }))], mint.toBase58(), pool);
    expect(events.map((e) => [e.venue, e.side, e.feeLamports, e.tradeLamports])).toEqual([
      ["curve", "buy", 6_000_000, 2 * SOL],
      ["pool", "sell", 9, 2 * SOL],
    ]);
  });

  it("one event per transaction: a repeat delivery is the same event, two trades in one transaction add up", () => {
    const signature = randomSignature();
    const tx = sampleTx(trade({ signature }));
    expect(parseFeeEvents([tx, tx], mint.toBase58(), "x")).toHaveLength(1);
    const both = { ...tx, meta: { ...tx.meta, innerInstructions: [{ index: 0, instructions: [...tx.meta.innerInstructions[0].instructions, ...tx.meta.innerInstructions[0].instructions] }] } };
    expect(parseFeeEvents([both], mint.toBase58(), "x")[0]).toMatchObject({ feeLamports: 12_000_000, tradeLamports: 4 * SOL });
  });

  it("skips failed transactions and trades that paid no creator fee", () => {
    const failed = { ...sampleTx(trade()), meta: { ...sampleTx(trade()).meta, err: { InstructionError: [0, "Custom"] } } };
    expect(parseFeeEvents([failed, sampleTx(trade({ feeLamports: 0 }))], mint.toBase58(), "x")).toEqual([]);
  });

  it("only accepts what Helius sends: a list of transactions with signatures", () => {
    expect(isHeliusPayload([pumpBuy, sampleTx(trade())])).toBe(true);
    expect(isHeliusPayload({ signature: "x" })).toBe(false);
    expect(isHeliusPayload([{ transaction: { signatures: ["not a signature"] } }])).toBe(false);
    expect(isHeliusPayload([{ signature: randomSignature(), instructions: [] }])).toBe(true); // enhanced
  });
});

// --- coins on the homepage ---------------------------------------------------------------------------

describe("a coin per real trade", () => {
  const page: LiveDrop = { phase: "filling", drop: { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalUsd: 2000 }, fundedUsd: 0, tickets: 0, watching: 0, trades: [], history: [] };
  const fee = (signature: string, feeUsd: number, tradeUsd: number): LiveFee => ({ signature, at: "2026-11-18T12:00:00Z", side: "buy", trader: "T", feeUsd, tradeUsd });
  const view = (fees: LiveFee[], poolCents = 10_000): LiveView => ({
    cluster: "mainnet-beta",
    poolCents,
    drop: { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalCents: 200_000, stage: "funding", round: 0, tickets: null },
    lastWinner: null,
    fees,
    updatedAt: "2026-11-18T12:00:00Z",
  });
  let n = 0;
  const id = () => ++n;

  it("trades already in the feed when the page loads don't rain down; each new one drops a coin, oldest first, once", () => {
    let s = applyView(page, view([fee("a", 1, 300)]), id);
    expect(s.trades).toEqual([]);
    s = applyView(s, view([fee("c", 24, 8_000), fee("b", 3, 1_000), fee("a", 1, 300)], 12_700), id);
    expect(s.trades.map((t) => [t.usd, t.tradeUsd])).toEqual([
      [3, 1_000],
      [24, 8_000],
    ]);
    expect(s.trades[0].url).toBe("https://solscan.io/tx/b");
    expect(s.fundedUsd).toBe(127);
    // The same feed again: nothing new.
    const again = applyView(s, view([fee("c", 24, 8_000), fee("b", 3, 1_000), fee("a", 1, 300)], 12_700), id);
    expect(again.trades).toEqual(s.trades);
  });

  it("labels each coin with its fee and the trade that paid it", () => {
    expect(feeLabel({ usd: 4.2, tradeUsd: 3_100, side: "buy" })).toBe("+$4.20 · $3,100 buy");
    expect(feeLabel({ usd: 0.42, tradeUsd: 4.5, side: "sell" })).toBe("+$0.42 · $4.50 sell");
    expect(feeLabel({ usd: 240.6, tradeUsd: 80_000, side: "buy" })).toBe("+$241 · $80,000 buy");
    expect(feeLabel({ usd: 3 })).toBe("+$3.00");
  });

  it("bigger fees, bigger coins", () => {
    expect(coinPx(0)).toBe(16);
    expect(coinPx(3)).toBeLessThan(coinPx(24));
    expect(coinPx(24)).toBeLessThan(coinPx(40));
    expect(coinPx(5_000)).toBe(40);
  });
});
