<a href="https://www.getlootbox.fun">
  <img src=".github/assets/banner.webp" alt="LOOTBOX: Don't trust. Check." width="100%">
</a>

<p align="center">
  <b>Prize drops for $LOOT holders on Solana.</b><br>
  Trading fees fill a prize pool. When it's full, one ticket is drawn with verifiable randomness,<br>
  the prize is bought and shipped, and every step is published as a proof anyone can check.
</p>

<p align="center">
  <a href="https://www.getlootbox.fun"><b>Website</b></a>
  &nbsp;·&nbsp;
  <a href="https://www.getlootbox.fun/docs"><b>Docs</b></a>
  &nbsp;·&nbsp;
  <a href="https://www.getlootbox.fun/proof"><b>Proofs</b></a>
  &nbsp;·&nbsp;
  <a href="https://www.getlootbox.fun/docs/verify"><b>Verify it yourself</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/chain-Solana-E9B03A?style=flat-square&labelColor=1C1C21" alt="Chain: Solana">
  <img src="https://img.shields.io/badge/randomness-ORAO%20VRF-E9B03A?style=flat-square&labelColor=1C1C21" alt="Randomness: ORAO VRF">
  <img src="https://img.shields.io/badge/proofs-zkTLS-E9B03A?style=flat-square&labelColor=1C1C21" alt="Proofs: zkTLS">
  <img src="https://img.shields.io/badge/app-Next.js%2014-E9B03A?style=flat-square&labelColor=1C1C21" alt="App: Next.js 14">
</p>

<br>

## How a drop works

<img src=".github/assets/how-it-works.svg" alt="Hold, Fill, Draw, Check: every 10,000 $LOOT you hold is a ticket, trading fees fill the prize pool, ORAO VRF picks one locked ticket, and the prize ships with every step proven." width="100%">

- **Hold.** Every 10,000 $LOOT is one ticket, based on your average balance across random, unannounced snapshots taken while the pool fills.
- **Fill.** Every $LOOT trade pays creator fees into a public treasury on Solana. Each drop has a prize pool goal.
- **Draw.** When the pool fills, the ticket list's fingerprint is posted on Solana. Only then is ORAO VRF asked for the randomness that picks one ticket.
- **Check.** The prize is ordered through Zinc and shipped to the winner. Payment, order, delivery and receipt each get a proof.

## Don't trust. Check.

Every drop leaves eight proofs. Steps 1 to 4 happen on Solana, so the transaction is the evidence. Steps 5 to 8 happen off-chain, so each becomes a proof package that links to the one before it, with its fingerprint posted on Solana. Nothing can be changed quietly afterward.

| | Step | Proven by |
|:-:|---|---|
| 1 | **Funded** | Fee transactions into the treasury |
| 2 | **Paid** | One transaction that swaps the goal to USDC and pays the purchasing account |
| 3 | **Drawn** | Snapshot and ticket list fingerprints on Solana, plus the ORAO VRF result |
| 4 | **Claimed** | A fingerprint of the winner's address, posted once the winning wallet signs |
| 5 | **Ordered** | A zkTLS proof of Zinc's own order response |
| 6 | **Shipped** | A zkTLS proof of Zinc's tracking record |
| 7 | **Delivered** | The same, once every package has arrived |
| 8 | **Received** | A message signed by the winning wallet |

The [proof page](https://www.getlootbox.fun/proof) re-runs these checks in your browser, and [Reproduce a draw](https://www.getlootbox.fun/docs/reproduce) shows how to re-run the pick yourself.

**Privacy.** The winner's name, address, phone and email are never published. Only a salted fingerprint of the address goes on-chain, and only the winner can check it. LOOTBOX keeps the address privately until the prize arrives, then deletes it.

<br>

## Running it locally

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

The site runs at http://localhost:3000. `.env.example` lists every key and what it's for. With no Supabase keys, the homepage shows the drop queue from `lib/data/drops.ts`.

## Project layout

| Path | What's there |
|---|---|
| `app/` | Pages and API routes. The docs are MDX files under `app/docs` |
| `lib/engine/` | The drop engine: opening drops, snapshots, the draw, claims and ordering |
| `lib/draws/` | Holder snapshots, ticket math, and the weighted pick from VRF randomness |
| `lib/claims/` | Wallet-signature claims and the Shopify checkout |
| `lib/orders/` | Zinc orders, delivery tracking, and what each zkTLS proof reveals |
| `lib/proofs/` | Proof packages, the address fingerprint, the leak guard, and the checks the proof page runs |
| `lib/treasury/` | Fee collection and the SOL to USDC swap |
| `supabase/migrations/` | Database schema |
| `scripts/` | Setup and maintenance commands, listed below |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local site |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Applies `supabase/migrations` (needs `SUPABASE_DB_URL`) |
| `npm run db:check` | Checks the database is set up and that visitors can't read the engine's private state |
| `npm run gate:zinc` | Reads a Zinc order and lists which fields the proofs can use |
| `npm run gate:zkfetch` | Makes a zkTLS proof of that order and confirms no shipping details are in it |

<details>
<summary><b>Devnet and operations</b></summary>
<br>

| Command | What it does |
|---|---|
| `npm run devnet:setup` | Creates the devnet treasury and prize wallets and fills any blanks in `.env` |
| `npm run devnet:token` | Creates tLOOT, a devnet stand-in for $LOOT held by a handful of wallets |
| `npm run devnet:holder` | A test holder whose key is kept locally, so a claim can be signed end to end |
| `npm run devnet:fees -- 0.05` | Sends test SOL into the devnet treasury, standing in for creator fees |
| `npm run devnet:snapshot` | Takes a real holder snapshot on devnet and posts its fingerprint |
| `npm run devnet:draw` | A full draw on devnet: lock, request randomness, pick, post, re-check |
| `npm run devnet:tick` | Runs the drop engine against devnet from this computer |
| `npm run fees:simulate` | Sends made-up trades to `/api/fees` so the homepage coins can be watched |
| `npm run schedule:tick` | Makes Supabase call the drop engine every minute |
| `npm run helius:webhook` | Registers the Helius webhook that sends every $LOOT trade to `/api/fees` |
| `npm run mainnet:fees-check` | Simulates the mainnet money-in transactions without sending anything |
| `npm run vercel:env` | Writes `.keys/vercel.env` with exactly the lines the live site needs |

</details>

<br>

<p align="center">
  <a href="https://www.getlootbox.fun">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
      <img src=".github/assets/logo-light.svg" alt="LOOTBOX" width="44">
    </picture>
  </a>
  <br>
  <sub>Don't trust. Check.</sub>
</p>
