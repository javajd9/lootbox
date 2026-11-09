// The drop queue: each drop, its goal, and when the first one opens. The engine picks up any drop
// listed here that it hasn't seen yet, so adding the next drop means adding it here.
import { GTA_VI_BUNDLE, type PrizeItem } from "@/lib/config/prizes";
import type { EngineStore } from "./run";
import type { DropRecord, EngineState } from "./types";

export type { PrizeItem };

export interface DropConfig {
  id: string;
  number: number;
  title: string;
  goalCents: number;
  opensAt?: string; // the first drop only
  prize?: PrizeItem[]; // must be set before the drop is claimed, or the order waits on a hold
}

// DROP-001 stays shut until LAUNCH_AT is set. Its ASINs and caps (lib/config/prizes) are filled in before then.
// Each drop after it opens the moment the one before is drawn, and its pool starts with whatever
// the last one collected past its goal. Its prize is set before its pool fills; until then an order
// for it would wait on a hold. Queue the next drop before the last one here is drawn.
const DROPS: DropConfig[] = [
  { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalCents: 159_000, opensAt: process.env.LAUNCH_AT || "2099-01-01T00:00:00Z", prize: GTA_VI_BUNDLE },
  { id: "DROP-002", number: 2, title: "Mystery Drop", goalCents: 200_000 },
];

export const dropQueue = () => DROPS;
export const dropConfig = (id: string) => DROPS.find((c) => c.id === id);

const record = (c: DropConfig): DropRecord => ({
  id: c.id,
  goalCents: c.goalCents,
  stage: "upcoming",
  opensAt: c.opensAt,
  snapshotsTaken: 0,
  snapshotDue: [],
  round: 0,
});

export const initialState = (): EngineState => ({ drops: DROPS.map(record), treasuryCents: 0, sentAlerts: [] });

// Adds newly listed drops to the saved state, after the ones it has. Only listed drops are run or
// shown: a saved drop that isn't listed here is left out, so it's never ticked again.
//
// A drop that hasn't opened yet follows this list: its record is saved the first time the engine
// sees it, which can be before LAUNCH_AT or its final goal is set, and nothing about it has been
// published. From the moment a drop opens, its record is never changed here.
export function withQueuedDrops(store: EngineStore): EngineStore {
  const listed = new Map(DROPS.map((c) => [c.id, c]));
  return {
    ...store,
    async load() {
      const loaded = await store.load();
      let changed = false;
      const drops = loaded.drops
        .filter((d) => listed.has(d.id))
        .map((d) => {
          const c = listed.get(d.id)!;
          if (d.stage !== "upcoming" || (d.goalCents === c.goalCents && d.opensAt === c.opensAt)) return d;
          changed = true;
          return { ...d, goalCents: c.goalCents, opensAt: c.opensAt };
        });
      const known = new Set(drops.map((d) => d.id));
      const added = DROPS.filter((c) => !known.has(c.id)).map(record);
      if (!changed && !added.length && drops.length === loaded.drops.length) return loaded;
      return { ...loaded, drops: [...drops, ...added] };
    },
  };
}
