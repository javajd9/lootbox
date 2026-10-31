// In-memory claim store for local development. Swap for the Supabase `claims` table
// before deploying: serverless instances don't share memory.
import type { PendingClaim } from "./claims";

const g = globalThis as unknown as { __lootboxClaims?: Map<string, PendingClaim> };
const claims = (g.__lootboxClaims ??= new Map());

export const claimStore = {
  save(claim: PendingClaim) {
    claims.set(claim.nonce, claim);
  },
  get(nonce: string): PendingClaim | undefined {
    return claims.get(nonce);
  },
  markUsed(nonce: string) {
    const c = claims.get(nonce);
    if (c) c.used = true;
  },
};
