// The Solana connection and the ops wallet: the published wallet that signs every proof
// fingerprint and every randomness request. The cluster comes from SOLANA_CLUSTER.
import { Connection, Keypair, TransactionMessage, VersionedTransaction, clusterApiUrl, type AddressLookupTableAccount, type Transaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

export type Cluster = "devnet" | "mainnet-beta";
export const CLUSTER: Cluster = process.env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet";

// Helius when its key is set (faster, and needed for reading every holder); Solana's public
// endpoint otherwise.
export function heliusUrl(cluster: Cluster = CLUSTER): string | null {
  const key = process.env.HELIUS_API_KEY;
  return key ? `https://${cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${key}` : null;
}

export function connection(cluster: Cluster = CLUSTER): Connection {
  const url = (cluster === CLUSTER && process.env.SOLANA_RPC_URL) || heliusUrl(cluster) || clusterApiUrl(cluster);
  return new Connection(url, "confirmed");
}

// Sends a transaction and checks its status every second until it's confirmed. Plain requests
// only: web3.js's own confirm keeps a live connection open, which stops scripts from exiting and
// doesn't suit serverless functions.
export async function sendAndConfirm(conn: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  return confirm(conn, await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 }), lastValidBlockHeight);
}

// The same, as a version 0 transaction: for instructions that need address lookup tables (a
// Jupiter swap). The first signer pays.
export async function sendAndConfirmV0(conn: Connection, instructions: TransactionInstruction[], signers: Keypair[], lookupTables: AddressLookupTableAccount[] = []): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  return confirm(conn, await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 }), lastValidBlockHeight);
}

async function confirm(conn: Connection, sig: string, lastValidBlockHeight: number): Promise<string> {
  for (;;) {
    const status = (await conn.getSignatureStatuses([sig])).value[0];
    if (status?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return sig;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error(`transaction ${sig} expired before it was confirmed`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function opsWallet(secret = process.env.OPS_WALLET_SECRET): Keypair {
  if (!secret) throw new Error("OPS_WALLET_SECRET is not set");
  return Keypair.fromSecretKey(bs58.decode(secret));
}

// Where anyone can look things up.
const suffix = (cluster: Cluster) => (cluster === "devnet" ? "?cluster=devnet" : "");
export const explorerTx = (sig: string, cluster = CLUSTER) => `https://solscan.io/tx/${sig}${suffix(cluster)}`;
export const explorerAccount = (address: string, cluster = CLUSTER) => `https://solscan.io/account/${address}${suffix(cluster)}`;
