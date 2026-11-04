// Mainnet: the moment a pool fills, the prize's worth of SOL is swapped to USDC through Jupiter and
// lands straight in the prize wallet, so a fall in SOL's price can't shrink a prize that's been won.
// The swap, the delivery and the "funded" fingerprint are one transaction.
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, TransactionInstruction, type AddressLookupTableAccount, type Connection, type Keypair } from "@solana/web3.js";
import { fingerprintMemo, memoInstruction } from "@/lib/chain/memo";
import { sendAndConfirmV0 } from "@/lib/chain/solana";

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER = "https://lite-api.jup.ag/swap/v1";
const SLIPPAGE_BPS = 50;
const MAX_ACCOUNTS = 32; // keeps the route small enough to fit with the delivery and fingerprint in one transaction

export interface Quote {
  inAmount: string; // lamports expected
  outAmount: string; // USDC base units (6 decimals)
  otherAmountThreshold: string; // the most SOL it may take, with slippage
  [key: string]: unknown;
}

interface JupInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

export const usdcUnits = (cents: number) => BigInt(cents) * 10_000n;

const toInstruction = (i: JupInstruction) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

async function jupiter<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JUPITER}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { error?: string }).error) throw new Error(`Jupiter ${path.split("?")[0]}: ${(body as { error?: string }).error ?? res.status}`);
  return body as T;
}

// Exactly the prize's worth of USDC out; whatever SOL that takes.
export const quoteUsdc = (cents: number) =>
  jupiter<Quote>(`/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT.toBase58()}&amount=${usdcUnits(cents)}&swapMode=ExactOut&slippageBps=${SLIPPAGE_BPS}&maxAccounts=${MAX_ACCOUNTS}`);

// Every instruction of the swap-and-deliver transaction, and the lookup tables it needs.
export async function swapInstructions(conn: Connection, ops: PublicKey, treasury: PublicKey, prize: PublicKey, dropId: string, cents: number, quote: Quote) {
  const prizeUsdc = getAssociatedTokenAddressSync(USDC_MINT, prize, true);
  const r = await jupiter<{
    computeBudgetInstructions?: JupInstruction[];
    setupInstructions?: JupInstruction[];
    swapInstruction: JupInstruction;
    cleanupInstruction?: JupInstruction | null;
    otherInstructions?: JupInstruction[];
    addressLookupTableAddresses?: string[];
  }>("/swap-instructions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: treasury.toBase58(), destinationTokenAccount: prizeUsdc.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  const tables = await Promise.all(
    (r.addressLookupTableAddresses ?? []).map(async (a) => {
      const t = (await conn.getAddressLookupTable(new PublicKey(a))).value;
      if (!t) throw new Error(`lookup table ${a} not found`);
      return t;
    }),
  );
  const instructions = [
    ...(r.computeBudgetInstructions ?? []).map(toInstruction),
    createAssociatedTokenAccountIdempotentInstruction(ops, prizeUsdc, prize, USDC_MINT),
    ...(r.setupInstructions ?? []).map(toInstruction),
    toInstruction(r.swapInstruction),
    ...(r.cleanupInstruction ? [toInstruction(r.cleanupInstruction)] : []),
    ...(r.otherInstructions ?? []).map(toInstruction),
    memoInstruction(ops, fingerprintMemo(dropId, "funded", `${cents}c`, `${quote.inAmount}lamports`, `${quote.outAmount}usdc6`)),
  ];
  return { instructions, tables: tables as AddressLookupTableAccount[] };
}

export async function swapToPrize(conn: Connection, ops: Keypair, treasury: Keypair, prize: PublicKey, dropId: string, cents: number, reserveLamports: number): Promise<string> {
  const quote = await quoteUsdc(cents);
  const balance = await conn.getBalance(treasury.publicKey);
  if (balance - reserveLamports < Number(quote.otherAmountThreshold)) {
    throw new Error(`the treasury has ${balance} lamports; the swap may need up to ${quote.otherAmountThreshold}`);
  }
  const { instructions, tables } = await swapInstructions(conn, ops.publicKey, treasury.publicKey, prize, dropId, cents, quote);
  return sendAndConfirmV0(conn, instructions, [ops, treasury], tables);
}
