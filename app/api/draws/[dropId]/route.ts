// Everything needed to re-run a drop's draw (see /docs/reproduce), as public JSON: each snapshot's
// fingerprint and the Solana transaction that carries it, the locked ticket list exactly as it was
// hashed, and each draw round's seed, ORAO randomness account, randomness and result. Each
// snapshot's full holder list is its own file (./snapshots/[slot]), since there can be many holders.
import { NextResponse } from "next/server";
import { CLUSTER } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { TOKEN_DECIMALS, TOKENS_PER_TICKET } from "@/lib/draws/tickets";
import { dropConfig } from "@/lib/engine/drops";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: Request, { params }: { params: { dropId: string } }) {
  if (!dropConfig(params.dropId)) return NextResponse.json({ error: "unknown drop" }, { status: 404 });
  const id = params.dropId;
  const base = new URL(req.url).origin;
  try {
    const db = serverDb();
    const [dropRes, snapsRes, drawRes, roundsRes] = await Promise.all([
      db.from("drops").select("token_mint, excluded_wallets").eq("id", id).maybeSingle(),
      db.from("snapshots").select("slot, taken_at, holder_count, snapshot_hash, memo_tx").eq("drop_id", id).order("slot"),
      db.from("draws").select("weights_hash, weights_memo_tx, total_weight, tickets").eq("drop_id", id).maybeSingle(),
      db
        .from("draw_rounds")
        .select("round, seed, randomness_account, request_tx, randomness_hex, winning_index, winner_wallet, result_memo_tx, drawn_at")
        .eq("drop_id", id)
        .order("round"),
    ]);
    const drop = check(dropRes, "load drop").data;
    const snaps = check(snapsRes, "load snapshots").data;
    const draw = check(drawRes, "load tickets").data;
    const rounds = check(roundsRes, "load draw rounds").data;
    if (!drop) return NextResponse.json({ error: "unknown drop" }, { status: 404 });

    return NextResponse.json(
      {
        dropId: id,
        cluster: CLUSTER,
        token: drop.token_mint,
        tokenDecimals: TOKEN_DECIMALS,
        tokensPerTicket: TOKENS_PER_TICKET.toString(),
        excludedWallets: drop.excluded_wallets ?? [],
        snapshots: (snaps ?? []).map((s) => ({
          slot: s.slot,
          takenAt: s.taken_at,
          holders: s.holder_count,
          hash: s.snapshot_hash,
          memoTx: s.memo_tx,
          data: `${base}/api/draws/${id}/snapshots/${s.slot}`,
        })),
        tickets: draw
          ? { hash: draw.weights_hash, memoTx: draw.weights_memo_tx, total: draw.total_weight, list: draw.tickets }
          : null, // not locked yet
        rounds: (rounds ?? []).map((r) => ({
          round: r.round,
          seed: r.seed,
          randomnessAccount: r.randomness_account,
          requestTx: r.request_tx,
          randomness: r.randomness_hex,
          winningIndex: r.winning_index === null ? null : String(r.winning_index),
          winningTicket: r.winning_index === null ? null : (BigInt(r.winning_index) + 1n).toString(),
          winner: r.winner_wallet,
          resultMemoTx: r.result_memo_tx,
          drawnAt: r.drawn_at,
        })),
      },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("draw data failed", err);
    return NextResponse.json({ error: "draw data unavailable" }, { status: 503 });
  }
}
