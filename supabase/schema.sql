-- Tefeci PostgreSQL Schema for Supabase (Frankfurt)
create table if not exists public.debts (
  id text primary key,
  trader_id text not null,
  principal double precision not null,
  interest_rate double precision not null,
  compounding_period_s integer not null default 300,
  due_date_ms bigint not null,
  status text not null default 'aktif',
  total_repaid double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.positions (
  id text primary key,
  trader_id text not null,
  symbol text not null,
  side text not null,
  leverage integer not null,
  entry_price double precision not null,
  qty double precision not null,
  isolated_margin double precision not null,
  liquidation_price double precision not null,
  pnl double precision not null default 0,
  status text not null default 'open',
  log_reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  type text not null,
  trader_id text,
  message text not null,
  created_at timestamptz not null default now()
);

-- Enable Supabase Realtime on all 3 tables
alter publication supabase_realtime add table public.debts;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.events;
