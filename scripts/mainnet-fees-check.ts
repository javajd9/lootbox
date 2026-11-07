// Proves the mainnet money-in transactions against the real programs without sending anything:
// each one is built exactly as the engine builds it, then only simulated (no signatures, no SOL).
//
//   npm run mainnet:fees-check -- --mint <any pump.fun coin> [--usd 5] [--wallet <SOL-rich wallet>]
//
// 1. Collect: reads the coin's uncollected creator fees, builds the collect transaction (with the
//    coin's real creator in the treasury's place) and simulates it: the creator should gain the fees.
// 2. Fund: quotes the prize's worth of USDC on Jupiter and simulates the swap-and-deliver
//    transaction from --wallet: a fresh prize wallet should end up holding exactly that much USDC.
import "dotenv/config";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import { bondingCurveAddress, decodeBondingCurve, readCreatorFees } from "@/lib/chain/pump";
import { connection } from "@/lib/chain/solana";
import { collectTransaction } from "@/lib/treasury/fees";
import { quoteUsdc, swapInstructions, USDC_MINT } from "@/lib/treasury/swap";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const mintArg = arg("mint");
if (!mintArg) {
  console.error("Usage: npm run mainnet:fees-check -- --mint <pump.fun coin> [--usd 5] [--wallet <address>]");
  process.exit(1);
}
const mint = new PublicKey(mintArg);
const conn = connection();
// Any wallet holding some SOL, standing in for ops and the treasury. Default: a large exchange wallet.
const wallet = new PublicKey(arg("wallet", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")!);
const sol = (lamports: bigint | number) => `${(Number(lamports) / 1e9).toFixed(6)} SOL`;

async function simulate(payer: PublicKey, instructions: TransactionInstruction[], watch: PublicKey[], tables: AddressLookupTableAccount[] = []) {
  const { blockhash } = await conn.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions });
  const tx = new VersionedTransaction(tables.length ? message.compileToV0Message(tables) : message.compileToLegacyMessage());
  const before = await conn.getMultipleAccountsInfo(watch);
  const { value } = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { addresses: watch.map((w) => w.toBase58()), encoding: "base64" } });
  return { value, before, size: tx.serialize().length };
}

// 1. Collect
const curveInfo = await conn.getAccountInfo(bondingCurveAddress(mint));
if (!curveInfo) throw new Error(`${mint.toBase58()} has no pump.fun bonding curve`);
const creator = decodeBondingCurve(curveInfo.data).creator;
const fees = await readCreatorFees(conn, mint, creator);
console.log(`Coin ${mint.toBase58()} (${fees.graduated ? "graduated to PumpSwap" : "on its bonding curve"}), creator ${creator.toBase58()}`);
console.log(`  waiting on curve ${sol(fees.curveWaiting)} · creator vault ${sol(fees.curveVault)} · on pool ${sol(fees.poolWaiting)} · pool vault ${sol(fees.poolVault)}`);
console.log(`  uncollected total ${sol(fees.total)}`);

// --wallet stands in for the ops wallet: it pays the network fee, as ops does.
const collect = collectTransaction(wallet, creator, mint, fees, "CHECK-001");
const c = await simulate(wallet, collect.instructions, [creator]);
const gained = c.value.accounts?.[0] ? c.value.accounts[0].lamports - (c.before[0]?.lamports ?? 0) : NaN;
console.log(`Collect simulation: ${c.value.err ? `FAILED ${JSON.stringify(c.value.err)}` : "ok"} (${c.value.unitsConsumed} compute units, ${c.size} bytes)`);
console.log(`  creator balance change ${sol(gained)} (uncollected was ${sol(fees.total)})`);
if (c.value.err) console.log(c.value.logs?.join("\n"));

// 2. Fund: swap to USDC and deliver
const cents = Math.round(Number(arg("usd", "5")) * 100);
const prize = Keypair.generate().publicKey;
const quote = await quoteUsdc(cents);
console.log(`\nFund (via ${(quote.routePlan as { swapInfo: { label: string } }[]).map((r) => r.swapInfo.label).join(" → ")}): $${(cents / 100).toFixed(2)} of USDC costs about ${sol(Number(quote.inAmount))} (at most ${sol(Number(quote.otherAmountThreshold))})`);
const { instructions, tables } = await swapInstructions(conn, wallet, wallet, prize, "CHECK-001", cents, quote);
const prizeUsdc = getAssociatedTokenAddressSync(USDC_MINT, prize, true);
const f = await simulate(wallet, instructions, [prizeUsdc], tables);
const got = f.value.accounts?.[0]?.data ? Buffer.from(f.value.accounts[0].data[0], "base64").readBigUInt64LE(64) : 0n;
console.log(`Swap simulation: ${f.value.err ? `FAILED ${JSON.stringify(f.value.err)}` : "ok"} (${f.value.unitsConsumed} compute units, ${f.size} bytes)`);
console.log(`  prize wallet would receive ${Number(got) / 1e6} USDC (wanted ${cents / 100})`);
if (f.value.err) console.log(f.value.logs?.slice(-15).join("\n"));
