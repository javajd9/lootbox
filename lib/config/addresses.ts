// The addresses LOOTBOX publishes on /docs/addresses, read from the same settings the drop engine
// runs on (lib/engine/live.ts), so the page can't drift from what the engine really uses. Each is
// left out until it's set. Server only: two of these come from secret keys.
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { bondingCurveAddress, poolAddress } from "@/lib/chain/pump";

export interface PublishedAddresses {
  token?: string;
  treasury?: string;
  purchasing?: string; // the prize wallet
  publisher?: string; // the ops wallet: signs every fingerprint and randomness request
  bondingCurve?: string;
  pool?: string;
  team: string[]; // EXCLUDED_WALLETS, less any of the above
}

const fromSecret = (secret?: string) => {
  try {
    return secret ? Keypair.fromSecretKey(bs58.decode(secret.trim())).publicKey.toBase58() : undefined;
  } catch {
    return undefined;
  }
};

const valid = (address?: string) => {
  try {
    return address?.trim() ? new PublicKey(address.trim()).toBase58() : undefined;
  } catch {
    return undefined;
  }
};

export function publishedAddresses(env: Record<string, string | undefined> = process.env): PublishedAddresses {
  const token = valid(env.LOOT_MINT);
  const mint = token ? new PublicKey(token) : undefined;
  const own = {
    token,
    treasury: fromSecret(env.TREASURY_WALLET_SECRET),
    purchasing: valid(env.PRIZE_WALLET),
    publisher: fromSecret(env.OPS_WALLET_SECRET),
    bondingCurve: mint && bondingCurveAddress(mint).toBase58(),
    pool: mint && poolAddress(mint).toBase58(),
  };
  const listed = new Set(Object.values(own).filter(Boolean));
  const team = (env.EXCLUDED_WALLETS ?? "")
    .split(",")
    .map((s) => valid(s))
    .filter((s): s is string => !!s && !listed.has(s));
  return { ...own, team: [...new Set(team)] };
}
