"use client";

// Live state of the current drop, as every viewer sees it.
// Today this is driven by a local simulator (demo mode). Later, the same shape comes from
// Supabase Realtime: fee inflows from Helius, and the draw result from the VRF transaction.
import { useCallback, useEffect, useState } from "react";
import type { PastDrop } from "./types";

export type Phase = "filling" | "funded" | "drawing" | "winner";

export interface Trade {
  id: number;
  usd: number;
}

export interface DrawResult {
  ticket: number; // 1-based ticket number shown to viewers
  totalTickets: number;
  wallet: string;
  walletTickets: number; // how many tickets the winning wallet held
}

export interface StageDrop {
  id: string; // "DROP-001"
  number: number; // 1
  title: string;
  goalUsd: number;
}

export interface LastWinner {
  dropId: string;
  number: number;
  title: string;
  wallet: string;
  ticket: number;
}

export interface LiveDrop {
  phase: Phase;
  drop: StageDrop;
  fundedUsd: number;
  tickets: number;
  watching: number;
  trades: Trade[];
  draw?: DrawResult;
  lastWinner?: LastWinner;
  fundedAt?: string;
  history: PastDrop[]; // newest first
}

// How long the winner stays on stage before the next drop opens.
export const WINNER_HOLD_MS = 10_000;

const DEMO_WALLETS = [
  "7xKpQ2vRdLm3nBf8hTzW1cYe5sJa9uGq4oXiN6kE9mQ2",
  "Bf3aYk7Lw2PqR9xTnD4vMc8sHj1uZe6gKo5iWb3tAh1z",
  "9mQ2HvL4kTz8RwX1cPe7nJdB3sYf6aGu5oKiMq2tVb8N",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Mostly small trades, the occasional big one, like real memecoin flow.
function randomFeeUsd() {
  const r = Math.random();
  if (r < 0.7) return round2(0.4 + Math.random() * 6);
  if (r < 0.95) return round2(6 + Math.random() * 24);
  return round2(40 + Math.random() * 90);
}

let tradeId = 0;

function addFees(s: LiveDrop, usd: number): LiveDrop {
  if (s.phase !== "filling") return s;
  const fundedUsd = Math.min(s.drop.goalUsd, round2(s.fundedUsd + usd));
  const added = round2(fundedUsd - s.fundedUsd);
  return {
    ...s,
    fundedUsd,
    tickets: s.tickets + Math.round(added * 30),
    trades: [...s.trades.slice(-7), { id: ++tradeId, usd: added }],
    phase: fundedUsd >= s.drop.goalUsd ? "funded" : "filling",
    fundedAt: fundedUsd >= s.drop.goalUsd ? new Date().toISOString() : undefined,
  };
}

// The moment the ticket is revealed, the drop joins the winner history (claim and fulfillment still to come).
function recordWinner(s: LiveDrop): LiveDrop {
  if (!s.draw) return s;
  const entry: PastDrop = {
    id: s.drop.id,
    number: s.drop.number,
    title: s.drop.title,
    valueUsd: s.drop.goalUsd,
    wallet: s.draw.wallet,
    ticket: s.draw.ticket,
    totalTickets: s.draw.totalTickets,
    walletTickets: s.draw.walletTickets,
    done: { funded: s.fundedAt, drawn: new Date().toISOString() },
  };
  return { ...s, phase: "winner", history: [entry, ...s.history.filter((h) => h.id !== entry.id)] };
}

// The winner moves to the small "last winner" line and the next drop starts filling from $0.
// Holders keep their tokens, so the tickets in the box carry over.
function openNextDrop(s: LiveDrop, next: StageDrop): LiveDrop {
  if (!s.draw) return s;
  return {
    ...s,
    phase: "filling",
    drop: next,
    fundedUsd: 0,
    trades: [],
    draw: undefined,
    fundedAt: undefined,
    lastWinner: { dropId: s.drop.id, number: s.drop.number, title: s.drop.title, wallet: s.draw.wallet, ticket: s.draw.ticket },
  };
}

const DEMO_START = { phase: "filling" as const, fundedUsd: 1240.18, tickets: 61_402, watching: 1_204, trades: [] };

export function useLiveDrop(initial: LiveDrop, upNext: StageDrop[], demoHistory: PastDrop[] = []) {
  const [state, setState] = useState(initial);
  const [demo, setDemo] = useState(false);
  const [speed, setSpeed] = useState(1);

  const nextDrop = upNext.find((d) => d.number === state.drop.number + 1);

  // Demo mode: /?demo (optionally &speed=4)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("demo")) return;
    setDemo(true);
    setSpeed(Math.max(1, Number(params.get("speed")) || 1));
    setState((s) => ({ ...s, ...DEMO_START, history: demoHistory }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on load

  // Simulated trades while filling.
  useEffect(() => {
    if (!demo || state.phase !== "filling") return;
    const t = setTimeout(() => setState((s) => addFees(s, randomFeeUsd())), (350 + Math.random() * 1300) / speed);
    return () => clearTimeout(t);
  }, [demo, speed, state.phase, state.fundedUsd]);

  // Viewer count drifts.
  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => setState((s) => ({ ...s, watching: Math.max(1, s.watching + Math.round((Math.random() - 0.35) * 14)) })), 2200);
    return () => clearInterval(t);
  }, [demo]);

  // Funded → the draw starts automatically after the hype countdown.
  useEffect(() => {
    if (state.phase !== "funded" || !demo) return;
    const t = setTimeout(() => {
      setState((s) => ({
        ...s,
        phase: "drawing",
        draw: {
          totalTickets: s.tickets,
          ticket: 1 + Math.floor(Math.random() * s.tickets),
          wallet: DEMO_WALLETS[Math.floor(Math.random() * DEMO_WALLETS.length)],
          walletTickets: Math.min(s.tickets, 40 + Math.floor(Math.random() * 1500)),
        },
      }));
    }, 5200 / speed);
    return () => clearTimeout(t);
  }, [demo, speed, state.phase]);

  // Winner → next drop opens.
  useEffect(() => {
    if (state.phase !== "winner" || !demo || !nextDrop) return;
    const t = setTimeout(() => setState((s) => openNextDrop(s, nextDrop)), WINNER_HOLD_MS / speed);
    return () => clearTimeout(t);
  }, [demo, speed, state.phase, nextDrop]);

  const finishDraw = useCallback(() => setState((s) => (s.phase === "drawing" ? recordWinner(s) : s)), []);

  const controls = {
    addUsd: (usd: number) => setState((s) => addFees(s, usd)),
    fundNow: () => setState((s) => addFees(s, s.drop.goalUsd - s.fundedUsd)),
    reset: () => setState({ ...initial, ...DEMO_START, history: demoHistory }),
    setSpeed,
  };

  return { state, demo, speed, nextDrop, finishDraw, controls };
}
