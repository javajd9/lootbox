// The treasury: where the pool collects, as SOL. The pool is its balance at today's price, plus
// the creator fees pump.fun still holds for it (lib/treasury/fees). The moment a pool fills, the
// prize's worth is swapped to USDC and moves to the prize wallet (./swap).
import { LAMPORTS_PER_SOL, type Connection, type PublicKey } from "@solana/web3.js";
import { parseFingerprint } from "@/lib/chain/memo";

export const RESERVE_LAMPORTS = 890_880; // what an empty account must keep to stay open

export async function treasuryCents(conn: Connection, treasury: PublicKey, priceUsd: number): Promise<number> {
  const lamports = Math.max(0, (await conn.getBalance(treasury)) - RESERVE_LAMPORTS);
  return Math.floor((lamports / LAMPORTS_PER_SOL) * priceUsd * 100);
}

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
