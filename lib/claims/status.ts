// A claim's statuses, and how it moves between them. One file for the server (./store, ./complete)
// and the claim page, so neither can meet a status the other doesn't know. Nothing is imported, so
// the browser can use it too.
//
//   nonce_issued → wallet_verified → checkout_sent → checkout_complete
//                         └──────────────┴────────→ expired
//
//   nonce_issued       the winner asked for a message to sign (/api/claims/nonce)
//   wallet_verified    the winning wallet signed it; the nonce is used up (/api/claims/verify)
//   checkout_sent      the $0 Shopify checkout exists and its link went to the winner
//   checkout_complete  Shopify sent the address; its fingerprint is on-chain (./complete)
//   expired            the checkout came back when the prize was no longer this claim's to take:
//                      the deadline had passed, or the drop was redrawn, on hold or already claimed

// Same names as the database's claim_status.
export const CLAIM_STATUSES = ["nonce_issued", "wallet_verified", "checkout_sent", "checkout_complete", "expired"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// Where each status can go next. Only the winner's signature leaves `nonce_issued`, and nothing
// leaves `checkout_complete`: a finished claim is never rewritten.
export const CLAIM_FLOW: Record<ClaimStatus, readonly ClaimStatus[]> = {
  nonce_issued: ["wallet_verified"],
  wallet_verified: ["checkout_sent", "checkout_complete", "expired"],
  checkout_sent: ["checkout_complete", "expired"],
  checkout_complete: [],
  // Shopify sending the same order again is checked afresh, so it can still count if the prize is
  // this winner's to claim by then (say a hold was cleared).
  expired: ["checkout_complete"],
};

// The statuses a claim may be in just before it becomes `to`. Every write of a new status is
// limited to these rows (./store, ./complete), so two requests racing can't move a claim backwards.
export const comesFrom = (to: ClaimStatus): ClaimStatus[] => CLAIM_STATUSES.filter((from) => CLAIM_FLOW[from].includes(to));

// The signature has been checked, so the nonce can't be used again.
export const nonceUsed = (status: ClaimStatus) => status !== "nonce_issued";

// What GET /api/claims/status tells the holder of a claim token.
export interface ClaimView {
  status: ClaimStatus;
  dropId: string;
  checkoutUrl?: string; // while the checkout is open, so the winner can get back to it
  // Once finished: the public fingerprint, and (until the drop completes) the winner's own secret code for it.
  commitment?: string | null;
  memoTx?: string | null;
  memoUrl?: string;
  salt?: string;
  normalized?: string;
}
