// The spending cap. Each prize item has its own all-in cap; the order's cap (Zinc's `max_price`)
// is their sum, and it can never be more than the prize pool the drop locked. Anything that
// doesn't add up stops the order before it's sent.
import type { PrizeItem } from "@/lib/engine/drops";

export interface OrderLine {
  name: string;
  url: string;
  quantity: number;
  maxPriceCents: number; // each
}

export type Cap = { ok: true; lines: OrderLine[]; maxPriceCents: number } | { ok: false; reason: string };

const MAX_QUANTITY = 100; // Zinc's own limit per product
const MAX_PRODUCTS = 10;

const ASIN = /^[A-Z0-9]{10}$/;

export function productUrl(item: PrizeItem): string | null {
  if (item.url) return /^https:\/\//.test(item.url) ? item.url : null;
  if (item.asin && ASIN.test(item.asin)) return `https://www.amazon.com/dp/${item.asin}`;
  return null;
}

// Zinc's flat fee on every order, paid on top of the order's price cap.
export const ZINC_ORDER_FEE_CENTS = 100;

// feeCents: what the order costs on top of its cap (Zinc's fee), which the pool has to cover too.
export function orderCap(items: PrizeItem[] | undefined, goalCents: number, feeCents = 0): Cap {
  if (!items?.length) return { ok: false, reason: "no prize items are set for this drop" };
  if (items.length > MAX_PRODUCTS) return { ok: false, reason: `a prize can have at most ${MAX_PRODUCTS} items` };
  const lines: OrderLine[] = [];
  for (const item of items) {
    const url = productUrl(item);
    if (!url) return { ok: false, reason: `"${item.name}" has no valid ASIN or product URL` };
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) return { ok: false, reason: `"${item.name}" has a bad quantity` };
    if (!Number.isInteger(item.maxPriceCents) || item.maxPriceCents <= 0) return { ok: false, reason: `"${item.name}" has no price cap` };
    lines.push({ name: item.name, url, quantity: item.quantity, maxPriceCents: item.maxPriceCents });
  }
  const maxPriceCents = lines.reduce((n, l) => n + l.maxPriceCents * l.quantity, 0);
  if (maxPriceCents + feeCents > goalCents) {
    const fee = feeCents ? ` plus Zinc's $${(feeCents / 100).toFixed(2)} order fee` : "";
    return { ok: false, reason: `the prize's price caps add up to $${(maxPriceCents / 100).toFixed(2)}${fee}, more than the $${(goalCents / 100).toFixed(2)} pool` };
  }
  return { ok: true, lines, maxPriceCents };
}

// After Zinc places the order: did it really stay under the cap? (It should; this catches the day it doesn't.)
export function overCap(totalCents: number | null | undefined, maxPriceCents: number): boolean {
  return typeof totalCents === "number" && totalCents > maxPriceCents;
}
