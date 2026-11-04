// Fee events: one per real $LOOT trade, read from the transactions Helius sends to /api/fees.
//
// Every pump.fun and PumpSwap trade logs an event (an Anchor "event CPI": the program calls itself
// with the event as instruction data) that says exactly what the creator was charged. The event is
// used rather than the vault's balance change, because new-style trades keep the creator fee on the
// curve or pool and the vault doesn't move until the fee is swept.
import bs58 from "bs58";
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "@/lib/chain/pump";

export interface FeeEvent {
  signature: string;
  slot: number;
  at: string; // ISO, the block's time
  venue: "curve" | "pool"; // bonding curve, or PumpSwap after graduation
  side: "buy" | "sell";
  trader: string;
  feeLamports: number; // the creator fee this trade paid
  tradeLamports: number; // the trade's size in SOL
}

// A transaction as Helius sends it: "raw" webhooks (the same JSON as getTransaction) or "enhanced".
interface RawTx {
  slot?: number;
  blockTime?: number | null;
  meta?: { err?: unknown; innerInstructions?: { instructions: { programIdIndex: number; data: string }[] }[] | null; loadedAddresses?: { writable?: string[]; readonly?: string[] } | null } | null;
  transaction?: { signatures?: string[]; message?: { accountKeys?: (string | { pubkey: string })[] } };
}
interface EnhancedTx {
  signature?: string;
  slot?: number;
  timestamp?: number;
  transactionError?: unknown;
  instructions?: { programId: string; data?: string; innerInstructions?: { programId: string; data?: string }[] }[];
}

const EVENT_CPI_TAG = "e445a52e51cb9a1d"; // Anchor's prefix for an event emitted as a self-call
const disc = (bytes: number[]) => Buffer.from(bytes).toString("hex");
const TRADE_EVENT = disc([189, 219, 127, 211, 78, 230, 97, 238]); // pump: TradeEvent
const BUY_EVENT = disc([103, 244, 82, 31, 44, 245, 119, 119]); // PumpSwap: BuyEvent
const SELL_EVENT = disc([62, 47, 55, 10, 165, 3, 220, 42]); // PumpSwap: SellEvent
export const EVENT_DISCRIMINATORS = { TRADE_EVENT, BUY_EVENT, SELL_EVENT, EVENT_CPI_TAG };

const PUMP = PUMP_PROGRAM_ID.toBase58();
const AMM = PUMP_AMM_PROGRAM_ID.toBase58();
const key = (b: Buffer, at: number) => bs58.encode(b.subarray(at, at + 32));
const u64 = (b: Buffer, at: number) => Number(b.readBigUInt64LE(at));

interface Trade {
  venue: FeeEvent["venue"];
  side: FeeEvent["side"];
  trader: string;
  feeLamports: number;
  tradeLamports: number;
  time: number;
}

// One event's bytes (after the tag and discriminator), for our coin only. Offsets follow the IDLs:
//   pump TradeEvent: mint 0, sol_amount 32, token_amount 40, is_buy 48, user 49, timestamp 81, …,
//     creator 169, creator_fee_basis_points 201, creator_fee 209
//   PumpSwap Buy/SellEvent: timestamp 0, …, quote amount 56 (in / out), user_quote_amount 104,
//     pool 112, user 144, …, coin_creator 304, coin_creator_fee_basis_points 336, coin_creator_fee 344
function decodeTrade(programId: string, data: Buffer, mint: string, pool: string): Trade | null {
  if (data.length < 16 || data.subarray(0, 8).toString("hex") !== EVENT_CPI_TAG) return null;
  const kind = data.subarray(8, 16).toString("hex");
  const b = data.subarray(16);
  if (programId === PUMP && kind === TRADE_EVENT && b.length >= 217) {
    if (key(b, 0) !== mint) return null;
    return { venue: "curve", side: b[48] === 1 ? "buy" : "sell", trader: key(b, 49), tradeLamports: u64(b, 32), feeLamports: u64(b, 209), time: Number(b.readBigInt64LE(81)) };
  }
  if (programId === AMM && (kind === BUY_EVENT || kind === SELL_EVENT) && b.length >= 352) {
    if (key(b, 112) !== pool) return null;
    return { venue: "pool", side: kind === BUY_EVENT ? "buy" : "sell", trader: key(b, 144), tradeLamports: u64(b, 104), feeLamports: u64(b, 344), time: Number(b.readBigInt64LE(0)) };
  }
  return null;
}

// The program-and-data pairs of every inner instruction, from either payload format.
function innerCalls(tx: RawTx & EnhancedTx): { programId: string; data: string }[] {
  if (tx.transaction?.message) {
    const keys = [
      ...(tx.transaction.message.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k.pubkey)),
      ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? []),
    ];
    return (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions.map((i) => ({ programId: keys[i.programIdIndex], data: i.data })));
  }
  return (tx.instructions ?? []).flatMap((i) => (i.innerInstructions ?? []).map((c) => ({ programId: c.programId, data: c.data ?? "" })));
}

// Whether a webhook body looks like what Helius sends: an array of transactions, each with a signature.
export function isHeliusPayload(body: unknown): body is unknown[] {
  return Array.isArray(body) && body.length <= 1000 && body.every((t) => !!t && typeof t === "object" && !!signatureOf(t as RawTx & EnhancedTx));
}

function signatureOf(tx: RawTx & EnhancedTx): string | undefined {
  const sig = tx.transaction?.signatures?.[0] ?? tx.signature;
  return typeof sig === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig) ? sig : undefined;
}

// Every $LOOT trade in a webhook body, one event per transaction (a transaction with several
// trades of our coin, say a bot's round trip, adds them up). Failed transactions paid nothing.
export function parseFeeEvents(body: unknown[], mint: string, pool: string): FeeEvent[] {
  const events = new Map<string, FeeEvent>();
  for (const item of body) {
    const tx = item as RawTx & EnhancedTx;
    const signature = signatureOf(tx);
    if (!signature || tx.meta?.err || tx.transactionError) continue;
    for (const call of innerCalls(tx)) {
      if (call.programId !== PUMP && call.programId !== AMM) continue;
      let data: Buffer;
      try {
        data = Buffer.from(bs58.decode(call.data));
      } catch {
        continue;
      }
      const t = decodeTrade(call.programId, data, mint, pool);
      if (!t || t.feeLamports <= 0) continue;
      const seen = events.get(signature);
      if (seen) {
        seen.feeLamports += t.feeLamports;
        seen.tradeLamports += t.tradeLamports;
        continue;
      }
      const time = tx.blockTime ?? tx.timestamp ?? t.time;
      events.set(signature, {
        signature,
        slot: tx.slot ?? 0,
        at: new Date(time * 1000).toISOString(),
        venue: t.venue,
        side: t.side,
        trader: t.trader,
        feeLamports: t.feeLamports,
        tradeLamports: t.tradeLamports,
      });
    }
  }
  return [...events.values()];
}
