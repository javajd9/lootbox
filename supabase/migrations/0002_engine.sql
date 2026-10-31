-- The drop engine's own state. Private: row level security is on with no public policies, so
-- only the server (service role key) can read or write it. Snapshot times stay secret here.

create table engine_state (
  id int primary key default 1 check (id = 1),   -- a single row
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table engine_state enable row level security;

-- One tick at a time across every server: a lease that expires on its own if a tick dies mid-way.
create table engine_lock (
  id int primary key default 1 check (id = 1),
  holder text,
  expires_at timestamptz not null default 'epoch'
);
insert into engine_lock (id) values (1);
alter table engine_lock enable row level security;

create function engine_acquire(p_holder text, p_seconds int) returns boolean
language plpgsql set search_path = public as $$
begin
  update engine_lock
     set holder = p_holder, expires_at = now() + make_interval(secs => p_seconds)
   where id = 1 and expires_at < now();
  return found;
end $$;

create function engine_release(p_holder text) returns void
language sql set search_path = public as $$
  update engine_lock set holder = null, expires_at = 'epoch' where id = 1 and holder = p_holder;
$$;

-- Server only: visitors can't take or release the lock.
revoke execute on function engine_acquire(text, int) from public, anon, authenticated;
revoke execute on function engine_release(text) from public, anon, authenticated;
