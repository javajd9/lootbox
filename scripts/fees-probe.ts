// Read-only probe: finds live pump.fun coins with trading volume, then for each one shows what
// LOOTBOX would see if it were $LOOT: the creator fees waiting (the pool, as the engine reads it)
// and each recent trade's creator fee (the homepage coins, as /api/fees parses them).
// Sends nothing and writes nothing, so it can be pointed at anyone's coin.
//
//   npm run fees:probe                   finds live coins itself (two on the curve, one graduated)
//   npm run fees:probe -- <mint> [...]   checks these coins
import "dotenv/config";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { bondingCurveAddress, decodeBondingCurve, poolAddress, readCreatorFees, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "@/lib/chain/pump";
import { connection } from "@/lib/chain/solana";
import { isHeliusPayload, parseFeeEvents } from "@/lib/fees/events";
import { feeLabel } from "@/lib/live/format";
import { solPriceUsd } from "@/lib/treasury/price";

const conn = connection();
const WSOL = "So11111111111111111111111111111111111111112";
// The same JSON a "raw" Helius webhook delivers.
const getTx = async (sig: string): Promise<any> => {
  const body = { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(conn.rpcEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status !== 429) return ((await res.json()) as { result?: unknown }).result;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // rate limited: wait and ask again
  }
  return null;
};

// A few at a time, so a free Helius plan's rate limit isn't hit.
async function txs(sigs: ConfirmedSignatureInfo[]) {
  const out: any[] = [];
  for (let i = 0; i < sigs.length; i += 3) {
    out.push(...(await Promise.all(sigs.slice(i, i + 3).map((s) => getTx(s.signature)))));
    await new Promise((r) => setTimeout(r, 300));
  }
  return out.filter(Boolean);
}

// The coins being traded right now: mints in the latest pump.fun and PumpSwap transactions.
async function activeCoins(): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const program of [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID]) {
    const sigs = (await conn.getSignaturesForAddress(program, { limit: 40 })).filter((s) => !s.err);
    for (const tx of await txs(sigs)) {
      for (const b of tx.meta?.postTokenBalances ?? []) if (b.mint !== WSOL && b.mint.endsWith("pump")) counts.set(b.mint, (counts.get(b.mint) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

const price = await solPriceUsd();
const usd = (lamports: number | bigint) => (Number(lamports) / 1e9) * price;
let mints = process.argv.slice(2);
if (!mints.length) {
  const active = await activeCoins();
  // A couple still on the bonding curve, and one that has graduated to PumpSwap.
  const picked: string[] = [];
  let curve = 0, graduated = 0;
  for (const m of active) {
    const info = await conn.getAccountInfo(bondingCurveAddress(new PublicKey(m)));
    if (!info || !info.owner.equals(PUMP_PROGRAM_ID)) continue;
    const done = decodeBondingCurve(info.data).complete;
    if (!done && curve < 2) (curve++, picked.push(m));
    if (done && graduated < 1) (graduated++, picked.push(m));
    if (curve >= 2 && graduated >= 1) break;
  }
  mints = picked;
}
console.log(`SOL $${price.toFixed(2)} · checking ${mints.length} live coin(s)\n`);

for (const m of mints) {
  const mint = new PublicKey(m);
  const info = await conn.getAccountInfo(bondingCurveAddress(mint));
  if (!info) {
    console.log(`${m}: no pump.fun bonding curve\n`);
    continue;
  }
  const curve = decodeBondingCurve(info.data);
  const creator = curve.creator;
  const fees = await readCreatorFees(conn, mint, creator);
  const pool = poolAddress(mint);
  console.log(`${m}  (${fees.graduated ? "graduated to PumpSwap" : "on its bonding curve"})  https://pump.fun/coin/${m}`);
  console.log(`  creator ${creator.toBase58()}`);
  console.log(`  POOL: creator fees waiting $${usd(fees.total).toFixed(2)} (${(Number(fees.total) / 1e9).toFixed(4)} SOL)` +
    ` = curve $${usd(fees.curveWaiting).toFixed(2)} + vault $${usd(fees.curveVault).toFixed(2)} + pool $${usd(fees.poolWaiting).toFixed(2)} + pool vault $${usd(fees.poolVault).toFixed(2)}`);

  // What Helius would deliver: every recent transaction touching the curve or the pool.
  const sigs = [
    ...(await conn.getSignaturesForAddress(bondingCurveAddress(mint), { limit: 25 })),
    ...(fees.graduated ? await conn.getSignaturesForAddress(pool, { limit: 25 }) : []),
  ].filter((s) => !s.err);
  const body = await txs(sigs);
  if (!isHeliusPayload(body)) {
    console.log("  ✗ these transactions don't look like a Helius delivery to /api/fees\n");
    continue;
  }
  const events = parseFeeEvents(body, mint.toBase58(), pool.toBase58());
  const total = events.reduce((n, e) => n + e.feeLamports, 0);
  const bps = events.length ? events.reduce((n, e) => n + e.feeLamports, 0) / events.reduce((n, e) => n + e.tradeLamports, 0) * 1e4 : 0;
  console.log(`  COINS: ${events.length} trades found in ${body.length} transactions · creator fees $${usd(total).toFixed(2)} · about ${bps.toFixed(1)} bps of volume`);
  for (const e of events.slice(0, 5)) {
    console.log(`    ${e.at.slice(11, 19)} ${e.venue.padEnd(5)} ${feeLabel({ usd: usd(e.feeLamports), tradeUsd: usd(e.tradeLamports), side: e.side })}`);
  }
  console.log();
}
