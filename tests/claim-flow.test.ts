import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { claimable, newClaim, verifyClaimSignature } from "../lib/claims/claims";
import { claimTokenOf, shippingAddressOf, verifyShopifyHmac, type ShopifyOrder } from "../lib/claims/shopify";
import { withClaims } from "../lib/engine/claims";
import { decide } from "../lib/engine/decide";
import type { DropRecord, EngineState } from "../lib/engine/types";
import { fingerprintMemo, parseFingerprint } from "../lib/chain/memo";
import { checkCommitment, makeCommitment, normalizeAddress } from "../lib/proofs/commitment";

const winner = nacl.sign.keyPair();
const wallet = bs58.encode(winner.publicKey);
const other = bs58.encode(nacl.sign.keyPair().publicKey);
const NOW = Date.parse("2026-11-01T12:00:00Z");
const DEADLINE = "2026-11-14T12:00:00Z";

const drop = (over: Partial<DropRecord> = {}): DropRecord => ({
  id: "DEV-001",
  goalCents: 1000,
  stage: "claiming",
  snapshotsTaken: 3,
  snapshotDue: [],
  round: 1,
  winner: wallet,
  ticket: 7,
  claimDeadline: DEADLINE,
  ...over,
});

describe("who can claim", () => {
  it("the winner, while the drop is claiming and before the deadline", () => {
    expect(claimable(drop(), wallet, NOW)).toEqual({ ok: true });
  });

  it("nobody else, and not too late, twice, or while on hold", () => {
    expect(claimable(undefined, wallet, NOW)).toEqual({ ok: false, reason: "unknown_drop" });
    expect(claimable(drop(), other, NOW)).toEqual({ ok: false, reason: "not_winner" });
    expect(claimable(drop(), wallet, Date.parse(DEADLINE))).toEqual({ ok: false, reason: "deadline_passed" });
    expect(claimable(drop({ claimedAt: "2026-11-02T00:00:00Z" }), wallet, NOW)).toEqual({ ok: false, reason: "already_claimed" });
    expect(claimable(drop({ stage: "fulfilling" }), wallet, NOW)).toEqual({ ok: false, reason: "already_claimed" });
    expect(claimable(drop({ stage: "drawing", winner: undefined }), wallet, NOW)).toEqual({ ok: false, reason: "not_claiming" });
    expect(claimable(drop({ hold: "check" }), wallet, NOW)).toEqual({ ok: false, reason: "on_hold" });
  });

  it("the signed message is only accepted from the winning wallet's key", () => {
    const c = newClaim("DEV-001", wallet, NOW);
    expect(c.message).toContain("Drop: DEV-001");
    expect(c.message).toContain(`Wallet: ${wallet}`);
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(c.message), winner.secretKey));
    expect(verifyClaimSignature(c, sig, NOW)).toEqual({ ok: true });
    const forged = bs58.encode(nacl.sign.detached(new TextEncoder().encode(c.message), nacl.sign.keyPair().secretKey));
    expect(verifyClaimSignature(c, forged, NOW).ok).toBe(false);
    expect(verifyClaimSignature(c, "not-base58-!!", NOW).ok).toBe(false);
  });
});

describe("Shopify webhook signature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ id: 1, note_attributes: [{ name: "lootbox_claim", value: "tok" }] });
  const hmac = createHmac("sha256", secret).update(body, "utf8").digest("base64");

  it("accepts Shopify's HMAC of the exact body", () => {
    expect(verifyShopifyHmac(body, hmac, secret)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, a missing header or a missing secret", () => {
    expect(verifyShopifyHmac(body.replace("tok", "tik"), hmac, secret)).toBe(false);
    expect(verifyShopifyHmac(body, hmac, "other-secret")).toBe(false);
    expect(verifyShopifyHmac(body, null, secret)).toBe(false);
    expect(verifyShopifyHmac(body, hmac, undefined)).toBe(false);
    expect(verifyShopifyHmac(body, "short", secret)).toBe(false);
  });
});

describe("Shopify order", () => {
  const order: ShopifyOrder = {
    id: 820982911946154500,
    note_attributes: [
      { name: "lootbox_drop", value: "DEV-001" },
      { name: "lootbox_claim", value: "abc123" },
    ],
    shipping_address: {
      first_name: "Ada",
      last_name: "Lovelace",
      address1: "12 Main St.",
      address2: "Apt #4",
      city: "Austin",
      province: "Texas",
      province_code: "TX",
      zip: "78701-1234",
      country_code: "US",
    },
  };

  it("finds the claim token among the order's attributes", () => {
    expect(claimTokenOf(order)).toBe("abc123");
    expect(claimTokenOf({ id: 1 })).toBeNull();
    expect(claimTokenOf({ id: 1, note_attributes: [{ name: "lootbox_claim", value: "" }] })).toBeNull();
  });

  it("reads the shipping address", () => {
    expect(shippingAddressOf(order)).toEqual({ name: "Ada Lovelace", line1: "12 Main St.", line2: "Apt #4", city: "Austin", state: "TX", zip: "78701-1234" });
    expect(shippingAddressOf({ id: 1, shipping_address: null })).toBeNull();
    expect(shippingAddressOf({ id: 1, shipping_address: { address1: "", city: "X", zip: "1" } })).toBeNull();
  });
});

describe("address fingerprint", () => {
  const a = { name: "Ada Lovelace", line1: "12 Main St.", line2: "Apt #4", city: "Austin", state: "TX", zip: "78701-1234" };

  it("normalizes case, punctuation, spacing and ZIP+4", () => {
    const b = { name: "  ada   lovelace", line1: "12 main st", line2: "apt 4", city: "AUSTIN", state: "tx", zip: "78701" };
    expect(normalizeAddress(a)).toBe("ADA LOVELACE|12 MAIN ST|APT 4|AUSTIN|TX|78701");
    expect(normalizeAddress(b)).toBe(normalizeAddress(a));
  });

  it("is a salted SHA-256 the winner can re-check, with a fresh salt each time", () => {
    const one = makeCommitment(a);
    const two = makeCommitment(a);
    expect(one.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(one.salt).not.toBe(two.salt);
    expect(one.commitment).not.toBe(two.commitment);
    expect(checkCommitment(a, one.salt, one.commitment)).toBe(true);
    expect(checkCommitment(one.normalized, one.salt, one.commitment)).toBe(true);
    expect(checkCommitment({ ...a, line1: "13 Main St" }, one.salt, one.commitment)).toBe(false);
  });

  it("goes on-chain in the standard memo format, with no address in it", () => {
    const c = makeCommitment(a);
    const memo = fingerprintMemo("DEV-001", "address", c.commitment);
    expect(memo).toBe(`LOOTBOX|v1|DEV-001|address|${c.commitment}`);
    expect(parseFingerprint(memo)).toEqual({ dropId: "DEV-001", kind: "address", values: [c.commitment] });
    expect(memo).not.toMatch(/MAIN|AUSTIN|78701/i);
  });
});

describe("the engine reads finished claims", () => {
  const state = (d: DropRecord): EngineState => ({ drops: [d], treasuryCents: 0, sentAlerts: [] });
  const done = { drop_id: "DEV-001", wallet, round: 1, completed_at: "2026-11-02T09:00:00Z" };

  it("marks the drop claimed, so the next step is ordering the prize", () => {
    const next = withClaims(state(drop()), [done]);
    expect(next.drops[0].claimedAt).toBe("2026-11-02T09:00:00.000Z");
    expect(decide(next, new Date(NOW)).map((s) => s.effect.type)).toContain("placeOrder");
  });

  it("ignores claims from another wallet, an earlier round, another drop, or after the deadline", () => {
    const s = state(drop());
    expect(withClaims(s, [{ ...done, wallet: other }])).toBe(s);
    expect(withClaims(s, [{ ...done, round: 0 }])).toBe(s);
    expect(withClaims(s, [{ ...done, completed_at: DEADLINE }])).toBe(s);
    expect(withClaims(s, [{ ...done, completed_at: null }])).toBe(s);
    expect(withClaims(s, [{ ...done, drop_id: "DEV-002" }])).toBe(s);
  });

  it("never changes a drop that was already claimed or redrawn", () => {
    const claimed = state(drop({ claimedAt: "2026-11-01T00:00:00Z" }));
    expect(withClaims(claimed, [done])).toBe(claimed);
    const redrawn = state(drop({ stage: "drawing", round: 2, winner: undefined }));
    expect(withClaims(redrawn, [done])).toBe(redrawn);
  });
});
