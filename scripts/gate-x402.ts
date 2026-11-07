// USDC payment check for Zinc's agent endpoint, the way the drop engine pays for orders on mainnet
// (lib/orders/x402.ts). Zinc has no test mode there, so this runs against the real thing.
//
//   npm run gate:x402 -- --url <product URL> --max <cents>
//       Asks Zinc for the order's price and checks it: USDC on Solana, exactly the cap plus $1, and
//       whether the prize wallet (PRIZE_WALLET_SECRET in .env) can pay it. Signs nothing, pays nothing.
//
//   npm run gate:x402 -- --url <product URL> --max <cents> --pay
//       Places that order for real, paid in USDC from the prize wallet, shipped to the TEST_PII_*
//       address in .env. Use a cheap item. Run it again with --again to check a repeat returns the
//       same order without charging twice.
import "dotenv/config";
import fs from "node:fs";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { connection, heliusUrl } from "../lib/chain/solana";
import { agentZincClient, maxPaymentUnits, pickRequirement, USDC, type AgentKeys } from "../lib/orders/x402";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg("url");
const max = Number(arg("max"));
const pay = process.argv.includes("--pay");
const again = process.argv.includes("--again");
if (!url || !/^https:\/\//.test(url) || !Number.isInteger(max) || max <= 0) {
  console.error("Usage: npm run gate:x402 -- --url <https product URL> --max <cap in cents> [--pay] [--again]");
  process.exit(1);
}
if (!process.env.PRIZE_WALLET_SECRET) {
  console.error("Set PRIZE_WALLET_SECRET (the mainnet prize wallet's key) in .env.");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIZE_WALLET_SECRET.trim()));
const conn: Connection = connection("mainnet-beta");
const usd = (units: bigint) => `$${(Number(units) / 1e6).toFixed(2)}`;
const held = await conn
  .getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(USDC.mint), payer.publicKey, true))
  .then((b) => BigInt(b.value.amount), () => 0n);
console.log(`Prize wallet ${payer.publicKey.toBase58()} holds ${usd(held)} USDC.`);

const e = process.env;
const [first, ...rest] = (e.TEST_PII_NAME ?? "Test Person").trim().split(/\s+/);
const address = pay
  ? { first_name: first, last_name: rest.join(" ") || first, address_line1: e.TEST_PII_LINE1!, city: e.TEST_PII_CITY!, state: e.TEST_PII_STATE!, postal_code: e.TEST_PII_ZIP!, phone_number: e.TEST_PII_PHONE!, country: "US" }
  : { first_name: "Test", last_name: "Person", address_line1: "123 Test Street", city: "Testville", state: "CA", postal_code: "90001", phone_number: "2125550100", country: "US" };
if (pay && Object.values(address).some((v) => !v)) {
  console.error("--pay ships for real: set TEST_PII_NAME, TEST_PII_LINE1, TEST_PII_CITY, TEST_PII_STATE, TEST_PII_ZIP and TEST_PII_PHONE in .env.");
  process.exit(1);
}

const STATE_FILE = ".keys/gate-x402.json"; // the last paid order's idempotency key, for --again
const last = fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as { idempotencyKey: string }) : null;
const idempotencyKey = again && last ? last.idempotencyKey : crypto.randomUUID();
const order = { products: [{ url, quantity: 1 }], max_price: max, shipping_address: address, idempotency_key: idempotencyKey, metadata: { lootbox_drop: "GATE" }, po_number: "GATE" };

if (!pay) {
  // The price, as Zinc asks for it, checked exactly as the engine checks it. Nothing is signed.
  const res = await fetch("https://api.zinc.com/agent/orders?method=x402", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(order),
  });
  const header = res.headers.get("payment-required");
  if (res.status !== 402 || !header) {
    console.error(`Expected a 402 with a price; got ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const requirement = pickRequirement(decodePaymentRequiredHeader(header), max);
  const amount = BigInt(requirement.amount);
  console.log(`Zinc asks ${usd(amount)} USDC on Solana, paid to ${requirement.payTo} (cap plus fee: ${usd(maxPaymentUnits(max))}).`);
  console.log(held >= amount ? "The prize wallet can pay it. Add --pay to place it for real." : `The prize wallet is ${usd(amount - held)} short.`);
  process.exit(0);
}

const saved = new Map<string, string>();
const keys: AgentKeys = {
  async get(id) {
    return saved.get(id) ?? null;
  },
  async save(_drop, id, key, tx) {
    saved.set(id, key);
    console.log(`Order ${id}${tx ? `, paid in https://solscan.io/tx/${tx}` : " (already paid before)"}`);
  },
};
fs.mkdirSync(".keys", { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify({ idempotencyKey }));
const zinc = agentZincClient({ baseUrl: "https://api.zinc.com", payer, conn, rpcUrl: process.env.SOLANA_RPC_URL || heliusUrl("mainnet-beta") || undefined, keys });
const placed = await zinc.createOrder(order);
console.log(`${again ? "Same order back" : "Placed"}: ${placed.id}, status ${placed.status}`);
for (let i = 0; i < 6; i++) {
  const now = await zinc.getOrder(placed.id);
  console.log(`  ${new Date().toISOString().slice(11, 19)}  ${now.status}`);
  if (!["pending", "in_progress"].includes(now.status)) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
