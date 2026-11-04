-- Buying the prize: one Zinc order per drop, ever. The engine saves this row (with its idempotency
-- key) before it asks Zinc for anything, so a crash or a stale state can never place a second
-- order: a retry sends the same key, and Zinc refuses to make a second order for it.
--
-- Private: row level security is on with no policies (set up in 0001), so only the server can
-- read it. The shipping address is never copied here; it's read from claim_addresses when the
-- order is placed and goes straight to Zinc. What the public sees is the order proof in `proofs`
-- (with every personal detail left out) and its fingerprint on-chain.

alter table orders add column round int not null default 1;
alter table orders add column idempotency_key text not null unique;
alter table orders add column max_price_cents bigint not null check (max_price_cents > 0);
alter table orders add column items jsonb not null;            -- what was bought: [{ name, url, quantity, maxPriceCents }]
alter table orders add column zinc_status text;                -- Zinc's own status: pending, in_progress, order_placed, ...
alter table orders add column error text;                      -- why Zinc failed or refused, if it did
alter table orders add column placed_at timestamptz;           -- when Zinc confirmed the order with the retailer
alter table orders add column checked_at timestamptz;          -- the last status check
alter table orders add column proof_id bigint references proofs(id);
alter table orders add column proof_hash text;
alter table orders add column memo_tx text;                    -- LOOTBOX|v1|<drop>|ordered|<proof hash>
alter table orders add column updated_at timestamptz not null default now();

-- Never two orders for one drop, even across redraws.
alter table orders add constraint one_order_per_drop unique (drop_id);
