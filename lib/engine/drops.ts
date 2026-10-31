// The drop queue: each drop, its goal, and when the first one opens. The engine picks up any drop
// listed here that it hasn't seen yet, so adding the next drop means adding it here.
import { CLUSTER, type Cluster } from "@/lib/chain/solana";
import type { EngineStore } from "./run";
import type { DropRecord, EngineState } from "./types";

export interface DropConfig {
  id: string;
  number: number;
  title: string;
  goalCents: number;
  opensAt?: string; // the first drop only
}

const QUEUES: Record<Cluster, DropConfig[]> = {
  // Small goals, so test fees can fill them.
  devnet: [
    { id: "DEV-001", number: 1, title: "Devnet test drop", goalCents: 1_000, opensAt: "2026-10-31T00:00:00Z" },
    { id: "DEV-002", number: 2, title: "Devnet test drop", goalCents: 1_000 },
    { id: "DEV-003", number: 3, title: "Devnet test drop", goalCents: 1_000 },
  ],
  // Stays shut until LAUNCH_AT is set.
  "mainnet-beta": [{ id: "DROP-001", number: 1, title: "GTA VI Bundle", goalCents: 200_000, opensAt: process.env.LAUNCH_AT || "2099-01-01T00:00:00Z" }],
};

export const dropQueue = (cluster: Cluster = CLUSTER) => QUEUES[cluster];
export const dropConfig = (id: string, cluster: Cluster = CLUSTER) => dropQueue(cluster).find((c) => c.id === id);

const record = (c: DropConfig): DropRecord => ({
  id: c.id,
  goalCents: c.goalCents,
  stage: "upcoming",
  opensAt: c.opensAt,
  snapshotsTaken: 0,
  snapshotDue: [],
  round: 0,
});

export const initialState = (cluster: Cluster = CLUSTER): EngineState => ({ drops: dropQueue(cluster).map(record), treasuryCents: 0, sentAlerts: [] });

// Adds newly listed drops to the saved state, after the ones it has. Never changes a known drop.
export function withQueuedDrops(store: EngineStore, cluster: Cluster = CLUSTER): EngineStore {
  return {
    ...store,
    async load() {
      const state = await store.load();
      const known = new Set(state.drops.map((d) => d.id));
      const added = dropQueue(cluster).filter((c) => !known.has(c.id)).map(record);
      return added.length ? { ...state, drops: [...state.drops, ...added] } : state;
    },
  };
}
