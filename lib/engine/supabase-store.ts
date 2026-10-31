// The drop engine's state, kept in Supabase. Server only: it uses the service role key.
import { serverDb } from "@/lib/db";
import type { EngineStore } from "./run";
import type { EngineState } from "./types";

const LEASE_SECONDS = 55; // a tick finishes well inside a minute; a crashed one frees the lock by the next

export function supabaseStore(initial: EngineState): EngineStore {
  const db = serverDb();
  const holder = crypto.randomUUID();

  return {
    async load() {
      const { data, error } = await db.from("engine_state").select("state").eq("id", 1).maybeSingle();
      if (error) throw new Error(`load engine state: ${error.message}`);
      return (data?.state as EngineState | undefined) ?? structuredClone(initial);
    },
    async save(state) {
      const { error } = await db.from("engine_state").upsert({ id: 1, state, updated_at: new Date().toISOString() });
      if (error) throw new Error(`save engine state: ${error.message}`);
    },
    async withLock(fn) {
      const { data, error } = await db.rpc("engine_acquire", { p_holder: holder, p_seconds: LEASE_SECONDS });
      if (error) throw new Error(`engine lock: ${error.message}`);
      if (!data) return undefined;
      try {
        return await fn();
      } finally {
        await db.rpc("engine_release", { p_holder: holder });
      }
    },
  };
}
