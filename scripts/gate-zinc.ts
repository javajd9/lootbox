// Day-1 gate #1: does Zinc's order record contain what our proofs need?
// Prints field NAMES and safe values only - never the shipping address.
// Usage: fill .env (ZINC_API_KEY, ZINC_ORDER_ID), then `npm run gate:zinc`.
import "dotenv/config";

const { ZINC_API_KEY, ZINC_ORDER_ID, ZINC_BASE_URL = "https://api.zinc.io/v1", ZINC_AUTH = "basic" } = process.env;
if (!ZINC_API_KEY || !ZINC_ORDER_ID) {
  console.error("Set ZINC_API_KEY and ZINC_ORDER_ID in .env");
  process.exit(1);
}

function zincAuthHeader(): string {
  return ZINC_AUTH === "bearer"
    ? `Bearer ${ZINC_API_KEY}`
    : `Basic ${Buffer.from(`${ZINC_API_KEY}:`).toString("base64")}`;
}

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}${prefix ? "." : ""}${k}`, ...keyPaths(v, `${prefix}${prefix ? "." : ""}${k}`)]);
  }
  return [];
}

const url = `${ZINC_BASE_URL}/orders/${encodeURIComponent(ZINC_ORDER_ID)}`;
const res = await fetch(url, { headers: { Authorization: zincAuthHeader() } });
console.log(`GET ${url} -> HTTP ${res.status}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
const body = await res.json();
const paths = keyPaths(body);

const needed: Record<string, RegExp> = {
  "order status": /(^|\.)(status|_type|code)$/,
  "Amazon order id (merchant_order_ids)": /merchant_order_id/,
  "price breakdown (price_components)": /price_components/,
  "product ids / quantities": /(product_id|quantity)/,
  "tracking numbers": /tracking/,
  "delivery status": /deliver/,
};
console.log("\nGO / NO-GO:");
let allGood = true;
for (const [label, re] of Object.entries(needed)) {
  const found = paths.filter((p) => re.test(p));
  if (!found.length) allGood = false;
  console.log(`${found.length ? "  ✅" : "  ❌"} ${label}${found.length ? `  (${found.slice(0, 3).join(", ")})` : ""}`);
}
const privatePaths = paths.filter((p) => /(address|phone|first_name|last_name|zip|email)/i.test(p));
console.log(`\nFields that MUST be redacted in proofs (${privatePaths.length}):`);
for (const p of privatePaths) console.log(`  - ${p}`);
console.log(allGood ? "\nZinc gate: GO" : "\nZinc gate: missing fields above - delivery status can come from AfterShip instead");
