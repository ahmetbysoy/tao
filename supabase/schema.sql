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

-- ============================================================================
-- TUR 2: Bülent — Mahalle Kupası (Invite-Code Rooms without User Login)
-- ============================================================================
create table if not exists public.cups (
  code text primary key check (code ~ '^[A-Z0-9]{6,10}$'),
  title text not null check (char_length(trim(title)) between 2 and 48),
  host_name text not null check (char_length(trim(host_name)) between 2 and 24),
  duration_minutes integer not null default 30 check (duration_minutes in (15, 30, 60, 1440)),
  ends_at_ms bigint not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table if not exists public.cup_participants (
  id text primary key,
  cup_code text not null references public.cups(code) on delete cascade,
  client_id text not null check (char_length(client_id) between 6 and 64),
  nickname text not null check (char_length(trim(nickname)) between 2 and 24),
  points double precision not null default 1000 check (points >= 0 and points <= 10000000),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  discipline_multiplier double precision not null default 1.0 check (discipline_multiplier >= 0.5 and discipline_multiplier <= 1.4),
  consistency_score integer not null default 0 check (consistency_score >= 0 and consistency_score <= 3000),
  cancelled_rounds integer not null default 0 check (cancelled_rounds >= 0),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cup_participants_cup_score
  on public.cup_participants (cup_code, consistency_score desc, updated_at asc);

alter table public.cups enable row level security;
alter table public.cup_participants enable row level security;

create policy "public_read_cups" on public.cups for select to anon, authenticated using (true);
create policy "public_insert_cups" on public.cups for insert to anon, authenticated
  with check (code ~ '^[A-Z0-9]{6,10}$' and status = 'active' and ends_at_ms > 0);
create policy "public_read_cup_participants" on public.cup_participants for select to anon, authenticated using (true);
create policy "public_insert_cup_participants" on public.cup_participants for insert to anon, authenticated
  with check (id = cup_code || '_' || client_id and points >= 0 and consistency_score between 0 and 3000);
create policy "public_update_cup_participants" on public.cup_participants for update to anon, authenticated
  using (true) with check (id = cup_code || '_' || client_id and points >= 0 and consistency_score between 0 and 3000);

alter table public.cups replica identity full;
alter table public.cup_participants replica identity full;
alter table public.equity_snapshots replica identity full;

alter publication supabase_realtime add table public.traders;
alter publication supabase_realtime add table public.debts;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.equity_snapshots;

-- Tur 4 (Kemal TAHTA + Riza RADAR): Real market funding snapshots & OHLCV candle vault
create table if not exists public.market_funding_snapshots (
  symbol text primary key check (symbol in ('BTCUSDT', 'ETHUSDT', 'SOLUSDT')),
  mark_price double precision not null check (mark_price > 0),
  funding_rate double precision not null,
  next_funding_ms bigint not null default 0,
  imbalance double precision not null default 0,
  change_pct_24h double precision not null default 0,
  source text not null check (source in ('binance_futures', 'okx_swap')),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_candles (
  symbol text not null check (symbol in ('BTCUSDT', 'ETHUSDT', 'SOLUSDT')),
  interval text not null check (interval in ('1m', '5m', '15m', '1h')),
  ts bigint not null check (ts > 0),
  open double precision not null check (open > 0),
  high double precision not null check (high > 0),
  low double precision not null check (low > 0),
  close double precision not null check (close > 0),
  volume double precision not null default 0,
  source text not null check (source in ('binance_fapi', 'okx_swap')),
  recorded_at timestamptz not null default now(),
  primary key (symbol, interval, ts)
);

create index if not exists idx_market_candles_lookup
  on public.market_candles (symbol, interval, ts desc);

alter table public.market_funding_snapshots enable row level security;
alter table public.market_candles enable row level security;

create policy "Public read market_funding_snapshots"
  on public.market_funding_snapshots for select using (true);
create policy "Public read market_candles"
  on public.market_candles for select using (true);

alter publication supabase_realtime add table public.market_funding_snapshots;
