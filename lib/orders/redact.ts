// What an order proof may show. Reclaim's zkFetch proves a few small facts about Zinc's order
// record, each picked out by a narrow regex: only the spans those regexes select are revealed (even
// Reclaim's attestor sees nothing else), and the values in their named groups are what the proof
// carries. The API key goes in a private header that never enters the proof. Nothing here can
// select the shipping address, phone, email or tracking: every fact is a fixed word, a number,
// an ID, or a product link the engine itself chose.
//
// Then, belt and braces: the finished proof is searched for the winner's details (see
// lib/proofs/pii-guard) and is thrown away if any turn up.
import type { ShippingAddress } from "@/lib/proofs/commitment";
import type { WinnerPII } from "@/lib/proofs/pii-guard";
import type { ZincOrder } from "./zinc";

export interface Fact {
  name: string;
  regex: string;
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The facts a placed order is proven by: which order, that it was placed, its cap, what it cost,
// the retailer's order numbers, and each product that was bought. Built from the order as Zinc
// last returned it, so every fact is there to be matched (a missing one would fail the proof).
export function orderFacts(order: ZincOrder): Fact[] {
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(order.id)) throw new Error(`orderFacts: odd order id "${order.id}"`);
  const facts: Fact[] = [
    { name: "orderId", regex: `"id":\\s*"(?<orderId>${order.id})"` },
    { name: "status", regex: `"status":\\s*"(?<status>order_placed)"` },
    { name: "maxPrice", regex: `"max_price":\\s*(?<maxPrice>\\d+)` },
  ];
  if (typeof order.job_result?.price_components?.total === "number") facts.push({ name: "total", regex: `"total":\\s*(?<total>\\d+)` });
  if (order.merchant_order_ids?.length) {
    facts.push({ name: "merchantOrderIds", regex: `"merchant_order_ids":\\s*\\[(?<merchantOrderIds>(?:\\s*"[A-Za-z0-9-]+"\\s*,?)+)\\]` });
  }
  order.items.forEach((item, i) => facts.push({ name: `product${i + 1}`, regex: `"url":\\s*"${literal(item.url)}"` }));
  return facts;
}

export function zkFetchOptions(order: ZincOrder, authHeader: string) {
  const facts = orderFacts(order);
  return {
    publicOptions: { method: "GET", headers: { accept: "application/json" } },
    privateOptions: {
      headers: { Authorization: authHeader },
      responseMatches: facts.map((f) => ({ type: "regex" as const, value: f.regex })),
      responseRedactions: facts.map((f) => ({ regex: f.regex })),
    },
  };
}

// Exactly what those facts reveal of a response: the selected spans, and the named values.
// zkFetch does the same thing inside the proof; this is how it's tested.
export function revealedSpans(responseText: string, facts: Fact[]): { spans: string[]; values: Record<string, string> } {
  const spans: string[] = [];
  const values: Record<string, string> = {};
  for (const f of facts) {
    const m = new RegExp(f.regex).exec(responseText);
    if (!m) continue;
    spans.push(m[0]);
    Object.assign(values, m.groups ?? {});
  }
  return { spans, values };
}

// Everything that identifies the winner, for the leak check.
export function winnerPII(a: ShippingAddress, email?: string): WinnerPII {
  return { name: a.name, line1: a.line1, line2: a.line2, city: a.city, zip: a.zip, phone: a.phone, email };
}
