// Turns each poll of the engine's feed into what the homepage shows. When the drop on stage gets
// its winner, the draw plays first; the next drop takes over only after the winner has been shown.
import type { LiveDrop } from "./useLiveDrop";
import type { LiveView } from "./view";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function applyView(s: LiveDrop, v: LiveView, nextTradeId: () => number): LiveDrop {
  // A reveal, or the winner on stage, finishes before anything else changes.
  if (s.phase === "drawing" || s.phase === "winner") return s;

  const w = v.lastWinner;
  if (w && w.id === s.drop.id && s.revealedId !== s.drop.id && !s.upcoming) {
    return {
      ...s,
      phase: "drawing",
      fundedUsd: s.drop.goalUsd,
      revealedId: s.drop.id,
      draw: { ticket: w.ticket, totalTickets: w.totalTickets ?? s.tickets, wallet: w.wallet, walletTickets: w.walletTickets ?? 0 },
    };
  }
  if (!v.drop) return s;

  const goalUsd = v.drop.goalCents / 100;
  const sameDrop = v.drop.id === s.drop.id;
  const funded = v.drop.stage === "snapshotting" || v.drop.stage === "drawing";
  const fundedUsd = funded ? goalUsd : Math.min(goalUsd, round2(v.poolCents / 100));
  const gained = sameDrop && s.phase === "filling" ? round2(fundedUsd - s.fundedUsd) : 0;

  return {
    ...s,
    drop: { id: v.drop.id, number: v.drop.number, title: v.drop.title, goalUsd },
    upcoming: v.drop.stage === "upcoming",
    phase: funded ? "funded" : "filling",
    fundedUsd,
    fundedAt: v.drop.fundedAt,
    drawAt: v.drop.drawAt,
    tickets: v.drop.tickets ?? s.tickets,
    watching: 0, // no viewer count yet
    // New fees since the last poll drop in as a coin (a big one gets called out).
    trades: gained > 0 ? [...s.trades.slice(-7), { id: nextTradeId(), usd: gained }] : sameDrop ? s.trades : [],
    lastWinner: w ? { dropId: w.id, number: w.number, title: w.title, wallet: w.wallet, ticket: w.ticket } : s.lastWinner,
  };
}
