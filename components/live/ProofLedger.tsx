"use client";

// The homepage's record of every drop: headline numbers, the "On the way" board (every prize
// between draw and the winner's signature, one row each), and the list of completed drops.
// Reads the same live feed as the ticket, so a new winner lands on the board instantly.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckMark } from "@/components/brand/Logo";
import { HudSection } from "@/components/brand/Hud";
import { shortWallet, usd } from "@/lib/live/format";
import { PROOF_STEPS, dropCode, fmtDay, isFinished, isOnTheWay, nextStep, statusText, type PastDrop, type StepKey } from "@/lib/live/types";
import { AnimatedNumber } from "./AnimatedNumber";
import { useLive } from "./LiveProvider";

const proofHref = (d: PastDrop) => `/proof/${d.proofId ?? d.id}`;

function SampleChip() {
  return <span className="hud rounded-sm border border-line px-1.5 py-0.5 text-[9px]">Sample</span>;
}

// Funded → Drawn → … → Received. Vertical on phones, one horizontal track on wider screens.
function ProofTracker({ done, activeKey, activeNote }: { done: PastDrop["done"]; activeKey?: StepKey; activeNote?: string }) {
  return (
    <ol className="grid gap-0 md:grid-cols-8">
      {PROOF_STEPS.map(([key, label], i) => {
        const at = done[key];
        const nextDone = i < PROOF_STEPS.length - 1 && !!done[PROOF_STEPS[i + 1][0]];
        const active = !at && key === activeKey;
        return (
          <li key={key} className="relative flex gap-4 pb-6 last:pb-0 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center">
            {i < PROOF_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px md:left-1/2 md:top-[13px] md:h-px md:w-full ${
                  nextDone ? "bg-loot" : "bg-line"
                }`}
              />
            )}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-ink ${
                at || active ? "border-loot" : "border-line"
              }`}
            >
              {at ? (
                <CheckMark className="h-4 w-4" />
              ) : active ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-loot" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
              )}
            </span>
            <span className="flex flex-col md:items-center">
              <span className={`hud ${at ? "text-cream" : active ? "text-loot" : ""}`}>{label}</span>
              <span className="mt-0.5 font-mono text-[11px] text-mute">{at ? fmtDay(at) : active ? activeNote : "—"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Eight small segments: the same track, compressed to fit in a row.
function PipTrack({ d }: { d: PastDrop }) {
  const next = nextStep(d);
  return (
    <span className="flex gap-1" aria-label={`${Object.values(d.done).filter(Boolean).length} of ${PROOF_STEPS.length} steps proven`}>
      {PROOF_STEPS.map(([k]) => (
        <span
          key={k}
          className={`h-1.5 w-3 sm:w-4 ${d.done[k] ? "bg-loot" : k === next ? "animate-pulse bg-loot/40" : "bg-line"}`}
        />
      ))}
    </span>
  );
}

function MiniTicket({ d }: { d: PastDrop }) {
  return (
    <div
      className="w-full max-w-[15rem] bg-cream px-5 py-4 text-ink shadow-[0_20px_60px_rgba(227,168,46,0.18)]"
      style={{
        WebkitMask: "radial-gradient(circle 10px at 0 64%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 10px at 100% 64%, transparent 98%, #000) right / 51% 100% no-repeat",
        mask: "radial-gradient(circle 10px at 0 64%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 10px at 100% 64%, transparent 98%, #000) right / 51% 100% no-repeat",
      }}
    >
      <p className="font-mono text-[9px] uppercase tracking-hud text-ink/50">Drop {dropCode(d)} · winning ticket</p>
      <p className="mt-2 font-mono text-4xl font-medium leading-none">#{d.ticket.toLocaleString("en-US")}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-hud text-ink/50">of {d.totalTickets.toLocaleString("en-US")}</p>
      <div className="my-3 border-t-2 border-dashed border-ink/20" />
      <p className="font-mono text-base">{shortWallet(d.wallet)}</p>
    </div>
  );
}

// The full receipt for one prize, shown when its row is opened.
function ReceiptDetail({ d }: { d: PastDrop }) {
  const odds = (d.walletTickets / d.totalTickets) * 100;
  const next = nextStep(d);
  return (
    <div className="animate-rise-in border-t border-line bg-ink/40">
      <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[auto_1fr] md:items-center">
        <MiniTicket d={d} />
        <div>
          <p className="hud">Winner</p>
          <p className="mt-2 font-mono text-3xl font-medium sm:text-4xl">{shortWallet(d.wallet)}</p>
          <p className="mt-3 text-cream/80">
            Won the <span className="font-bold text-cream">{d.title}</span> ({usd(d.valueUsd)}) holding{" "}
            <span className="text-loot">{d.walletTickets.toLocaleString("en-US")} tickets</span>, a{" "}
            {odds < 0.01 ? "<0.01" : odds.toFixed(2)}% chance.
          </p>
        </div>
      </div>
      <div className="border-t border-line p-6 sm:px-8">
        <ProofTracker done={d.done} activeKey={next} activeNote={next === "claimed" ? "Claim open" : "In progress"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-4 sm:px-8">
        <p className="hud">
          {Object.values(d.done).filter(Boolean).length} of {PROOF_STEPS.length} steps proven
        </p>
        <Link href={proofHref(d)} className="btn-loot px-4 py-2 text-xs">Verify every proof →</Link>
      </div>
    </div>
  );
}

function OnTheWay({ prizes }: { prizes: PastDrop[] }) {
  const newest = prizes[0]?.id;
  const [open, setOpen] = useState<string | undefined>(newest);
  // A freshly drawn prize opens itself so the moment carries down from the ticket.
  useEffect(() => setOpen(newest), [newest]);

  return (
    <ul className="border border-line bg-panel">
      {prizes.map((d) => {
        const isOpen = open === d.id;
        return (
          <li key={d.id} className="animate-rise-in border-b border-line last:border-b-0">
            <button
              onClick={() => setOpen(isOpen ? undefined : d.id)}
              aria-expanded={isOpen}
              className="grid w-full grid-cols-[3rem_1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition hover:bg-ink/40 md:grid-cols-[3.5rem_1fr_7.5rem_auto_15.5rem_1rem] md:px-6"
            >
              <span className="font-mono text-loot">{dropCode(d)}</span>
              <span className="min-w-0">
                <span className="block truncate font-bold">{d.title}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="hud">{usd(d.valueUsd)}</span>
                  {d.sample && <SampleChip />}
                </span>
              </span>
              <span className="hidden font-mono text-sm text-cream/80 md:block">{shortWallet(d.wallet)}</span>
              <span className="col-start-2 row-start-2 md:col-start-auto md:row-start-auto">
                <PipTrack d={d} />
              </span>
              <span className="hud col-start-2 row-start-3 text-cream md:col-start-auto md:row-start-auto md:whitespace-nowrap md:tracking-[0.16em]">
                {statusText(d)}
              </span>
              <span className={`row-span-3 text-loot transition md:row-span-1 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true">
                ▾
              </span>
            </button>
            {isOpen && <ReceiptDetail d={d} />}
          </li>
        );
      })}
    </ul>
  );
}

// Before anything is on the way: show the current drop's track, so visitors see what will be proven.
function NothingOnTheWay({ pct, anyCompleted }: { pct: number; anyCompleted: boolean }) {
  return (
    <div className="border border-line bg-panel">
      <div className="p-6 sm:p-8">
        <p className="display text-2xl sm:text-3xl">
          {anyCompleted ? "Nothing on the way right now." : "No winners yet."}
        </p>
        <p className="mt-2 max-w-xl text-cream/70">
          Every step of each delivery will be proven here, from the money coming in to the winner signing for their prize.
        </p>
      </div>
      <div className="border-t border-line p-6 sm:px-8">
        <ProofTracker done={{}} activeKey="funded" activeNote={`${pct}%`} />
      </div>
    </div>
  );
}

function Completed({ drops }: { drops: PastDrop[] }) {
  if (drops.length === 0) {
    return <p className="border-t border-line py-6 text-cream/60">The first completed drop, signed for by its winner, will be listed here.</p>;
  }
  return (
    <ul className="border-t border-line">
      {drops.map((d) => (
        <li
          key={d.id}
          className="grid grid-cols-[3rem_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-5 py-4 md:grid-cols-[3.5rem_1fr_7.5rem_7rem_9rem_4.5rem] md:px-6"
        >
          <span className="font-mono text-loot">{dropCode(d)}</span>
          <span className="min-w-0">
            <span className="block truncate font-bold">{d.title}</span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className="hud">{usd(d.valueUsd)}</span>
              {d.sample && <SampleChip />}
            </span>
            <span className="mt-1 block font-mono text-xs text-cream/60 md:hidden">
              {shortWallet(d.wallet)} · #{d.ticket.toLocaleString("en-US")}
            </span>
          </span>
          <span className="hidden font-mono text-sm md:block">{shortWallet(d.wallet)}</span>
          <span className="hidden font-mono text-sm text-cream/70 md:block">#{d.ticket.toLocaleString("en-US")}</span>
          {d.done.received ? (
            <span className="hud flex items-center gap-1.5 text-loot">
              <CheckMark className="h-3.5 w-3.5" /> Signed {fmtDay(d.done.received)}
            </span>
          ) : (
            <span className="hud text-cream/60">Delivered{d.done.delivered && ` ${fmtDay(d.done.delivered)}`} · unsigned</span>
          )}
          <Link href={proofHref(d)} className="hud col-span-3 text-loot hover:text-cream md:col-span-1 md:text-right">
            Proof →
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProofLedger() {
  const { state } = useLive();
  const { drop, fundedUsd, history } = state;
  const pct = Math.floor((fundedUsd / drop.goalUsd) * 100);
  const onTheWay = history.filter(isOnTheWay);
  const completed = history.filter(isFinished);
  const delivered = history.filter((h) => h.done.delivered);
  const stats = [
    { label: "Prizes delivered", value: delivered.length },
    { label: "Given away", value: delivered.reduce((n, h) => n + h.valueUsd, 0), money: true },
    { label: "On the way", value: onTheWay.length },
    { label: "Proofs on-chain", value: history.reduce((n, h) => n + Object.values(h.done).filter(Boolean).length, 0) },
  ];

  return (
    <HudSection id="proof" index="01" label="Proof of loot">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Proof of loot</p>
          <h2 className="display mt-3 text-5xl sm:text-7xl">
            Every drop.
            <br />
            Every winner.
            <br />
            <span className="text-loot">Proven.</span>
          </h2>
        </div>
        <Link href="/docs/proofs" className="hud text-cream/70 underline decoration-loot underline-offset-4 hover:text-loot">
          How the proofs work →
        </Link>
      </div>

      <dl className="mt-14 grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-ink px-5 py-6">
            <dt className="hud">{s.label}</dt>
            <dd className="display mt-2 text-4xl sm:text-5xl">
              <AnimatedNumber value={s.value} format={(n) => (s.money ? usd(n) : Math.round(n).toLocaleString("en-US"))} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-16 flex items-baseline justify-between gap-4">
        <h3 className="display text-3xl sm:text-4xl">On the way</h3>
        {onTheWay.length > 0 && (
          <p className="hud">
            {onTheWay.length} prize{onTheWay.length === 1 ? "" : "s"} · tap one for its proofs
          </p>
        )}
      </div>
      <div className="mt-6">
        {onTheWay.length > 0 ? <OnTheWay prizes={onTheWay} /> : <NothingOnTheWay pct={pct} anyCompleted={completed.length > 0} />}
      </div>

      <h3 className="display mt-20 text-3xl sm:text-4xl">Completed</h3>
      <p className="mt-2 text-sm text-cream/60">
        Delivered, and signed for by the winner&apos;s own wallet, or closed 14 days after delivery without a signature.
      </p>
      <div className="mt-6">
        <Completed drops={completed} />
      </div>
      <p className="mt-8">
        <Link href="/proof" className="hud text-cream/70 underline decoration-loot underline-offset-4 hover:text-loot">
          Every drop&apos;s proof page →
        </Link>
      </p>
    </HudSection>
  );
}
