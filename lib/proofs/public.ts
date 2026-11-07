// A live drop's public record, for its proof page: the drop, its winner, its proof packages and
// the Solana transactions that fingerprint them. Nothing here is checked: the page hands it all to
// the visitor's browser, which reads the fingerprints from Solana itself (see ./verify-live).
import { CLUSTER, opsWallet } from "@/lib/chain/solana";
import type { Drop, DropStatus } from "@/lib/data/types";
import { check, serverDb } from "@/lib/db";
import { dropConfig } from "@/lib/engine/drops";
import { productUrl } from "@/lib/orders/price";
import type { ProofPackage } from "./package";
import type { LiveRecord } from "./verify-live";

export async function liveDropProofs(id: string): Promise<{ drop: Drop; packages: ProofPackage[]; live: LiveRecord } | null> {
  if (!dropConfig(id)) return null; // only listed drops have proof pages
  const db = serverDb();
  const { data: row } = check(
    await db.from("drops").select("id, title, status, goal_usd_cents, treasury_wallet, excluded_wallets, funded_tx").eq("id", id).maybeSingle(),
    "load drop",
  );
  if (!row) return null;
  const [{ data: round }, { data: proofs }, { data: claim }] = await Promise.all([
    db.from("draw_rounds").select("winner_wallet").eq("drop_id", id).not("winner_wallet", "is", null).order("round", { ascending: false }).limit(1).maybeSingle(),
    db.from("proofs").select("package, memo_tx").eq("drop_id", id).order("seq"),
    // Its fingerprint is already public on-chain; the address itself never leaves the server.
    db.from("claims").select("address_commitment").eq("drop_id", id).eq("status", "checkout_complete").maybeSingle(),
  ]);
  const goalUsd = Number(row.goal_usd_cents) / 100;

  const drop: Drop = {
    id: row.id,
    title: row.title,
    status: row.status as DropStatus,
    goalUsd,
    fundedUsd: row.funded_tx ? goalUsd : 0,
    items: [],
    treasuryWallet: row.treasury_wallet,
    excludedWallets: ((row.excluded_wallets as string[] | null) ?? []).map((wallet) => ({ label: "Excluded", wallet })),
    winnerWallet: (round?.winner_wallet as string | undefined) ?? undefined,
    addressCommitment: (claim?.address_commitment as string | undefined) ?? undefined,
  };
  return {
    drop,
    packages: (proofs ?? []).map((p) => p.package as ProofPackage),
    live: {
      cluster: CLUSTER,
      publisher: opsWallet().publicKey.toBase58(),
      memoTxs: (proofs ?? []).map((p) => (p.memo_tx as string | null) ?? null),
      fundedTx: (row.funded_tx as string | null) ?? undefined,
      products: (dropConfig(id)?.prize ?? []).map(productUrl).filter((u): u is string => !!u),
    },
  };
}
