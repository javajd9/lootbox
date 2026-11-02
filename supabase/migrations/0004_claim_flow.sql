-- The winner's claim: a signed wallet message, then a $0 Shopify checkout that collects the
-- shipping address. The engine reads finished claims on every tick and moves the drop on.

-- Which draw round the claim is for (a redraw picks a new winner, so an old claim never counts),
-- the exact message the winner signed, and the claim token that ties the Shopify order back here.
alter table claims add column round int not null default 1;
alter table claims add column message text;
alter table claims add column token text unique;
alter table claims add column checkout_url text;
alter table claims add column verified_at timestamptz;
alter table claims add column completed_at timestamptz;   -- when the address arrived and was fingerprinted
alter table claims add column memo_started_at timestamptz; -- so two webhook deliveries never post twice
alter table claims add column address_memo_tx text;
-- The salt lives with the address in claim_addresses instead.
alter table claims drop column salt_encrypted;

-- The winner's shipping address, kept only so the prize can be bought and shipped. Private: row
-- level security is on with no policies, so only the server (service role key) can read it. The
-- public sees only the salted hash, on-chain.
create table claim_addresses (
  claim_id uuid primary key references claims(id),
  drop_id text not null references drops(id),
  shopify_order_id text not null,
  address jsonb not null,
  normalized text not null,
  salt text not null,
  commitment text not null,
  created_at timestamptz not null default now()
);
alter table claim_addresses enable row level security;
