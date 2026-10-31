// Sample data until Supabase, Helius and Zinc are connected.
// DROP-000 is a clearly labelled DEMO: its proofs are generated with the real proof code, so the
// proof page's checks genuinely run against them.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { commitWithSalt } from "../proofs/commitment";
import { buildPackage, hashPackage, type ProofPackage } from "../proofs/package";
import { receiptMessage } from "../proofs/receipt";
import type { Drop, DropProofs } from "./types";
import type { PastDrop } from "../live/types";

const TREASURY = "LooTTreasury1111111111111111111111111111111";

const GTA_ITEMS = [
  { name: "PS5 Pro", productId: "ASIN-TBD-PS5PRO", quantity: 1, image: "/prizes/ps5-pro.webp" },
  { name: "OLED Monitor", productId: "ASIN-TBD-OLED", quantity: 1, image: "/prizes/oled-monitor.webp" },
  { name: "GTA VI", productId: "ASIN-TBD-GTA6", quantity: 1, image: "/prizes/gta6.webp" },
];

const EXCLUDED = [
  { label: "pump.fun bonding curve", wallet: "TBD at launch" },
  { label: "Liquidity pool", wallet: "TBD at launch" },
  { label: "Dev wallet", wallet: "TBD at launch" },
  { label: "Treasury", wallet: TREASURY },
];

// Demo winner: a throwaway keypair derived from a fixed seed, so the receipt signature is real.
const demoWinner = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(42));
const DEMO_WINNER_WALLET = bs58.encode(demoWinner.publicKey);

export const DEMO_ADDRESS = { name: "Demo Winner", line1: "1 Example Way", city: "Sampletown", state: "CA", zip: "90001" };
export const DEMO_SALT = "5a".repeat(32);
const demoCommitment = commitWithSalt(DEMO_ADDRESS, DEMO_SALT);

const drops: Drop[] = [
  {
    id: "DROP-001",
    title: "GTA VI Bundle",
    tagline: "PS5 Pro + OLED monitor + GTA VI, funded by $LOOT trading fees.",
    status: "upcoming",
    demo: false,
    goalUsd: 2000,
    fundedUsd: 0,
    items: GTA_ITEMS,
    treasuryWallet: TREASURY,
    excludedWallets: EXCLUDED,
  },
  {
    // Placeholder until the second prize is chosen.
    id: "DROP-002",
    title: "Mystery Drop",
    tagline: "Prize revealed soon.",
    status: "upcoming",
    demo: false,
    goalUsd: 2000,
    fundedUsd: 0,
    items: [],
    treasuryWallet: TREASURY,
    excludedWallets: EXCLUDED,
  },
  {
    id: "DROP-000",
    title: "Demo drop (sample data)",
    tagline: "A full rehearsal of the proof pipeline with fake data, so you can see every check run.",
    status: "complete",
    demo: true,
    goalUsd: 2000,
    fundedUsd: 2000,
    items: GTA_ITEMS,
    treasuryWallet: TREASURY,
    excludedWallets: EXCLUDED,
    winnerWallet: DEMO_WINNER_WALLET,
    addressCommitment: demoCommitment.commitment,
  },
];

function demoProofs(): DropProofs {
  const drop = drops.find((d) => d.id === "DROP-000")!;
  const amazonOrderId = "112-0000000-0000000";
  const receipt = receiptMessage({ dropId: drop.id, amazonOrderId, commitment: demoCommitment.commitment, receivedOn: "2026-10-12" });
  const receiptSig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(receipt), demoWinner.secretKey));

  const steps: Pick<ProofPackage, "type" | "createdAt" | "revealed" | "attestation">[] = [
    { type: "address_commitment", createdAt: "2026-10-05T15:00:00Z", revealed: { commitment: demoCommitment.commitment, winner: drop.winnerWallet }, attestation: null },
    { type: "payment", createdAt: "2026-10-05T15:05:00Z", revealed: { from: TREASURY, to: "ZincTopUp111 (demo)", usdc: 1850 }, attestation: { solanaTx: "demo-tx-signature" } },
    {
      type: "order",
      createdAt: "2026-10-05T15:12:00Z",
      revealed: { source: "zinc", status: "request_processed", amazonOrderId, items: GTA_ITEMS.map(({ productId, quantity }) => ({ productId, quantity })), totalUsd: 1749.97 },
      attestation: { reclaim: "demo: real zkTLS proof goes here" },
    },
    { type: "tracking", createdAt: "2026-10-07T09:30:00Z", revealed: { source: "aftership", carrier: "ups", tag: "InTransit" }, attestation: { reclaim: "demo" } },
    { type: "tracking", createdAt: "2026-10-10T18:02:00Z", revealed: { source: "aftership", carrier: "ups", tag: "Delivered" }, attestation: { reclaim: "demo" } },
    { type: "receipt", createdAt: "2026-10-12T12:00:00Z", revealed: { message: receipt, wallet: drop.winnerWallet }, attestation: { signature: receiptSig } },
  ];

  const packages: ProofPackage[] = [];
  for (const s of steps) packages.push(buildPackage({ dropId: drop.id, ...s }, packages.at(-1)));
  return { drop, packages, anchoredHashes: packages.map(hashPackage), memoTxs: packages.map((_, i) => `demo-memo-${i}`) };
}

export function listDrops(): Drop[] {
  return drops;
}

export function getDrop(id: string): Drop | undefined {
  return drops.find((d) => d.id === id);
}

// Live (non-demo) drops in order: the one filling now, then what's queued after it.
export function getDropQueue(): Drop[] {
  return drops.filter((d) => !d.demo && d.status !== "complete");
}

// Sample winner history for demo mode: the rehearsal drop, with steps timed from its real proof packages.
export function getDemoHistory(): PastDrop[] {
  const { drop, packages } = demoProofs();
  const at = (type: ProofPackage["type"], tag?: string) =>
    packages.find((p) => p.type === type && (!tag || p.revealed.tag === tag))?.createdAt;
  // Three sample prizes mid-delivery, to show the "On the way" board with several at once.
  const sample = (code: string, title: string, valueUsd: number, wallet: string, ticket: number, walletTickets: number, done: PastDrop["done"]): PastDrop => ({
    id: `SAMPLE-${code}`,
    code,
    number: 0,
    title,
    valueUsd,
    wallet,
    ticket,
    totalTickets: 72_410,
    walletTickets,
    sample: true,
    proofId: drop.id,
    done,
  });
  return [
    sample("S03", "Switch 2 Bundle", 750, "9mQ2HvL4kTz8RwX1cPe7nJdB3sYf6aGu5oKiMq2tVb8N", 31_877, 96, {
      funded: "2026-10-26T19:40:00Z",
      drawn: "2026-10-26T19:41:00Z",
    }),
    sample("S02", "Apple Drop", 2400, "Bf3aYk7Lw2PqR9xTnD4vMc8sHj1uZe6gKo5iWb3tAh1z", 5_204, 1_310, {
      funded: "2026-10-18T02:10:00Z",
      drawn: "2026-10-18T02:11:00Z",
      claimed: "2026-10-18T16:30:00Z",
      paid: "2026-10-18T16:34:00Z",
      ordered: "2026-10-18T16:41:00Z",
      shipped: "2026-10-20T11:05:00Z",
    }),
    sample("S01", "Charizard Vault", 1900, "7xKpQ2vRdLm3nBf8hTzW1cYe5sJa9uGq4oXiN6kE9mQ2", 66_013, 433, {
      funded: "2026-10-14T21:00:00Z",
      drawn: "2026-10-14T21:01:00Z",
      claimed: "2026-10-15T09:12:00Z",
      paid: "2026-10-15T09:15:00Z",
      ordered: "2026-10-15T09:20:00Z",
      shipped: "2026-10-16T14:00:00Z",
      delivered: "2026-10-24T18:22:00Z",
    }),
    {
      id: drop.id,
      code: "000",
      number: 0,
      title: "GTA VI Bundle (rehearsal)",
      valueUsd: 1750,
      wallet: drop.winnerWallet!,
      ticket: 48_213,
      totalTickets: 61_402,
      walletTickets: 412,
      sample: true,
      done: {
        funded: "2026-10-05T14:52:00Z",
        drawn: "2026-10-05T14:58:00Z",
        claimed: at("address_commitment"),
        paid: at("payment"),
        ordered: at("order"),
        shipped: at("tracking", "InTransit"),
        delivered: at("tracking", "Delivered"),
        received: at("receipt"),
      },
    },
  ];
}

export function getDropProofs(id: string): DropProofs | undefined {
  if (id === "DROP-000") return demoProofs();
  const drop = getDrop(id);
  return drop ? { drop, packages: [], anchoredHashes: [], memoTxs: [] } : undefined;
}
