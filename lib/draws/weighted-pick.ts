// Turn ORAO VRF randomness (64 bytes) into a winner, with no modulo bias.
// Anyone with the published weights and the on-chain randomness gets the same winner.
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { toRanges, type WeightEntry, type WeightRange } from "./snapshot";

const SPACE = 1n << 512n;

function toBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes) || "0"}`);
}

// Round 0 uses the VRF output directly; if it falls in the biased tail, derive the next
// candidate as SHA-512(randomness || round). The tail is < total / 2^512, so this is
// essentially never needed, but it makes the result exactly uniform.
export function pickIndex(randomness: Uint8Array, total: bigint): { index: bigint; rounds: number } {
  if (randomness.length !== 64) throw new Error("pickIndex: expected 64 bytes of randomness");
  if (total <= 0n) throw new Error("pickIndex: total weight must be positive");
  const limit = SPACE - (SPACE % total);
  for (let round = 0; round < 1000; round++) {
    const bytes = round === 0 ? randomness : sha512(concatBytes(randomness, new Uint8Array([round >> 8, round & 0xff])));
    const r = toBigInt(bytes);
    if (r < limit) return { index: r % total, rounds: round + 1 };
  }
  throw new Error("pickIndex: no unbiased value found");
}

export function findRange(ranges: WeightRange[], index: bigint): WeightRange {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index < ranges[mid].start) hi = mid - 1;
    else if (index >= ranges[mid].end) lo = mid + 1;
    else return ranges[mid];
  }
  throw new Error("findRange: index out of range");
}

export function pickWinner(randomness: Uint8Array, entries: WeightEntry[]) {
  const { ranges, total } = toRanges(entries);
  const { index, rounds } = pickIndex(randomness, total);
  const range = findRange(ranges, index);
  return { wallet: range.wallet, index, total, rounds };
}
