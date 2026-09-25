-- Ashiato: saved cases, one row per case, owned by a wallet address.
-- Run once in Supabase → SQL Editor. The app talks to this table only from its server
-- (service role key), and only for the signed-in wallet, so no one else can read it.

create table if not exists public.cases (
  owner          text        not null check (owner ~ '^0x[0-9a-f]{40}$'),
  id             text        not null check (length(id) between 3 and 64),
  name           text        not null check (length(name) between 1 and 120),
  origin_address text,
  origin_chain   text,
  origin_kind    text,
  addresses      integer     not null default 0,
  -- The case file, gzip-compressed and base64-encoded by the browser
  data           text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (owner, id)
);

create index if not exists cases_owner_updated on public.cases (owner, updated_at desc);

-- Lock the table: no direct access with the public (anon) key. The server uses the
-- service role key, which bypasses row-level security.
alter table public.cases enable row level security;
