# LOOTBOX

Hold $LOOT, win real prizes funded by trading fees, and see public proof that every prize was funded, drawn fairly, bought and delivered, without revealing the winner's details.

## Run the site
```
npm install
npm run dev     # http://localhost:3000
```
Pages: `/` (current drop), `/proof/DROP-000` (demo proofs, checked live in the browser), `/claim` (winner wallet claim).
Data is sample data in `lib/data/mock.ts` until Supabase is connected (`supabase/migrations/0001_init.sql`).

| File | Job |
|---|---|
| `lib/draws/snapshot.ts` | Holder snapshots, exclusions, average-balance weights, hashes |
| `lib/draws/weighted-pick.ts` | Unbiased winner pick from ORAO VRF randomness |
| `lib/claims/claims.ts` | One-time wallet-signature claim (nonce, expiry, replay protection) |
| `components/ProofChecks.tsx` | Runs every proof check in the visitor's browser |
| `components/WinnerAddressCheck.tsx` | Winner privately checks the prize went to their address |
| `lib/proofs/commitment.ts` | Salted address fingerprint the winner can check privately |
| `lib/proofs/package.ts` | Proof packages chained by hash; matched against Solana memos |
| `lib/proofs/receipt.ts` | "I received it" message signed by the winning wallet |
| `lib/proofs/pii-guard.ts` | Blocks publishing if any winner detail shows up in a proof |
| `scripts/gate-zinc.ts` | Day-1 test: does Zinc's order record have what we need? |
| `scripts/gate-zkfetch.ts` | Day-1 test: zkTLS proof of a Zinc order with nothing private leaking |

## Run
```
npm install
npm test
```

## Day-1 gates (after signing up for Zinc and Reclaim, and placing one cheap test order to yourself)
1. Copy `.env.example` to `.env` and fill it in.
2. `npm run gate:zinc` — shows which needed fields exist and which must be redacted.
3. Update the `REVEAL` list in `scripts/gate-zkfetch.ts` to match, then `npm run gate:zkfetch`.
