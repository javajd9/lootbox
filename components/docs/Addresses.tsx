// The address tables on /docs/addresses, filled from the settings the engine runs on
// (lib/config/addresses). An address that isn't set yet shows as not published.
import { explorerAccount } from "@/lib/chain/solana";
import { publishedAddresses } from "@/lib/config/addresses";
import { Table } from "./DocsBlocks";

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

const what = (label: string) => <strong className="font-bold text-cream">{label}</strong>;

export function LootboxAddresses() {
  const a = publishedAddresses();
  return (
    <Table
      head={["What", "Address", "What to check"]}
      rows={[
        [what("$LOOT token"), <Address key="t" value={a?.token} pending="Not published yet" />, "The mint on pump.fun matches this exactly"],
        [what("Treasury"), <Address key="tr" value={a?.treasury} pending="Not published yet" />, "The token's creator on pump.fun, so the creator fees go to it. Holds the pool"],
        [
          what("Purchasing account"),
          <Address key="p" value={a?.purchasing} pending="Not published yet" />,
          "Receives the prize's worth in USDC from the treasury the moment a pool fills (the Paid step), then pays Zinc for the order in USDC (the Ordered step)",
        ],
        [
          what("Proof publisher"),
          <Address key="o" value={a?.publisher} pending="Not published yet" />,
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
    <span className="text-mute">Not published yet</span>
  );
  return (
    <Table
      head={["Wallet", "Address"]}
      rows={[
        ["pump.fun bonding curve", <Address key="c" value={a?.bondingCurve} pending="Not published yet" />],
        ["Liquidity pool (PumpSwap)", <Address key="l" value={a?.pool} pending="Not published yet" />],
        ["Team and dev wallets", team],
        ["Treasury, purchasing account and proof publisher", "As above"],
        ["Any account owned by a program (other pools, vaults)", "Every address off the ed25519 curve: it can't sign a claim"],
      ]}
    />
  );
}
