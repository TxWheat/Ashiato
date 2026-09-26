-- Ashiato: community labels and votes, each signed by the investigator's wallet (EIP-712).
-- Run once in Supabase → SQL Editor. Only the app's server writes here (service role key),
-- after checking the signature; the signed message and signature are kept so anyone can
-- re-check who said what (GET /api/community?uid=…).

create table if not exists public.community_attestations (
  uid        text        primary key check (uid ~ '^0x[0-9a-f]{64}$'),
  kind       text        not null check (kind in ('label', 'vote')),
  attester   text        not null check (attester ~ '^0x[0-9a-f]{40}$'),
  -- Labels: the labelled address. Votes: the label voted on
  chain      text,
  subject    text,
  ref_uid    text,
  message    jsonb       not null,
  signature  text        not null,
  -- Signing time, unix seconds
  time       bigint      not null,
  revoked    boolean     not null default false,
  -- The signed withdrawal, when revoked
  revocation jsonb,
  created_at timestamptz not null default now()
);

create index if not exists community_subject on public.community_attestations (chain, subject) where kind = 'label';
create index if not exists community_ref on public.community_attestations (ref_uid) where kind = 'vote';
create index if not exists community_attester on public.community_attestations (attester, created_at desc);

-- No direct access with the public (anon) key; the server's service role key bypasses this.
alter table public.community_attestations enable row level security;
