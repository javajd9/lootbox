-- Orders paid in USDC from the prize wallet (Zinc's agent endpoint, lib/orders/x402.ts).
-- Zinc hands back a key with each paid order: the only way to follow that order, so it's kept here,
-- in the private orders table (row level security on, no policies: only the server reads it).
-- The payment itself is a public Solana transaction, and goes in the order's proof.
alter table orders add column if not exists zinc_api_key text;
alter table orders add column if not exists payment_tx text; -- the USDC transfer from the prize wallet to Zinc
