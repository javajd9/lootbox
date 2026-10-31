// Winner's signed receipt (claim P5b). Only the winning wallet can produce a valid signature.
import nacl from "tweetnacl";
import bs58 from "bs58";

export interface ReceiptFields {
  dropId: string;
  amazonOrderId: string;
  commitment: string;
  receivedOn: string; // YYYY-MM-DD
}

export function receiptMessage(f: ReceiptFields): string {
  for (const [k, v] of Object.entries(f)) {
    if (!v || v.includes("|") || v.includes("\n")) throw new Error(`receiptMessage: invalid ${k}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.receivedOn)) throw new Error("receiptMessage: receivedOn must be YYYY-MM-DD");
  return `LOOTBOX ${f.dropId} | received | amazon_order:${f.amazonOrderId} | commitment:${f.commitment} | ${f.receivedOn}`;
}

// signatureB58: what the wallet's signMessage returned, base58-encoded. winnerAddress: from the draw proof.
export function verifyReceipt(message: string, signatureB58: string, winnerAddress: string): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const pubkey = bs58.decode(winnerAddress);
    if (sig.length !== 64 || pubkey.length !== 32) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pubkey);
  } catch {
    return false;
  }
}
