// Every drop on this network, for the proof index (/proof): each one the engine has opened, from
// the public drops table, then the ones still queued. Newest first.
import { CLUSTER, type Cluster } from "@/lib/chain/solana";
import type { DropStatus } from "@/lib/data/types";
import { check, serverDb } from "@/lib/db";
import { dropQueue } from "@/lib/engine/drops";

export interface DropSummary {
  id: string;
  number: number;
  title: string;
  goalUsd: number;
  status: DropStatus;
  openedAt?: string;
  winner?: string; // the current round's, once drawn
  proofs: number; // proof packages published so far
}

const DRAWN = new Set<DropStatus>(["claiming", "fulfilling", "delivered", "complete"]);

export async function dropSummaries(cluster: Cluster = CLUSTER): Promise<DropSummary[]> {
  const queue = dropQueue(cluster);
  const ids = queue.map((c) => c.id);
  const db = serverDb();
  const [dropRows, roundRows, proofRows] = await Promise.all([
    db.from("drops").select("id, status, opened_at").in("id", ids),
    db.from("draw_rounds").select("drop_id, round, winner_wallet").in("drop_id", ids).not("winner_wallet", "is", null),
    db.from("proofs").select("drop_id").in("drop_id", ids),
  ]);
  const { data: drops } = check(dropRows, "load drops");
  const { data: rounds } = check(roundRows, "load draw rounds");
  const { data: proofs } = check(proofRows, "load proofs");
  return queue
    .map((c): DropSummary => {
      const row = drops?.find((d) => d.id === c.id);
      const status = (row?.status as DropStatus | undefined) ?? "upcoming";
      // During a redraw the last round's winner is no longer the winner, so only a drawn drop shows one.
      const latest = (rounds ?? []).filter((r) => r.drop_id === c.id).sort((a, b) => b.round - a.round)[0];
      return {
        id: c.id,
        number: c.number,
        title: c.title,
        goalUsd: c.goalCents / 100,
        status,
        openedAt: (row?.opened_at as string | null) ?? undefined,
        winner: DRAWN.has(status) ? (latest?.winner_wallet as string | undefined) : undefined,
        proofs: (proofs ?? []).filter((p) => p.drop_id === c.id).length,
      };
    })
    .reverse();
}
