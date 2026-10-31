// The drop engine's view of a drop: where it is in its life, plus the private bits (like when the
// next snapshot will be taken) that are never public until they've happened.

// Same names as the database's drop_status.
export type Stage = "upcoming" | "funding" | "snapshotting" | "drawing" | "claiming" | "fulfilling" | "delivered" | "complete";

export interface DropRecord {
  id: string;
  goalCents: number;
  stage: Stage;
  opensAt?: string; // launch time, for the first drop; later drops open as soon as the one before is drawn
  openedAt?: string;
  fundedAt?: string;
  snapshotsTaken: number;
  snapshotDue: string[]; // private: when the next snapshot(s) will be taken
  drawAt?: string; // the pause after the pool fills, then the randomness is requested
  ticketsHash?: string; // the locked ticket list, posted on-chain before any randomness is requested
  totalTickets?: number;
  round: number; // 1 for the first draw; each redraw adds 1
  randomnessRequestedAt?: string;
  winner?: string;
  ticket?: number;
  drawnAt?: string;
  claimDeadline?: string;
  // Set by the claim, order and delivery systems (webhooks); the engine reacts to them.
  claimedAt?: string;
  orderedAt?: string;
  deliveredAt?: string;
  receivedAt?: string;
  hold?: string; // something needs a human; the engine leaves this drop alone until it's cleared
}

export interface EngineState {
  drops: DropRecord[]; // in drop order
  // The pool filling now: the SOL in the treasury at today's price. Each prize is swapped out to
  // USDC the moment its pool fills, so whatever is left over is already the next drop's pool.
  treasuryCents: number;
  sentAlerts: string[]; // so each alert goes out once
}

export type Effect =
  | { type: "open" }
  | { type: "snapshot" }
  | { type: "fund"; lockedCents: number }
  | { type: "lockTickets" }
  | { type: "requestRandomness"; round: number }
  | { type: "readRandomness"; round: number }
  | { type: "redraw"; round: number }
  | { type: "placeOrder" }
  | { type: "markDelivered" }
  | { type: "complete" }
  | { type: "alert"; key: string; message: string };

export interface Step {
  dropId: string;
  effect: Effect;
}

// The outside world: Helius, Solana, ORAO, Zinc, alerts. Each one must be safe to repeat (a crash
// between doing it and saving the result means it runs again), e.g. keyed by drop and round.
export interface Effects {
  readTreasury(): Promise<number>; // USD cents of SOL in the treasury, at the current price
  open(drop: DropRecord): Promise<void>;
  snapshot(drop: DropRecord): Promise<{ hash: string; holders: number }>;
  fund(drop: DropRecord, lockedCents: number): Promise<void>; // swaps the prize's worth of SOL to USDC
  lockTickets(drop: DropRecord): Promise<{ hash: string; totalTickets: number }>;
  requestRandomness(drop: DropRecord, round: number): Promise<void>;
  readRandomness(drop: DropRecord, round: number): Promise<{ winner: string; ticket: number } | null>;
  placeOrder(drop: DropRecord): Promise<{ ok: true } | { ok: false; reason: string }>;
  alert(message: string): Promise<void>;
}
