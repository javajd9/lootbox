import { LiveProvider } from "@/components/live/LiveProvider";
import { HeroTicket } from "@/components/live/HeroTicket";
import { TickerTape } from "@/components/live/TickerTape";
import { YourTickets } from "@/components/live/TicketCheck";
import { ProofLedger } from "@/components/live/ProofLedger";
import { InTheBox } from "@/components/home/InTheBox";
import { getDemoHistory, getDropQueue } from "@/lib/data/mock";
import type { StageDrop } from "@/lib/live/useLiveDrop";

// The homepage: the live raffle ticket, then the record of every drop, winner and proof.
// The ticket, ticker, ticket check and ledger all share one live feed. How it works lives in /docs.
export default function Home() {
  const [current, ...rest] = getDropQueue();
  const toStage = (d: typeof current): StageDrop => ({ id: d.id, number: Number(d.id.split("-")[1]), title: d.title, goalUsd: d.goalUsd });
  return (
    <>
      <LiveProvider
        initial={{ phase: "filling", upcoming: true, drop: toStage(current), fundedUsd: current.fundedUsd, tickets: 0, watching: 0, trades: [], history: [] }}
        upNext={rest.map(toStage)}
        demoHistory={getDemoHistory()}
      >
        <HeroTicket prizes={Object.fromEntries([current, ...rest].map((d) => [d.id, d.items]))} />
        <TickerTape />
        <YourTickets />
        <ProofLedger />
      </LiveProvider>
      <InTheBox drop={current} />
    </>
  );
}
