"use client";

// Live state of the current drop, as every viewer sees it, from the drop engine's public feed
// (/api/live, checked every few seconds). This hook only keeps time: what each poll, the end of
// the reveal and the end of the winner's turn change is decided in ./fromView.
import { useCallback, useEffect, useRef, useState } from "react";
import { applyView, nextUp, revealWinner } from "./fromView";
import type { PastDrop } from "./types";
import type { LiveView } from "./view";

// What the stage is showing (see ./fromView for how it moves from one to the next).
export type Phase = "filling" | "funded" | "drawing" | "winner";

export interface Trade {
  id: number;
  usd: number; // the fee into the pool
  tradeUsd?: number; // the trade that paid it
  side?: "buy" | "sell";
  url?: string; // the trade's transaction
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
  drawAt?: string; // when the draw starts, after the pause that follows the pool filling
  upcoming?: boolean; // the drop hasn't opened yet
  revealedId?: string; // the drop whose draw has already played
  seenFees?: string[]; // trades already shown (or there before the page loaded), by signature
  history: PastDrop[]; // newest first
}

// How long the winner stays on stage before the next drop opens.
export const WINNER_HOLD_MS = 10_000;
const POLL_MS = 5_000;

let tradeId = 0;

export function useLiveDrop(initial: LiveDrop, upNext: StageDrop[]) {
  const [state, setState] = useState(initial);
  const [live, setLive] = useState(false);
  const latest = useRef<LiveView | null>(null);

  const nextDrop = upNext.find((d) => d.number === state.drop.number + 1);

  // The drop engine's feed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const view = res.ok ? ((await res.json()) as LiveView) : null;
        if (view) {
          latest.current = view;
          setLive(true);
          setState((s) => applyView(s, view, () => ++tradeId));
        }
      } catch {
        // Offline for a moment: keep showing the last known state.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // After the winner has been on stage, the engine's current drop takes over.
  useEffect(() => {
    if (!live || state.phase !== "winner") return;
    const t = setTimeout(() => setState((s) => nextUp(s, latest.current, () => ++tradeId)), WINNER_HOLD_MS);
    return () => clearTimeout(t);
  }, [live, state.phase]);

  const finishDraw = useCallback(() => setState((s) => revealWinner(s)), []);

  return { state, live, nextDrop, finishDraw };
}
