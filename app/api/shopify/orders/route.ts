// Shopify's orders/create webhook. A claim's $0 checkout is finished: store the address privately,
// post its salted hash on-chain, and mark the claim done (see lib/claims/complete.ts).
import { NextResponse } from "next/server";
import { completeClaim } from "@/lib/claims/complete";
import { verifyShopifyHmac, type ShopifyOrder } from "@/lib/claims/shopify";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text(); // the exact bytes Shopify signed
  if (!verifyShopifyHmac(raw, req.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const outcome = await completeClaim(JSON.parse(raw) as ShopifyOrder);
    return NextResponse.json({ note: outcome.note }, { status: outcome.retry ? 409 : 200 });
  } catch (err) {
    console.error("claim webhook failed", err);
    return NextResponse.json({ error: "failed; Shopify will retry" }, { status: 500 });
  }
}
