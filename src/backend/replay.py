"""Tur 3: Sinan — Historical Candle Replay Engine (Binance Futures REST + OKX Swap Fallback).

Zero fake candles, zero randomness:
  - Normalizes real Binance Futures /fapi/v1/klines and OKX /api/v5/market/candles payloads.
  - Simulates conservative intrabar wick liquidation & mark-to-market PnL step-by-step.
  - Scores practice replay strictly via Consistency Score (accuracy x discipline), never raw profit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional

from src.backend.scoring import calc_consistency_score

ALLOWED_SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
ALLOWED_INTERVALS = ("1m", "5m", "15m", "1h")
TAKER_FEE_RATE = 0.0004  # 0.04% Binance USD-M Futures taker fee
MAINTENANCE_MARGIN_RATE = 0.005  # 0.5% isolated maintenance margin

OKX_BAR_MAP: dict[str, str] = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1H",
}


@dataclass(frozen=True)
class HistoricalCandle:
    ts: int  # Unix ms open time
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class ReplayPosition:
    symbol: str
    side: Literal["LONG", "SHORT"]
    entry_price: float
    leverage: int
    isolated_margin: float
    qty: float
    liquidation_price: float
    entry_fee: float
    opened_index: int


@dataclass(frozen=True)
class ReplayStepOutcome:
    status: Literal["open", "liquidated"]
    unrealized_pnl: float
    roe_pct: float
    exit_price: Optional[float] = None
    realized_pnl: Optional[float] = None


def validate_candle_request(symbol: str, interval: str, limit: int = 120) -> tuple[str, str, int]:
    sym = (symbol or "BTCUSDT").strip().upper()
    if sym not in ALLOWED_SYMBOLS:
        raise ValueError(f"Desteklenmeyen sembol: {sym}")
    iv = (interval or "1m").strip().lower()
    if iv not in ALLOWED_INTERVALS:
        raise ValueError(f"Desteklenmeyen zaman aralığı: {iv}")
    clamped_limit = max(30, min(200, int(limit)))
    return sym, iv, clamped_limit


def _clean_candles(raw_items: list[HistoricalCandle]) -> list[HistoricalCandle]:
    by_ts: dict[int, HistoricalCandle] = {}
    for c in raw_items:
        if c.ts <= 0 or c.open <= 0 or c.high <= 0 or c.low <= 0 or c.close <= 0:
            continue
        hi = max(c.high, c.open, c.close)
        lo = min(c.low, c.open, c.close)
        by_ts[c.ts] = HistoricalCandle(
            ts=c.ts,
            open=c.open,
            high=hi,
            low=lo,
            close=c.close,
            volume=max(0.0, c.volume),
        )
    return [by_ts[k] for k in sorted(by_ts.keys())]


def parse_binance_klines(payload: list[Any]) -> list[HistoricalCandle]:
    """Parse Binance Futures GET /fapi/v1/klines array."""
    parsed: list[HistoricalCandle] = []
    for row in payload or []:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        try:
            parsed.append(
                HistoricalCandle(
                    ts=int(row[0]),
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                )
            )
        except (TypeError, ValueError):
            continue
    return _clean_candles(parsed)


def parse_okx_candles(payload: dict[str, Any]) -> list[HistoricalCandle]:
    """Parse OKX GET /api/v5/market/candles response (newest-first -> ascending)."""
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    parsed: list[HistoricalCandle] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        try:
            parsed.append(
                HistoricalCandle(
                    ts=int(row[0]),
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                )
            )
        except (TypeError, ValueError):
            continue
    return _clean_candles(parsed)


def open_replay_position(
    *,
    symbol: str,
    side: Literal["LONG", "SHORT"],
    entry_price: float,
    leverage: int,
    isolated_margin: float,
    opened_index: int,
) -> ReplayPosition:
    if entry_price <= 0 or isolated_margin <= 0 or leverage < 1:
        raise ValueError("Geçersiz pozisyon parametreleri")
    notional = isolated_margin * leverage
    qty = notional / entry_price
    entry_fee = notional * TAKER_FEE_RATE
    # Isolated liquidation threshold (matching Faz 1 engine)
    liq_move = max(0.002, (1.0 / leverage) - MAINTENANCE_MARGIN_RATE)
    liq_price = entry_price * (1.0 - liq_move) if side == "LONG" else entry_price * (1.0 + liq_move)
    return ReplayPosition(
        symbol=symbol,
        side=side,
        entry_price=entry_price,
        leverage=leverage,
        isolated_margin=isolated_margin,
        qty=qty,
        liquidation_price=round(liq_price, 6),
        entry_fee=round(entry_fee, 4),
        opened_index=opened_index,
    )


def evaluate_replay_candle(position: ReplayPosition, candle: HistoricalCandle) -> ReplayStepOutcome:
    """Evaluate intrabar wick liquidation first, otherwise mark-to-market at candle.close."""
    if position.side == "LONG" and candle.low <= position.liquidation_price:
        return ReplayStepOutcome(
            status="liquidated",
            unrealized_pnl=-position.isolated_margin,
            roe_pct=-100.0,
            exit_price=position.liquidation_price,
            realized_pnl=round(-position.isolated_margin, 2),
        )
    if position.side == "SHORT" and candle.high >= position.liquidation_price:
        return ReplayStepOutcome(
            status="liquidated",
            unrealized_pnl=-position.isolated_margin,
            roe_pct=-100.0,
            exit_price=position.liquidation_price,
            realized_pnl=round(-position.isolated_margin, 2),
        )

    gross = (
        (candle.close - position.entry_price) * position.qty
        if position.side == "LONG"
        else (position.entry_price - candle.close) * position.qty
    )
    est_exit_fee = (candle.close * position.qty) * TAKER_FEE_RATE
    net = gross - position.entry_fee - est_exit_fee
    roe_pct = (net / position.isolated_margin) * 100.0
    return ReplayStepOutcome(
        status="open",
        unrealized_pnl=round(net, 2),
        roe_pct=round(roe_pct, 2),
    )


def close_replay_position(position: ReplayPosition, exit_price: float) -> float:
    gross = (
        (exit_price - position.entry_price) * position.qty
        if position.side == "LONG"
        else (position.entry_price - exit_price) * position.qty
    )
    exit_fee = (exit_price * position.qty) * TAKER_FEE_RATE
    net = gross - position.entry_fee - exit_fee
    return round(max(-position.isolated_margin, net), 2)


def calc_replay_consistency(
    *,
    wins: int,
    losses: int,
    liquidations: int,
    high_leverage_trades: int,
) -> tuple[float, int]:
    """Compute discipline multiplier & consistency score for replay practice."""
    total = max(0, wins) + max(0, losses)
    discipline = 1.0
    if total > 0:
        discipline += min(0.25, wins * 0.03)
        discipline -= liquidations * 0.18
        discipline -= high_leverage_trades * 0.06
    discipline = round(max(0.5, min(1.4, discipline)), 2)
    score = calc_consistency_score(wins, losses, discipline)
    return discipline, score
