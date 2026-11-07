// Registers (or updates) the Helius webhook that sends every $LOOT trade to /api/fees, so the
// homepage can drop a coin per trade. It watches the coin's bonding curve and, for after
// graduation, its PumpSwap pool: every trade writes to one of them.
//
//   npm run helius:webhook              show what it would register, change nothing
//   npm run helius:webhook -- --apply   create it, or update the one already pointing at the URL
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import { bondingCurveAddress, poolAddress } from "@/lib/chain/pump";
import { CLUSTER } from "@/lib/chain/solana";

const API = "https://api.helius.xyz/v0/webhooks";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}

const key = env("HELIUS_API_KEY");
const mint = new PublicKey(env("LOOT_MINT"));
const secret = env("FEES_WEBHOOK_SECRET");
// www: the bare domain answers with a redirect to it, which a webhook delivery may not follow, and
// a redirect to another host drops the Authorization header the route checks.
const url = process.env.FEES_WEBHOOK_URL || "https://www.getlootbox.fun/api/fees";
const apply = process.argv.includes("--apply");

const config = {
  webhookURL: url,
  webhookType: CLUSTER === "devnet" ? "rawDevnet" : "raw", // raw: the full transaction, with the trade's event in it
  transactionTypes: ["ANY"],
  accountAddresses: [bondingCurveAddress(mint).toBase58(), poolAddress(mint).toBase58()],
  txnStatus: "success",
  authHeader: secret, // Helius sends it back as the Authorization header
};

async function helius<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}?api-key=${key}`, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Helius ${init?.method ?? "GET"} ${path || "/"}: ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

console.log(`${CLUSTER}: trades of ${mint.toBase58()} -> ${url}`);
console.log(`  bonding curve  ${config.accountAddresses[0]}`);
console.log(`  PumpSwap pool  ${config.accountAddresses[1]}`);

const existing = (await helius<{ webhookID: string; webhookURL: string }[]>("")).find((w) => w.webhookURL === url);
if (!apply) {
  console.log(existing ? `Would update webhook ${existing.webhookID}.` : "Would create a new webhook.");
  console.log("Run again with --apply to do it (each change costs 100 Helius credits).");
  process.exit(0);
}
const saved = existing
  ? await helius<{ webhookID: string }>(`/${existing.webhookID}`, { method: "PUT", body: JSON.stringify(config) })
  : await helius<{ webhookID: string }>("", { method: "POST", body: JSON.stringify(config) });
console.log(`${existing ? "Updated" : "Created"} webhook ${saved.webhookID}.`);
