// zkTLS check: can we get a Reclaim zkTLS proof of Zinc's order record that
// (a) verifies, (b) hides our API key, and (c) contains NONE of the shipping details?
// It uses exactly the options the engine uses (lib/orders/redact).
// Usage: fill .env (ZINC_API_KEY, ZINC_ORDER_ID of a placed order, RECLAIM_*, and the order's
// shipping details as TEST_PII_*), then `npm run gate:zkfetch`.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { verifyProof } from "@reclaimprotocol/js-sdk";
import { revealedOf } from "../lib/orders/order";
import { zkFetchOptions } from "../lib/orders/redact";
import { orderUrl, zincClient, zincSettings } from "../lib/orders/zinc";
import { findPII, type WinnerPII } from "../lib/proofs/pii-guard";

const env = process.env;
for (const k of ["ZINC_API_KEY", "ZINC_ORDER_ID", "RECLAIM_APP_ID", "RECLAIM_APP_SECRET"]) {
  if (!env[k]) {
    console.error(`Set ${k} in .env`);
    process.exit(1);
  }
}
const s = zincSettings();
const pii: WinnerPII = {
  name: env.TEST_PII_NAME,
  email: env.TEST_PII_EMAIL,
  phone: env.TEST_PII_PHONE,
  line1: env.TEST_PII_LINE1,
  city: env.TEST_PII_CITY,
  zip: env.TEST_PII_ZIP,
};
if (!Object.values(pii).some(Boolean)) {
  console.error("Set at least TEST_PII_NAME, TEST_PII_LINE1 and TEST_PII_ZIP (the order's shipping details) so the leak check means something");
  process.exit(1);
}

const order = await zincClient(s).getOrder(env.ZINC_ORDER_ID!);
if (order.status !== "order_placed") {
  console.error(`Order ${order.id} is "${order.status}"; the proof is made once it's "order_placed".`);
  process.exit(1);
}
const { publicOptions, privateOptions } = zkFetchOptions(order, s.authHeader);
const client = new ReclaimClient(env.RECLAIM_APP_ID!, env.RECLAIM_APP_SECRET!);
console.log("Requesting zkTLS proof from Reclaim (can take a minute)...");
const proof: any = await client.zkFetch(orderUrl(s, order.id), publicOptions as any, privateOptions as any, 2, 5_000);
if (!proof) {
  console.error("❌ zkFetch returned no proof");
  process.exit(1);
}

const proofText = JSON.stringify(proof);
const checks: [string, boolean][] = [];
const verified = await verifyProof(proof, { dangerouslyDisableContentValidation: true });
checks.push(["proof verifies (attestor signatures)", verified.isVerified]);
checks.push(["API key hidden", !proofText.includes(s.apiKey) && !proofText.includes(s.authHeader)]);
const leaks = findPII(proofText, pii);
checks.push([`no shipping details in proof${leaks.length ? ` (LEAKED: ${leaks.join(", ")})` : ""}`, leaks.length === 0]);
checks.push(["proves the order was placed", proof.extractedParameterValues?.status === "order_placed" && proof.extractedParameterValues?.orderId === order.id]);

console.log("\nGO / NO-GO:");
for (const [label, ok] of checks) console.log(`${ok ? "  ✅" : "  ❌"} ${label}`);

if (checks.every(([, ok]) => ok)) {
  mkdirSync("proofs-out", { recursive: true });
  writeFileSync("proofs-out/zinc-order-proof.json", JSON.stringify(proof, null, 2));
  console.log("\nRevealed data:", revealedOf(proof));
  console.log("zkFetch gate: GO - proof saved to proofs-out/zinc-order-proof.json");
} else {
  console.log("\nzkFetch gate: NO-GO - proof NOT saved. Fix lib/orders/redact.ts and rerun.");
  process.exit(1);
}
