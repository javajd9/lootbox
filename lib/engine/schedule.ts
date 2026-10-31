// When snapshots happen. The times are drawn from a secure random source and kept private until
// each snapshot has been taken, so nobody can buy in just before one and sell after.
import { RULES } from "@/lib/config/rules";

const HOUR = 3_600_000;

export const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// While a pool fills: the next snapshot, 2 to 8 hours from now.
export function nextSnapshotAt(now: Date, rng: () => number): string {
  const hours = RULES.snapshotMinHours + rng() * (RULES.snapshotMaxHours - RULES.snapshotMinHours);
  return new Date(now.getTime() + hours * HOUR).toISOString();
}
