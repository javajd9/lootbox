import { notFound } from "next/navigation";
import { ProofChecks } from "@/components/ProofChecks";
import { WinnerAddressCheck } from "@/components/WinnerAddressCheck";
import { HudSection } from "@/components/brand/Hud";
import { DEMO_ADDRESS, DEMO_SALT, getDropProofs } from "@/lib/data/mock";
import { mono } from "@/lib/fonts";
import { liveDropProofs } from "@/lib/proofs/public";
import "../../legacy.css";

// Live drops are read fresh from the database on every visit; the checks run in the browser.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function ProofPage({ params }: { params: { dropId: string } }) {
  // DROP-000 is the demo rehearsal; every other drop the engine has opened is read live.
  const real =
    params.dropId === "DROP-000" || !/^[A-Z0-9-]{1,32}$/.test(params.dropId)
      ? null
      : await liveDropProofs(params.dropId).catch((err) => {
          console.error("proof page", err);
          return null;
        });
  const data = real ?? getDropProofs(params.dropId);
  if (!data) notFound();
  const { drop, packages } = data;
  const live = real?.live;

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
          {live?.cluster === "devnet" && (
            <p className="mt-6 max-w-3xl border-l-2 border-loot pl-4 text-sm text-cream/70">
              Test drop on Solana&apos;s devnet. Its prize is Zinc&apos;s sandbox test product, so nothing real is bought or shipped,
              but every check below runs against the real records.
            </p>
          )}
          {drop.winnerWallet && (
            <p className="hud mt-6 break-all">
              Winner · <span className="text-cream">{drop.winnerWallet}</span>
            </p>
          )}
        </header>

        <ProofChecks drop={drop} packages={packages} anchoredHashes={"anchoredHashes" in data ? data.anchoredHashes : []} live={live} />

        {drop.addressCommitment && (
          <WinnerAddressCheck
            commitment={drop.addressCommitment}
            demoHint={drop.demo ? { ...DEMO_ADDRESS, line2: "", salt: DEMO_SALT } : undefined}
          />
        )}

        {live && (
          <section className="card">
            <h2 className="display text-2xl">The raw data</h2>
            <p className="mt-3 text-sm text-cream/60">
              Everything these checks use, as JSON, so you can check it with your own tools. See{" "}
              <a className="underline" href="/docs/verify">Verify it yourself</a> and{" "}
              <a className="underline" href="/docs/reproduce">Reproduce a draw</a>.
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-cream/60">
              <li>
                <a className="text-cream underline" href={`/api/proofs/${drop.id}`}>Proof packages</a>: each one exactly as it was
                hashed, with the Solana transaction that carries its fingerprint.
              </li>
              <li>
                <a className="text-cream underline" href={`/api/draws/${drop.id}`}>Draw data</a>: every holder snapshot, the locked
                ticket list and each draw round&apos;s randomness.
              </li>
            </ul>
          </section>
        )}

        <section className="card">
          <h2 className="display text-2xl">What you&apos;re trusting</h2>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-cream/60">
            <li>Not LOOTBOX, for anything checked above: every check runs in your browser against the raw proofs and on-chain records.</li>
            <li>LOOTBOX keeps the treasury&apos;s key safe and the winner&apos;s address private until it&apos;s deleted.</li>
            <li>Zinc reports Amazon&apos;s order and the carrier&apos;s delivery status honestly.</li>
            <li>Reclaim&apos;s attestors don&apos;t collude to fake a zkTLS proof.</li>
            <li>&quot;Delivered&quot; is the carrier&apos;s word until the winner signs their receipt (P5).</li>
          </ul>
        </section>
      </div>
    </HudSection>
  );
}
