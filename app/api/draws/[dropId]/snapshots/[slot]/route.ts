// One holder snapshot, exactly as it was hashed: SHA-256 over its canonical JSON (keys sorted, no
// whitespace) is the fingerprint posted on Solana when it was taken (see /docs/reproduce).
import { NextResponse } from "next/server";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_req: Request, { params }: { params: { dropId: string; slot: string } }) {
  if (!dropConfig(params.dropId) || !/^\d{1,15}$/.test(params.slot)) {
    return NextResponse.json({ error: "unknown snapshot" }, { status: 404 });
  }
  try {
    const { data } = check(
      await serverDb().from("snapshots").select("data").eq("drop_id", params.dropId).eq("slot", Number(params.slot)).maybeSingle(),
      "load snapshot",
    );
    if (!data?.data) return NextResponse.json({ error: "unknown snapshot" }, { status: 404 });
    // A snapshot never changes once taken.
    return NextResponse.json(data.data, { headers: { "cache-control": "public, s-maxage=86400, immutable" } });
  } catch (err) {
    console.error("snapshot failed", err);
    return NextResponse.json({ error: "snapshot unavailable" }, { status: 503 });
  }
}
