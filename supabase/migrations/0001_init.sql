-- LOOTBOX core schema. Every row hangs off a drop.
-- Privacy rule: no names, addresses, emails or phone numbers are stored anywhere here.
-- Shipping details live in Shopify and are passed to Zinc in memory only.

create type drop_status as enum ('upcoming', 'funding', 'snapshotting', 'drawing', 'claiming', 'fulfilling', 'delivered', 'complete');
create type claim_status as enum ('nonce_issued', 'wallet_verified', 'checkout_sent', 'checkout_complete', 'expired');
create type order_status as enum ('pending', 'placed', 'failed', 'cancelled');
create type proof_type as enum ('address_commitment', 'payment', 'order', 'tracking', 'receipt');

create table drops (
  id text primary key,                       -- 'DROP-001'
  title text not null,
  description text,
  image_url text,
  status drop_status not null default 'upcoming',
  goal_usd_cents bigint not null check (goal_usd_cents > 0),
  token_mint text not null,
  treasury_wallet text not null,
  excluded_wallets text[] not null default '{}',   -- curve, pool, team, dev, treasury
  snapshot_window_start timestamptz,
  snapshot_window_end timestamptz,
  snapshot_count int not null default 6,
  claim_deadline_days int not null default 14,
  created_at timestamptz not null default now()
);

create table prize_items (
  id bigint generated always as identity primary key,
  drop_id text not null references drops(id),
  name text not null,
  retailer text not null default 'amazon',
  product_id text not null,                  -- ASIN, locked before launch
  quantity int not null default 1 check (quantity > 0),
  max_price_cents bigint not null check (max_price_cents > 0)
);

create table snapshots (
  id bigint generated always as identity primary key,
  drop_id text not null references drops(id),
  slot bigint not null,
  taken_at timestamptz not null,
  holder_count int not null,
  snapshot_hash text not null,
  data_url text not null,                    -- public JSON of the snapshot
  memo_tx text,                              -- Solana Memo with snapshot_hash
  unique (drop_id, slot)
);

create table draws (
  drop_id text primary key references drops(id),
  weights_hash text not null,
  weights_memo_tx text,                      -- posted BEFORE randomness is requested
  vrf_seed text,
  vrf_request_tx text,
  randomness_hex text,
  total_weight numeric,
  winning_index numeric,
  winner_wallet text,
  drawn_at timestamptz
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  drop_id text not null references drops(id),
  wallet text not null,
  nonce text not null unique,
  nonce_expires_at timestamptz not null,
  status claim_status not null default 'nonce_issued',
  shopify_draft_order_id text,
  shopify_order_id text unique,
  address_commitment text,
  salt_encrypted text,                       -- only the winner ever sees the plain salt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Only one successful claim per drop.
create unique index one_claim_per_drop on claims (drop_id) where status = 'checkout_complete';

create table orders (
  id uuid primary key default gen_random_uuid(),
  drop_id text not null references drops(id),
  claim_id uuid not null unique references claims(id),   -- idempotency: one order per claim
  zinc_request_id text unique,
  merchant_order_ids text[],
  status order_status not null default 'pending',
  total_cents bigint,
  created_at timestamptz not null default now()
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  carrier text,
  tracking_hash text,                        -- never the raw tracking number
  aftership_id text,
  status text,
  delivered_at timestamptz
);

create table treasury_events (
  id bigint generated always as identity primary key,
  drop_id text references drops(id),
  kind text not null check (kind in ('creator_fee', 'topup_zinc', 'other_out')),
  tx_signature text not null unique,
  amount_lamports numeric,
  amount_usdc_micro numeric,
  usd_cents bigint,
  occurred_at timestamptz not null
);

create table proofs (
  id bigint generated always as identity primary key,
  drop_id text not null references drops(id),
  seq int not null,
  type proof_type not null,
  package jsonb not null,                    -- the ProofPackage, PII-checked before insert
  package_hash text not null,
  memo_tx text,
  created_at timestamptz not null default now(),
  unique (drop_id, seq)
);

create table audit_events (
  id bigint generated always as identity primary key,
  drop_id text references drops(id),
  actor text not null,                       -- 'system', 'admin', 'webhook:zinc', ...
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Row level security: the public can read everything that's already public; only the
-- server (service role key, which bypasses RLS) can write. Claims are never public.
alter table drops enable row level security;
alter table prize_items enable row level security;
alter table snapshots enable row level security;
alter table draws enable row level security;
alter table claims enable row level security;
alter table orders enable row level security;
alter table shipments enable row level security;
alter table treasury_events enable row level security;
alter table proofs enable row level security;
alter table audit_events enable row level security;

create policy public_read on drops for select using (true);
create policy public_read on prize_items for select using (true);
create policy public_read on snapshots for select using (true);
create policy public_read on draws for select using (true);
create policy public_read on treasury_events for select using (true);
create policy public_read on proofs for select using (true);
create policy public_read on shipments for select using (true);
