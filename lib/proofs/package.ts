// Proof packages and the hash chain (claim P6).
// Each package includes the hash of the one before it; each package hash is also posted
// to Solana via Memo. Editing, removing or reordering any package breaks verification.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type ProofType = "address_commitment" | "payment" | "order" | "tracking" | "receipt";

export interface ProofPackage {
  version: 1;
  dropId: string;
  seq: number;
  type: ProofType;
  createdAt: string;
  // Only allowlisted, non-private facts (ASINs, prices, status, timestamps...).
  revealed: Record<string, unknown>;
  // Raw Reclaim proof, Solana tx signature, or wallet signature, depending on type.
  attestation: unknown;
  prevHash: string | null;
}

// Deterministic JSON: sorted keys, no whitespace. Same object -> same bytes -> same hash.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function hashPackage(p: ProofPackage): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(p))));
}

export function buildPackage(
  input: Pick<ProofPackage, "dropId" | "type" | "createdAt" | "revealed" | "attestation">,
  prev?: ProofPackage,
): ProofPackage {
  if (prev && prev.dropId !== input.dropId) throw new Error("buildPackage: dropId differs from previous package");
  return {
    version: 1,
    ...input,
    seq: prev ? prev.seq + 1 : 0,
    prevHash: prev ? hashPackage(prev) : null,
  };
}

// anchoredHashes: package hashes read back from the Solana Memo transactions, in order.
export function verifyChain(packages: ProofPackage[], anchoredHashes?: string[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (packages.length === 0) errors.push("no packages");
  if (anchoredHashes && anchoredHashes.length !== packages.length) {
    errors.push(`expected ${packages.length} on-chain hashes, found ${anchoredHashes.length}`);
  }
  packages.forEach((p, i) => {
    if (p.seq !== i) errors.push(`package ${i}: seq is ${p.seq}`);
    if (p.dropId !== packages[0].dropId) errors.push(`package ${i}: belongs to ${p.dropId}`);
    const expectedPrev = i === 0 ? null : hashPackage(packages[i - 1]);
    if (p.prevHash !== expectedPrev) errors.push(`package ${i}: prevHash does not match package ${i - 1}`);
    if (anchoredHashes?.[i] !== undefined && anchoredHashes[i] !== hashPackage(p)) {
      errors.push(`package ${i}: hash does not match the on-chain record`);
    }
  });
  return { ok: errors.length === 0, errors };
}
