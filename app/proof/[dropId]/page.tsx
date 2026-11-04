import { notFound } from "next/navigation";
import { ProofChecks } from "@/components/ProofChecks";
import { WinnerAddressCheck } from "@/components/WinnerAddressCheck";
import { HudSection } from "@/components/brand/Hud";
import { DEMO_ADDRESS, DEMO_SALT, getDropProofs } from "@/lib/data/mock";
import { mono } from "@/lib/fonts";
import "../../legacy.css";

export default function ProofPage({ params }: { params: { dropId: string } }) {
  const data = getDropProofs(params.dropId);
  if (!data) notFound();
  const { drop, packages, anchoredHashes } = data;

  return (
    <HudSection index="04" label="The proof" className={mono.variable}>
      <div className="space-y-10">
        <header>
          <p className="eyebrow">{drop.id} · proof of loot</p>
          <h1 className="display mt-3 text-5xl sm:text-7xl">{drop.title}</h1>
          {drop.demo && (
            <p className="mt-6 max-w-3xl border-l-2 border-loot pl-4 text-sm text-cream/70">
              Demo with sample data. The chain, signature and address checks below are real. Payment and zkTLS checks show
              DEMO until a live drop provides the real Solana transactions and Reclaim proofs.
            </p>
          )}
          {drop.winnerWallet && (
            <p className="hud mt-6 break-all">
              Winner · <span className="text-cream">{drop.winnerWallet}</span>
            </p>
          )}
        </header>

        <ProofChecks drop={drop} packages={packages} anchoredHashes={anchoredHashes} />

        {drop.addressCommitment && (
          <WinnerAddressCheck
            commitment={drop.addressCommitment}
            demoHint={drop.demo ? { ...DEMO_ADDRESS, line2: "", salt: DEMO_SALT } : undefined}
          />
        )}

        <section className="card">
          <h2 className="display text-2xl">What you&apos;re trusting</h2>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-cream/60">
            <li>Not LOOTBOX. Every check above runs in your browser against the raw proofs and on-chain records.</li>
            <li>Zinc reports Amazon&apos;s order and the carrier&apos;s delivery status honestly.</li>
            <li>Reclaim&apos;s attestors don&apos;t collude to fake a zkTLS proof.</li>
            <li>&quot;Delivered&quot; is the carrier&apos;s word until the winner signs their receipt (P5).</li>
          </ul>
        </section>
      </div>
    </HudSection>
  );
}
