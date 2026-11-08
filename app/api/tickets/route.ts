// "How many tickets do I have?" for the homepage: GET /api/tickets?wallet=<address>.
// A wallet's tickets in the drop that's filling now, worked out exactly as the draw does
// (lib/draws/tickets): its balance averaged over the drop's snapshots so far. Once the list is
// locked for the draw, the locked list is read instead. Only taken snapshots are used, so nothing
// here hints at when the next one is due. Before the first snapshot there's nothing to average, so
// the wallet's balance right now gives an estimate instead.
import { NextResponse } from "next/server";
import { canSign, readBalance } from "@/lib/chain/holders";
import { isWalletAddress } from "@/lib/claims/claims";
import { publishedAddresses } from "@/lib/config/addresses";
import { check, serverDb } from "@/lib/db";
import { combineWeights, type Snapshot } from "@/lib/draws/snapshot";
import { TOKEN_DECIMALS, toTickets } from "@/lib/draws/tickets";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const LIVE = ["funding", "snapshotting", "drawing"];

export interface TicketsView {
  drop: { id: string; number: number } | null; // null: no drop is filling right now
  snapshots: number;
  tickets: number; // this wallet's
  totalTickets: number; // everyone's
  locked: boolean; // the list the draw uses is final
  holding?: { tokens: number; tickets: number; leftOut: boolean } | null; // before the first snapshot: what the wallet holds now
}

// What a snapshot taken right now would count for this wallet, or null if it can't be read.
async function holdingNow(wallet: string): Promise<TicketsView["holding"]> {
  const own = publishedAddresses();
  if (!own.token) return null;
  try {
    const balance = await readBalance(own.token, wallet);
    const leftOut = !canSign(wallet) || [own.treasury, own.purchasing, own.publisher, own.bondingCurve, own.pool, ...own.team].includes(wallet);
    const tickets = leftOut ? 0 : Number(toTickets([{ wallet, weight: balance }], 1)[0]?.weight ?? 0n);
    return { tokens: Number(balance) / 10 ** TOKEN_DECIMALS, tickets, leftOut };
  } catch (err) {
    console.error("balance failed", err);
    return null;
  }
}

// A taken snapshot never changes, so each drop's ticket list is worked out again only when a new
// snapshot lands (per server), not on every check.
let cache: { key: string; tickets: Map<string, bigint>; total: bigint } | undefined;

const view = (v: TicketsView) =>
  NextResponse.json(v, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim() ?? "";
  if (!isWalletAddress(wallet)) return NextResponse.json({ error: "Send a valid Solana wallet address." }, { status: 400 });
  try {
    const db = serverDb();
    const { data: drop } = check(
      await db.from("drops").select("id, number").in("status", LIVE).order("number", { ascending: false }).limit(1).maybeSingle(),
      "load drop",
    );
    if (!drop) return view({ drop: null, snapshots: 0, tickets: 0, totalTickets: 0, locked: false, holding: await holdingNow(wallet) });
    const current = { id: drop.id as string, number: Number(drop.number) };

    const { data: slots } = check(await db.from("snapshots").select("slot").eq("drop_id", current.id), "load snapshot list");
    const count = slots?.length ?? 0;

    // Locked for the draw: the exact list the winner is picked from.
    const { data: locked } = check(await db.from("draws").select("tickets, total_weight").eq("drop_id", current.id).maybeSingle(), "load locked tickets");
    if (locked) {
      const row = (locked.tickets as { wallet: string; weight: string }[]).find((t) => t.wallet === wallet);
      return view({ drop: current, snapshots: count, tickets: Number(row?.weight ?? 0), totalTickets: Number(locked.total_weight), locked: true });
    }
    if (!count) return view({ drop: current, snapshots: 0, tickets: 0, totalTickets: 0, locked: false, holding: await holdingNow(wallet) });

    const key = `${current.id}:${count}:${Math.max(...slots!.map((s) => Number(s.slot)))}`;
    if (cache?.key !== key) {
      const { data } = check(await db.from("snapshots").select("data").eq("drop_id", current.id).order("slot"), "load snapshots");
      const snaps = (data ?? []).map((r) => r.data as Snapshot);
      const list = toTickets(combineWeights(snaps), snaps.length);
      cache = { key, tickets: new Map(list.map((t) => [t.wallet, t.weight])), total: list.reduce((n, t) => n + t.weight, 0n) };
    }
    return view({
      drop: current,
      snapshots: count,
      tickets: Number(cache.tickets.get(wallet) ?? 0n),
      totalTickets: Number(cache.total),
      locked: false,
    });
  } catch (err) {
    console.error("tickets failed", err);
    return NextResponse.json({ error: "Ticket counts are unavailable right now. Try again in a minute." }, { status: 503 });
  }
}
