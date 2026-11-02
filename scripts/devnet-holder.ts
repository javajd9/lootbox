// A devnet test holder whose key we keep, so a claim can be signed for real end to end. Mints it
// a large tLOOT balance so it almost certainly wins the next drop drawn. Devnet only. The key stays
// in .keys/devnet-holder.json (never committed); running again only mints if it holds nothing.
//
//   npm run devnet:holder                 make the wallet and mint 1,000,000,000 tLOOT
//   npm run devnet:holder -- 50000000     a different amount
import "dotenv/config";
import fs from "node:fs";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { CLUSTER, connection, explorerAccount, sendAndConfirm } from "@/lib/chain/solana";
import { TOKEN_DECIMALS } from "@/lib/draws/tickets";
import { devnetWallet } from "./devnet-wallet";

if (CLUSTER !== "devnet") {
  console.error("devnet:holder only runs on devnet (SOLANA_CLUSTER is not devnet).");
  process.exit(1);
}

const FILE = ".keys/devnet-holder.json";
const tokens = BigInt(process.argv[2] ?? "1000000000");
const mint = new PublicKey((JSON.parse(fs.readFileSync(".keys/devnet-token.json", "utf8")) as { mint: string }).mint);

const holder = fs.existsSync(FILE) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(FILE, "utf8")))) : Keypair.generate();
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([...holder.secretKey]));
console.log(`test holder ${holder.publicKey.toBase58()} (key in ${FILE})\n  ${explorerAccount(holder.publicKey.toBase58(), "devnet")}`);

const conn = connection("devnet");
const ops = devnetWallet(); // the tLOOT mint authority
const account = getAssociatedTokenAddressSync(mint, holder.publicKey);
const held = await conn.getTokenAccountBalance(account).then((b) => BigInt(b.value.amount)).catch(() => 0n);
if (held > 0n) {
  console.log(`  already holds ${(held / 10n ** BigInt(TOKEN_DECIMALS)).toLocaleString("en-US")} tLOOT; not minting more`);
} else {
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(ops.publicKey, account, holder.publicKey, mint),
    createMintToInstruction(mint, account, ops.publicKey, tokens * 10n ** BigInt(TOKEN_DECIMALS)),
  );
  await sendAndConfirm(conn, tx, [ops]);
  console.log(`  +${tokens.toLocaleString("en-US")} tLOOT`);
}
