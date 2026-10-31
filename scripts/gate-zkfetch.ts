// Day-1 gate #2: can we get a Reclaim zkTLS proof of Zinc's order record that
// (a) verifies, (b) hides our API key, and (c) contains NONE of the shipping details?
// Usage: fill .env (Zinc + Reclaim + your own TEST_PII_*), then `npm run gate:zkfetch`.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { ReclaimClient } from "@reclaimprotocol/zk-fetch";
import { verifyProof } from "@reclaimprotocol/js-sdk";
import { findPII, type WinnerPII } from "../lib/proofs/pii-guard";

const env = process.env;
for (const k of ["ZINC_API_KEY", "ZINC_ORDER_ID", "RECLAIM_APP_ID", "RECLAIM_APP_SECRET"]) {
  if (!env[k]) {
    console.error(`Set ${k} in .env`);
    process.exit(1);
  }
}
const base = env.ZINC_BASE_URL ?? "https://api.zinc.io/v1";
const auth =
  env.ZINC_AUTH === "bearer"
    ? `Bearer ${env.ZINC_API_KEY}`
    : `Basic ${Buffer.from(`${env.ZINC_API_KEY}:`).toString("base64")}`;
const pii: WinnerPII = {
  name: env.TEST_PII_NAME,
  email: env.TEST_PII_EMAIL,
  phone: env.TEST_PII_PHONE,
  line1: env.TEST_PII_LINE1,
  city: env.TEST_PII_CITY,
  zip: env.TEST_PII_ZIP,
};
if (!Object.values(pii).some(Boolean)) {
  console.error("Set at least TEST_PII_NAME, TEST_PII_LINE1 and TEST_PII_ZIP so the leak check means something");
  process.exit(1);
}

// Allowlist: the only parts of the response we want revealed. Adjust the paths to match
// what `npm run gate:zinc` printed.
const REVEAL = ["$.request_id", "$._type", "$.code", "$.merchant_order_ids", "$.price_components", "$.request.products", "$.tracking"];

const client = new ReclaimClient(env.RECLAIM_APP_ID!, env.RECLAIM_APP_SECRET!);
console.log("Requesting zkTLS proof from Reclaim (can take a minute)...");
const proof: any = await client.zkFetch(
  `${base}/orders/${encodeURIComponent(env.ZINC_ORDER_ID!)}`,
  { method: "GET" },
  {
    headers: { Authorization: auth },
    responseRedactions: REVEAL.map((jsonPath) => ({ jsonPath })),
  } as any,
);
if (!proof) {
  console.error("❌ zkFetch returned no proof");
  process.exit(1);
}

const proofText = JSON.stringify(proof);
const checks: [string, boolean][] = [];
checks.push(["proof verifies", Boolean(await (verifyProof as any)(proof))]);
checks.push(["API key hidden", !proofText.includes(env.ZINC_API_KEY!) && !proofText.includes(auth)]);
const leaks = findPII(proofText, pii);
checks.push([`no shipping details in proof${leaks.length ? ` (LEAKED: ${leaks.join(", ")})` : ""}`, leaks.length === 0]);

console.log("\nGO / NO-GO:");
for (const [label, ok] of checks) console.log(`${ok ? "  ✅" : "  ❌"} ${label}`);

if (checks.every(([, ok]) => ok)) {
  mkdirSync("proofs-out", { recursive: true });
  writeFileSync("proofs-out/zinc-order-proof.json", JSON.stringify(proof, null, 2));
  console.log("\nRevealed data:", proof.extractedParameterValues ?? "(see proofs-out/zinc-order-proof.json)");
  console.log("zkFetch gate: GO - proof saved to proofs-out/zinc-order-proof.json");
} else {
  console.log("\nzkFetch gate: NO-GO - proof NOT saved. Fix the REVEAL allowlist / redactions and rerun.");
  process.exit(1);
}
