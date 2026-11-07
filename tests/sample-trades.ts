// Made-up trades, shaped exactly like what Helius sends for a real one (a "raw" webhook: the
// getTransaction JSON), for the tests.
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "@/lib/chain/pump";
import { EVENT_DISCRIMINATORS } from "@/lib/fees/events";

export interface SampleTrade {
  mint: string;
  pool?: string; // set: a PumpSwap trade on this pool; unset: a bonding curve trade
  side: "buy" | "sell";
  trader: string;
  tradeLamports: number;
  feeLamports: number;
  time: number; // unix seconds
  signature?: string;
}

const hex = (h: string) => Buffer.from(h, "hex");
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const key = (k: string) => Buffer.from(bs58.decode(k));

// The event's instruction data, laid out as in lib/fees/events.ts (fields after the ones it reads are left out).
export function eventData(t: SampleTrade): Buffer {
  const { EVENT_CPI_TAG, TRADE_EVENT, BUY_EVENT, SELL_EVENT } = EVENT_DISCRIMINATORS;
  if (!t.pool) {
    const b = Buffer.alloc(217);
    key(t.mint).copy(b, 0);
    u64(t.tradeLamports).copy(b, 32);
    b[48] = t.side === "buy" ? 1 : 0;
    key(t.trader).copy(b, 49);
    b.writeBigInt64LE(BigInt(t.time), 81);
    u64(t.feeLamports).copy(b, 209);
    return Buffer.concat([hex(EVENT_CPI_TAG), hex(TRADE_EVENT), b]);
  }
  const b = Buffer.alloc(352);
  b.writeBigInt64LE(BigInt(t.time), 0);
  u64(t.tradeLamports).copy(b, 104);
  key(t.pool).copy(b, 112);
  key(t.trader).copy(b, 144);
  u64(t.feeLamports).copy(b, 344);
  return Buffer.concat([hex(EVENT_CPI_TAG), hex(t.side === "buy" ? BUY_EVENT : SELL_EVENT), b]);
}

export const randomSignature = () => bs58.encode(randomBytes(64));

export function sampleTx(t: SampleTrade, slot = 1) {
  const program = (t.pool ? PUMP_AMM_PROGRAM_ID : PUMP_PROGRAM_ID).toBase58();
  return {
    slot,
    blockTime: t.time,
    meta: { err: null, innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [], data: bs58.encode(eventData(t)), stackHeight: 2 }] }], loadedAddresses: { writable: [], readonly: [] } },
    transaction: { signatures: [t.signature ?? randomSignature()], message: { accountKeys: [t.trader, program], instructions: [] } },
  };
}
