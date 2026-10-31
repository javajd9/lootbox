// What the homepage may see of the engine. Never the snapshot schedule: those times stay secret
// until each snapshot has been taken.
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { combineWeights, type Snapshot } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import type { LiveView } from "@/lib/live/view";
import { dropConfig } from "./drops";
import { liveStore } from "./live";
import type { DropRecord } from "./types";

const LIVE_STAGES = new Set(["funding", "snapshotting", "drawing"]);

export async function liveView(): Promise<LiveView> {
  const state = await liveStore().load();
  const current = state.drops.find((d) => LIVE_STAGES.has(d.stage)) ?? state.drops.find((d) => d.stage === "upcoming");
  const last = [...state.drops].reverse().find((d) => d.winner);

  let tickets: number | null = current?.totalTickets ?? null;
  if (current && tickets === null && current.snapshotsTaken > 0) {
    const { data } = check(
      await serverDb().from("snapshots").select("data").eq("drop_id", current.id).order("slot", { ascending: false }).limit(1).maybeSingle(),
      "load latest snapshot",
    );
    if (data) tickets = Number(toTickets(combineWeights([data.data as Snapshot]), 1).reduce((n, t) => n + t.weight, 0n));
  }

  let walletTickets: number | null = null;
  if (last?.winner) {
    const { data } = check(await serverDb().from("draws").select("tickets").eq("drop_id", last.id).maybeSingle(), "load tickets");
    const row = (data?.tickets as { wallet: string; weight: string }[] | undefined)?.find((t) => t.wallet === last.winner);
    walletTickets = row ? Number(row.weight) : null;
  }

  const info = (d: DropRecord) => ({ number: dropConfig(d.id)?.number ?? 0, title: dropConfig(d.id)?.title ?? d.id });
  return {
    cluster: CLUSTER,
    poolCents: state.treasuryCents,
    drop: current
      ? {
          id: current.id,
          ...info(current),
          goalCents: current.goalCents,
          stage: current.stage,
          openedAt: current.openedAt,
          fundedAt: current.fundedAt,
          drawAt: current.drawAt,
          round: current.round,
          tickets,
        }
      : null,
    lastWinner: last?.winner
      ? { id: last.id, ...info(last), wallet: last.winner, ticket: last.ticket ?? 0, totalTickets: last.totalTickets, walletTickets, drawnAt: last.drawnAt }
      : null,
    updatedAt: new Date().toISOString(),
  };
}
