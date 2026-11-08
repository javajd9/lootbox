"use client";

// The first screen is the raffle ticket every holder owns, printed on cream and lit from behind
// (the light warms as the pool fills). The live prize pool is printed on it; its stub holds the
// LOOTBOX box filling with gold. Every fee drops a coin into the box; big buys, milestones and the
// final stretch each get a moment. When the pool fills, the same ticket becomes the winning ticket.
// Once it scrolls away, the pool moves into the header so it stays in sight.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { RULES } from "@/lib/config/rules";
import { coinPx, dropNo, feeLabel, shortWallet, usd } from "@/lib/live/format";
import { WINNER_HOLD_MS, type DrawResult, type Trade } from "@/lib/live/useLiveDrop";
import type { PrizeItem } from "@/lib/data/types";
import type { OfficialLinks } from "@/lib/config/links";
import { CopyAddress } from "@/components/brand/CopyAddress";
import { AnimatedNumber } from "./AnimatedNumber";
import { FillBox } from "./FillBox";
import { HeroBackdrop } from "./HeroBackdrop";
import { useLive } from "./LiveProvider";

const MILESTONES: [number, string][] = [
  [0.25, "A quarter full"],
  [0.5, "Halfway"],
  [0.75, "Three quarters"],
  [0.9, "Final stretch"],
];
const WHALE_USD = 50;
const per = RULES.tokensPerTicket.toLocaleString("en-US");
const reducedMotion = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Countdown({ from }: { from: number }) {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (n <= 1) return;
    const t = setTimeout(() => setN(n - 1), 1000);
    return () => clearTimeout(t);
  }, [n]);
  return (
    <span key={n} className="inline-block min-w-[0.7em] animate-count-in tabular-nums">
      {n}
    </span>
  );
}

// The winning number rolls and locks one digit at a time, then the wallet holding it is revealed.
// The number comes from the on-chain randomness; this only reveals it.
const DIGITS = "0123456789";
function RollingDigit({ value, locked }: { value: number; locked: boolean }) {
  return (
    <span className="relative inline-block h-[0.9em] w-[0.6em] overflow-hidden align-top">
      {locked ? (
        <span className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-out" style={{ transform: `translateY(-${value * 0.9}em)` }}>
          {DIGITS.split("").map((d) => (
            <span key={d} className="h-[0.9em] leading-[0.9]">{d}</span>
          ))}
        </span>
      ) : (
        <span className="absolute inset-x-0 top-0 flex animate-roll flex-col motion-reduce:animate-none">
          {(DIGITS + DIGITS).split("").map((d, i) => (
            <span key={i} className="h-[0.9em] leading-[0.9] opacity-60">{d}</span>
          ))}
        </span>
      )}
    </span>
  );
}

function DrawReveal({ draw, onDone }: { draw: DrawResult; onDone: () => void }) {
  const width = String(draw.totalTickets).length;
  const digits = String(draw.ticket).padStart(width, "0").split("").map(Number);
  const [locked, setLocked] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const first = 1200;
    const step = 700;
    digits.forEach((_, i) => timers.push(setTimeout(() => setLocked(i + 1), first + i * step)));
    const all = first + (digits.length - 1) * step;
    timers.push(setTimeout(() => setRevealed(true), all + 800));
    timers.push(setTimeout(onDone, all + 2600));
    return () => timers.forEach(clearTimeout);
  }, [draw.ticket]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per draw

  return (
    <div>
      <p className="t-lead font-bold">Winning ticket</p>
      <p className="t-display mt-2">
        {/* screen readers hear the final number once, not the rolling strips */}
        <span className="sr-only" aria-live="polite">
          {locked === digits.length ? `Ticket ${draw.ticket.toLocaleString("en-US")}` : "Drawing"}
        </span>
        <span aria-hidden="true">
          {digits.map((d, i) => (
            <span key={i}>
              {i > 0 && (digits.length - i) % 3 === 0 && <span>,</span>}
              <RollingDigit value={d} locked={i < locked} />
            </span>
          ))}
        </span>
      </p>
      <p className="t-lead mt-3">of {draw.totalTickets.toLocaleString("en-US")} tickets in the box</p>
      <p className="t-title mt-6">
        Held by{" "}
        <span className={`inline-block transition duration-500 ${revealed ? "" : "opacity-30 blur-[6px]"}`}>
          {revealed ? shortWallet(draw.wallet) : "????…????"}
        </span>
      </p>
    </div>
  );
}

// Once the ticket has scrolled away, the live pool moves into the header bar, so it stays in sight
// on every screen without covering anything.
function useOutOfView(el: React.RefObject<HTMLElement>) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!el.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setOut(!e.isIntersecting), { threshold: 0.15 });
    io.observe(el.current);
    return () => io.disconnect();
  }, [el]);
  return out;
}

function HeaderPool({ phase, number, title, pct, funded, goal }: { phase: string; number: number; title: string; pct: number; funded: number; goal: number }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("header-live")), []);
  if (!slot) return null;
  return createPortal(
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" })}
      className="flex animate-rise-in items-center gap-3 text-left text-base motion-reduce:animate-none"
      aria-label="Back to the live drop"
    >
      <span className="hidden font-bold lg:inline">Drop {dropNo(number)}, {title}</span>
      {phase === "filling" ? (
        <>
          <span className="whitespace-nowrap tabular-nums">
            <AnimatedNumber value={funded} format={usd} /> <span className="text-cream/70">of {usd(goal)}</span>
          </span>
          <span className="hidden h-2 w-24 bg-panel lg:block" aria-hidden="true">
            <span className="block h-full bg-loot transition-[width] duration-700" style={{ width: `${Math.max(2, pct * 100)}%` }} />
          </span>
        </>
      ) : (
        <span className="font-bold text-loot">{phase === "winner" ? "We have a winner" : "Drawing now"}</span>
      )}
    </button>,
    slot,
  );
}

// A thin printed border inset on each part of the ticket, the way tickets are printed.
function PrintedFrame() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-3.5 rounded-[10px] border-[1.5px] border-ink/15 sm:inset-[18px]" />;
}

// A barcode for the stub. Purely decorative, but stable per drop so it doesn't change on reload.
function Barcode({ seed }: { seed: string }) {
  const bars: number[] = [];
  let h = 2166136261;
  for (let i = 0; i < 44; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i % seed.length) ^ i, 16777619) >>> 0;
    bars.push(1 + (h % 3));
  }
  return (
    <span aria-hidden="true" className="flex h-8 items-stretch gap-[2px] opacity-85">
      {bars.map((w, i) => (
        <span key={i} className="bg-ink" style={{ width: w }} />
      ))}
    </span>
  );
}

// The prizes, tipped into the ticket like small plates (wide screens, where the ticket has room).
function Plates({ items }: { items: PrizeItem[] }) {
  const pics = items.filter((i) => i.image);
  if (!pics.length) return null;
  // Share of the row each picture may take, so the group never runs past the tear line.
  const sizes = ["h-52 basis-[36%]", "h-36 basis-[40%]", "h-32 basis-[28%]"];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute right-11 top-1/2 hidden w-[30%] max-w-[340px] -translate-y-1/2 items-end xl:flex">
      {pics.map((it, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- small static cutouts
        <img key={it.productId} src={it.image} alt="" width={240} height={240} className={`${sizes[i % 3]} min-w-0 object-contain ${i ? "-ml-4" : ""}`} />
      ))}
    </div>
  );
}

export function HeroTicket({ prizes, links }: { prizes: Record<string, PrizeItem[]>; links: OfficialLinks }) {
  const { state, live, nextDrop, finishDraw } = useLive();
  const { phase, drop, fundedUsd, tickets, watching, trades, draw, lastWinner } = state;
  const pct = Math.min(1, fundedUsd / drop.goalUsd);
  const toGo = Math.max(0, drop.goalUsd - fundedUsd);
  const notOpen = state.upcoming ?? (fundedUsd === 0 && !lastWinner);
  // The draw starts when the engine's pause ends.
  const untilDraw = state.drawAt ? Math.max(1, Math.ceil((Date.parse(state.drawAt) - Date.now()) / 1000)) : 5;
  const final = phase === "filling" && pct >= 0.9;

  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrolledAway = useOutOfView(cardRef);

  // Every fee drops a coin into the box, sized by the fee; a big one drops three and shakes the
  // ticket. Live, each coin is one real trade, labelled with what it paid and links to it.
  const lastTrade = useRef(0);
  const [coins, setCoins] = useState<{ id: number; x: number; px: number }[]>([]);
  const [splash, setSplash] = useState(0);
  const [label, setLabel] = useState<(Trade & { big: boolean }) | null>(null);
  useEffect(() => {
    const fresh = trades.filter((t) => t.id > lastTrade.current);
    if (!fresh.length) return;
    lastTrade.current = fresh[fresh.length - 1].id;
    // Several trades in one poll land one after another.
    fresh.forEach((t, i) => setTimeout(() => dropCoin(t), i * 260));
  }, [trades]); // eslint-disable-line react-hooks/exhaustive-deps -- dropCoin only sets state

  function dropCoin(t: Trade) {
    const big = t.usd >= WHALE_USD;
    const px = coinPx(t.usd);
    const born = Array.from({ length: big ? 3 : 1 }, (_, i) => ({ id: t.id * 10 + i, x: Math.round((Math.random() - 0.5) * 140), px }));
    setCoins((c) => [...c.slice(-11), ...born]);
    const ids = new Set(born.map((b) => b.id));
    setTimeout(() => setSplash((s) => s + 1), 700);
    setTimeout(() => setCoins((c) => c.filter((x) => !ids.has(x.id))), 1100);
    if (t.tradeUsd !== undefined || big) {
      setLabel({ ...t, big });
      setTimeout(() => setLabel((l) => (l?.id === t.id ? null : l)), 2500);
    }
    if (big && !reducedMotion()) {
      innerRef.current?.animate(
        [{ transform: "translate(0,0)" }, { transform: "translate(-5px,2px)" }, { transform: "translate(5px,-2px)" }, { transform: "translate(0,0)" }],
        { duration: 380, easing: "ease-in-out" },
      );
    }
  }

  // Crossing 25 / 50 / 75 / 90% prints a word on the stub.
  const prevPct = useRef(pct);
  const [milestone, setMilestone] = useState<{ key: number; label: string } | null>(null);
  useEffect(() => {
    const prev = prevPct.current;
    prevPct.current = pct;
    // Only real progress counts: not the jump from $0 when the live data first arrives.
    if (phase !== "filling" || pct <= prev || pct - prev > 0.3) return;
    const hit = MILESTONES.filter(([m]) => prev < m && pct >= m).at(-1);
    if (!hit) return;
    const key = Date.now();
    setMilestone({ key, label: hit[1] });
    setTimeout(() => setMilestone((m) => (m?.key === key ? null : m)), 2800);
  }, [pct, phase]);

  const stubWord = phase === "filling" ? `${Math.floor(pct * 100)}% full` : phase === "funded" ? "Full" : phase === "drawing" ? "Drawing" : "Won";

  return (
    <section aria-label="Live drop" className="hero relative min-h-[calc(100svh-60px)] overflow-clip bg-ink lg:h-[calc(100svh-60px)] lg:min-h-[640px]">
      <HeroBackdrop />
      {phase === "funded" && <div className="pointer-events-none absolute inset-0 z-20 animate-flash bg-loot" />}
      {scrolledAway && (
        <HeaderPool phase={phase} number={drop.number} title={drop.title} pct={pct} funded={fundedUsd} goal={drop.goalUsd} />
      )}

      <div className="hero-ticket relative z-30 grid min-h-[inherit] place-items-center py-6 lg:h-full">
        <div className="frame relative">
          {/* backlight: the ticket glows from behind, brighter as the pool fills */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-[1%] -inset-y-[4%] transition-opacity duration-1000"
            style={{ opacity: 0.4 + (phase === "filling" ? pct : 1) * 0.6 }}
          >
            <div className="h-full w-full animate-breathe rounded-[48px] bg-loot/40 blur-[80px] motion-reduce:animate-none" />
          </div>
          <div className="ticket-float">
            <div
              ref={cardRef}
              className="ticket ticket-paper relative grid text-ink max-lg:min-h-[66svh] max-lg:grid-rows-[auto_var(--stub)] lg:aspect-[2.2/1] lg:min-h-[540px] lg:grid-cols-[minmax(0,1fr)_var(--stub)]"
            >
              {/* main part of the ticket */}
              <div ref={innerRef} className="relative flex min-w-0 flex-col justify-between gap-8 p-6 sm:p-9 lg:p-11">
                <PrintedFrame />
                <Plates items={prizes[drop.id] ?? []} />
                <h1 className="t-title flex flex-wrap justify-between gap-x-6 gap-y-1 uppercase">
                  {/* on phones the header already carries the name, so the title keeps to two lines */}
                  <span className="max-sm:hidden">LOOTBOX</span>
                  <span>Drop {dropNo(drop.number)}</span>
                  <span key={drop.id}>{drop.title}</span>
                </h1>

                <div className="relative">
                  {phase === "filling" && (
                    <>
                      <p className={`t-display origin-left ${final ? "animate-heartbeat motion-reduce:animate-none" : ""}`}>
                        <AnimatedNumber key={drop.id} value={fundedUsd} format={usd} />
                      </p>
                      <p className="t-lead mt-5">
                        <strong>
                          <AnimatedNumber key={drop.id} value={toGo} format={usd} /> to go
                        </strong>{" "}
                        of the {usd(drop.goalUsd)} prize pool
                      </p>
                      {label && (
                        <p key={label.id} className={`t-lead absolute -top-8 left-0 animate-float-off font-bold motion-reduce:animate-none ${label.big ? "text-[1.3em]" : ""}`}>
                          {label.url ? (
                            <a href={label.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {feeLabel(label)}
                            </a>
                          ) : (
                            <>+{usd(label.usd)} whale buy</>
                          )}
                        </p>
                      )}
                      <p className="t-lead mt-5 max-w-[36ch] text-pretty text-ink/80">
                        Hold $LOOT to get tickets. The second this pool fills, one ticket wins the {drop.title}, live.
                      </p>
                      {lastWinner && (
                        <p className="t-small mt-4">
                          <Link href={`/proof/${lastWinner.dropId}`} className="link">
                            Drop {dropNo(lastWinner.number)}, {lastWinner.title}: won by {shortWallet(lastWinner.wallet)}. See the proof
                          </Link>
                        </p>
                      )}
                    </>
                  )}

                  {phase === "funded" && (
                    <>
                      <p className="t-display">Funded.</p>
                      <p className="t-title mt-4">
                        Drawing in <Countdown key={state.drawAt} from={untilDraw} />
                      </p>
                      <p className="t-lead mt-4">Asking Solana for a random number. {tickets.toLocaleString("en-US")} tickets are locked in.</p>
                    </>
                  )}

                  {phase === "drawing" && draw && <DrawReveal draw={draw} onDone={finishDraw} />}

                  {phase === "winner" && draw && (
                    <>
                      <p className="t-head max-w-[16ch]">
                        {shortWallet(draw.wallet)} wins.
                      </p>
                      <p className="t-lead mt-4 max-w-[40ch]">
                        Ticket #{draw.ticket.toLocaleString("en-US")} of {draw.totalTickets.toLocaleString("en-US")} wins the {drop.title}. The wallet held{" "}
                        {draw.walletTickets.toLocaleString("en-US")} tickets, a {((draw.walletTickets / draw.totalTickets) * 100).toFixed(2)}% chance.
                      </p>
                      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                        <Link href={`/proof/${drop.id}`} className="button button-ink">Verify the draw</Link>
                        <Link href={`/claim?${live ? "live&" : ""}drop=${encodeURIComponent(drop.id)}`} className="link">Won? Claim your prize</Link>
                      </div>
                      {nextDrop && (
                        <p className="t-small mt-5">
                          Drop {dropNo(nextDrop.number)}, {nextDrop.title}, opens in <Countdown from={Math.round(WINNER_HOLD_MS / 1000)} />
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="grid items-center gap-4 max-sm:text-center sm:grid-cols-[1fr_auto]">
                  <p className="t-small text-ink/75">1 ticket for every {per} $LOOT you hold</p>
                  {/* pump.fun once the coin is live on mainnet; until then, where its address will be published */}
                  <Link
                    href={links.buy.href}
                    {...(links.buy.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="button max-sm:order-first max-sm:w-full sm:justify-self-end"
                  >
                    Buy $LOOT
                  </Link>
                </div>
                {/* the contract address: here on smaller screens; under the ticket on wide ones, where the ticket's shape is fixed */}
                {links.mint && (
                  <div className="mt-4 flex max-sm:justify-center sm:justify-end lg:hidden">
                    <CopyAddress address={links.mint} onLight />
                  </div>
                )}
              </div>

              {/* the stub: the box filling with gold, torn off along the perforation */}
              <div
                className={`relative flex flex-col items-center justify-center gap-4 px-6 py-16 transition-colors duration-700 ${
                  final || phase === "funded" ? "bg-loot" : ""
                }`}
              >
                <PrintedFrame />
                <p className="absolute inset-x-0 top-7 text-center text-[13px] font-black uppercase tracking-[0.25em] text-ink/70">
                  Admit one
                </p>
                {milestone && (
                  <p key={milestone.key} className="t-title absolute inset-x-4 top-14 animate-milestone text-center motion-reduce:animate-none">
                    {milestone.label}
                  </p>
                )}
                <div className="relative">
                  <FillBox
                    pct={phase === "filling" ? pct : 1}
                    complete={phase !== "filling"}
                    shaking={phase === "drawing"}
                    splash={splash}
                    className="h-[150px] w-[150px] lg:h-[190px] lg:w-[190px]"
                  />
                  <div className="pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden="true">
                    {coins.map((c) => (
                      <span
                        key={c.id}
                        className="absolute left-1/2 top-[38%] animate-coin rounded-full bg-loot ring-[3px] ring-ink"
                        style={{ "--x": `${c.x}px`, width: c.px, height: c.px, marginLeft: -c.px / 2 } as React.CSSProperties}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-center">
                  <p className="t-title">{stubWord}</p>
                  {!notOpen && (
                    <p className="t-small mt-2">
                      {tickets.toLocaleString("en-US")} tickets in the box
                      {watching > 0 && <> · {watching.toLocaleString("en-US")} watching</>}
                    </p>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-7 flex flex-col items-center gap-1.5">
                  <Barcode seed={`LOOTBOX-${drop.id}`} />
                  <p className="text-[11px] font-bold tracking-[0.2em] text-ink/60 tabular-nums">LBX · {dropNo(drop.number)} · 2026</p>
                </div>
              </div>
            </div>
          </div>
          {links.mint && (
            <div className="absolute inset-x-0 top-full mt-3 hidden justify-center lg:flex">
              <CopyAddress address={links.mint} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
