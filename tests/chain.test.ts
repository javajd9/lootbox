import { describe, expect, it } from "vitest";
import { fingerprintMemo, parseFingerprint } from "../lib/chain/memo";
import { drawSeed, randomnessAccount } from "../lib/chain/vrf";
import { isFundingMemo } from "../lib/treasury/treasury";

describe("proof fingerprints", () => {
  it("round-trips through the memo format", () => {
    const text = fingerprintMemo("DROP-001", "tickets", "ab12");
    expect(text).toBe("LOOTBOX|v1|DROP-001|tickets|ab12");
    expect(parseFingerprint(text)).toEqual({ dropId: "DROP-001", kind: "tickets", values: ["ab12"] });
  });

  it("refuses parts that would break the format", () => {
    expect(() => fingerprintMemo("DROP|001", "tickets", "x")).toThrow();
    expect(() => fingerprintMemo("DROP-001", "", "x")).toThrow();
    expect(() => fingerprintMemo("DROP-001", "tickets", "x".repeat(600))).toThrow();
  });

  it("ignores memos that aren't LOOTBOX fingerprints", () => {
    expect(parseFingerprint("gm")).toBeNull();
    expect(parseFingerprint("LOOTBOX|v2|DROP-001|tickets|x")).toBeNull();
  });
});

describe("draw seeds", () => {
  it("are the same for the same drop, ticket list and round", () => {
    expect(drawSeed("DROP-001", "ab12", 1)).toEqual(drawSeed("DROP-001", "ab12", 1));
    expect(drawSeed("DROP-001", "ab12", 1)).toHaveLength(32);
  });

  it("change with the round or the ticket list, so a redraw gets new randomness", () => {
    const first = randomnessAccount(drawSeed("DROP-001", "ab12", 1));
    expect(randomnessAccount(drawSeed("DROP-001", "ab12", 2))).not.toBe(first);
    expect(randomnessAccount(drawSeed("DROP-001", "cd34", 1))).not.toBe(first);
  });
});

describe("never paying a drop twice", () => {
  it("spots the drop's own funded fingerprint in a transaction's memo field", () => {
    const funded = `[60] ${fingerprintMemo("DEV-002", "funded", "1000c", "106262338lamports", "94.1067usd")}`;
    expect(isFundingMemo(funded, "DEV-002")).toBe(true);
    expect(isFundingMemo(`[12] something else; ${funded}`, "DEV-002")).toBe(true);
  });

  it("ignores other drops, other steps, and transactions without a memo", () => {
    expect(isFundingMemo(`[60] ${fingerprintMemo("DEV-001", "funded", "1000c")}`, "DEV-002")).toBe(false);
    expect(isFundingMemo(`[80] ${fingerprintMemo("DEV-002", "tickets", "ab12")}`, "DEV-002")).toBe(false);
    expect(isFundingMemo(null, "DEV-002")).toBe(false);
  });
});
