// Holder snapshots and draw weights.
// Several snapshots are taken at random, unannounced times during a drop. A wallet's weight is
// the SUM of its balances across all snapshots (proportional to its average), so buying right
// before the draw only earns weight in the snapshots that happen after the buy.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalJson } from "../proofs/package";

export interface TokenAccount {
  owner: string;
  amount: bigint; // raw base units
}

export interface Snapshot {
  dropId: string;
  slot: number;
  takenAt: string;
  // Sorted by wallet; balances as decimal strings so the JSON is exact.
  holders: { wallet: string; balance: string }[];
}

export interface WeightEntry {
  wallet: string;
  weight: bigint;
}

export interface WeightRange extends WeightEntry {
  start: bigint; // inclusive
  end: bigint; // exclusive
}

const byWallet = (a: { wallet: string }, b: { wallet: string }) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0);

// excluded: bonding curve, AMM pool, team, dev and treasury wallets (listed on /docs/addresses).
export function buildSnapshot(
  dropId: string,
  slot: number,
  takenAt: string,
  accounts: TokenAccount[],
  excluded: Iterable<string>,
): Snapshot {
  const skip = new Set(excluded);
  const totals = new Map<string, bigint>();
  for (const { owner, amount } of accounts) {
    if (skip.has(owner) || amount <= 0n) continue;
    totals.set(owner, (totals.get(owner) ?? 0n) + amount);
  }
  const holders = [...totals]
    .map(([wallet, balance]) => ({ wallet, balance: balance.toString() }))
    .sort(byWallet);
  return { dropId, slot, takenAt, holders };
}

export function hashSnapshot(s: Snapshot): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(s))));
}

export function combineWeights(snapshots: Snapshot[]): WeightEntry[] {
  if (snapshots.length === 0) throw new Error("combineWeights: no snapshots");
  const dropIds = new Set(snapshots.map((s) => s.dropId));
  if (dropIds.size !== 1) throw new Error("combineWeights: snapshots from different drops");
  const weights = new Map<string, bigint>();
  for (const s of snapshots) {
    for (const h of s.holders) weights.set(h.wallet, (weights.get(h.wallet) ?? 0n) + BigInt(h.balance));
  }
  return [...weights].map(([wallet, weight]) => ({ wallet, weight })).sort(byWallet);
}

export function toRanges(entries: WeightEntry[]): { ranges: WeightRange[]; total: bigint } {
  let total = 0n;
  const ranges = entries
    .filter((e) => e.weight > 0n)
    .map((e) => {
      const start = total;
      total += e.weight;
      return { ...e, start, end: total };
    });
  return { ranges, total };
}

// Published (and posted on-chain) before randomness is requested, so the list can't change after.
export function hashWeights(entries: WeightEntry[]): string {
  const rows = entries.map((e) => ({ wallet: e.wallet, weight: e.weight.toString() }));
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(rows))));
}
