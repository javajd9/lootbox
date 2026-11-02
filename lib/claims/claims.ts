// Winner claim: prove you own the winning wallet by signing a one-time message.
// Signing costs nothing and can't move funds. Each nonce works once and expires.
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { DropRecord } from "@/lib/engine/types";

export const NONCE_TTL_MS = 10 * 60 * 1000;

export interface PendingClaim {
  dropId: string;
  wallet: string;
  nonce: string;
  message: string;
  expiresAt: number;
  used: boolean;
}

export function isWalletAddress(s: string): boolean {
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

export function claimMessage(dropId: string, wallet: string, nonce: string, expiresAt: number): string {
  return [
    "LOOTBOX prize claim",
    `Drop: ${dropId}`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "Signing this proves you own the wallet. It costs nothing and cannot move funds.",
  ].join("\n");
}

export function newClaim(dropId: string, wallet: string, now = Date.now()): PendingClaim {
  const nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = now + NONCE_TTL_MS;
  return { dropId, wallet, nonce, expiresAt, used: false, message: claimMessage(dropId, wallet, nonce, expiresAt) };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "unknown_nonce" | "used" | "expired" | "bad_signature" };

export function verifyClaimSignature(claim: PendingClaim | undefined, signatureB58: string, now = Date.now()): VerifyResult {
  if (!claim) return { ok: false, reason: "unknown_nonce" };
  if (claim.used) return { ok: false, reason: "used" };
  if (now > claim.expiresAt) return { ok: false, reason: "expired" };
  try {
    const sig = bs58.decode(signatureB58);
    const ok =
      sig.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(claim.message), sig, bs58.decode(claim.wallet));
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

// Can this wallet claim this drop right now? Checked when the nonce is issued and again when the
// signature comes back, against the engine's own record of the drop.
export type ClaimableResult =
  | { ok: true }
  | { ok: false; reason: "unknown_drop" | "not_claiming" | "not_winner" | "deadline_passed" | "already_claimed" | "on_hold" };

export function claimable(drop: DropRecord | undefined, wallet: string, now = Date.now()): ClaimableResult {
  if (!drop) return { ok: false, reason: "unknown_drop" };
  if (drop.claimedAt || ["fulfilling", "delivered", "complete"].includes(drop.stage)) return { ok: false, reason: "already_claimed" };
  if (drop.stage !== "claiming" || !drop.winner) return { ok: false, reason: "not_claiming" };
  if (drop.hold) return { ok: false, reason: "on_hold" };
  if (drop.winner !== wallet) return { ok: false, reason: "not_winner" };
  if (!drop.claimDeadline || now >= Date.parse(drop.claimDeadline)) return { ok: false, reason: "deadline_passed" };
  return { ok: true };
}

export const CLAIMABLE_MESSAGES: Record<Exclude<ClaimableResult, { ok: true }>["reason"], string> = {
  unknown_drop: "Unknown drop.",
  not_claiming: "This drop isn't waiting for a claim.",
  not_winner: "This wallet didn't win this drop.",
  deadline_passed: "The claim window for this drop has closed.",
  already_claimed: "This prize has already been claimed.",
  on_hold: "This drop is paused while we check something. Try again later.",
};
