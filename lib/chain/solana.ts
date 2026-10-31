// The Solana connection and the ops wallet: the published wallet that signs every proof
// fingerprint and every randomness request. Devnet (Solana's free test network) until launch.
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
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

export function opsWallet(secret = process.env.OPS_WALLET_SECRET): Keypair {
  if (!secret) throw new Error("OPS_WALLET_SECRET is not set");
  return Keypair.fromSecretKey(bs58.decode(secret));
}

// Where anyone can look things up.
const suffix = (cluster: Cluster) => (cluster === "devnet" ? "?cluster=devnet" : "");
export const explorerTx = (sig: string, cluster = CLUSTER) => `https://solscan.io/tx/${sig}${suffix(cluster)}`;
export const explorerAccount = (address: string, cluster = CLUSTER) => `https://solscan.io/account/${address}${suffix(cluster)}`;
