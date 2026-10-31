// Proof fingerprints on Solana. Each one is a Memo: a short line of text, signed by the ops wallet
// and timestamped by the chain, that can never be edited or removed afterwards.
import { PublicKey, Transaction, TransactionInstruction, type Connection, type Keypair } from "@solana/web3.js";
import { sendAndConfirm } from "./solana";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MAX_BYTES = 500;

// One format for every fingerprint: LOOTBOX|v1|<drop>|<kind>|<values…>
export function fingerprintMemo(dropId: string, kind: string, ...values: string[]): string {
  for (const part of [dropId, kind, ...values]) {
    if (!part || part.includes("|")) throw new Error(`fingerprintMemo: bad part "${part}"`);
  }
  const text = ["LOOTBOX", "v1", dropId, kind, ...values].join("|");
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("fingerprintMemo: too long");
  return text;
}

export function parseFingerprint(text: string): { dropId: string; kind: string; values: string[] } | null {
  const [brand, version, dropId, kind, ...values] = text.split("|");
  if (brand !== "LOOTBOX" || version !== "v1" || !dropId || !kind) return null;
  return { dropId, kind, values };
}

export async function postMemo(conn: Connection, signer: Keypair, text: string): Promise<string> {
  const ix = new TransactionInstruction({
    keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(text, "utf8"),
  });
  return sendAndConfirm(conn, new Transaction().add(ix), [signer]);
}

// Reads a fingerprint back from the chain: what it says, who signed it, and when.
export async function readMemo(conn: Connection, signature: string): Promise<{ text: string; signer: string; time: number | null } | null> {
  const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) return null;
  const ix = tx.transaction.message.instructions.find((i) => i.programId.equals(MEMO_PROGRAM_ID));
  if (!ix || !("parsed" in ix)) return null;
  const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ?? "";
  return { text: String(ix.parsed), signer, time: tx.blockTime ?? null };
}
