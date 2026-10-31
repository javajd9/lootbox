// Last line of defense: before any proof is published, search everything we're about to
// reveal for the winner's details. Any hit blocks publishing. False positives are acceptable;
// a leak is not.

export interface WinnerPII {
  name?: string;
  email?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  zip?: string;
}

export class PIILeakError extends Error {
  constructor(public fields: string[]) {
    super(`PII found in proof: ${fields.join(", ")}`);
    this.name = "PIILeakError";
  }
}

const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const tokenize = (s: string) => s.normalize("NFKC").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function containsTokenSeq(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function findPII(revealed: string, pii: WinnerPII): string[] {
  const hits = new Set<string>();
  const lower = revealed.normalize("NFKC").toLowerCase();
  const squashed = squash(revealed);
  const tokens = tokenize(revealed);
  const digits = revealed.replace(/\D/g, "");

  if (pii.email) {
    const email = pii.email.trim().toLowerCase();
    const local = email.split("@")[0];
    if (lower.includes(email) || (local.length >= 4 && squashed.includes(squash(local)))) hits.add("email");
  }
  if (pii.phone) {
    const p = pii.phone.replace(/\D/g, "").slice(-10);
    if (p.length >= 7 && digits.includes(p)) hits.add("phone");
  }
  if (pii.zip) {
    const z = pii.zip.replace(/\D/g, "").slice(0, 5);
    if (z.length === 5 && new RegExp(`(?<!\\d)${z}(?!\\d)`).test(revealed)) hits.add("zip");
  }
  for (const field of ["line1", "line2"] as const) {
    const v = pii[field];
    if (v && squash(v).length >= 4 && squashed.includes(squash(v))) hits.add(field);
  }
  if (pii.city && containsTokenSeq(tokens, tokenize(pii.city))) hits.add("city");
  if (pii.name) {
    const parts = tokenize(pii.name);
    if (containsTokenSeq(tokens, parts) || squashed.includes(squash(pii.name))) hits.add("name");
    else if (parts.some((t) => t.length >= 3 && tokens.includes(t))) hits.add("name");
  }
  return [...hits];
}

export function assertNoPII(revealed: unknown, pii: WinnerPII): void {
  const text = typeof revealed === "string" ? revealed : JSON.stringify(revealed);
  const hits = findPII(text, pii);
  if (hits.length) throw new PIILeakError(hits);
}
