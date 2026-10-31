import type { ProofPackage } from "../proofs/package";

export type DropStatus = "upcoming" | "funding" | "snapshotting" | "drawing" | "claiming" | "fulfilling" | "delivered" | "complete";

export interface PrizeItem {
  name: string;
  productId: string;
  quantity: number;
  image?: string; // transparent cutout in /public/prizes (made with scripts/cutout.mjs)
}

export interface Drop {
  id: string;
  title: string;
  tagline: string;
  status: DropStatus;
  demo: boolean;
  goalUsd: number;
  fundedUsd: number;
  items: PrizeItem[];
  treasuryWallet: string;
  excludedWallets: { label: string; wallet: string }[];
  winnerWallet?: string;
  addressCommitment?: string;
}

export interface DropProofs {
  drop: Drop;
  packages: ProofPackage[];
  // Package hashes as read back from the Solana Memo transactions.
  anchoredHashes: string[];
  memoTxs: string[];
}

export interface DropTimelineStep {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
}
