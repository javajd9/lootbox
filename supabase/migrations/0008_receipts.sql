-- The winner's "I received it" (proof 8): a fixed message signed by the winning wallet once the
-- prize is delivered. One per drop. It's published in full as the drop's last proof package (type
-- 'receipt'), with its fingerprint on-chain: LOOTBOX|v1|<drop>|received|<hash>. The engine reads
-- this table on each tick and completes the drop once the fingerprint is posted.
--
-- Nothing private: the message holds the drop, the retailer's order number and the address
-- fingerprint, all of which are public already.

create table receipts (
  drop_id text primary key references drops(id),
  wallet text not null,
  message text not null,
  signature text not null,                   -- base58 ed25519 signature by `wallet`
  received_on date not null,                 -- the date in the message
  proof_hash text,
  memo_tx text,                              -- LOOTBOX|v1|<drop>|received|<proof hash>
  created_at timestamptz not null default now()
);
alter table receipts enable row level security;
create policy public_read on receipts for select using (true);
