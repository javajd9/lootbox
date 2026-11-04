// The winner's "I received it" (proof 8). Once the prize is delivered, the winner signs a fixed
// message with the winning wallet: the drop, the retailer's order number and their address
// fingerprint. The signature is the only credential needed, so it works from any device.
//
// The signed message becomes a "receipt" proof package at the end of the drop's chain, its
// fingerprint is posted on-chain (LOOTBOX|v1|<drop>|received|<hash>), and the engine completes the
// drop on its next tick (see lib/engine/receipts.ts). Every step is saved as it's done, so sending
// the same signature again finishes whatever a crash left undone.
import { fingerprintMemo, postMemo } from "@/lib/chain/memo";
import { connection, opsWallet } from "@/lib/chain/solana";
import { check, serverDb } from "@/lib/db";
import { liveStore } from "@/lib/engine/live";
import type { DropRecord } from "@/lib/engine/types";
import { buildPackage, hashPackage, type ProofPackage } from "@/lib/proofs/package";
import { receiptMessage, verifyReceipt } from "@/lib/proofs/receipt";
import { isWalletAddress } from "./claims";

const DAY = 864e5;
const RECEIVABLE = new Set(["delivered", "complete"]);

export type ReceiptAnswer = { ok: true; message: string } | { ok: false; status: number; error: string };

interface ReceiptRow {
  drop_id: string;
  wallet: string;
  message: string;
  signature: string;
  proof_hash: string | null;
  memo_tx: string | null;
}

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

// What the winner signs, and whether they can sign it yet.
async function expected(dropId: string, wallet: string, receivedOn: string): Promise<ReceiptAnswer & { drop?: DropRecord }> {
  if (!isWalletAddress(wallet)) return fail(400, "That isn't a Solana wallet address.");
  const drop = (await liveStore().load()).drops.find((d) => d.id === dropId);
  if (!drop) return fail(404, "No drop with that ID.");
  if (drop.winner !== wallet) return fail(403, "This wallet didn't win this drop. Connect the winning wallet.");
  if (!RECEIVABLE.has(drop.stage)) return fail(409, "The carrier hasn't marked this prize delivered yet. Come back once it has arrived.");

  const db = serverDb();
  const [{ data: claim }, { data: order }] = await Promise.all([
    db.from("claims").select("address_commitment").eq("drop_id", dropId).eq("status", "checkout_complete").maybeSingle(),
    db.from("proofs").select("package").eq("drop_id", dropId).eq("type", "order").maybeSingle(),
  ]);
  const revealed = ((order?.package as ProofPackage | undefined)?.revealed ?? {}) as { merchantOrderIds?: string; orderId?: string };
  // The retailer's order number, as the order proof shows it (Zinc's own order id if it shows none).
  const orderNo = /[A-Za-z0-9-]+/.exec(revealed.merchantOrderIds ?? "")?.[0] ?? revealed.orderId;
  if (!claim?.address_commitment || !orderNo) return fail(409, "This drop's claim or order record is missing. Contact LOOTBOX.");
  return { ok: true, drop, message: receiptMessage({ dropId, amazonOrderId: orderNo, commitment: claim.address_commitment as string, receivedOn }) };
}

// Today's message to sign.
export function receiptToSign(dropId: string, wallet: string, now = new Date()): Promise<ReceiptAnswer> {
  return expected(dropId, wallet, day(now.getTime()));
}

export async function recordReceipt(dropId: string, wallet: string, message: string, signature: string, now = new Date()): Promise<ReceiptAnswer> {
  // The date the winner signed for, within a day of today either way (time zones).
  const receivedOn = /\| (\d{4}-\d{2}-\d{2})$/.exec(message)?.[1] ?? "";
  if (![day(now.getTime() - DAY), day(now.getTime()), day(now.getTime() + DAY)].includes(receivedOn)) return fail(400, "That message is out of date. Sign again.");
  const want = await expected(dropId, wallet, receivedOn);
  if (!want.ok) return want;
  if (want.message !== message) return fail(400, "That isn't the receipt message for this drop. Sign again.");
  if (!verifyReceipt(message, signature, wallet)) return fail(401, "The signature doesn't match the winning wallet.");

  const db = serverDb();
  // One receipt per drop: the first one signed is kept, and a repeat finishes it.
  check(await db.from("receipts").upsert({ drop_id: dropId, wallet, message, signature, received_on: receivedOn }, { onConflict: "drop_id", ignoreDuplicates: true }), "save receipt");
  const { data } = check(await db.from("receipts").select("drop_id, wallet, message, signature, proof_hash, memo_tx").eq("drop_id", dropId).single(), "load receipt");
  let row = data as ReceiptRow;

  if (!row.proof_hash) {
    // The last link in the drop's proof chain.
    const { data: last } = check(
      await db.from("proofs").select("package, type").eq("drop_id", dropId).order("seq", { ascending: false }).limit(1).maybeSingle(),
      "load proofs",
    );
    let pkg = last?.type === "receipt" ? (last.package as ProofPackage) : null; // saved already, before a crash
    if (!pkg) {
      pkg = buildPackage(
        { dropId, type: "receipt", createdAt: now.toISOString(), revealed: { message: row.message, wallet: row.wallet }, attestation: { signature: row.signature } },
        (last?.package as ProofPackage | undefined) ?? undefined,
      );
      check(await db.from("proofs").insert({ drop_id: dropId, seq: pkg.seq, type: "receipt", package: pkg, package_hash: hashPackage(pkg) }), "save proof");
    }
    row = { ...row, proof_hash: hashPackage(pkg) };
    check(await db.from("receipts").update({ proof_hash: row.proof_hash }).eq("drop_id", dropId), "save receipt proof");
  }

  if (!row.memo_tx) {
    const memo = await postMemo(connection(), opsWallet(), fingerprintMemo(dropId, "received", row.proof_hash!));
    check(await db.from("receipts").update({ memo_tx: memo }).eq("drop_id", dropId), "save receipt memo");
    check(await db.from("proofs").update({ memo_tx: memo }).eq("drop_id", dropId).eq("type", "receipt"), "save proof memo");
  }
  return { ok: true, message: row.message };
}
