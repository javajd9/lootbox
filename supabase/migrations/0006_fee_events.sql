-- One row per real $LOOT trade: the creator fee it paid into the pool (public). Written by
-- /api/fees from Helius webhooks; the homepage drops a coin for each one.
create table fee_events (
  signature text primary key,                -- the trade's transaction; Helius may send it twice
  cluster text not null,                     -- the Solana network: mainnet-beta
  slot bigint not null,
  at timestamptz not null,                   -- the block's time
  venue text not null check (venue in ('curve', 'pool')),
  side text not null check (side in ('buy', 'sell')),
  trader text not null,
  fee_lamports bigint not null check (fee_lamports > 0),
  trade_lamports bigint not null,
  sol_usd numeric not null,                  -- SOL's price when it was recorded
  fee_usd numeric not null,
  trade_usd numeric not null,
  recorded_at timestamptz not null default now()
);
create index fee_events_recent on fee_events (cluster, at desc);
alter table fee_events enable row level security;
create policy public_read on fee_events for select using (true);
