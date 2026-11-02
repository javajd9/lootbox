// Finished claims, as the engine sees them. The claim webhook never writes the engine's state
// itself: it records the claim in its own table, and the engine reads that table on every tick
// (while it holds the lock) and marks the drop claimed. So a claim can never race a tick.
import type { EngineState } from "./types";

export interface FinishedClaim {
  drop_id: string;
  wallet: string;
  round: number;
  completed_at: string | null;
}

// A claim counts only for the draw round it was made in, by that round's winner, before the deadline.
export function withClaims(state: EngineState, claims: FinishedClaim[]): EngineState {
  let changed = false;
  const drops = state.drops.map((d) => {
    if (d.stage !== "claiming" || d.claimedAt || !d.winner || !d.claimDeadline) return d;
    const c = claims.find(
      (c) => c.drop_id === d.id && c.wallet === d.winner && c.round === d.round && c.completed_at && Date.parse(c.completed_at) < Date.parse(d.claimDeadline!),
    );
    if (!c) return d;
    changed = true;
    return { ...d, claimedAt: new Date(c.completed_at!).toISOString() };
  });
  return changed ? { ...state, drops } : state;
}
