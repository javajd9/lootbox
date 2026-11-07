# Developing LOOTBOX

This is the working guide for the code behind [getlootbox.fun](https://www.getlootbox.fun). For what LOOTBOX is and how to check it, see the [README](README.md).

Pushing `main` deploys the live site on Vercel. Apply new database migrations with `npm run db:migrate` before pushing code that needs them.

## Running it locally

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

The site runs at http://localhost:3000. `.env.example` lists every key and what it's for. With no Supabase keys, the homepage shows the drop queue from `lib/data/drops.ts`.

## Layout

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
| `npm test` | Unit tests |
| `npm run db:migrate` | Applies `supabase/migrations` (needs `SUPABASE_DB_URL`) |
| `npm run db:check` | Checks the database is set up and that visitors can't read the engine's private state |
| `npm run gate:zinc` | Reads a Zinc order and lists which fields the proofs can use |
| `npm run gate:zkfetch` | Makes a zkTLS proof of that order and confirms no shipping details are in it |

## Devnet and operations

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

Secrets live in `.env` and `.keys/`, and neither is ever committed.
