import { NextResponse } from "next/server";
import { isWalletAddress, newClaim } from "@/lib/claims/claims";
import { claimStore } from "@/lib/claims/store";
import { getDrop } from "@/lib/data/mock";

export async function POST(req: Request) {
  const { dropId, wallet } = (await req.json().catch(() => ({}))) as { dropId?: string; wallet?: string };
  if (!dropId || !wallet || !isWalletAddress(wallet)) {
    return NextResponse.json({ error: "Send a drop ID and a valid Solana wallet address." }, { status: 400 });
  }
  const drop = getDrop(dropId);
  if (!drop) return NextResponse.json({ error: "Unknown drop." }, { status: 404 });
  if (!drop.winnerWallet) return NextResponse.json({ error: "This drop hasn't been drawn yet." }, { status: 409 });
  if (drop.winnerWallet !== wallet) return NextResponse.json({ error: "This wallet didn't win this drop." }, { status: 403 });

  const claim = newClaim(dropId, wallet);
  claimStore.save(claim);
  return NextResponse.json({ nonce: claim.nonce, message: claim.message, expiresAt: claim.expiresAt });
}
