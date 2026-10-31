// The live drop, for the homepage: the pool, the current drop's stage, the last winner.
import { NextResponse } from "next/server";
import { liveView } from "@/lib/engine/public";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await liveView(), { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=25" } });
  } catch (err) {
    console.error("live view failed", err);
    return NextResponse.json({ error: "live data unavailable" }, { status: 503 });
  }
}
