"""Tahta Kemal — Order Book Imbalance (OBI) & Spoofing Detector."""

from __future__ import annotations

from collections import deque
from typing import Deque, Dict, Optional

from src.backend.feed import BookTickerEvent, DepthEvent, MarketEvent
from src.backend.traders import BaseTrader, TradeSignal


class TahtaKemal(BaseTrader):
    trader_id = "kemal"
    nickname = "Tahta Kemal"
    archetype = "Emir Defteri Dengesizliği & Spoofing Dedektörü (20x)"
    base_leverage = 20

    def __init__(self, obi_threshold: float = 0.75, spoofing_window_ms: int = 200) -> None:
        super().__init__()
        self.obi_threshold = obi_threshold
        self.spoofing_window_ms = spoofing_window_ms
        self._mid_history: Dict[str, Deque[float]] = {}
        self._last_obi_ts: Dict[str, int] = {}
        self._last_obi_val: Dict[str, float] = {}

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        if isinstance(event, BookTickerEvent):
            mid = (event.bid_price + event.ask_price) / 2.0
            hist = self._mid_history.setdefault(event.symbol, deque(maxlen=30))
            hist.append(mid)
            return None

        if isinstance(event, DepthEvent):
            bid_vol = sum(q for _, q in event.bids[:10])
            ask_vol = sum(q for _, q in event.asks[:10])
            total = bid_vol + ask_vol
            if total <= 0:
                return None

            obi = bid_vol / total
            now_ms = event.event_time_ms
            prev_ts = self._last_obi_ts.get(event.symbol, 0)
            prev_obi = self._last_obi_val.get(event.symbol, 0.5)
            self._last_obi_ts[event.symbol] = now_ms
            self._last_obi_val[event.symbol] = obi

            # Spoofing check: if wall vanished within 200ms, reject
            if prev_obi >= self.obi_threshold and obi < self.obi_threshold and (now_ms - prev_ts) <= self.spoofing_window_ms:
                return None

            hist = self._mid_history.get(event.symbol)
            if not hist or len(hist) < 5:
                return None
            ma = sum(hist) / len(hist)
            mid = hist[-1]

            # Real buy wall + price near MA (within 0.15%)
            if obi >= self.obi_threshold and abs(mid - ma) / ma <= 0.0015:
                return TradeSignal(
                    trader_id=self.trader_id,
                    symbol=event.symbol,
                    side="LONG",
                    leverage=self.adjust_leverage(20),
                    margin_fraction=0.20,
                    stop_loss=round(mid * 0.994, 2),
                    take_profit=round(mid * 1.008, 2),
                    reason=f"Gerçek alıcı duvarı (OBI={obi:.2f}), spoofing yok",
                    signal_snapshot={"obi": obi, "mid": mid, "ma": ma},
                )
        return None
