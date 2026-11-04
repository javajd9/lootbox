// Collecting $LOOT's creator fees from pump.fun into the treasury. Anyone may call pump.fun's
// collect instructions, so the ops wallet pays; the money can only go to the coin's creator.
import { Transaction, type Connection, type Keypair, type PublicKey } from "@solana/web3.js";
import { fingerprintMemo, memoInstruction } from "@/lib/chain/memo";
import { curveCollectInstructions, poolCollectInstructions, readCreatorFees, type CreatorFees } from "@/lib/chain/pump";
import { sendAndConfirm } from "@/lib/chain/solana";

// The collect transaction, with its fingerprint: LOOTBOX|v1|<drop>|collected|<lamports>.
export function collectTransaction(ops: PublicKey, treasury: PublicKey, mint: PublicKey, fees: CreatorFees, dropId: string): Transaction {
  if (fees.creator !== treasury.toBase58()) {
    // Most likely a fee sharing config: then pump.fun's fee program pays out instead, and these
    // instructions would fail.
    throw new Error(`pump.fun pays this coin's creator fees to ${fees.creator}, not the treasury`);
  }
  const tx = new Transaction().add(...curveCollectInstructions(ops, mint, treasury));
  if (fees.graduated && fees.pool) tx.add(...poolCollectInstructions(ops, mint, treasury, fees.pool));
  return tx.add(memoInstruction(ops, fingerprintMemo(dropId, "collected", fees.total.toString())));
}

export async function collectCreatorFees(conn: Connection, ops: Keypair, treasury: Keypair, mint: PublicKey, dropId: string): Promise<string | null> {
  const fees = await readCreatorFees(conn, mint, treasury.publicKey);
  if (!fees.coin || fees.total === 0n) return null;
  const tx = collectTransaction(ops.publicKey, treasury.publicKey, mint, fees, dropId);
  // The treasury signs only when it has to: closing its WSOL account after a pool collect.
  return sendAndConfirm(conn, tx, fees.graduated ? [ops, treasury] : [ops]);
}
