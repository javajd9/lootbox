-- Everything anyone needs to re-check a drop, stored exactly as it was hashed and posted.

-- Each drop's timeline, mirrored from the engine (public).
alter table drops add column number int;
alter table drops add column opened_at timestamptz;
alter table drops add column funded_at timestamptz;
alter table drops add column funded_tx text;          -- treasury -> prize transfer, with its memo

-- The full snapshot (drop, slot, time, every holder), byte-for-byte what was hashed.
alter table snapshots add column data jsonb;
alter table snapshots alter column data_url drop not null;

-- The locked ticket list: [{ wallet, weight }] exactly as hashed into weights_hash.
alter table draws add column tickets jsonb;

-- Each draw round: the first draw is round 1; an unclaimed prize is redrawn as round 2, 3, ...
create table draw_rounds (
  drop_id text not null references drops(id),
  round int not null,
  seed text not null,                        -- hex; derived from the drop, its ticket list and the round
  randomness_account text not null,          -- ORAO's account for that seed
  request_tx text,
  randomness_hex text,
  winning_index numeric,
  winner_wallet text,
  result_memo_tx text,
  drawn_at timestamptz,
  primary key (drop_id, round)
);
alter table draw_rounds enable row level security;
create policy public_read on draw_rounds for select using (true);
