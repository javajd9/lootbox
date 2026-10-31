// Tickets: every TOKENS_PER_TICKET $LOOT of average balance (across the drop's snapshots)
// is one raffle ticket. Ticket numbers are positions in the cumulative ticket range, so
// "ticket #48,213" maps to exactly one wallet, and the draw picks a ticket number.
import type { WeightEntry } from "./snapshot";

export const TOKEN_DECIMALS = 6; // pump.fun tokens
export const TOKENS_PER_TICKET = 10_000n;
const BASE_UNITS_PER_TICKET = TOKENS_PER_TICKET * 10n ** BigInt(TOKEN_DECIMALS);

// weights: output of combineWeights (sum of raw balances over snapshotCount snapshots).
export function toTickets(weights: WeightEntry[], snapshotCount: number): WeightEntry[] {
  if (snapshotCount <= 0) throw new Error("toTickets: snapshotCount must be positive");
  return weights
    .map(({ wallet, weight }) => ({ wallet, weight: weight / BigInt(snapshotCount) / BASE_UNITS_PER_TICKET }))
    .filter((e) => e.weight > 0n);
}
