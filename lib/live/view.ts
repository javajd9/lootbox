// The engine's public feed (GET /api/live), as the browser receives it. Types only, so the
// homepage can use them without pulling in any server code.
export type Cluster = "devnet" | "mainnet-beta";

export interface LiveView {
  cluster: Cluster;
  poolCents: number; // the treasury at the last tick's price
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
  updatedAt: string;
}
