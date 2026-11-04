# LOOTBOX

Prize drops for $LOOT holders on Solana. Trading fees fill a prize pool. When it's full, one ticket is drawn with ORAO VRF, the prize is ordered through Zinc, and each step is published as a proof anyone can check.

Site: https://www.getlootbox.fun · Docs: https://www.getlootbox.fun/docs

## Running it locally

```
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
| `scripts/` | Setup and maintenance commands, listed in `package.json` |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local site |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Applies `supabase/migrations` (needs `SUPABASE_DB_URL`) |
| `npm run gate:zinc` | Reads a Zinc order and lists which fields the proofs can use |
| `npm run gate:zkfetch` | Makes a zkTLS proof of that order and confirms no shipping details are in it |
