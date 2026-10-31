// Draw randomness from ORAO VRF. Each draw round's seed is derived from public facts (the drop,
// its locked ticket list, the round), so anyone can find the one randomness account that belongs
// to a draw, and nobody can quietly request a different one and keep the result they like.
import { AnchorProvider } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { Orao, randomnessAccountAddress } from "@orao-network/solana-vrf";
import type { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { sendAndConfirm } from "./solana";

export function drawSeed(dropId: string, ticketsHash: string, round: number): Uint8Array {
  return sha256(utf8ToBytes(`LOOTBOX|draw|${dropId}|${ticketsHash}|${round}`));
}

export const randomnessAccount = (seed: Uint8Array) => randomnessAccountAddress(seed).toBase58();

function orao(conn: Connection, payer: Keypair): Orao {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if ("version" in tx) tx.sign([payer]);
    else tx.partialSign(payer);
    return tx;
  };
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(sign),
  };
  return new Orao(new AnchorProvider(conn, wallet, { commitment: "confirmed" }));
}

// Safe to repeat: if this seed was already requested (say the server crashed right after), it
// returns null instead of failing.
export async function requestRandomness(conn: Connection, payer: Keypair, seed: Uint8Array): Promise<string | null> {
  const vrf = orao(conn, payer);
  if (await vrf.getRandomness(seed).then(() => true, () => false)) return null;
  const tx = await (await (await vrf.request(seed)).build()).transaction();
  return sendAndConfirm(conn, tx, [payer]);
}

// The 64 random bytes, or null while ORAO's nodes are still answering.
export async function readRandomness(conn: Connection, payer: Keypair, seed: Uint8Array): Promise<Uint8Array | null> {
  const account = await orao(conn, payer).getRandomness(seed).catch(() => null);
  return account?.getFulfilledRandomness() ?? null;
}
