import { NextResponse } from "next/server";
import { verifyClaimSignature } from "@/lib/claims/claims";
import { claimStore } from "@/lib/claims/store";

const MESSAGES = {
  unknown_nonce: "Claim session not found. Start again.",
  used: "This claim link was already used.",
  expired: "This claim session expired. Start again.",
  bad_signature: "Signature doesn't match the winning wallet.",
} as const;

export async function POST(req: Request) {
  const { nonce, signature } = (await req.json().catch(() => ({}))) as { nonce?: string; signature?: string };
  if (!nonce || !signature) return NextResponse.json({ error: "Missing nonce or signature." }, { status: 400 });

  const claim = claimStore.get(nonce);
  const result = verifyClaimSignature(claim, signature);
  if (!result.ok) return NextResponse.json({ error: MESSAGES[result.reason] }, { status: 401 });
  claimStore.markUsed(nonce);

  // Next: create the winner's $0 Shopify draft order and return its invoice URL.
  return NextResponse.json({
    status: "wallet_verified",
    dropId: claim!.dropId,
    checkoutUrl: null,
    next: "Wallet verified. The $0 Shopify checkout link appears here once the Shopify store is connected.",
  });
}
