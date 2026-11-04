// Salted address commitment (claim P5a).
// We publish C = SHA-256(domain | normalized address | salt). Only the winner gets the salt,
// so nobody can brute-force C by guessing addresses, but the winner can recompute it.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  // Kept with the private address for the carrier; never hashed or published.
  phone?: string;
  country?: string; // ISO alpha-2
}

const DOMAIN = "LOOTBOX-ADDR-v1";

function clean(s = ""): string {
  return s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shown to the winner on their private claim page, so they can paste exactly what we hashed.
export function normalizeAddress(a: ShippingAddress): string {
  const zip = a.zip.replace(/\D/g, "").slice(0, 5);
  return [a.name, a.line1, a.line2 ?? "", a.city, a.state, zip].map(clean).join("|");
}

function digest(normalized: string, salt: Uint8Array): string {
  return bytesToHex(sha256(concatBytes(utf8ToBytes(`${DOMAIN}|${normalized}|`), salt)));
}

export function makeCommitment(a: ShippingAddress): { commitment: string; salt: string; normalized: string } {
  return commitWithSalt(a, bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
}

// Only for reproducible demo data; real claims always use makeCommitment's fresh salt.
export function commitWithSalt(a: ShippingAddress, saltHex: string): { commitment: string; salt: string; normalized: string } {
  const normalized = normalizeAddress(a);
  return { commitment: digest(normalized, hexToBytes(saltHex)), salt: saltHex, normalized };
}

// Runs in the winner's browser on the proof page; nothing is sent anywhere.
export function checkCommitment(a: ShippingAddress | string, saltHex: string, commitment: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(saltHex)) return false;
  const normalized = typeof a === "string" ? a : normalizeAddress(a);
  return digest(normalized, hexToBytes(saltHex)) === commitment.toLowerCase();
}
