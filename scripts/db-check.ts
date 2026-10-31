// Checks the database is set up and safe: the engine's state saves and reloads, only one tick can
// hold the lock, and visitors (the public anon key) can't read the engine's private state.
//
//   npm run db:check
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { supabaseStore } from "@/lib/engine/supabase-store";
import type { EngineState } from "@/lib/engine/types";

const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => results.push([name, ok]);

const empty: EngineState = { drops: [], treasuryCents: 0, sentAlerts: [] };
const a = supabaseStore(empty);
const b = supabaseStore(empty);

// Save and reload, then put back whatever was there.
const before = await a.load();
await a.save({ ...before, sentAlerts: [...before.sentAlerts, "db-check"] });
check("engine state saves and reloads", (await b.load()).sentAlerts.includes("db-check"));
await a.save(before);

// Two "servers" ticking at once: only one gets in.
let inner: unknown = "not run";
const outer = await a.withLock(async () => {
  inner = await b.withLock(async () => "second got in");
  return "first got in";
});
check("only one tick can hold the lock", outer === "first got in" && inner === undefined);
check("the lock is released afterwards", (await b.withLock(async () => true)) === true);

// What a visitor's browser can see.
const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const peek = await visitor.from("engine_state").select("state");
check("visitors can't read the engine's private state", !peek.error && peek.data.length === 0);
for (const table of ["claims", "orders", "audit_events"]) {
  const r = await visitor.from(table).select("id");
  check(`visitors can't read ${table}`, !r.error && r.data.length === 0);
}
const grab = await visitor.rpc("engine_acquire", { p_holder: "visitor", p_seconds: 60 });
check("visitors can't take the engine lock", Boolean(grab.error));
const drops = await visitor.from("drops").select("id");
check("visitors can read public drop data", !drops.error);

for (const [name, ok] of results) console.log(`${ok ? "✓" : "✗"} ${name}`);
if (results.some(([, ok]) => !ok)) process.exit(1);
