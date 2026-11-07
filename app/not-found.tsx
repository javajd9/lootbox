import type { Metadata } from "next";
import Link from "next/link";
import { HeroBackdrop } from "@/components/live/HeroBackdrop";

// Any address that isn't a page (and any missing drop under /proof) lands here: a raffle ticket
// that was never in the box, printed on the homepage's card stock and stamped void. The room and
// the ticket's cut are the homepage's; the backlight is turned most of the way down.
// (Next marks every 404 noindex itself.)
export const metadata: Metadata = { title: "Page not found" };

// A thin printed border inset on each part of the ticket, as on the homepage ticket.
function PrintedFrame() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-3.5 rounded-[10px] border-[1.5px] border-ink/15 sm:inset-[18px]" />;
}

export default function NotFound() {
  return (
    <section aria-label="Page not found" className="relative min-h-[calc(100svh-60px)] overflow-clip bg-ink">
      <HeroBackdrop />

      <div className="relative z-10 grid min-h-[inherit] place-items-center py-10">
        <div className="frame relative max-w-[1040px]">
          {/* backlight, dimmed: nothing on this ticket can win */}
          <div aria-hidden="true" className="pointer-events-none absolute -inset-x-[1%] -inset-y-[4%] opacity-40">
            <div className="h-full w-full animate-breathe rounded-[48px] bg-loot/40 blur-[80px] motion-reduce:animate-none" />
          </div>

          <div className="ticket-float animate-rise-in motion-reduce:animate-none">
            <div className="ticket ticket-paper relative grid text-ink [--stub:280px] max-lg:grid-rows-[auto_var(--stub)] lg:min-h-[460px] lg:grid-cols-[minmax(0,1fr)_var(--stub)]">
              {/* main part of the ticket */}
              <div className="relative flex min-w-0 flex-col justify-between gap-10 p-6 sm:p-9 lg:p-11">
                <PrintedFrame />
                <p className="t-title flex flex-wrap justify-between gap-x-6 gap-y-1 uppercase">
                  {/* on phones the header already carries the name */}
                  <span className="max-sm:hidden">LOOTBOX</span>
                  <span>Ticket 404</span>
                </p>

                <div>
                  <h1 className="t-head max-w-[14ch] text-balance">This ticket isn&apos;t in the box.</h1>
                  <p className="t-lead mt-5 max-w-[38ch] text-pretty text-ink/80">
                    Nothing lives at this address. The link may be mistyped, or it points at a page that was never printed.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-x-7 gap-y-3 max-sm:flex-col max-sm:items-stretch max-sm:text-center">
                  <Link href="/" className="button button-ink">Back to the live drop</Link>
                  <Link href="/proof" className="link t-small">Check a proof</Link>
                  <Link href="/docs" className="link t-small">How it works</Link>
                </div>
              </div>

              {/* the stub, stamped void */}
              <div className="relative flex flex-col items-center justify-center px-6 py-16">
                <PrintedFrame />
                <p className="absolute inset-x-0 top-7 text-center text-[13px] font-black uppercase tracking-[0.25em] text-ink/70">
                  Admit none
                </p>
                <p className="text-[88px] font-black leading-none tracking-[-0.04em] tabular-nums lg:text-[112px]">
                  <span className="sr-only">Error </span>404
                </p>
                {/* the rubber stamp lands once the ticket has settled, just catching the number */}
                <span
                  aria-hidden="true"
                  className="-mt-3 -rotate-12 animate-stamp rounded-md border-[5px] border-bad px-4 py-1.5 text-[40px] font-black uppercase leading-none tracking-[0.14em] text-bad opacity-90 mix-blend-multiply motion-reduce:animate-none lg:-mt-4 lg:text-[48px]"
                  style={{ animationDelay: "550ms" }}
                >
                  Void
                </span>
                <p className="absolute inset-x-0 bottom-7 text-center text-[13px] font-black uppercase tracking-[0.25em] text-ink/70">
                  No such page
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
