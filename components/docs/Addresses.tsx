// The address tables on /docs/addresses, filled from the settings the engine runs on
// (lib/config/addresses). Until the site is on mainnet, every row says when it will be published.
import { explorerAccount } from "@/lib/chain/solana";
import { publishedAddresses } from "@/lib/config/addresses";

function Address({ value, pending }: { value?: string; pending: string }) {
  if (!value) return <span className="text-mute">{pending}</span>;
  return (
    <a
      href={explorerAccount(value)}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[13px] text-loot underline decoration-loot/40 underline-offset-4 hover:decoration-loot"
    >
      {value}
    </a>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="my-8 overflow-x-auto border-y border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="hud whitespace-nowrap border-b border-line py-3 pr-6 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="border-b border-line py-3 pr-6 align-top leading-6 text-cream/80 [tr:last-child_&]:border-b-0">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const what = (label: string) => <strong className="font-bold text-cream">{label}</strong>;

export function LootboxAddresses() {
  const a = publishedAddresses();
  return (
    <Table
      head={["What", "Address", "What to check"]}
      rows={[
        [what("$LOOT token"), <Address key="t" value={a?.token} pending="Published at launch" />, "The mint on pump.fun matches this exactly"],
        [what("Treasury"), <Address key="tr" value={a?.treasury} pending="Published before launch" />, "Launches $LOOT, so pump.fun's creator fees go to it. Holds the pool"],
        [
          what("Purchasing account"),
          <Address key="p" value={a?.purchasing} pending="Published before launch" />,
          "Receives the prize's worth in USDC from the treasury the moment a pool fills (the Paid step)",
        ],
        [
          what("Proof publisher"),
          <Address key="o" value={a?.publisher} pending="Published before launch" />,
          "Signs every fingerprint: snapshots, ticket lists, winners, address fingerprints and proofs",
        ],
      ]}
    />
  );
}

export function ExcludedAddresses() {
  const a = publishedAddresses();
  const team = a?.team.length ? (
    <span className="flex flex-col gap-1">
      {a.team.map((w) => (
        <Address key={w} value={w} pending="" />
      ))}
    </span>
  ) : (
    <span className="text-mute">Published before launch</span>
  );
  return (
    <Table
      head={["Wallet", "Address"]}
      rows={[
        ["pump.fun bonding curve", <Address key="c" value={a?.bondingCurve} pending="Published at launch" />],
        ["Liquidity pool (PumpSwap)", <Address key="l" value={a?.pool} pending="Published at launch" />],
        ["Team and dev wallets", team],
        ["Treasury, purchasing account and proof publisher", "As above"],
        ["Any account owned by a program (other pools, vaults)", "Every address off the ed25519 curve: it can't sign a claim"],
      ]}
    />
  );
}
