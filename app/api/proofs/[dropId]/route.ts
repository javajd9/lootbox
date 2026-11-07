// A drop's proof packages as public JSON, exactly as they were hashed: anyone can recompute each
// hash and compare it with the fingerprint on-chain (LOOTBOX|v1|<drop>|<kind>|<hash>).
import { NextResponse } from "next/server";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_req: Request, { params }: { params: { dropId: string } }) {
  if (!dropConfig(params.dropId)) return NextResponse.json({ error: "unknown drop" }, { status: 404 });
  try {
    const { data } = check(
      await serverDb().from("proofs").select("seq, type, package, package_hash, memo_tx, created_at").eq("drop_id", params.dropId).order("seq"),
      "load proofs",
    );
    return NextResponse.json({ dropId: params.dropId, proofs: data ?? [] }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=300" } });
  } catch (err) {
    console.error("proofs failed", err);
    return NextResponse.json({ error: "proofs unavailable" }, { status: 503 });
  }
}
