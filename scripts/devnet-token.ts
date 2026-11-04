// Creates "tLOOT" on devnet: a stand-in for $LOOT (same 6 decimals) held by a handful of wallets,
// so snapshots run against a real token on devnet. Run once; it remembers the mint
// in .keys/devnet-token.json.
//
//   npm run devnet:token
import "dotenv/config";
import fs from "node:fs";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { connection, explorerAccount } from "@/lib/chain/solana";
import { TOKEN_DECIMALS } from "@/lib/draws/tickets";
import { devnetWallet } from "./devnet-wallet";

const FILE = ".keys/devnet-token.json";
const BALANCES = [4_200_000, 1_350_000, 610_000, 240_000, 88_000, 9_000]; // tLOOT; the last is under one ticket

if (fs.existsSync(FILE)) {
  const { mint } = JSON.parse(fs.readFileSync(FILE, "utf8"));
  console.log(`tLOOT already exists: ${mint}\n  ${explorerAccount(mint, "devnet")}`);
  process.exit(0);
}

const conn = connection("devnet");
const ops = devnetWallet();
const mint = await createMint(conn, ops, ops.publicKey, null, TOKEN_DECIMALS);
console.log(`tLOOT mint ${mint.toBase58()}\n  ${explorerAccount(mint.toBase58(), "devnet")}`);

const holders: { wallet: string; tokens: number }[] = [];
for (const tokens of BALANCES) {
  const owner = Keypair.generate().publicKey;
  const account = await getOrCreateAssociatedTokenAccount(conn, ops, mint, owner);
  await mintTo(conn, ops, mint, account.address, ops, BigInt(tokens) * 10n ** BigInt(TOKEN_DECIMALS));
  holders.push({ wallet: owner.toBase58(), tokens });
  console.log(`  ${owner.toBase58()}  ${tokens.toLocaleString("en-US")} tLOOT`);
}
fs.writeFileSync(FILE, JSON.stringify({ mint: mint.toBase58(), holders }, null, 2));
