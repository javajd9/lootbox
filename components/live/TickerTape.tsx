"use client";

// A thin, always-moving line of what's happening right now: fees landing, tickets in the box,
// the latest winner, proofs on-chain. Carries the ticket's "live" feeling down the page.
import { CheckMark } from "@/components/brand/Logo";
import { dropNo, feeLabel, shortWallet } from "@/lib/live/format";
import { dropCode, isOnTheWay } from "@/lib/live/types";
import { useLive } from "./LiveProvider";

type Item = { key: string; text: React.ReactNode; gold?: boolean; check?: boolean };

export function TickerTape() {
  const { state, demo } = useLive();
  const { drop, fundedUsd, tickets, trades, history, phase } = state;
  const pct = Math.floor((fundedUsd / drop.goalUsd) * 100);
  const proofs = history.reduce((n, h) => n + Object.values(h.done).filter(Boolean).length, 0);
  const latest = history[0];

  const items: Item[] = [];
  if (!demo && fundedUsd === 0 && !latest) {
    items.push(
      { key: "d", text: `Drop ${dropNo(drop.number)} · ${drop.title}`, gold: true },
      { key: "o", text: "Pool opens at launch" },
      { key: "t", text: "1 ticket = 10,000 $LOOT" },
      { key: "s", text: "Draw starts the second the box fills" },
      { key: "c", text: "Don't trust. Check.", check: true },
    );
  } else {
    items.push({ key: "d", text: `Drop ${dropNo(drop.number)} · ${phase === "filling" ? `${pct}% funded` : phase}`, gold: true });
    for (const t of [...trades].reverse()) {
      const text = t.url ? (
        <a href={t.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
          {feeLabel(t)}
        </a>
      ) : (
        `+$${t.usd.toFixed(2)} fee in`
      );
      items.push({ key: `t${t.id}`, text, gold: true });
    }
    items.push({ key: "k", text: `${tickets.toLocaleString()} tickets in the box` });
    if (latest) {
      items.push({
        key: "w",
        text: (
          <>
            Drop {dropCode(latest)} won by <span className="normal-case tracking-normal text-cream">{shortWallet(latest.wallet)}</span>
          </>
        ),
        check: true,
      });
    }
    const onTheWay = history.filter(isOnTheWay).length;
    if (onTheWay) items.push({ key: "o", text: `${onTheWay} prize${onTheWay === 1 ? "" : "s"} on the way` });
    items.push({ key: "p", text: `${proofs} proofs on-chain`, check: true });
  }

  // Rendered twice so the loop is seamless.
  const row = (copy: number) =>
    items.map((it) => (
      <span key={`${copy}-${it.key}`} className={`flex shrink-0 items-center gap-2 px-6 ${it.gold ? "text-loot" : ""}`}>
        {it.check ? <CheckMark className="h-3.5 w-3.5" /> : <span className="h-1 w-1 rotate-45 bg-loot/60" />}
        {it.text}
      </span>
    ));

  return (
    <div className="group relative overflow-hidden border-y border-line bg-panel py-3 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
      <div className="hud flex w-max animate-marquee text-cream/70 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {row(0)}
        {row(1)}
      </div>
    </div>
  );
}
