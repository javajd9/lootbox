// Sends test SOL from the ops wallet into the devnet treasury, standing in for $LOOT creator fees.
//
//   npm run devnet:fees -- 0.05
import "dotenv/config";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { connection, explorerTx, opsWallet, sendAndConfirm } from "@/lib/chain/solana";

const sol = Number(process.argv[2]);
if (!(sol > 0)) {
  console.error("Usage: npm run devnet:fees -- <SOL>");
  process.exit(1);
}
const conn = connection("devnet");
const ops = opsWallet();
const treasury = Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_WALLET_SECRET!)).publicKey;
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: treasury, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
const sig = await sendAndConfirm(conn, tx, [ops]);
console.log(`${sol} test SOL -> treasury ${treasury.toBase58()}\n  ${explorerTx(sig, "devnet")}`);
