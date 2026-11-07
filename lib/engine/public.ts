// What the homepage may see of the engine. Never the snapshot schedule: those times stay secret
// until each snapshot has been taken.
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { combineWeights, type Snapshot } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import { recentFees } from "@/lib/fees/store";
import type { PastDrop } from "@/lib/live/types";
import type { LiveView } from "@/lib/live/view";
import { poolCents } from "./decide";
import { dropConfig } from "./drops";
import { liveStore } from "./live";
import type { DropRecord } from "./types";

const LIVE_STAGES = new Set(["funding", "snapshotting", "drawing"]);
const DRAWN_STAGES = new Set(["claiming", "fulfilling", "delivered", "complete"]);

// How many tickets each round's winner held. A locked ticket list never changes, so each is read
// once per server rather than on every poll.
const winnerTickets = new Map<string, number | null>();
async function walletTicketsOf(drops: DropRecord[]): Promise<Map<string, number | null>> {
  const key = (d: DropRecord) => `${d.id}:${d.round}:${d.winner}`;
  const missing = drops.filter((d) => !winnerTickets.has(key(d)));
  if (missing.length) {
    const { data } = check(await serverDb().from("draws").select("drop_id, tickets").in("drop_id", missing.map((d) => d.id)), "load tickets");
    for (const d of missing) {
      const list = data?.find((r) => r.drop_id === d.id)?.tickets as { wallet: string; weight: string }[] | undefined;
      const row = list?.find((t) => t.wallet === d.winner);
      winnerTickets.set(key(d), row ? Number(row.weight) : null);
    }
  }
  return new Map(drops.map((d) => [d.id, winnerTickets.get(key(d)) ?? null]));
}

// Every drawn drop, newest first, with when each of its steps was proven. Funded and Paid are the
// same moment: the pool filling, and the transaction that moved the prize's worth out of the treasury.
async function pastDrops(drops: DropRecord[]): Promise<PastDrop[]> {
  const drawn = drops.filter((d) => d.winner && DRAWN_STAGES.has(d.stage)).reverse();
  if (!drawn.length) return [];
  const [tickets, { data: shipped }] = await Promise.all([
    walletTicketsOf(drawn),
    serverDb()
      .from("proofs")
      .select("drop_id, created_at, milestone:package->revealed->>milestone")
      .in("drop_id", drawn.map((d) => d.id))
      .eq("type", "tracking"),
  ]);
  return drawn.map((d) => ({
    id: d.id,
    number: dropConfig(d.id)?.number ?? 0,
    title: dropConfig(d.id)?.title ?? d.id,
    valueUsd: d.goalCents / 100,
    wallet: d.winner!,
    ticket: d.ticket ?? 0,
    totalTickets: d.totalTickets ?? 0,
    walletTickets: tickets.get(d.id) ?? 0,
    done: {
      funded: d.fundedAt,
      paid: d.fundedAt,
      drawn: d.drawnAt,
      claimed: d.claimedAt,
      ordered: d.orderedAt,
      shipped: (shipped ?? []).find((p) => p.drop_id === d.id && p.milestone === "shipped")?.created_at as string | undefined,
      delivered: d.deliveredAt,
      received: d.receivedAt,
    },
    complete: d.stage === "complete" || undefined,
  }));
}

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

  const walletTickets = last?.winner ? ((await walletTicketsOf([last])).get(last.id) ?? null) : null;
  const history = await pastDrops(state.drops).catch((err) => {
    console.error("drop history unavailable", err);
    return undefined; // the homepage keeps the history it has
  });

  // The tick reads the pool once a minute; fees from trades since then are added on, so the
  // number moves with every trade.
  const fees = await recentFees().catch((err) => {
    console.error("fee events unavailable", err);
    return [];
  });
  const readAt = state.poolReadAt ? Date.parse(state.poolReadAt) : Infinity;
  const sinceRead = fees.filter((f) => Date.parse(f.at) > readAt).reduce((n, f) => n + f.feeUsd * 100, 0);

  const info = (d: DropRecord) => ({ number: dropConfig(d.id)?.number ?? 0, title: dropConfig(d.id)?.title ?? d.id });
  return {
    cluster: CLUSTER,
    poolCents: Math.floor(poolCents(state) + sinceRead),
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
    fees,
    history,
    updatedAt: new Date().toISOString(),
  };
}
