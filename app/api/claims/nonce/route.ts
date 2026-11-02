// Step 1 of a claim: the winner asks for a one-time message to sign with the winning wallet.
import { NextResponse } from "next/server";
import { claimable, CLAIMABLE_MESSAGES, isWalletAddress, newClaim } from "@/lib/claims/claims";
import { claimStore } from "@/lib/claims/store";
import { liveStore } from "@/lib/engine/live";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: Request) {
  const { dropId, wallet } = (await req.json().catch(() => ({}))) as { dropId?: string; wallet?: string };
  if (!dropId || !wallet || !isWalletAddress(wallet)) {
    return NextResponse.json({ error: "Send a drop ID and a valid Solana wallet address." }, { status: 400 });
  }
  const drop = (await liveStore().load()).drops.find((d) => d.id === dropId);
  const ok = claimable(drop, wallet);
  if (!ok.ok) return NextResponse.json({ error: CLAIMABLE_MESSAGES[ok.reason] }, { status: ok.reason === "unknown_drop" ? 404 : 409 });

  const claim = newClaim(dropId, wallet);
  await claimStore.save(claim, drop!.round);
  return NextResponse.json({ nonce: claim.nonce, message: claim.message, expiresAt: claim.expiresAt });
}
