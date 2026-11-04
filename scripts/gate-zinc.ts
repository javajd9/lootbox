// Day-1 gate #1: does Zinc's order record contain what our proofs need?
// Prints field NAMES and safe values only - never the shipping address.
//
// Usage: put ZINC_API_KEY in .env, then `npm run gate:zinc`.
// - With ZINC_ORDER_ID set, it reads that order.
// - Without it, and with a sandbox key (zn_test_...), it places a free sandbox order for Zinc's
//   test product (to a made-up address), waits for it, and prints its id for ZINC_ORDER_ID.
//   It refuses to place an order with a live key.
import "dotenv/config";
import { orderFacts, revealedSpans } from "../lib/orders/redact";
import { isTestKey, zincClient, zincSettings, type ZincOrder } from "../lib/orders/zinc";

const s = zincSettings();
const zinc = zincClient(s);

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}${prefix ? "." : ""}${k}`, ...keyPaths(v, `${prefix}${prefix ? "." : ""}${k}`)]);
  }
  return [];
}

let id = process.env.ZINC_ORDER_ID;
if (!id) {
  if (!isTestKey(s.apiKey)) {
    console.error("Set ZINC_ORDER_ID in .env, or use a sandbox key (zn_test_...) to place a free test order.");
    process.exit(1);
  }
  const placed = await zinc.createOrder({
    products: [{ url: "https://zinc.com/shop/products/test-success", quantity: 1 }],
    max_price: 500,
    shipping_address: { first_name: "Test", last_name: "Person", address_line1: "123 Test Street", city: "Testville", state: "CA", postal_code: "90001", phone_number: "5555550100", country: "US" },
    idempotency_key: crypto.randomUUID(),
    metadata: { lootbox_drop: "GATE" },
  });
  id = placed.id;
  console.log(`Placed sandbox order ${id} (status ${placed.status}). Put this in .env as ZINC_ORDER_ID.`);
}

let order: ZincOrder = await zinc.getOrder(id);
for (let i = 0; i < 20 && (order.status === "pending" || order.status === "in_progress"); i++) {
  await new Promise((r) => setTimeout(r, 3_000));
  order = await zinc.getOrder(id);
}
console.log(`GET ${s.baseUrl}/orders/${id} -> status ${order.status}`);
const paths = keyPaths(order);

const needed: Record<string, RegExp> = {
  "order status": /^status$/,
  "max price": /^max_price$/,
  "retailer order ids (merchant_order_ids)": /^merchant_order_ids/,
  "price breakdown (job_result.price_components)": /price_components/,
  "product urls / quantities": /^items\[\d+\]\.(url|quantity)$/,
  "tracking numbers (for delivery later)": /tracking/,
};
console.log("\nGO / NO-GO:");
let allGood = true;
for (const [label, re] of Object.entries(needed)) {
  const found = paths.filter((p) => re.test(p));
  if (!found.length) allGood = false;
  console.log(`${found.length ? "  ✅" : "  ❌"} ${label}${found.length ? `  (${found.slice(0, 3).join(", ")})` : ""}`);
}
if (order.status === "order_placed") {
  const { values } = revealedSpans(JSON.stringify(order), orderFacts(order));
  console.log("\nWhat an order proof would reveal:", values);
}
const privatePaths = paths.filter((p) => /(address|phone|first_name|last_name|postal|zip|email)/i.test(p));
console.log(`\nFields that are never revealed in proofs (${privatePaths.length}):`);
for (const p of privatePaths) console.log(`  - ${p}`);
console.log(allGood ? "\nZinc gate: GO" : "\nZinc gate: some fields are missing (see above)");
