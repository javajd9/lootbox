import { CLUSTER } from "@/lib/chain/solana";
import { dropSummaries } from "@/lib/proofs/drops";
import { ClaimForm, type ClaimDrop } from "./ClaimForm";

// The claim page lists the drops that have been drawn, so the winner picks theirs instead of typing it.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Claim" };

export default async function ClaimPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // Devnet drops are only listed with /claim?live, the same switch the homepage and /proof use.
  const listed = CLUSTER === "mainnet-beta" || searchParams.live !== undefined;
  const drops: ClaimDrop[] | null = listed
    ? await dropSummaries()
        .then((all) =>
          all
            .filter((d) => d.winner)
            .map((d) => ({
              id: d.id,
              number: d.number,
              title: d.title,
              winner: d.winner!,
              status: d.status,
              open: d.status === "claiming" && !d.claimed,
            })),
        )
        .catch((err) => {
          console.error("claim drops", err);
          return null;
        })
    : [];
  return <ClaimForm drops={drops} />;
}
