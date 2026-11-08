// The drops the homepage shows before the engine has a record of them: the one that opens first,
// then what's queued after it. Once a drop is live, its numbers come from the engine instead.
import { GTA_VI_BUNDLE } from "../config/prizes";
import type { Drop, DropProofs } from "./types";

// The same list the engine buys from (lib/config/prizes), so the homepage shows what's bought.
const GTA_ITEMS = GTA_VI_BUNDLE.map((p, i) => ({
  name: p.name,
  productId: p.asin ?? `ITEM-${i + 1}`,
  quantity: p.quantity,
  image: p.image,
  asin: p.asin,
  maxPriceCents: p.maxPriceCents || undefined,
}));

const drops: Drop[] = [
  {
    id: "DROP-001",
    title: "GTA VI Bundle",
    status: "upcoming",
    goalUsd: 1590,
    fundedUsd: 0,
    items: GTA_ITEMS,
    treasuryWallet: "",
    excludedWallets: [],
  },
  {
    id: "DROP-002",
    title: "Mystery Drop",
    status: "upcoming",
    goalUsd: 2000,
    fundedUsd: 0,
    items: [],
    treasuryWallet: "",
    excludedWallets: [],
  },
];

// In order: the drop filling now, then what's queued after it.
export function getDropQueue(): Drop[] {
  return drops.filter((d) => d.status !== "complete");
}

// A drop the engine hasn't opened yet still gets a proof page, with nothing published on it.
export function getDropProofs(id: string): DropProofs | undefined {
  const drop = drops.find((d) => d.id === id);
  return drop ? { drop, packages: [], anchoredHashes: [], memoTxs: [] } : undefined;
}
