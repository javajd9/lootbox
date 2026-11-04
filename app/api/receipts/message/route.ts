// Step 1 of "I received it": the winner asks for the message to sign with the winning wallet.
import { NextResponse } from "next/server";
import { receiptToSign } from "@/lib/claims/received";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: Request) {
  const { dropId, wallet } = (await req.json().catch(() => ({}))) as { dropId?: string; wallet?: string };
  if (!dropId || !wallet) return NextResponse.json({ error: "Send a drop ID and the winning wallet's address." }, { status: 400 });
  try {
    const r = await receiptToSign(dropId, wallet);
    return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    console.error("receipt message failed", err);
    return NextResponse.json({ error: "Something went wrong. Try again in a minute." }, { status: 500 });
  }
}
