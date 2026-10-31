import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { isWalletAddress, newClaim, NONCE_TTL_MS, verifyClaimSignature } from "../lib/claims/claims";

const winner = nacl.sign.keyPair();
const wallet = bs58.encode(winner.publicKey);
const sign = (secret: Uint8Array, msg: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), secret));

describe("wallet claim", () => {
  it("validates wallet addresses", () => {
    expect(isWalletAddress(wallet)).toBe(true);
    expect(isWalletAddress("not a wallet")).toBe(false);
    expect(isWalletAddress(bs58.encode(new Uint8Array(20)))).toBe(false);
  });

  it("accepts the winning wallet's signature", () => {
    const c = newClaim("DROP-001", wallet);
    expect(verifyClaimSignature(c, sign(winner.secretKey, c.message))).toEqual({ ok: true });
  });

  it("rejects another wallet, a reused nonce, an expired nonce and unknown sessions", () => {
    const c = newClaim("DROP-001", wallet);
    const good = sign(winner.secretKey, c.message);
    expect(verifyClaimSignature(c, sign(nacl.sign.keyPair().secretKey, c.message))).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyClaimSignature(c, good, c.expiresAt + 1)).toEqual({ ok: false, reason: "expired" });
    expect(verifyClaimSignature({ ...c, used: true }, good)).toEqual({ ok: false, reason: "used" });
    expect(verifyClaimSignature(undefined, good)).toEqual({ ok: false, reason: "unknown_nonce" });
  });

  it("a signature for one claim session can't be replayed on another", () => {
    const a = newClaim("DROP-001", wallet);
    const b = newClaim("DROP-001", wallet);
    expect(a.nonce).not.toBe(b.nonce);
    expect(verifyClaimSignature(b, sign(winner.secretKey, a.message)).ok).toBe(false);
  });

  it("expires after the TTL", () => {
    const now = 1_000_000;
    expect(newClaim("DROP-001", wallet, now).expiresAt).toBe(now + NONCE_TTL_MS);
  });
});
