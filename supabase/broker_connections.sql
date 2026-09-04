-- Stores OAuth tokens for a user's connected broker account (e.g. cTrader).
-- Deliberately has NO policies granting access to the anon/authenticated roles -
-- with RLS enabled and zero policies, only the service_role key (used exclusively
-- by Netlify Functions, never shipped to the browser) can read or write it. The
-- frontend never queries this table directly via supabase-js; it goes through a
-- Netlify Function that checks the connection status without exposing the tokens.
create table if not exists broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null,
  ctid_trader_account_id text,
  access_token text not null,
  refresh_token text not null,
  token_type text default 'bearer',
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_deal_timestamp bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker)
);

alter table broker_connections enable row level security;
-- No policies added on purpose - see comment above.

-- Marks trades that were auto-imported via a broker connection, so the UI
-- can show a "synced from cTrader" badge and the sync job can avoid duplicates.
alter table trades add column if not exists broker_deal_id text;
alter table trades add column if not exists source text default 'manual';
create unique index if not exists trades_broker_deal_unique
  on trades (user_id, broker_deal_id)
  where broker_deal_id is not null;
