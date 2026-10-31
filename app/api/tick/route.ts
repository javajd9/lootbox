// The drop engine's heartbeat. The scheduler calls this every minute with the secret; each call
// does whatever is due (see lib/engine) and reports what it did.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { liveEffects, liveStore } from "@/lib/engine/live";
import { tick } from "@/lib/engine/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const report = await tick(liveStore(), liveEffects());
    if (report?.errors.length) console.error("tick errors", report.errors);
    return NextResponse.json(report ?? { skipped: "another tick is running" });
  } catch (err) {
    console.error("tick failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "tick failed" }, { status: 500 });
  }
}
