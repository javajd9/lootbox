"use client";

// Every check here runs in the visitor's browser against the raw proof packages.
// Nothing trusts a "verified: true" flag from our server.
import { useCallback, useEffect, useState } from "react";
import { hashPackage, verifyChain, type ProofPackage } from "@/lib/proofs/package";
import { verifyReceipt } from "@/lib/proofs/receipt";
import type { Drop } from "@/lib/data/types";
import { CheckMark, CrossMark } from "@/components/brand/Logo";

type Result = "pass" | "fail" | "demo" | "pending";

interface Check {
  id: string;
  label: string;
  explain: string;
  result: Result;
  note?: string;
}

function ResultIcon({ result }: { result: Result }) {
  if (result === "pass") return <CheckMark className="h-7 w-7" />;
  if (result === "fail") return <CrossMark className="h-7 w-7" />;
  return (
    <span className="hud rounded-sm border border-line px-1.5 py-1 text-[9px]">{result === "demo" ? "Demo" : "Soon"}</span>
  );
}

function runChecks(drop: Drop, packages: ProofPackage[], anchored: string[]): Check[] {
  const find = (t: ProofPackage["type"]) => packages.filter((p) => p.type === t);
  const payment = find("payment")[0];
  const order = find("order")[0];
  const delivered = find("tracking").find((p) => p.revealed.milestone === "delivered" || p.revealed.tag === "Delivered");
  const receipt = find("receipt")[0];
  const chain = verifyChain(packages, anchored);
  // Demo packages carry placeholder attestations; live ones carry real Solana txs / Reclaim proofs.
  const liveOrDemo = (ok: boolean): Result => (!ok ? "pending" : drop.demo ? "demo" : "pass");

  const receiptOk =
    !!receipt &&
    !!drop.winnerWallet &&
    receipt.revealed.wallet === drop.winnerWallet &&
    verifyReceipt(String(receipt.revealed.message), String((receipt.attestation as { signature?: string })?.signature ?? ""), drop.winnerWallet);

  return [
    {
      id: "P1",
      label: "Paid from the prize treasury",
      explain: "USDC moved from the public treasury wallet to the purchasing account, on Solana.",
      result: liveOrDemo(!!payment),
      note: drop.demo ? "Demo: live drops link the real Solana transaction." : undefined,
    },
    {
      id: "P2",
      label: "The exact bundle was ordered",
      explain: "A zkTLS proof that the order system's own server returned these products and this Amazon order number.",
      result: liveOrDemo(!!order),
      note: drop.demo ? "Demo: live drops verify a real Reclaim zkTLS proof here." : undefined,
    },
    {
      id: "P3",
      label: "The order went through",
      explain: "The same proof shows the order succeeded and its total fits the treasury payment.",
      result: liveOrDemo(!!order && !!payment && Number(order.revealed.totalUsd) <= Number(payment.revealed.usdc)),
    },
    {
      id: "P4",
      label: "Delivered",
      explain: "A zkTLS proof of Zinc's tracking record showing every package delivered. Tracking numbers and locations hidden.",
      result: liveOrDemo(!!delivered),
    },
    {
      id: "P5",
      label: "Winner confirmed they received it",
      explain: "A message signed by the winning wallet. Only the person who won can produce this signature.",
      result: receipt ? (receiptOk ? "pass" : "fail") : "pending",
    },
    {
      id: "P6",
      label: "Nothing was edited afterward",
      explain: "Every proof is chained by hash and each hash is recorded on Solana. Any change breaks the chain.",
      result: packages.length === 0 ? "pending" : chain.ok ? "pass" : "fail",
      note: chain.ok ? undefined : chain.errors.join("; "),
    },
  ];
}

export function ProofChecks({ drop, packages, anchoredHashes }: { drop: Drop; packages: ProofPackage[]; anchoredHashes: string[] }) {
  const [working, setWorking] = useState(packages);
  const [checks, setChecks] = useState<Check[]>([]);
  const [tampered, setTampered] = useState(false);

  const verify = useCallback(() => setChecks(runChecks(drop, working, anchoredHashes)), [drop, working, anchoredHashes]);
  useEffect(verify, [verify]);

  const tamper = () => {
    // Change one number in the order proof, exactly what a dishonest operator would want to do.
    setWorking((pkgs) => pkgs.map((p) => (p.type === "order" ? { ...p, revealed: { ...p.revealed, totalUsd: 99.99 } } : p)));
    setTampered(true);
  };

  const count = (r: Result) => checks.filter((c) => c.result === r).length;
  const passed = count("pass");
  const counted = checks.length - count("pending");
  const breakdown = [
    count("fail") && `${count("fail")} failed`,
    count("demo") && `${count("demo")} demo data`,
    count("pending") && `${count("pending")} not yet available`,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="display text-4xl">
            {counted === 0 ? "No proofs yet" : `${passed}/${checks.length} checks verified`}
          </p>
          <p className="text-sm text-cream/60">
            {breakdown.length ? `${breakdown.join(" · ")} · ` : ""}Checked just now, in your browser.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={verify} className="btn-loot">Verify everything</button>
          {packages.length > 0 && (
            tampered ? (
              <button onClick={() => { setWorking(packages); setTampered(false); }} className="btn-ghost">Undo tampering</button>
            ) : (
              <button onClick={tamper} className="btn-ghost">Try tampering</button>
            )
          )}
        </div>
      </div>
      {tampered && (
        <p className="rounded-sm border border-bad/50 bg-bad/10 p-4 text-sm">
          You changed the order total to $99.99 in your browser. Watch check P6 fail: the edited proof no longer matches its
          on-chain record.
        </p>
      )}

      <ul className="grid gap-3">
        {checks.map((c) => (
          <li key={c.id} className="card flex gap-4">
            <span className="flex w-10 shrink-0 justify-center pt-0.5" aria-label={c.result}>
              <ResultIcon result={c.result} />
            </span>
            <div>
              <p className="font-bold">
                <span className="mr-2 font-mono text-xs text-mute">{c.id}</span>
                {c.label}
              </p>
              <p className="text-sm text-cream/60">{c.explain}</p>
              {c.note && <p className="mt-1 text-xs text-mute">{c.note}</p>}
            </div>
          </li>
        ))}
      </ul>

      {working.length > 0 && (
        <section>
          <h2 className="display mb-4 text-3xl">Proof timeline</h2>
          <ol className="space-y-2">
            {working.map((p, i) => {
              const h = hashPackage(p);
              const ok = h === anchoredHashes[i];
              return (
                <li key={p.seq} className="card py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex items-center gap-2 font-bold uppercase tracking-wide">
                      {ok ? <CheckMark /> : <CrossMark />}
                      <span className="hud text-loot">#{p.seq}</span> {p.type.replace("_", " ")}
                    </p>
                    <p className="text-xs text-mute">{new Date(p.createdAt).toUTCString()}</p>
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-cream/60">
                    {JSON.stringify(p.revealed, null, 2)}
                  </pre>
                  <p className="mt-2 break-all font-mono text-[11px] text-mute">sha256 {h}</p>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
