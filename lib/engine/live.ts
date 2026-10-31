// The engine's real actions: on Solana (devnet until launch) and in the database, where every
// public record is saved exactly as it was hashed, so anyone can re-check it.
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readHolders } from "@/lib/chain/holders";
import { fingerprintMemo, postMemo } from "@/lib/chain/memo";
import { connection, opsWallet } from "@/lib/chain/solana";
import { drawSeed, randomnessAccount, readRandomness, requestRandomness } from "@/lib/chain/vrf";
import { check, serverDb } from "@/lib/db";
import { buildSnapshot, combineWeights, hashSnapshot, hashWeights, type Snapshot } from "@/lib/draws/snapshot";
import { toTickets } from "@/lib/draws/tickets";
import { pickWinner } from "@/lib/draws/weighted-pick";
import { solPriceUsd } from "@/lib/treasury/price";
import { moveToPrize, treasuryCents } from "@/lib/treasury/treasury";
import { dropConfig, initialState, withQueuedDrops } from "./drops";
import type { EngineStore } from "./run";
import { supabaseStore } from "./supabase-store";
import type { Effects } from "./types";

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
  // LOOTBOX's own wallets never hold tickets.
  const excluded = [ops.publicKey, treasury.publicKey, prize]
    .map((k) => k.toBase58())
    .concat((process.env.EXCLUDED_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  let price: Promise<number> | undefined;
  const solPrice = () => (price ??= solPriceUsd()); // one price for the whole tick

  return {
    async readTreasury() {
      return treasuryCents(conn, treasury.publicKey, await solPrice());
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
      const snap = buildSnapshot(d.id, slot, new Date().toISOString(), await readHolders(mint), excluded);
      const hash = hashSnapshot(snap);
      const memo = await postMemo(conn, ops, fingerprintMemo(d.id, "snapshot", String(slot), hash));
      check(
        await db.from("snapshots").insert({ drop_id: d.id, slot, taken_at: snap.takenAt, holder_count: snap.holders.length, snapshot_hash: hash, data: snap, memo_tx: memo }),
        "save snapshot",
      );
      return { hash, holders: snap.holders.length };
    },

    async fund(d, cents) {
      const tx = await moveToPrize(conn, ops, treasury, prize, d.id, cents, await solPrice());
      check(await db.from("drops").update({ funded_at: new Date().toISOString(), funded_tx: tx }).eq("id", d.id), "save funding");
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

    async placeOrder() {
      return { ok: false, reason: "automatic purchasing isn't connected yet" };
    },

    async alert(message) {
      const url = process.env.ALERT_WEBHOOK_URL;
      if (!url) return console.warn(`[alert] ${message}`);
      await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `LOOTBOX: ${message}` }) });
    },
  };
}

// The engine's store, with newly queued drops added and each drop's stage mirrored to the public
// drops table whenever it changes.
export function liveStore(): EngineStore {
  const store = withQueuedDrops(supabaseStore(initialState()));
  const db = serverDb();
  let stages = new Map<string, string>();
  return {
    ...store,
    async load() {
      const state = await store.load();
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
