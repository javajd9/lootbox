// A real holder snapshot on devnet: reads every tLOOT balance through Helius, builds the snapshot
// exactly as a drop does, posts its fingerprint on-chain, and shows the tickets it's worth.
//
//   npm run devnet:snapshot     (after npm run devnet:token, with HELIUS_API_KEY in .env)
import "dotenv/config";
import fs from "node:fs";
import { readHolders } from "@/lib/chain/holders";
import { fingerprintMemo, postMemo } from "@/lib/chain/memo";
import { connection, explorerTx } from "@/lib/chain/solana";
import { buildSnapshot, combineWeights, hashSnapshot } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import { devnetWallet } from "./devnet-wallet";

const { mint } = JSON.parse(fs.readFileSync(".keys/devnet-token.json", "utf8")) as { mint: string };
const conn = connection("devnet");
const ops = devnetWallet();

const slot = await conn.getSlot();
const accounts = await readHolders(mint, "devnet");
const snapshot = buildSnapshot("DEV-SNAPSHOT", slot, new Date().toISOString(), accounts, [ops.publicKey.toBase58()]);
const hash = hashSnapshot(snapshot);
const tickets = new Map(toTickets(combineWeights([snapshot]), 1).map((t) => [t.wallet, t.weight]));

console.log(`Snapshot at slot ${slot}: ${snapshot.holders.length} holders`);
for (const h of snapshot.holders) {
  const tokens = Number(BigInt(h.balance) / 10n ** 6n).toLocaleString("en-US");
  console.log(`  ${h.wallet}  ${tokens} tLOOT  ->  ${tickets.get(h.wallet) ?? 0n} tickets`);
}
const sig = await postMemo(conn, ops, fingerprintMemo("DEV-SNAPSHOT", "snapshot", String(slot), hash));
console.log(`\nFingerprint ${hash}\n  ${explorerTx(sig, "devnet")}`);
