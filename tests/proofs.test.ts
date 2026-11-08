import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { checkCommitment, makeCommitment, normalizeAddress, type ShippingAddress } from "../lib/proofs/commitment";
import { buildPackage, canonicalJson, hashPackage, verifyChain, type ProofPackage } from "../lib/proofs/package";
import { receiptMessage, verifyReceipt } from "../lib/proofs/receipt";
import { assertNoPII, findPII, PIILeakError } from "../lib/proofs/pii-guard";

const addr: ShippingAddress = { name: "Jordan Rivera", line1: "742 Evergreen Terrace", city: "Springfield", state: "OR", zip: "97477-1234" };

describe("address commitment", () => {
  it("winner can recompute it; wrong address or salt fails", () => {
    const { commitment, salt, normalized } = makeCommitment(addr);
    expect(checkCommitment(addr, salt, commitment)).toBe(true);
    expect(checkCommitment(normalized, salt, commitment)).toBe(true);
    expect(checkCommitment({ ...addr, line1: "743 Evergreen Terrace" }, salt, commitment)).toBe(false);
    expect(checkCommitment(addr, "00".repeat(32), commitment)).toBe(false);
    expect(checkCommitment(addr, "not-hex", commitment)).toBe(false);
  });

  it("ignores case, punctuation, spacing and ZIP+4", () => {
    const { commitment, salt } = makeCommitment(addr);
    const messy = { ...addr, name: "  jordan   RIVERA ", line1: "742 evergreen terrace.", zip: "97477" };
    expect(checkCommitment(messy, salt, commitment)).toBe(true);
    expect(normalizeAddress(addr)).toBe("JORDAN RIVERA|742 EVERGREEN TERRACE||SPRINGFIELD|OR|97477");
  });

  it("uses a fresh salt every time, so the same address gives different commitments", () => {
    expect(makeCommitment(addr).commitment).not.toBe(makeCommitment(addr).commitment);
  });
});

describe("proof package chain", () => {
  const chain = (): ProofPackage[] => {
    const p0 = buildPackage({ dropId: "DROP-001", type: "payment", createdAt: "2026-11-20T00:00:00Z", revealed: { usdc: 1800 }, attestation: "solana-tx-sig" });
    const p1 = buildPackage({ dropId: "DROP-001", type: "order", createdAt: "2026-11-21T00:00:00Z", revealed: { asins: ["B0CL61F39H"], total: 1749.97 }, attestation: { reclaim: "..." } }, p0);
    const p2 = buildPackage({ dropId: "DROP-001", type: "tracking", createdAt: "2026-11-24T00:00:00Z", revealed: { tag: "Delivered" }, attestation: { reclaim: "..." } }, p1);
    return [p0, p1, p2];
  };

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  it("an untouched chain verifies, including against on-chain hashes", () => {
    const pkgs = chain();
    expect(verifyChain(pkgs).ok).toBe(true);
    expect(verifyChain(pkgs, pkgs.map(hashPackage)).ok).toBe(true);
  });

  it("editing any package breaks it", () => {
    const pkgs = chain();
    const anchored = pkgs.map(hashPackage);
    pkgs[1].revealed = { asins: ["B0CL61F39H"], total: 1.0 };
    const r = verifyChain(pkgs, anchored);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/package 1: hash does not match|package 2: prevHash/);
  });

  it("removing or reordering a package breaks it", () => {
    const pkgs = chain();
    expect(verifyChain([pkgs[0], pkgs[2]]).ok).toBe(false);
    expect(verifyChain([pkgs[1], pkgs[0], pkgs[2]]).ok).toBe(false);
  });

  it("missing on-chain records are reported", () => {
    const pkgs = chain();
    expect(verifyChain(pkgs, pkgs.slice(0, 2).map(hashPackage)).ok).toBe(false);
  });
});

describe("winner receipt", () => {
  const winner = nacl.sign.keyPair();
  const winnerAddress = bs58.encode(winner.publicKey);
  const msg = receiptMessage({ dropId: "DROP-001", amazonOrderId: "112-1234567-1234567", commitment: "ab".repeat(32), receivedOn: "2026-11-24" });
  const sign = (secretKey: Uint8Array, m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), secretKey));

  it("accepts the winning wallet's signature", () => {
    expect(verifyReceipt(msg, sign(winner.secretKey, msg), winnerAddress)).toBe(true);
  });

  it("rejects a different wallet, an edited message, and garbage", () => {
    const other = nacl.sign.keyPair();
    expect(verifyReceipt(msg, sign(other.secretKey, msg), winnerAddress)).toBe(false);
    expect(verifyReceipt(msg.replace("2026-11-24", "2026-11-25"), sign(winner.secretKey, msg), winnerAddress)).toBe(false);
    expect(verifyReceipt(msg, "notbase58!!", winnerAddress)).toBe(false);
  });

  it("refuses fields that could forge the message format", () => {
    expect(() => receiptMessage({ dropId: "DROP-001 | received", amazonOrderId: "x", commitment: "y", receivedOn: "2026-11-24" })).toThrow();
  });
});

describe("PII guard", () => {
  const pii = { name: "Jordan Rivera", email: "jordan.rivera@example.com", phone: "+1 (541) 555-0199", line1: "742 Evergreen Terrace", city: "Springfield", zip: "97477" };
  const cleanProof = { request_id: "abc123", code: "request_processed", merchant_order_ids: [{ merchant_order_id: "112-1234567-1234567" }], price_components: { total: 174997 }, tag: "Delivered", created_at: "2026-11-24T18:22:01Z" };

  it("passes a clean proof", () => {
    expect(findPII(JSON.stringify(cleanProof), pii)).toEqual([]);
    expect(() => assertNoPII(cleanProof, pii)).not.toThrow();
  });

  it("catches leaks even with different formatting", () => {
    const leaked = { ...cleanProof, shipping: { first_name: "JORDAN", last_name: "rivera", address_line1: "742 evergreen terrace", city: "Springfield", zip_code: "97477-1234", phone_number: "541.555.0199" } };
    expect(findPII(JSON.stringify(leaked), pii).sort()).toEqual(["city", "line1", "name", "phone", "zip"]);
    expect(() => assertNoPII(leaked, pii)).toThrow(PIILeakError);
  });

  it("catches a leaked email", () => {
    expect(findPII(JSON.stringify({ ...cleanProof, email: "Jordan.Rivera@Example.com" }), pii)).toContain("email");
  });
});
