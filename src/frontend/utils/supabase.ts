import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TraderVoiceId } from "./tts";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export type TableName =
  | "traders"
  | "positions"
  | "debts"
  | "events"
  | "equity_snapshots"
  | "market_funding_snapshots";

export interface MarketFundingRow {
  symbol: string;
  mark_price: number;
  funding_rate: number;
  next_funding_ms: number;
  imbalance: number;
  change_pct_24h: number;
  source: "binance_futures" | "okx_swap" | string;
  updated_at?: string;
}

export interface TraderRow {
  id: TraderVoiceId;
  nickname: string;
  archetype: string;
  balance: number;
  initial_balance: number;
  realized_pnl: number;
  mood: "focused" | "greedy" | "panicked" | "busted" | string;
  fear_trades_remaining: number;
  max_leverage: number;
  win_count: number;
  loss_count: number;
  liquidation_count: number;
  last_signal: string;
  updated_at?: string;
}

export interface DebtRow {
  id: string;
  trader_id: TraderVoiceId;
  principal: number;
  initial_principal: number;
  interest_rate: number;
  compounding_period_s: number;
  due_date_ms: number;
  status: "teklif" | "aktif" | "gecikti" | "patladı" | "ödendi" | string;
  total_repaid: number;
  enforcer_count: number;
  created_at?: string;
}

export interface PositionRow {
  id: string;
  trader_id: TraderVoiceId;
  symbol: string;
  side: "LONG" | "SHORT";
  leverage: number;
  entry_price: number;
  exit_price: number | null;
  qty: number;
  isolated_margin: number;
  liquidation_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  entry_fee: number;
  funding_paid: number;
  pnl: number;
  status: "open" | "closed" | "liquidated" | string;
  reason_entry: string;
  log_reason: string;
  mood: string;
  opened_at_ms: number;
  closed_at_ms: number | null;
  created_at?: string;
}

export interface EventRow {
  id: number;
  type: string;
  trader_id: string | null;
  payload: Record<string, unknown>;
  message: string;
  processed: boolean;
  created_at: string;
}

export interface EquitySnapshotRow {
  id: number;
  ts_ms: number;
  tefeci_profit: number;
  total_debt_owed: number;
  total_trader_equity: number;
  total_unrealized_pnl: number;
  btc_price: number;
  eth_price: number;
  created_at?: string;
}

let client: SupabaseClient | null = null;
let channelSeq = 0;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/** Live Frankfurt Supabase Edge Worker /health endpoint (falls back to local /health proxy). */
export function getCloudWorkerHealthUrl(): string {
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/tefeci-worker/health`;
  }
  return "/health";
}

/** Live Frankfurt Supabase Edge Worker /candles endpoint (Binance REST -> OKX Swap fallback). */
export function getCloudWorkerCandlesUrl(
  symbol: string,
  interval: string,
  limit = 120
): string | null {
  if (!supabaseUrl) return null;
  const base = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/tefeci-worker/candles`;
  return `${base}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
    interval
  )}&limit=${encodeURIComponent(String(limit))}`;
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

export function subscribeTable<T>(
  table: TableName,
  onSnapshot: (rows: T[]) => void,
  options?: {
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
    pollMs?: number;
    onStatusChange?: (connected: boolean) => void;
  }
): () => void {
  const sb = getSupabase();
  if (!sb) {
    options?.onStatusChange?.(false);
    return () => {};
  }

  let active = true;

  const fetchAll = async () => {
    let query = sb.from(table).select("*");
    if (options?.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? true,
      });
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (!error && data && active) {
      onSnapshot(data as T[]);
    }
  };

  fetchAll();

  channelSeq += 1;
  const channel = sb
    .channel(`public:${table}:${channelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        fetchAll();
      }
    )
    .subscribe((status) => {
      options?.onStatusChange?.(status === "SUBSCRIBED");
    });

  // Resilient periodic fallback poll in case a corporate firewall drops WS frames
  const pollInterval = window.setInterval(fetchAll, options?.pollMs ?? 5000);

  return () => {
    active = false;
    window.clearInterval(pollInterval);
    sb.removeChannel(channel);
  };
}

export type CommandType =
  | "DOUBLE_INTEREST"
  | "SEND_ENFORCER"
  | "COLLECT_DEBT"
  | "ISSUE_DEBT"
  | "FORCE_CLOSE"
  | "TRIGGER_TEST_TRADE";

export async function pushCommand(
  type: CommandType,
  traderId: string,
  message: string,
  payload: Record<string, unknown> = {}
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("events").insert({
    type,
    trader_id: traderId,
    message,
    payload,
    processed: false,
  });
  return !error;
}
