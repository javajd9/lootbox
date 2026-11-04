// Step 2 of "I received it": the signed message comes back. If the winning wallet signed it, it's
// published as the drop's last proof, with its fingerprint on-chain. Safe to send again.
import { NextResponse } from "next/server";
import { recordReceipt } from "@/lib/claims/received";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60; // posting the fingerprint waits for Solana to confirm it

export async function POST(req: Request) {
  const { dropId, wallet, message, signature } = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (!dropId || !wallet || !message || !signature) return NextResponse.json({ error: "Missing drop, wallet, message or signature." }, { status: 400 });
  try {
    const r = await recordReceipt(dropId, wallet, message, signature);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    console.error("receipt failed", err);
    return NextResponse.json({ error: "Your signature was saved but not fully published yet. Press confirm again in a minute." }, { status: 500 });
  }
}
