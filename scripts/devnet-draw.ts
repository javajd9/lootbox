// A real LOOTBOX draw on Solana devnet (the free test network), start to finish: lock a ticket
// list on-chain, ask ORAO for randomness, pick the winner, post the result, then re-check it all
// from the chain alone. Every step prints a Solscan link so anyone can see it happened.
//
//   npm run devnet:draw
import "dotenv/config";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { fingerprintMemo, parseFingerprint, postMemo, readMemo } from "@/lib/chain/memo";
import { connection, explorerAccount, explorerTx } from "@/lib/chain/solana";
import { drawSeed, randomnessAccount, readRandomness, requestRandomness } from "@/lib/chain/vrf";
import { buildSnapshot, combineWeights, hashWeights } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import { pickWinner } from "@/lib/draws/weighted-pick";
import { devnetWallet } from "./devnet-wallet";

const conn = connection("devnet");
const tx = (sig: string) => explorerTx(sig, "devnet");

async function ensureFunded(ops: Keypair) {
  const balance = await conn.getBalance(ops.publicKey);
  if (balance >= 0.02 * LAMPORTS_PER_SOL) return balance;
  console.log("Asking the devnet faucet for 1 test SOL…");
  try {
    const sig = await conn.requestAirdrop(ops.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
    return conn.getBalance(ops.publicKey);
  } catch {
    console.log(`\nThe faucet said no (it rate-limits). Get free devnet SOL for this address at https://faucet.solana.com,\nthen run this again:\n\n  ${ops.publicKey.toBase58()}\n`);
    process.exit(1);
  }
}

// A stand-in for real holders: five wallets with different balances, as one snapshot.
function sampleTickets(dropId: string) {
  const balances = [2_500_000, 900_000, 120_000, 55_000, 31_000]; // $LOOT
  const accounts = balances.map((b) => ({ owner: Keypair.generate().publicKey.toBase58(), amount: BigInt(b) * 10n ** 6n }));
  const snapshot = buildSnapshot(dropId, 0, new Date().toISOString(), accounts, []);
  return toTickets(combineWeights([snapshot]), 1);
}

async function main() {
  const ops = devnetWallet();
  const balance = await ensureFunded(ops);
  console.log(`Ops wallet ${ops.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(3)} test SOL)\n  ${explorerAccount(ops.publicKey.toBase58(), "devnet")}\n`);

  const dropId = `DEV-${Date.now().toString(36).toUpperCase()}`;
  const tickets = sampleTickets(dropId);
  const ticketsHash = hashWeights(tickets);
  const total = tickets.reduce((n, t) => n + t.weight, 0n);
  console.log(`${dropId}: ${total} tickets across ${tickets.length} wallets`);
  for (const t of tickets) console.log(`  ${t.wallet}  ${t.weight} tickets`);

  // 1. Lock the ticket list on-chain before any randomness exists.
  const lockSig = await postMemo(conn, ops, fingerprintMemo(dropId, "tickets", ticketsHash));
  console.log(`\n1. Ticket list locked\n  ${tx(lockSig)}`);

  // 2. Ask ORAO for randomness, with a seed anyone can derive from the drop and its ticket list.
  const seed = drawSeed(dropId, ticketsHash, 1);
  const requestSig = await requestRandomness(conn, ops, seed);
  console.log(`\n2. Randomness requested from ORAO\n  ${requestSig ? tx(requestSig) : "(already requested)"}\n  account ${explorerAccount(randomnessAccount(seed), "devnet")}`);

  let randomness: Uint8Array | null = null;
  for (let i = 0; i < 60 && !randomness; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    randomness = await readRandomness(conn, ops, seed);
  }
  if (!randomness) throw new Error("ORAO hasn't answered after 2 minutes; run again later to check the same seed");

  // 3. Pick the winner and post the result.
  const win = pickWinner(randomness, tickets);
  const ticketNo = (win.index + 1n).toString();
  const resultSig = await postMemo(conn, ops, fingerprintMemo(dropId, "drawn", "r1", win.wallet, `#${ticketNo}`));
  console.log(`\n3. Winner: ticket #${ticketNo} of ${win.total}, held by ${win.wallet}\n  ${tx(resultSig)}`);

  // 4. Check it from the chain alone, the way anyone else would.
  const lock = await readMemo(conn, lockSig);
  const lockedHash = lock && parseFingerprint(lock.text)?.values[0];
  const again = await readRandomness(conn, ops, seed);
  const rewin = again && pickWinner(again, tickets);
  const ok = lockedHash === hashWeights(tickets) && lock?.signer === ops.publicKey.toBase58() && rewin?.wallet === win.wallet;
  console.log(`\n4. Re-checked from the chain: ${ok ? "same ticket list, same randomness, same winner ✓" : "MISMATCH ✗"}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
