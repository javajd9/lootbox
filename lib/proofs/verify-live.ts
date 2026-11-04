// Checks a live drop's proofs in the visitor's browser, against the sources themselves: each
// fingerprint is read from Solana's public RPC, and each zkTLS proof's attestor signatures are
// checked with Reclaim's own SDK. Nothing here takes LOOTBOX's server's word for anything.
//
// Browser code: it deliberately doesn't import @solana/web3.js (lib/chain/*), which is large.
import type { Cluster } from "@/lib/chain/solana";
import type { ProofPackage } from "./package";

export interface LiveRecord {
  cluster: Cluster;
  publisher: string; // the ops wallet: it signs every fingerprint
  memoTxs: (string | null)[]; // one per package, in order
  fundedTx?: string;
  products: string[]; // the drop's locked product links, as the order must show them
}

export interface LiveFacts {
  anchored: string[]; // the hash each package's fingerprint carries ("" if it's missing or not ours)
  signed: Record<number, boolean>; // by package seq: do Reclaim's attestor signatures check out?
  funded: { amount: string } | null; // the drop's funding fingerprint, if it checks out
}

const RPC: Record<Cluster, string> = { devnet: "https://api.devnet.solana.com", "mainnet-beta": "https://api.mainnet-beta.solana.com" };
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
// Zinc's API, the only server an order or delivery proof may come from.
const ZINC_HOST = "api.zinc.com";

export const explorerTx = (cluster: Cluster, sig: string) => `https://solscan.io/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

// A LOOTBOX fingerprint (LOOTBOX|v1|<drop>|<kind>|<values…>) and who signed its transaction. Null
// when the transaction isn't on-chain, failed, or carries no fingerprint; throws if Solana can't be reached.
export async function readFingerprint(cluster: Cluster, sig: string) {
  const res = await fetch(RPC[cluster], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
  });
  if (!res.ok) throw new Error(`Solana RPC: HTTP ${res.status}`);
  const { result: tx } = (await res.json()) as { result?: any };
  if (!tx || tx.meta?.err) return null;
  const ix = (tx.transaction.message.instructions as { programId: string; parsed?: unknown }[]).find((i) => i.programId === MEMO_PROGRAM);
  if (typeof ix?.parsed !== "string") return null;
  const [brand, version, dropId, kind, ...values] = ix.parsed.split("|");
  if (brand !== "LOOTBOX" || version !== "v1") return null;
  const signers = (tx.transaction.message.accountKeys as { pubkey: string; signer: boolean }[]).filter((k) => k.signer).map((k) => k.pubkey);
  return { dropId, kind, values, signers };
}

export async function loadLiveFacts(dropId: string, packages: ProofPackage[], live: LiveRecord): Promise<LiveFacts> {
  const ours = async (sig: string | null | undefined, kinds: string[]) => {
    if (!sig) return null;
    const f = await readFingerprint(live.cluster, sig);
    return f && f.dropId === dropId && kinds.includes(f.kind) && f.signers.includes(live.publisher) ? f : null;
  };
  const [anchored, funded, signed] = await Promise.all([
    Promise.all(packages.map(async (p, i) => (await ours(live.memoTxs[i], KINDS[p.type] ?? [p.type]))?.values.at(-1) ?? "")),
    ours(live.fundedTx, ["funded"]),
    attestorsCheck(packages),
  ]);
  return { anchored, signed, funded: funded ? { amount: funded.values[0] ?? "" } : null };
}

// The fingerprint kind each package type is posted under.
const KINDS: Partial<Record<ProofPackage["type"], string[]>> = { order: ["ordered"], tracking: ["shipped", "delivered"] };

async function attestorsCheck(packages: ProofPackage[]): Promise<Record<number, boolean>> {
  const zk = packages.filter((p) => p.type === "order" || p.type === "tracking");
  if (!zk.length) return {};
  // Reclaim's SDK is large, so it's only loaded when there's a proof to check.
  const { verifyProof } = await import("@reclaimprotocol/js-sdk");
  const out: Record<number, boolean> = {};
  for (const p of zk) {
    try {
      out[p.seq] = (await verifyProof(p.attestation as any, { dangerouslyDisableContentValidation: true } as any)).isVerified;
    } catch {
      out[p.seq] = false;
    }
  }
  return out;
}

// Does the package say what its zkTLS proof proves, and is the proof of Zinc's server? Returns
// what's wrong, or null. (The proof's signatures are checked separately, in loadLiveFacts.)
export function proofMismatch(p: ProofPackage): string | null {
  const proof = p.attestation as { claimData?: { parameters?: string }; extractedParameterValues?: Record<string, unknown> } | null;
  if (!proof?.claimData) return "this package carries no zkTLS proof";
  let host = "";
  try {
    host = new URL((JSON.parse(proof.claimData.parameters ?? "{}") as { url?: string }).url ?? "").hostname;
  } catch {
    return "the proof doesn't say which server it came from";
  }
  if (host !== ZINC_HOST) return `the proof came from ${host || "an unknown server"}, not Zinc (${ZINC_HOST})`;
  for (const [k, v] of Object.entries(proof.extractedParameterValues ?? {})) {
    if (p.revealed[k] !== v) return `the package says ${k} is ${JSON.stringify(p.revealed[k])}, but the proof says ${JSON.stringify(v)}`;
  }
  return null;
}
