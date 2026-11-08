// The drop queue on /docs/drops, read from the same list the engine runs (lib/engine/drops), so the
// page shows exactly what's queued. Always the mainnet queue: the devnet test drops are never shown.
import { dropQueue } from "@/lib/engine/drops";
import { Table } from "./DocsBlocks";

const code = (n: number) => String(n).padStart(3, "0");
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

export function DropQueue() {
  const drops = dropQueue("mainnet-beta");
  const last = drops.at(-1);
  return (
    <Table
      head={["Drop", "Prize", "Pool goal", "Opens"]}
      rows={[
        ...drops.map((d, i) => [
          <strong key="n" className="font-mono font-bold text-cream">
            {code(d.number)}
          </strong>,
          <span key="p">
            <strong className="font-bold text-cream">{d.title}</strong>
            <span className="block text-cream/60">{d.prize?.length ? d.prize.map((p) => p.name).join(", ") : "Chosen and listed before its pool fills"}</span>
          </span>,
          usd(d.goalCents),
          i === 0 ? "At launch" : `When Drop ${code(drops[i - 1].number)} is drawn`,
        ]),
        ...(last
          ? [
              [
                <strong key="n" className="font-mono font-bold text-loot">
                  {code(last.number + 1)} →
                </strong>,
                <span key="p" className="text-cream/60">
                  Added to the queue before Drop {code(last.number)} is drawn
                </span>,
                "",
                `When Drop ${code(last.number)} is drawn`,
              ],
            ]
          : []),
      ]}
    />
  );
}
