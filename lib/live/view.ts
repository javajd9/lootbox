// The engine's public feed (GET /api/live), as the browser receives it. Types only, so the
// homepage can use them without pulling in any server code.
import type { PastDrop } from "./types";

export type Cluster = "devnet" | "mainnet-beta";

// One real trade's creator fee, in the pool.
export interface LiveFee {
  signature: string; // the trade's transaction
  at: string;
  side: "buy" | "sell";
  trader: string;
  feeUsd: number;
  tradeUsd: number;
}

export interface LiveView {
  cluster: Cluster;
  // The treasury plus the creator fees not collected yet, at the last tick's price, plus any
  // trade's fee recorded since.
  poolCents: number;
  drop: {
    id: string;
    number: number;
    title: string;
    goalCents: number;
    stage: "upcoming" | "funding" | "snapshotting" | "drawing" | "claiming" | "fulfilling" | "delivered" | "complete";
    openedAt?: string;
    fundedAt?: string;
    drawAt?: string; // when the randomness is requested (the end of the pause)
    round: number;
    tickets: number | null; // locked total once drawing; before that, the latest snapshot's
  } | null;
  lastWinner: {
    id: string;
    number: number;
    title: string;
    wallet: string;
    ticket: number;
    totalTickets?: number;
    walletTickets: number | null; // how many tickets the winning wallet held
    drawnAt?: string;
  } | null;
  fees?: LiveFee[]; // the latest trades, newest first
  history?: PastDrop[]; // every drawn drop and how far its proofs have got, newest first
  updatedAt: string;
}
