// Sends made-up $LOOT trades to /api/fees, shaped exactly like Helius's deliveries, so the
// homepage's coins can be watched without a real coin. Devnet only: the trades are fake (their
// transaction links lead nowhere) and they're saved as devnet fee events.
//
//   npm run fees:simulate                                   12 trades to http://localhost:3000
//   npm run fees:simulate -- --count 30 --every 2 --url https://…   30 trades, one every 2 seconds
import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import { poolAddress } from "@/lib/chain/pump";
import { CLUSTER } from "@/lib/chain/solana";
import { sampleTx } from "@/lib/fees/sample";

if (CLUSTER !== "devnet") {
  console.error("fees:simulate only runs on devnet (SOLANA_CLUSTER=devnet).");
  process.exit(1);
}
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const count = Number(arg("count", "12"));
const every = Number(arg("every", "1.5"));
const url = `${arg("url", "http://localhost:3000").replace(/\/$/, "")}/api/fees`;
const mint = process.env.LOOT_MINT;
const secret = process.env.FEES_WEBHOOK_SECRET;
if (!mint || !secret) {
  console.error("LOOT_MINT and FEES_WEBHOOK_SECRET must be set in .env");
  process.exit(1);
}
const pool = poolAddress(new PublicKey(mint)).toBase58();

// Mostly small trades, now and then a whale. The creator fee is 0.30% on the curve.
function tradeSol() {
  const r = Math.random();
  if (r < 0.7) return 0.05 + Math.random() * 2;
  if (r < 0.95) return 2 + Math.random() * 10;
  return 20 + Math.random() * 60;
}

for (let i = 0; i < count; i++) {
  const sol = tradeSol();
  const trade = {
    mint,
    pool: Math.random() < 0.2 ? pool : undefined,
    side: (Math.random() < 0.75 ? "buy" : "sell") as "buy" | "sell",
    trader: Keypair.generate().publicKey.toBase58(),
    tradeLamports: Math.round(sol * 1e9),
    feeLamports: Math.round(sol * 1e9 * 0.003),
    time: Math.floor(Date.now() / 1000),
  };
  const res = await fetch(url, { method: "POST", headers: { authorization: secret, "content-type": "application/json" }, body: JSON.stringify([sampleTx(trade)]) });
  console.log(`${trade.side} ${sol.toFixed(3)} SOL (fee ${(trade.feeLamports / 1e9).toFixed(5)} SOL): ${res.status} ${await res.text()}`);
  if (i < count - 1) await new Promise((r) => setTimeout(r, every * 1000));
}
