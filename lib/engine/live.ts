// The engine's real actions: on Solana (devnet until launch) and in the database, where every
// public record is saved exactly as it was hashed, so anyone can re-check it.
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { canSign, readHolders } from "@/lib/chain/holders";
import { fingerprintMemo, postMemo } from "@/lib/chain/memo";
import { connection, opsWallet } from "@/lib/chain/solana";
import { drawSeed, randomnessAccount, readRandomness, requestRandomness } from "@/lib/chain/vrf";
import { check, serverDb } from "@/lib/db";
import { buildSnapshot, combineWeights, hashSnapshot, hashWeights, type Snapshot } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import { pickWinner } from "@/lib/draws/weighted-pick";
import { solPriceUsd } from "@/lib/treasury/price";
import { findFunding, moveToPrize, treasuryCents } from "@/lib/treasury/treasury";
import { claimStore } from "@/lib/claims/store";
import { deliveryStep } from "@/lib/orders/delivery";
import { liveDeliveryDeps, liveOrderDeps } from "@/lib/orders/live";
import { orderStep } from "@/lib/orders/order";
import { withClaims } from "./claims";
import { withReceipts, type FinishedReceipt } from "./receipts";
import { dropConfig, initialState, withQueuedDrops } from "./drops";
import type { EngineStore } from "./run";
import { supabaseStore } from "./supabase-store";
import type { Effects } from "./types";
// Money in: creator fees and the mainnet USDC swap.
import { bondingCurveAddress, poolAddress, readCreatorFees } from "@/lib/chain/pump";
import { CLUSTER } from "@/lib/chain/solana";
import { collectCreatorFees } from "@/lib/treasury/fees";
import { swapToPrize } from "@/lib/treasury/swap";
import { RESERVE_LAMPORTS } from "@/lib/treasury/treasury";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export function liveEffects(): Effects {
  const conn = connection();
  const db = serverDb();
  const ops = opsWallet();
  const treasury = Keypair.fromSecretKey(bs58.decode(env("TREASURY_WALLET_SECRET")));
  const prize = new PublicKey(env("PRIZE_WALLET"));
  const mint = env("LOOT_MINT");
  // LOOTBOX's own wallets, pump.fun's bonding curve and the PumpSwap pool it graduates into never
  // hold tickets. They're published with each drop.
  const excluded = [ops.publicKey, treasury.publicKey, prize, bondingCurveAddress(new PublicKey(mint)), poolAddress(new PublicKey(mint))]
    .map((k) => k.toBase58())
    .concat((process.env.EXCLUDED_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  let price: Promise<number> | undefined;
  const solPrice = () => (price ??= solPriceUsd()); // one price for the whole tick

  return {
    async readTreasury() {
      return treasuryCents(conn, treasury.publicKey, await solPrice());
    },

    // Zero on devnet: the test token isn't a pump.fun coin.
    async readCreatorFees() {
      const fees = await readCreatorFees(conn, new PublicKey(mint), treasury.publicKey);
      const lamports = Number(fees.total);
      return { lamports, cents: lamports ? Math.floor((lamports / 1e9) * (await solPrice()) * 100) : 0 };
    },

    async collect(d) {
      const tx = await collectCreatorFees(conn, ops, treasury, new PublicKey(mint), d.id);
      if (tx) console.log(`collected creator fees for ${d.id}: ${tx}`);
    },

    async open(d) {
      const c = dropConfig(d.id);
      check(
        await db.from("drops").upsert({
          id: d.id,
          number: c?.number,
          title: c?.title ?? d.id,
          status: "funding",
          goal_usd_cents: d.goalCents,
          token_mint: mint,
          treasury_wallet: treasury.publicKey.toBase58(),
          excluded_wallets: excluded,
          opened_at: new Date().toISOString(),
        }),
        "save drop",
      );
      await postMemo(conn, ops, fingerprintMemo(d.id, "opened", `${d.goalCents}c`));
    },

    async snapshot(d) {
      const slot = await conn.getSlot();
      const accounts = await readHolders(mint);
      // Any other program account (another pool, a vault) can't sign a claim either, so it's left out too.
      const programs = accounts.map((a) => a.owner).filter((owner) => !canSign(owner));
      const snap = buildSnapshot(d.id, slot, new Date().toISOString(), accounts, [...excluded, ...programs]);
      const hash = hashSnapshot(snap);
      const memo = await postMemo(conn, ops, fingerprintMemo(d.id, "snapshot", String(slot), hash));
      check(
        await db.from("snapshots").insert({ drop_id: d.id, slot, taken_at: snap.takenAt, holder_count: snap.holders.length, snapshot_hash: hash, data: snap, memo_tx: memo }),
        "save snapshot",
      );
      return { hash, holders: snap.holders.length };
    },

    async fund(d, cents) {
      // A drop is paid once, even if the engine loaded an old state: check the saved record, then the chain.
      const { data: row } = check(await db.from("drops").select("funded_tx").eq("id", d.id).maybeSingle(), "load funding");
      const paid = row?.funded_tx ?? (await findFunding(conn, treasury.publicKey, d.id));
      if (paid) console.warn(`${d.id} was already funded (${paid}); not paying again`);
      const tx =
        paid ??
        (CLUSTER === "mainnet-beta"
          ? await swapToPrize(conn, ops, treasury, prize, d.id, cents, RESERVE_LAMPORTS)
          : await moveToPrize(conn, ops, treasury, prize, d.id, cents, await solPrice()));
      if (!row?.funded_tx) check(await db.from("drops").update({ funded_at: new Date().toISOString(), funded_tx: tx }).eq("id", d.id), "save funding");
    },

    async lockTickets(d) {
      const { data } = check(await db.from("snapshots").select("data").eq("drop_id", d.id).order("slot"), "load snapshots");
      const snaps = (data ?? []).map((r) => r.data as Snapshot);
      const tickets = snaps.length ? toTickets(combineWeights(snaps), snaps.length) : [];
      const hash = hashWeights(tickets);
      const total = tickets.reduce((n, t) => n + t.weight, 0n);
      if (total === 0n) return { hash, totalTickets: 0 };
      const memo = await postMemo(conn, ops, fingerprintMemo(d.id, "tickets", hash));
      check(
        await db.from("draws").upsert({
          drop_id: d.id,
          weights_hash: hash,
          weights_memo_tx: memo,
          total_weight: total.toString(),
          tickets: tickets.map((t) => ({ wallet: t.wallet, weight: t.weight.toString() })),
        }),
        "save tickets",
      );
      return { hash, totalTickets: Number(total) };
    },

    async requestRandomness(d, round) {
      const seed = drawSeed(d.id, d.ticketsHash!, round);
      const tx = await requestRandomness(conn, ops, seed);
      check(
        await db.from("draw_rounds").upsert({ drop_id: d.id, round, seed: hex(seed), randomness_account: randomnessAccount(seed), ...(tx ? { request_tx: tx } : {}) }),
        "save draw round",
      );
    },

    async readRandomness(d, round) {
      // Already picked (say a crash came right after): reuse it rather than post it twice.
      const { data: saved } = check(
        await db.from("draw_rounds").select("winner_wallet, winning_index").eq("drop_id", d.id).eq("round", round).maybeSingle(),
        "load draw round",
      );
      if (saved?.winner_wallet) return { winner: saved.winner_wallet as string, ticket: Number(saved.winning_index) + 1 };

      const bytes = await readRandomness(conn, ops, drawSeed(d.id, d.ticketsHash!, round));
      if (!bytes) return null;
      const { data: draw } = check(await db.from("draws").select("tickets").eq("drop_id", d.id).single(), "load tickets");
      if (!draw) throw new Error(`no locked ticket list for ${d.id}`);
      const entries = (draw.tickets as { wallet: string; weight: string }[]).map((t) => ({ wallet: t.wallet, weight: BigInt(t.weight) }));
      const win = pickWinner(bytes, entries);
      const ticket = win.index + 1n;
      const memo = await postMemo(conn, ops, fingerprintMemo(d.id, "drawn", `r${round}`, win.wallet, `#${ticket}`));
      check(
        await db
          .from("draw_rounds")
          .update({ randomness_hex: hex(bytes), winning_index: win.index.toString(), winner_wallet: win.wallet, result_memo_tx: memo, drawn_at: new Date().toISOString() })
          .eq("drop_id", d.id)
          .eq("round", round),
        "save winner",
      );
      return { winner: win.wallet, ticket: Number(ticket) };
    },

    async placeOrder(d) {
      // Set up only when an order is due, so a missing Zinc key never stops the rest of the engine.
      if (!process.env.ZINC_API_KEY) return { waiting: "Zinc isn't configured yet (ZINC_API_KEY)" };
      return orderStep(d, liveOrderDeps(conn, ops));
    },

    async trackDelivery(d) {
      if (!process.env.ZINC_API_KEY) return { waiting: "Zinc isn't configured yet (ZINC_API_KEY)" };
      return deliveryStep(d, liveDeliveryDeps(conn, ops));
    },

    // The prize has arrived (or the receipt window has closed), so the winner's address, kept only
    // to ship it, is deleted. The public fingerprint stays; the winner holds the secret code for it.
    async complete(d) {
      check(await db.from("claim_addresses").delete().eq("drop_id", d.id), "delete winner address");
    },

    async alert(message) {
      const url = process.env.ALERT_WEBHOOK_URL;
      if (!url) return console.warn(`[alert] ${message}`);
      await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `LOOTBOX: ${message}` }) });
    },
  };
}

async function finishedReceipts(dropIds: string[]): Promise<FinishedReceipt[]> {
  if (!dropIds.length) return [];
  const { data } = check(await serverDb().from("receipts").select("drop_id, wallet, created_at").in("drop_id", dropIds).not("memo_tx", "is", null), "load receipts");
  return (data ?? []) as FinishedReceipt[];
}

// The engine's store, with newly queued drops added, finished claims and receipts read in (see
// ./claims, ./receipts), and each drop's stage mirrored to the public drops table whenever it changes.
export function liveStore(): EngineStore {
  const store = withQueuedDrops(supabaseStore(initialState()));
  const db = serverDb();
  let stages = new Map<string, string>();
  return {
    ...store,
    async load() {
      const loaded = await store.load();
      const waiting = loaded.drops.filter((d) => d.stage === "claiming" && !d.claimedAt).map((d) => d.id);
      const delivered = loaded.drops.filter((d) => d.stage === "delivered" && !d.receivedAt).map((d) => d.id);
      const state = withReceipts(withClaims(loaded, await claimStore.completed(waiting)), await finishedReceipts(delivered));
      stages = new Map(state.drops.map((d) => [d.id, d.stage]));
      return state;
    },
    async save(state) {
      await store.save(state);
      for (const d of state.drops) {
        if (d.stage === "upcoming" || stages.get(d.id) === d.stage) continue;
        check(await db.from("drops").update({ status: d.stage }).eq("id", d.id), "mirror drop stage");
        stages.set(d.id, d.stage);
      }
    },
  };
}
