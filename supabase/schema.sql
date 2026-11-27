-- TEFECİ Faz 2 PostgreSQL Schema for Supabase (Frankfurt / eu-central-1)

create table if not exists public.traders (
  id text primary key,
  nickname text not null,
  archetype text not null default '',
  balance double precision not null default 1000,
  initial_balance double precision not null default 1000,
  realized_pnl double precision not null default 0,
  mood text not null default 'focused',
  fear_trades_remaining integer not null default 0,
  max_leverage integer not null default 20,
  win_count integer not null default 0,
  loss_count integer not null default 0,
  liquidation_count integer not null default 0,
  last_signal text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.debts (
  id text primary key,
  trader_id text not null,
  principal double precision not null,
  initial_principal double precision not null default 1000,
  interest_rate double precision not null,
  compounding_period_s integer not null default 300,
  due_date_ms bigint not null,
  status text not null default 'aktif',
  total_repaid double precision not null default 0,
  enforcer_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id text primary key,
  trader_id text not null,
  symbol text not null,
  side text not null,
  leverage integer not null,
  entry_price double precision not null,
  exit_price double precision,
  qty double precision not null,
  isolated_margin double precision not null,
  liquidation_price double precision not null,
  stop_loss double precision,
  take_profit double precision,
  entry_fee double precision not null default 0,
  funding_paid double precision not null default 0,
  pnl double precision not null default 0,
  status text not null default 'open',
  reason_entry text not null default '',
  log_reason text not null default '',
  mood text not null default 'focused',
  opened_at_ms bigint not null default 0,
  closed_at_ms bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  type text not null,
  trader_id text,
  payload jsonb not null default '{}'::jsonb,
  message text not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.equity_snapshots (
  id bigint generated always as identity primary key,
  ts_ms bigint not null,
  tefeci_profit double precision not null default 0,
  total_debt_owed double precision not null default 0,
  total_trader_equity double precision not null default 0,
  total_unrealized_pnl double precision not null default 0,
  btc_price double precision not null default 0,
  eth_price double precision not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_positions_status on public.positions (status);
create index if not exists idx_positions_trader on public.positions (trader_id);
create index if not exists idx_debts_trader on public.debts (trader_id);
create index if not exists idx_events_processed on public.events (processed, id);
create index if not exists idx_equity_snapshots_ts on public.equity_snapshots (ts_ms desc);

-- Row Level Security
alter table public.traders enable row level security;
alter table public.debts enable row level security;
alter table public.positions enable row level security;
alter table public.events enable row level security;
alter table public.equity_snapshots enable row level security;

create policy "public_read_traders" on public.traders for select to anon, authenticated using (true);
create policy "public_read_debts" on public.debts for select to anon, authenticated using (true);
create policy "public_read_positions" on public.positions for select to anon, authenticated using (true);
create policy "public_read_events" on public.events for select to anon, authenticated using (true);
create policy "public_read_equity_snapshots" on public.equity_snapshots for select to anon, authenticated using (true);

create policy "public_insert_commands" on public.events
  for insert to anon, authenticated
  with check (
    type in (
      'DOUBLE_INTEREST',
      'SEND_ENFORCER',
      'COLLECT_DEBT',
      'ISSUE_DEBT',
      'FORCE_CLOSE',
      'TRIGGER_TEST_TRADE',
      'SIMULATE_WHALE'
    )
  );

-- Enable Supabase Realtime on all 5 tables
alter table public.traders replica identity full;
alter table public.debts replica identity full;
alter table public.positions replica identity full;
alter table public.events replica identity full;
alter table public.equity_snapshots replica identity full;

alter publication supabase_realtime add table public.traders;
alter publication supabase_realtime add table public.debts;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.equity_snapshots;
