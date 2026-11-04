// Helius calls this with every transaction that touches $LOOT's bonding curve or pool (see
// scripts/helius-webhook.ts). Each trade's creator fee is recorded, and the homepage drops a coin
// for it. The pool itself is always read from the chain, so these only ever show what happened.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { poolAddress } from "@/lib/chain/pump";
import { CLUSTER } from "@/lib/chain/solana";
import { isHeliusPayload, parseFeeEvents } from "@/lib/fees/events";
import { lastSolUsd, recordFeeEvents } from "@/lib/fees/store";
import { solPriceUsd } from "@/lib/treasury/price";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const MAX_BYTES = 2_000_000;
const PRICE_TTL_MS = 30_000;

// Trades can arrive many a second, and the price API limits how often it's asked: one price per
// 30 seconds is plenty for labelling fees. If it can't be reached, the last price used will do,
// so a trade is never lost over its label.
let price: { usd: number; at: number } | undefined;
async function solUsd(): Promise<number> {
  if (price && Date.now() - price.at < PRICE_TTL_MS) return price.usd;
  try {
    price = { usd: await solPriceUsd(), at: Date.now() };
    return price.usd;
  } catch (err) {
    const last = price?.usd ?? (await lastSolUsd(CLUSTER));
    if (last) return last;
    throw err;
  }
}

// Helius sends back, as the Authorization header, the authHeader the webhook was registered with.
function authorized(req: Request): boolean {
  const secret = process.env.FEES_WEBHOOK_SECRET;
  const given = req.headers.get("authorization") ?? "";
  return Boolean(secret) && given.length === secret!.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret!));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mint = process.env.LOOT_MINT;
  if (!mint) return NextResponse.json({ error: "LOOT_MINT is not set" }, { status: 500 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  // 403 for anything that isn't a Helius delivery: Helius doesn't retry those.
  if (!isHeliusPayload(body)) return NextResponse.json({ error: "not a Helius transaction list" }, { status: 403 });

  const events = parseFeeEvents(body, mint, poolAddress(new PublicKey(mint)).toBase58());
  if (!events.length) return NextResponse.json({ recorded: 0 });
  try {
    const recorded = await recordFeeEvents(events, CLUSTER, await solUsd());
    return NextResponse.json({ recorded, trades: events.length });
  } catch (err) {
    console.error("recording fee events failed", err);
    return NextResponse.json({ error: "not recorded" }, { status: 500 }); // Helius retries
  }
}
