"""Madam Sevil — Cold-Blooded 1s Bollinger Bands + RSI Mean Reversion."""

from __future__ import annotations

from collections import deque
from typing import Deque, Dict, Optional

import numpy as np

from src.backend.feed import BookTickerEvent, MarketEvent
from src.backend.traders import BaseTrader, TradeSignal


class MadamSevil(BaseTrader):
    trader_id = "sevil"
    nickname = "Madam Sevil"
    archetype = "Soğukkanlı Bollinger + RSI Ortalamaya Dönüş (8x)"
    base_leverage = 8

    def __init__(self, window: int = 20, rsi_period: int = 14) -> None:
        super().__init__()
        self.window = window
        self.rsi_period = rsi_period
        self._prices: Dict[str, Deque[float]] = {}
        self._last_sample_ms: Dict[str, int] = {}

    @staticmethod
    def _compute_rsi(prices: np.ndarray, period: int) -> float:
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])
        if avg_loss == 0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        return float(100.0 - (100.0 / (1.0 + rs)))

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        if not isinstance(event, BookTickerEvent):
            return None

        last_ms = self._last_sample_ms.get(event.symbol, 0)
        if event.event_time_ms - last_ms < 1000:
            return None
        self._last_sample_ms[event.symbol] = event.event_time_ms

        mid = (event.bid_price + event.ask_price) / 2.0
        buf = self._prices.setdefault(event.symbol, deque(maxlen=max(self.window, self.rsi_period + 1)))
        buf.append(mid)

        if len(buf) < self.window:
            return None

        arr = np.array(buf, dtype=float)
        sma = float(np.mean(arr[-self.window :]))
        std = float(np.std(arr[-self.window :]))
        lower_band = sma - 2.0 * std
        rsi = self._compute_rsi(arr, self.rsi_period)

        if mid <= lower_band and rsi < 30.0:
            return TradeSignal(
                trader_id=self.trader_id,
                symbol=event.symbol,
                side="LONG",
                leverage=self.adjust_leverage(8),
                margin_fraction=0.15,
                stop_loss=round(mid * 0.992, 2),
                take_profit=round(sma, 2),
                reason=f"BB alt band kırılımı + aşırı satım (RSI={rsi:.1f})",
                signal_snapshot={"mid": mid, "lower_band": lower_band, "sma": sma, "rsi": rsi},
            )
        return None
