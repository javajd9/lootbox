// The drop queue: each drop, its goal, and when the first one opens. The engine picks up any drop
// listed here that it hasn't seen yet, so adding the next drop means adding it here.
import { CLUSTER, type Cluster } from "@/lib/chain/solana";
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

// Zinc's sandbox product that always succeeds. Test keys (zn_test_...) never spend real money.
const TEST_PRODUCT: PrizeItem = { name: "Zinc test product", url: "https://zinc.com/shop/products/test-success", quantity: 1, maxPriceCents: 500 };

const QUEUES: Record<Cluster, DropConfig[]> = {
  // Small goals, so test fees can fill them.
  devnet: [
    { id: "DEV-001", number: 1, title: "Devnet test drop", goalCents: 1_000, opensAt: "2026-10-31T00:00:00Z", prize: [TEST_PRODUCT] },
    { id: "DEV-002", number: 2, title: "Devnet test drop", goalCents: 1_000, prize: [TEST_PRODUCT] },
    { id: "DEV-003", number: 3, title: "Devnet test drop", goalCents: 1_000, prize: [TEST_PRODUCT] },
  ],
  // Stays shut until LAUNCH_AT is set. Its ASINs and caps (lib/config/prizes) are filled in before then.
  "mainnet-beta": [
    { id: "DROP-001", number: 1, title: "GTA VI Bundle", goalCents: 159_000, opensAt: process.env.LAUNCH_AT || "2099-01-01T00:00:00Z", prize: GTA_VI_BUNDLE },
  ],
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
// Drops from another network's queue are left out: the engine keeps one saved state, so when
// SOLANA_CLUSTER switches to mainnet the devnet test drops would otherwise still be ticked there
// (a redraw would request mainnet randomness for a test drop) and shown as past drops.
export function withQueuedDrops(store: EngineStore, cluster: Cluster = CLUSTER): EngineStore {
  const elsewhere = new Set(
    (Object.keys(QUEUES) as Cluster[]).filter((c) => c !== cluster).flatMap((c) => QUEUES[c].map((d) => d.id)),
  );
  return {
    ...store,
    async load() {
      const loaded = await store.load();
      const drops = loaded.drops.filter((d) => !elsewhere.has(d.id));
      const state = drops.length === loaded.drops.length ? loaded : { ...loaded, drops };
      const known = new Set(state.drops.map((d) => d.id));
      const added = dropQueue(cluster).filter((c) => !known.has(c.id)).map(record);
      return added.length ? { ...state, drops: [...state.drops, ...added] } : state;
    },
  };
}
