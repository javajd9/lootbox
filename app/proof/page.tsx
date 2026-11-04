import Link from "next/link";
import { HudSection } from "@/components/brand/Hud";
import { CLUSTER } from "@/lib/chain/solana";
import type { DropStatus } from "@/lib/data/types";
import { shortWallet, usd } from "@/lib/live/format";
import { dropSummaries, type DropSummary } from "@/lib/proofs/drops";
import "../legacy.css";

// Every drop's proof page, in one list. Read fresh on each visit.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Proof" };

const STATUS: Record<DropStatus, string> = {
  upcoming: "Not open yet",
  funding: "Pool filling",
  snapshotting: "Locking tickets",
  drawing: "Drawing",
  claiming: "Claim open",
  fulfilling: "Ordered · shipping",
  delivered: "Delivered",
  complete: "Complete",
};

function DropRow({ d }: { d: DropSummary }) {
  const opened = d.status !== "upcoming";
  const inner = (
    <>
      <span className="font-mono text-loot">{String(d.number).padStart(3, "0")}</span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{d.title}</span>
        <span className="hud">{usd(d.goalUsd)}</span>
      </span>
      <span className="hidden font-mono text-sm text-cream/80 md:block">{d.winner ? shortWallet(d.winner) : "—"}</span>
      <span className="hud whitespace-nowrap text-cream">{d.status === "claiming" && d.claimed ? "Claimed · ordering" : STATUS[d.status]}</span>
      <span className="hud hidden text-right md:block">{d.proofs ? `${d.proofs} proof${d.proofs === 1 ? "" : "s"}` : ""}</span>
      <span className="hud text-right text-loot">{opened ? "Check →" : ""}</span>
    </>
  );
  const cls = "grid grid-cols-[3rem_1fr_auto_auto] items-center gap-x-4 border-b border-line px-5 py-4 md:grid-cols-[3.5rem_1fr_7.5rem_10rem_6rem_4.5rem] md:px-6";
  return opened ? (
    <li>
      <Link href={`/proof/${d.id}`} className={`${cls} transition hover:bg-ink/40`}>
        {inner}
      </Link>
    </li>
  ) : (
    <li className={`${cls} text-cream/50`}>{inner}</li>
  );
}

export default async function ProofIndex() {
  const drops = await dropSummaries().catch((err) => {
    console.error("proof index", err);
    return null;
  });

  return (
    <HudSection index="04" label="The proof">
      <div className="space-y-10">
        <header>
          <p className="eyebrow">Proof of loot</p>
          <h1 className="display mt-3 text-5xl sm:text-7xl">Every drop, checked by you.</h1>
          <p className="mt-6 max-w-3xl text-cream/70">
            Each drop has its own proof page. Open one and your browser re-checks it against Solana and Reclaim directly: the
            money leaving the treasury, the order, the delivery, the winner&apos;s signature, and that nothing was edited after it
            was posted. See <Link className="underline" href="/docs/proofs">the 8 proofs</Link> for what each step proves.
          </p>
          {CLUSTER === "devnet" && (
            <p className="mt-6 max-w-3xl border-l-2 border-loot pl-4 text-sm text-cream/70">
              These are test drops on Solana&apos;s devnet. Their prizes are Zinc&apos;s sandbox test product, so nothing real is
              bought, but every proof page runs its checks against the real records. Real drops start at launch.
            </p>
          )}
        </header>

        <section>
          <div className="hidden grid-cols-[3.5rem_1fr_7.5rem_10rem_6rem_4.5rem] gap-x-4 px-6 pb-3 md:grid">
            <span className="hud">Drop</span>
            <span className="hud">Prize</span>
            <span className="hud">Winner</span>
            <span className="hud">Status</span>
            <span className="hud text-right">Published</span>
            <span />
          </div>
          {drops === null ? (
            <p className="border-y border-line py-6 text-cream/60">The drop list can&apos;t be loaded right now. Try again in a minute.</p>
          ) : drops.length === 0 ? (
            <p className="border-y border-line py-6 text-cream/60">No drops yet.</p>
          ) : (
            <ul className="border-t border-line">
              {drops.map((d) => (
                <DropRow key={d.id} d={d} />
              ))}
            </ul>
          )}
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-bold">Demo rehearsal (sample data)</p>
            <p className="text-sm text-cream/60">
              A finished drop with every proof filled in. Press <span className="text-cream">Try tampering</span> to watch a check fail.
            </p>
          </div>
          <Link href="/proof/DROP-000" className="btn-ghost">Open the demo</Link>
        </section>
      </div>
    </HudSection>
  );
}
