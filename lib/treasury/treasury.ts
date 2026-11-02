// The treasury: where the pool collects, as SOL. The pool is its balance at today's price. The
// moment a pool fills, the prize's worth moves to the prize wallet (on mainnet it will be swapped
// to USDC on the way).
import { LAMPORTS_PER_SOL, SystemProgram, Transaction, type Connection, type Keypair, type PublicKey } from "@solana/web3.js";
import { fingerprintMemo, memoInstruction, parseFingerprint } from "@/lib/chain/memo";
import { sendAndConfirm } from "@/lib/chain/solana";

const RESERVE_LAMPORTS = 890_880; // what an empty account must keep to stay open

export async function treasuryCents(conn: Connection, treasury: PublicKey, priceUsd: number): Promise<number> {
  const lamports = Math.max(0, (await conn.getBalance(treasury)) - RESERVE_LAMPORTS);
  return Math.floor((lamports / LAMPORTS_PER_SOL) * priceUsd * 100);
}

export const lamportsFor = (cents: number, priceUsd: number) => Math.ceil((cents / 100 / priceUsd) * LAMPORTS_PER_SOL);

// Whether a transaction's memo field (as getSignaturesForAddress gives it: "[60] LOOTBOX|v1|…",
// several joined by "; ") is this drop's "funded" fingerprint.
export function isFundingMemo(memoField: string | null | undefined, dropId: string): boolean {
  return (memoField ?? "").split("; ").some((m) => {
    const f = parseFingerprint(m.replace(/^\[\d+\]\s*/, ""));
    return f?.dropId === dropId && f.kind === "funded";
  });
}

// The chain is the record of what was paid: the transaction that already funded this drop, if any.
export async function findFunding(conn: Connection, treasury: PublicKey, dropId: string): Promise<string | null> {
  const sigs = await conn.getSignaturesForAddress(treasury, { limit: 200 });
  return sigs.find((s) => !s.err && isFundingMemo(s.memo, dropId))?.signature ?? null;
}

// The transfer and its fingerprint go in one transaction, so the proof can't be separated from the
// payment. The ops wallet pays the fee.
export async function moveToPrize(
  conn: Connection,
  ops: Keypair,
  treasury: Keypair,
  prize: PublicKey,
  dropId: string,
  cents: number,
  priceUsd: number,
): Promise<string> {
  const lamports = lamportsFor(cents, priceUsd);
  const tx = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: prize, lamports }))
    .add(memoInstruction(ops.publicKey, fingerprintMemo(dropId, "funded", `${cents}c`, `${lamports}lamports`, `${priceUsd.toFixed(4)}usd`)));
  return sendAndConfirm(conn, tx, [ops, treasury]);
}
