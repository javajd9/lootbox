// pump.fun's creator fees, from the programs' public IDLs (github.com/pump-fun/pump-public-docs,
// October 2026). $LOOT is created from the treasury wallet, so the treasury is the coin's creator
// and every trade pays it a fee. That fee can be waiting in four places until it's collected:
//
//   on the bonding curve   BondingCurve.creator_fee   new-style trades (buy_v3 / sell_v3) keep it on the curve
//                          the creator vault           older trades pay straight in; a sweep moves the curve's in
//   after graduation       Pool.creator_fees           new-style PumpSwap trades (buy_v2 / sell_v2) keep it on the pool
//                          the coin creator vault      WSOL; older trades pay straight in; a sweep moves the pool's in
//
// Collecting is permissionless: sweep each waiting fee into its vault, then collect each vault to
// the creator. This only works for a coin without a fee sharing config, which $LOOT must not have.
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from "@solana/web3.js";

export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEES_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const AMM_GLOBAL_CONFIG = new PublicKey("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");

// What an empty system account must keep to stay open; the creator vault always keeps this much.
const VAULT_RENT_LAMPORTS = 890_880;

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const seed = (s: string) => Buffer.from(s);

export const bondingCurveAddress = (mint: PublicKey) => pda([seed("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID);
export const creatorVaultAddress = (creator: PublicKey) => pda([seed("creator-vault"), creator.toBuffer()], PUMP_PROGRAM_ID);
// The PumpSwap pool a coin graduates into: created by pump's pool authority, index 0, paired with WSOL.
export const poolAddress = (mint: PublicKey) => {
  const authority = pda([seed("pool-authority"), mint.toBuffer()], PUMP_PROGRAM_ID);
  return pda([seed("pool"), Buffer.from([0, 0]), authority.toBuffer(), mint.toBuffer(), NATIVE_MINT.toBuffer()], PUMP_AMM_PROGRAM_ID);
};
export const coinCreatorVaultAuthority = (creator: PublicKey) => pda([seed("creator_vault"), creator.toBuffer()], PUMP_AMM_PROGRAM_ID);
export const coinCreatorVaultAta = (creator: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, coinCreatorVaultAuthority(creator), true);
const pumpEventAuthority = pda([seed("__event_authority")], PUMP_PROGRAM_ID);
const ammEventAuthority = pda([seed("__event_authority")], PUMP_AMM_PROGRAM_ID);
const pumpGlobal = pda([seed("global")], PUMP_PROGRAM_ID);

// Fields appended later are missing from older, shorter accounts; they read as 0.
const u64At = (data: Buffer, offset: number) => (data.length >= offset + 8 ? data.readBigUInt64LE(offset) : 0n);
const keyAt = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32));

export interface BondingCurve {
  complete: boolean; // graduated to PumpSwap
  creator: PublicKey;
  creatorFee: bigint; // waiting on the curve
}

// BondingCurve: 8-byte discriminator, 5 × u64 reserves/supply (8..48), complete (48), creator
// (49..81), is_mayhem_mode, is_cashback_coin, quote_mint (83..115), creator_fee_bps (115..123),
// can_edit_creator_fee, is_holder_reward, creator_fee (125..133), protocol_fees, …
export function decodeBondingCurve(data: Buffer): BondingCurve {
  return { complete: data[48] === 1, creator: keyAt(data, 49), creatorFee: u64At(data, 125) };
}

export interface Pool {
  coinCreator: PublicKey;
  quoteMint: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  creatorFees: bigint; // waiting on the pool
}

// Pool: discriminator, pool_bump (8), index u16 (9..11), creator, base_mint, quote_mint (75..107),
// lp_mint, pool_base_token_account, pool_quote_token_account (171..203), lp_supply (203..211),
// coin_creator (211..243), is_mayhem_mode, is_cashback_coin, virtual_quote_reserves i128
// (245..261), creator_fee_bps (261..269), can_edit_creator_fee, is_holder_reward,
// protocol_fees (271..279), creator_fees (279..287).
export function decodePool(data: Buffer): Pool {
  return { quoteMint: keyAt(data, 75), poolQuoteTokenAccount: keyAt(data, 171), coinCreator: keyAt(data, 211), creatorFees: u64At(data, 279) };
}

export interface CreatorFees {
  coin: boolean; // false: the mint isn't a pump.fun coin
  graduated: boolean;
  creator?: string; // who pump.fun pays: must be the treasury
  pool?: Pool;
  curveWaiting: bigint;
  curveVault: bigint; // above the vault's rent
  poolWaiting: bigint;
  poolVault: bigint;
  total: bigint; // lamports not yet in the treasury
}

const NONE: CreatorFees = { coin: false, graduated: false, curveWaiting: 0n, curveVault: 0n, poolWaiting: 0n, poolVault: 0n, total: 0n };

// One read of every place the creator's fee can be waiting.
export async function readCreatorFees(conn: Connection, mint: PublicKey, creator: PublicKey): Promise<CreatorFees> {
  const [curveInfo, vaultInfo, poolInfo, ataInfo] = await conn.getMultipleAccountsInfo([
    bondingCurveAddress(mint),
    creatorVaultAddress(creator),
    poolAddress(mint),
    coinCreatorVaultAta(creator),
  ]);
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) return NONE;
  const curve = decodeBondingCurve(curveInfo.data);
  const pool = poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID) ? decodePool(poolInfo.data) : undefined;
  // A token account's amount is the u64 at byte 64.
  const fees = {
    curveWaiting: curve.creatorFee,
    curveVault: BigInt(Math.max(0, (vaultInfo?.lamports ?? 0) - VAULT_RENT_LAMPORTS)),
    poolWaiting: pool?.creatorFees ?? 0n,
    poolVault: ataInfo && ataInfo.data.length >= 72 ? ataInfo.data.readBigUInt64LE(64) : 0n,
  };
  return {
    coin: true,
    graduated: curve.complete && !!pool,
    creator: curve.creator.toBase58(),
    pool,
    ...fees,
    total: fees.curveWaiting + fees.curveVault + fees.poolWaiting + fees.poolVault,
  };
}

const ix = (programId: PublicKey, discriminator: number[], keys: [PublicKey, boolean, boolean][]) =>
  new TransactionInstruction({
    programId,
    keys: keys.map(([pubkey, isWritable, isSigner]) => ({ pubkey, isWritable, isSigner })),
    data: Buffer.from(discriminator),
  });

// Discriminators from the IDLs.
const SWEEP_CREATOR_FEE = [32, 246, 191, 52, 8, 201, 73, 186]; // same on both programs
const COLLECT_CREATOR_FEE_V2 = [207, 17, 138, 242, 4, 34, 19, 56];
const COLLECT_COIN_CREATOR_FEE = [160, 57, 89, 42, 181, 139, 43, 66];

// Bonding curve: sweep the waiting fee into the creator vault, then the vault to the creator.
export function curveCollectInstructions(payer: PublicKey, mint: PublicKey, creator: PublicKey): TransactionInstruction[] {
  const curve = bondingCurveAddress(mint);
  const vault = creatorVaultAddress(creator);
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, owner, true);
  return [
    ix(PUMP_PROGRAM_ID, SWEEP_CREATOR_FEE, [
      [payer, true, true],
      [pumpGlobal, false, false],
      [mint, false, false],
      [NATIVE_MINT, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
      [SystemProgram.programId, false, false],
      [curve, true, false],
      [ata(curve), true, false], // unused for SOL-paired coins, but must be the derived address
      [vault, true, false],
      [ata(vault), true, false],
      [pumpEventAuthority, false, false],
      [PUMP_PROGRAM_ID, false, false],
    ]),
    ix(PUMP_PROGRAM_ID, COLLECT_CREATOR_FEE_V2, [
      [creator, true, false],
      [ata(creator), true, false],
      [vault, true, false],
      [ata(vault), true, false],
      [NATIVE_MINT, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
      [SystemProgram.programId, false, false],
      [pumpEventAuthority, false, false],
      [PUMP_PROGRAM_ID, false, false],
    ]),
  ];
}

// PumpSwap: sweep the pool's waiting fee into the coin creator vault, collect it to the creator's
// WSOL account, then close that account so it arrives as plain SOL. The creator signs: it opens
// that account (its rent comes back on the close) and closes it.
export function poolCollectInstructions(payer: PublicKey, mint: PublicKey, creator: PublicKey, pool: Pool): TransactionInstruction[] {
  const authority = coinCreatorVaultAuthority(creator);
  const vaultAta = coinCreatorVaultAta(creator);
  const creatorAta = getAssociatedTokenAddressSync(NATIVE_MINT, creator, true);
  return [
    ix(PUMP_AMM_PROGRAM_ID, SWEEP_CREATOR_FEE, [
      [payer, true, true],
      [AMM_GLOBAL_CONFIG, false, false],
      [poolAddress(mint), true, false],
      [pool.quoteMint, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [pool.poolQuoteTokenAccount, true, false],
      [authority, false, false],
      [vaultAta, true, false],
      [SystemProgram.programId, false, false],
      [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
      [ammEventAuthority, false, false],
      [PUMP_AMM_PROGRAM_ID, false, false],
    ]),
    createAssociatedTokenAccountIdempotentInstruction(creator, creatorAta, creator, NATIVE_MINT),
    ix(PUMP_AMM_PROGRAM_ID, COLLECT_COIN_CREATOR_FEE, [
      [NATIVE_MINT, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [creator, false, false],
      [authority, false, false],
      [vaultAta, true, false],
      [creatorAta, true, false],
      [ammEventAuthority, false, false],
      [PUMP_AMM_PROGRAM_ID, false, false],
    ]),
    createCloseAccountInstruction(creatorAta, creator, creator),
  ];
}
