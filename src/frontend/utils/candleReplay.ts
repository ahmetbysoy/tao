// Sinan: Tur 3 Historical Candle Replay engine (Binance Futures REST + OKX Swap fallback).
// Mirrors src/backend/replay.py with ZERO randomness and ZERO synthetic candles.

import { calcConsistencyScore } from "./fitilScoring";
import { getCloudWorkerCandlesUrl } from "./supabase";

export type ReplaySymbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
export type ReplayInterval = "1m" | "5m" | "15m" | "1h";
export type CandleSource = "binance_fapi" | "okx_swap";

export const REPLAY_SYMBOLS: Array<{ key: ReplaySymbol; label: string; decimals: number }> = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
];

export const REPLAY_INTERVALS: Array<{ key: ReplayInterval; label: string }> = [
  { key: "1m", label: "1d" },
  { key: "5m", label: "5d" },
  { key: "15m", label: "15d" },
  { key: "1h", label: "1s" },
];

export const REPLAY_LEVERAGES = [5, 10, 25, 50] as const;
export const REPLAY_TAKER_FEE = 0.0004;
export const REPLAY_MAINT_MARGIN = 0.005;
export const REPLAY_START_BALANCE = 1000;

export interface HistoricalCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayPosition {
  symbol: ReplaySymbol;
  side: "LONG" | "SHORT";
  entryPrice: number;
  leverage: number;
  isolatedMargin: number;
  qty: number;
  liquidationPrice: number;
  entryFee: number;
  openedIndex: number;
}

export interface ReplayStepOutcome {
  status: "open" | "liquidated";
  unrealizedPnl: number;
  roePct: number;
  exitPrice?: number;
  realizedPnl?: number;
}

export interface ReplayTradeRecord {
  id: number;
  symbol: ReplaySymbol;
  side: "LONG" | "SHORT";
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  netPnl: number;
  liquidated: boolean;
}

const OKX_INST: Record<ReplaySymbol, string> = {
  BTCUSDT: "BTC-USDT-SWAP",
  ETHUSDT: "ETH-USDT-SWAP",
  SOLUSDT: "SOL-USDT-SWAP",
};

const OKX_BAR: Record<ReplayInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
};

function sanitizeCandles(rows: HistoricalCandle[]): HistoricalCandle[] {
  const map = new Map<number, HistoricalCandle>();
  for (const c of rows) {
    if (
      !Number.isFinite(c.ts) ||
      c.ts <= 0 ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.open <= 0 ||
      c.high <= 0 ||
      c.low <= 0 ||
      c.close <= 0
    ) {
      continue;
    }
    map.set(Math.trunc(c.ts), {
      ts: Math.trunc(c.ts),
      open: c.open,
      high: Math.max(c.high, c.open, c.close),
      low: Math.min(c.low, c.open, c.close),
      close: c.close,
      volume: Number.isFinite(c.volume) ? Math.max(0, c.volume) : 0,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

/**
 * Fetch 100% real historical OHLCV candles.
 * 1. Frankfurt Cloud Worker /candles (tries Binance Futures REST first, OKX Swap fallback).
 * 2. Direct Binance Futures REST -> OKX Swap REST fallback if worker unavailable.
 * NEVER fabricates synthetic candles.
 */
export async function fetchHistoricalCandles(
  symbol: ReplaySymbol,
  interval: ReplayInterval,
  limit = 120
): Promise<{ source: CandleSource; candles: HistoricalCandle[] }> {
  // 1. Server-side Frankfurt Worker proxy (avoids browser geo-block/CORS issues)
  const workerUrl = getCloudWorkerCandlesUrl(symbol, interval, limit);
  if (workerUrl) {
    try {
      const res = await fetch(workerUrl, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as {
          status?: string;
          source?: CandleSource;
          candles?: HistoricalCandle[];
        };
        if (body.status === "ok" && Array.isArray(body.candles) && body.candles.length >= 10) {
          return {
            source: body.source === "binance_fapi" ? "binance_fapi" : "okx_swap",
            candles: sanitizeCandles(body.candles),
          };
        }
      }
    } catch {
      // Fall through to direct exchange REST
    }
  }

  // 2. Direct Binance Futures REST
  try {
    const bUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(bUrl);
    if (res.ok) {
      const raw = (await res.json()) as unknown[];
      if (Array.isArray(raw)) {
        const parsed: HistoricalCandle[] = raw
          .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 6)
          .map((r) => ({
            ts: Number(r[0]),
            open: parseFloat(String(r[1])),
            high: parseFloat(String(r[2])),
            low: parseFloat(String(r[3])),
            close: parseFloat(String(r[4])),
            volume: parseFloat(String(r[5])),
          }));
        const cleaned = sanitizeCandles(parsed);
        if (cleaned.length >= 10) {
          return { source: "binance_fapi", candles: cleaned };
        }
      }
    }
  } catch {
    // Fall through to OKX REST
  }

  // 3. Direct OKX Swap REST fallback
  const okxUrl = `https://www.okx.com/api/v5/market/candles?instId=${OKX_INST[symbol]}&bar=${OKX_BAR[interval]}&limit=${limit}`;
  const okxRes = await fetch(okxUrl);
  if (!okxRes.ok) {
    throw new Error(`Gerçek mum verisi alınamadı (HTTP ${okxRes.status})`);
  }
  const okxJson = (await okxRes.json()) as { code?: string; data?: unknown[] };
  if (okxJson.code !== "0" || !Array.isArray(okxJson.data)) {
    throw new Error("OKX geçmiş mum yanıtı geçersiz.");
  }
  const parsed: HistoricalCandle[] = okxJson.data
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 6)
    .map((r) => ({
      ts: Number(r[0]),
      open: parseFloat(String(r[1])),
      high: parseFloat(String(r[2])),
      low: parseFloat(String(r[3])),
      close: parseFloat(String(r[4])),
      volume: parseFloat(String(r[5])),
    }));
  const cleaned = sanitizeCandles(parsed);
  if (cleaned.length < 10) {
    throw new Error("Yetersiz gerçek mum verisi alındı.");
  }
  return { source: "okx_swap", candles: cleaned };
}

export function openReplayPosition(params: {
  symbol: ReplaySymbol;
  side: "LONG" | "SHORT";
  entryPrice: number;
  leverage: number;
  isolatedMargin: number;
  openedIndex: number;
}): ReplayPosition {
  const notional = params.isolatedMargin * params.leverage;
  const qty = notional / params.entryPrice;
  const entryFee = Number((notional * REPLAY_TAKER_FEE).toFixed(4));
  const liqMove = Math.max(0.002, 1 / params.leverage - REPLAY_MAINT_MARGIN);
  const liquidationPrice =
    params.side === "LONG"
      ? params.entryPrice * (1 - liqMove)
      : params.entryPrice * (1 + liqMove);

  return {
    symbol: params.symbol,
    side: params.side,
    entryPrice: params.entryPrice,
    leverage: params.leverage,
    isolatedMargin: params.isolatedMargin,
    qty,
    liquidationPrice: Number(liquidationPrice.toFixed(6)),
    entryFee,
    openedIndex: params.openedIndex,
  };
}

export function evaluateReplayCandle(
  position: ReplayPosition,
  candle: HistoricalCandle
): ReplayStepOutcome {
  if (position.side === "LONG" && candle.low <= position.liquidationPrice) {
    return {
      status: "liquidated",
      unrealizedPnl: -position.isolatedMargin,
      roePct: -100,
      exitPrice: position.liquidationPrice,
      realizedPnl: Number((-position.isolatedMargin).toFixed(2)),
    };
  }
  if (position.side === "SHORT" && candle.high >= position.liquidationPrice) {
    return {
      status: "liquidated",
      unrealizedPnl: -position.isolatedMargin,
      roePct: -100,
      exitPrice: position.liquidationPrice,
      realizedPnl: Number((-position.isolatedMargin).toFixed(2)),
    };
  }

  const gross =
    position.side === "LONG"
      ? (candle.close - position.entryPrice) * position.qty
      : (position.entryPrice - candle.close) * position.qty;
  const exitFee = candle.close * position.qty * REPLAY_TAKER_FEE;
  const net = gross - position.entryFee - exitFee;
  const roePct = (net / position.isolatedMargin) * 100;

  return {
    status: "open",
    unrealizedPnl: Number(net.toFixed(2)),
    roePct: Number(roePct.toFixed(2)),
  };
}

export function closeReplayPosition(position: ReplayPosition, exitPrice: number): number {
  const gross =
    position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.qty
      : (position.entryPrice - exitPrice) * position.qty;
  const exitFee = exitPrice * position.qty * REPLAY_TAKER_FEE;
  const net = gross - position.entryFee - exitFee;
  return Number(Math.max(-position.isolatedMargin, net).toFixed(2));
}

export function calcReplayConsistency(params: {
  wins: number;
  losses: number;
  liquidations: number;
  highLeverageTrades: number;
}): { disciplineMultiplier: number; consistencyScore: number } {
  const total = Math.max(0, params.wins) + Math.max(0, params.losses);
  let discipline = 1.0;
  if (total > 0) {
    discipline += Math.min(0.25, params.wins * 0.03);
    discipline -= params.liquidations * 0.18;
    discipline -= params.highLeverageTrades * 0.06;
  }
  discipline = Number(Math.max(0.5, Math.min(1.4, discipline)).toFixed(2));
  const consistencyScore = calcConsistencyScore(params.wins, params.losses, discipline);
  return { disciplineMultiplier: discipline, consistencyScore };
}
