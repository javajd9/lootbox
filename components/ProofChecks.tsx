"use client";

// Every check here runs in the visitor's browser against the raw proof packages.
// Nothing trusts a "verified: true" flag from our server: on a live drop, the fingerprints are read
// from Solana and the zkTLS proofs are checked with Reclaim's SDK (see lib/proofs/verify-live).
import { useCallback, useEffect, useState } from "react";
import { hashPackage, verifyChain, type ProofPackage } from "@/lib/proofs/package";
import { verifyReceipt } from "@/lib/proofs/receipt";
import { explorerTx, loadLiveFacts, proofMismatch, type LiveFacts, type LiveRecord } from "@/lib/proofs/verify-live";
import type { Drop } from "@/lib/data/types";
import { CheckMark, CrossMark } from "@/components/brand/Logo";

type Result = "pass" | "fail" | "demo" | "pending" | "checking";

const NONE: string[] = []; // no fingerprints read yet (one array, so the checks don't rerun every render)

interface Check {
  id: string;
  label: string;
  explain: string;
  result: Result;
  note?: string;
  href?: string;
}

function ResultIcon({ result }: { result: Result }) {
  if (result === "pass") return <CheckMark className="h-7 w-7" />;
  if (result === "fail") return <CrossMark className="h-7 w-7" />;
  return (
    <span className="hud rounded-sm border border-line px-1.5 py-1 text-[9px]">{result === "demo" ? "Demo" : result === "checking" ? "…" : "Soon"}</span>
  );
}

// A live zkTLS package: it must say what its proof proves, come from Zinc, and carry real attestor signatures.
function zkCheck(p: ProofPackage | undefined, facts: LiveFacts | null): { result: Result; note?: string } {
  if (!p) return { result: "pending" };
  const wrong = proofMismatch(p);
  if (wrong) return { result: "fail", note: wrong };
  if (!facts) return { result: "checking" };
  return facts.signed[p.seq] ? { result: "pass" } : { result: "fail", note: "Reclaim's attestor signatures on this proof don't check out." };
}

function runChecks(drop: Drop, packages: ProofPackage[], anchored: string[], live?: { record: LiveRecord; facts: LiveFacts | null }): Check[] {
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

  let paid: Pick<Check, "result" | "note" | "href">;
  let ordered: Pick<Check, "result" | "note">;
  let wentThrough: Result;
  let arrived: Pick<Check, "result" | "note">;
  if (live) {
    const { record, facts } = live;
    const fundedTx = record.fundedTx;
    paid = !fundedTx
      ? { result: "pending" }
      : !facts
        ? { result: "checking" }
        : facts.funded
          ? { result: "pass", note: `Fingerprinted on Solana: $${(parseInt(facts.funded.amount, 10) / 100).toFixed(2)} for this drop.`, href: explorerTx(record.cluster, fundedTx) }
          : { result: "fail", note: "The funding transaction isn't on Solana with this drop's fingerprint.", href: explorerTx(record.cluster, fundedTx) };
    ordered = zkCheck(order, facts);
    const missing = order ? record.products.filter((url) => !(order.revealed.products as unknown[] | undefined)?.includes(url)) : [];
    if (ordered.result === "pass" && missing.length) ordered = { result: "fail", note: `The proof doesn't show the locked product ${missing[0]}.` };
    const r = order?.revealed ?? {};
    const underCap = r.total === undefined || Number(r.total) <= Number(r.maxPrice);
    wentThrough = ordered.result === "pass" ? (r.status === "order_placed" && underCap ? "pass" : "fail") : ordered.result === "fail" ? "fail" : ordered.result;
    arrived = zkCheck(delivered, facts);
  } else {
    paid = { result: liveOrDemo(!!payment), note: drop.demo ? "Demo: live drops link the real Solana transaction." : undefined };
    ordered = { result: liveOrDemo(!!order), note: drop.demo ? "Demo: live drops verify a real Reclaim zkTLS proof here." : undefined };
    wentThrough = liveOrDemo(!!order && !!payment && Number(order.revealed.totalUsd) <= Number(payment.revealed.usdc));
    arrived = { result: liveOrDemo(!!delivered) };
  }

  return [
    {
      id: "P1",
      label: "Paid from the prize treasury",
      explain: "The prize's worth left the public treasury on Solana, in a transaction fingerprinted for this drop.",
      ...paid,
    },
    {
      id: "P2",
      label: "The exact bundle was ordered",
      explain: "A zkTLS proof that the order system's own server returned these products and this Amazon order number.",
      ...ordered,
    },
    {
      id: "P3",
      label: "The order went through",
      explain: "The same proof shows the order succeeded, within the prize's price cap.",
      result: wentThrough,
    },
    {
      id: "P4",
      label: "Delivered",
      explain: "A zkTLS proof of Zinc's tracking record showing every package delivered. Tracking numbers and locations hidden.",
      ...arrived,
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
      result: packages.length === 0 ? "pending" : live && !live.facts ? "checking" : chain.ok ? "pass" : "fail",
      note: packages.length === 0 || chain.ok || (live && !live.facts) ? undefined : chain.errors.join("; "),
    },
  ];
}

export function ProofChecks({ drop, packages, anchoredHashes, live }: { drop: Drop; packages: ProofPackage[]; anchoredHashes: string[]; live?: LiveRecord }) {
  const [working, setWorking] = useState(packages);
  const [checks, setChecks] = useState<Check[]>([]);
  const [tampered, setTampered] = useState(false);
  const [facts, setFacts] = useState<LiveFacts | null>(null);
  const [unreachable, setUnreachable] = useState("");
  const [round, setRound] = useState(0); // "Verify everything" reads Solana and Reclaim again

  useEffect(() => {
    if (!live) return;
    let current = true;
    setFacts(null);
    setUnreachable("");
    loadLiveFacts(drop.id, packages, live)
      .then((f) => current && setFacts(f))
      .catch((err) => current && setUnreachable(err instanceof Error ? err.message : String(err)));
    return () => {
      current = false;
    };
  }, [drop.id, packages, live, round]);

  const anchored = live ? (facts?.anchored ?? NONE) : anchoredHashes;
  const verify = useCallback(
    () => setChecks(runChecks(drop, working, anchored, live ? { record: live, facts } : undefined)),
    [drop, working, anchored, live, facts],
  );
  useEffect(verify, [verify]);

  const tamper = () => {
    // Change one number in the order proof, exactly what a dishonest operator would want to do.
    setWorking((pkgs) =>
      pkgs.map((p) => (p.type !== "order" ? p : { ...p, revealed: { ...p.revealed, ...("total" in p.revealed ? { total: "9999" } : { totalUsd: 99.99 }) } })),
    );
    setTampered(true);
  };

  const count = (r: Result) => checks.filter((c) => c.result === r).length;
  const passed = count("pass");
  const counted = checks.length - count("pending");
  const breakdown = [
    count("fail") && `${count("fail")} failed`,
    count("demo") && `${count("demo")} demo data`,
    count("checking") && `${count("checking")} still checking`,
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
            {breakdown.length ? `${breakdown.join(" · ")} · ` : ""}
            {live ? "Checked in your browser, against Solana and Reclaim directly." : "Checked just now, in your browser."}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => (live ? setRound((n) => n + 1) : verify())} className="btn-loot">Verify everything</button>
          {packages.length > 0 && (
            tampered ? (
              <button onClick={() => { setWorking(packages); setTampered(false); }} className="btn-ghost">Undo tampering</button>
            ) : (
              <button onClick={tamper} className="btn-ghost">Try tampering</button>
            )
          )}
        </div>
      </div>
      {unreachable && (
        <p className="rounded-sm border border-bad/50 bg-bad/10 p-4 text-sm">
          Couldn&apos;t reach Solana to read the fingerprints ({unreachable}). Try &quot;Verify everything&quot; again in a moment.
        </p>
      )}
      {tampered && (
        <p className="rounded-sm border border-bad/50 bg-bad/10 p-4 text-sm">
          You changed the order total in your browser. Watch check P6 fail: the edited proof no longer matches its
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
              {c.href && (
                <a href={c.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-loot underline">
                  View the transaction
                </a>
              )}
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
              const ok = h === anchored[i];
              const memo = live?.memoTxs[i];
              return (
                <li key={p.seq} className="card py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex items-center gap-2 font-bold uppercase tracking-wide">
                      {live && !facts ? null : ok ? <CheckMark /> : <CrossMark />}
                      <span className="hud text-loot">#{p.seq}</span> {p.type === "tracking" && p.revealed.milestone ? String(p.revealed.milestone) : p.type.replace("_", " ")}
                    </p>
                    <p className="text-xs text-mute">{new Date(p.createdAt).toUTCString()}</p>
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-cream/60">
                    {JSON.stringify(p.revealed, null, 2)}
                  </pre>
                  <p className="mt-2 break-all font-mono text-[11px] text-mute">sha256 {h}</p>
                  {live && memo && (
                    <a href={explorerTx(live.cluster, memo)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-loot underline">
                      Its fingerprint on Solana
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
