// Turns each poll of the engine's feed into what the homepage shows. When the drop on stage gets
// its winner, the draw plays first; the next drop takes over only after the winner has been shown.
import { txUrl } from "./format";
import type { LiveDrop, Trade } from "./useLiveDrop";
import type { LiveView } from "./view";

const round2 = (n: number) => Math.round(n * 100) / 100;
const KEEP_SEEN = 100;

// Each real trade since the last poll becomes a coin, oldest first. The ones already in the feed
// when the page loads only mark as seen, so a fresh visitor doesn't get twenty coins at once.
function newTrades(s: LiveDrop, v: LiveView, nextTradeId: () => number): { trades: Trade[]; seenFees: string[] } {
  const fees = v.fees ?? [];
  const seen = new Set(s.seenFees ?? []);
  const fresh = s.seenFees ? fees.filter((f) => !seen.has(f.signature)).reverse() : [];
  return {
    trades: fresh.map((f) => ({ id: nextTradeId(), usd: round2(f.feeUsd), tradeUsd: f.tradeUsd, side: f.side, url: txUrl(f.signature) })),
    seenFees: [...fees.map((f) => f.signature), ...(s.seenFees ?? []).filter((sig) => !fees.some((f) => f.signature === sig))].slice(0, KEEP_SEEN),
  };
}

// Every drawn drop, from the engine, so the ledger survives a reload. The drop on stage joins only
// once its draw has played, so the ledger never gives the winner away early.
const historyOf = (s: LiveDrop, v: LiveView) => (v.history ? v.history.filter((h) => h.id !== s.drop.id || s.revealedId === h.id) : s.history);

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
  if (!v.drop) return { ...s, history: historyOf(s, v) }; // nothing queued: still show every past drop

  const goalUsd = v.drop.goalCents / 100;
  const sameDrop = v.drop.id === s.drop.id;
  const funded = v.drop.stage === "snapshotting" || v.drop.stage === "drawing";
  const fundedUsd = funded ? goalUsd : Math.min(goalUsd, round2(v.poolCents / 100));
  const filling = sameDrop && s.phase === "filling";
  const gained = filling ? round2(fundedUsd - s.fundedUsd) : 0;
  // A coin per real trade when the feed has them; an older feed without trades gets one per gain.
  const fresh = newTrades(s, v, nextTradeId);
  const coins: Trade[] = v.fees ? (filling ? fresh.trades : []) : gained > 0 ? [{ id: nextTradeId(), usd: gained }] : [];

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
    // New fees since the last poll drop in as coins (a big one gets called out).
    trades: sameDrop ? [...s.trades, ...coins].slice(-8) : coins,
    seenFees: fresh.seenFees,
    lastWinner: w ? { dropId: w.id, number: w.number, title: w.title, wallet: w.wallet, ticket: w.ticket } : s.lastWinner,
    history: historyOf(s, v),
  };
}
