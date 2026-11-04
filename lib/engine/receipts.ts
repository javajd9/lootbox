// Winners' signed receipts, as the engine sees them. Like claims (./claims), the receipt route never
// writes the engine's state: it records the receipt in its own table, and the engine reads that
// table on every tick (while it holds the lock) and marks the drop received, which completes it.
import type { EngineState } from "./types";

export interface FinishedReceipt {
  drop_id: string;
  wallet: string;
  created_at: string;
}

// A receipt counts once it's fully recorded (proof saved, fingerprint posted) and only from the winner.
export function withReceipts(state: EngineState, receipts: FinishedReceipt[]): EngineState {
  let changed = false;
  const drops = state.drops.map((d) => {
    if (d.stage !== "delivered" || d.receivedAt || !d.winner) return d;
    const r = receipts.find((r) => r.drop_id === d.id && r.wallet === d.winner);
    if (!r) return d;
    changed = true;
    return { ...d, receivedAt: new Date(r.created_at).toISOString() };
  });
  return changed ? { ...state, drops } : state;
}
