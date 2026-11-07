// Fee events, kept in Supabase's public `fee_events` table (server only: it uses the service role key).
// Each row names its chain, and only mainnet rows are read, so trades simulated before launch never show.
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import type { LiveFee } from "@/lib/live/view";
import type { FeeEvent } from "./events";

const usd = (lamports: number, solUsd: number) => Math.round((lamports / 1e9) * solUsd * 1e4) / 1e4;

// Saves each event once: a repeat delivery of the same transaction is ignored. Returns how many were new.
export async function recordFeeEvents(events: FeeEvent[], solUsd: number): Promise<number> {
  if (!events.length) return 0;
  const rows = events.map((e) => ({
    signature: e.signature,
    cluster: CLUSTER,
    slot: e.slot,
    at: e.at,
    venue: e.venue,
    side: e.side,
    trader: e.trader,
    fee_lamports: e.feeLamports,
    trade_lamports: e.tradeLamports,
    sol_usd: solUsd,
    fee_usd: usd(e.feeLamports, solUsd),
    trade_usd: usd(e.tradeLamports, solUsd),
  }));
  const { data } = check(await serverDb().from("fee_events").upsert(rows, { onConflict: "signature", ignoreDuplicates: true }).select("signature"), "save fee events");
  return data?.length ?? 0;
}

// The SOL price that was used for the latest recorded trade, for when the price API is unavailable.
export async function lastSolUsd(): Promise<number | null> {
  const { data } = check(await serverDb().from("fee_events").select("sol_usd").eq("cluster", CLUSTER).order("recorded_at", { ascending: false }).limit(1).maybeSingle(), "load last price");
  return data ? Number(data.sol_usd) : null;
}

// The latest trades, newest first, as the homepage gets them.
export async function recentFees(limit = 20): Promise<LiveFee[]> {
  const { data } = check(
    await serverDb().from("fee_events").select("signature, at, side, trader, fee_usd, trade_usd").eq("cluster", CLUSTER).order("at", { ascending: false }).limit(limit),
    "load fee events",
  );
  return (data ?? []).map((r) => ({ signature: r.signature, at: r.at, side: r.side, trader: r.trader, feeUsd: Number(r.fee_usd), tradeUsd: Number(r.trade_usd) }));
}
