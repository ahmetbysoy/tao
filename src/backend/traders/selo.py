"""Selo Roket — High-Leverage Momentum & Volume Spike Maniac."""

from __future__ import annotations

from collections import deque
from typing import Deque, Dict, Optional

from src.backend.feed import AggTradeEvent, MarketEvent
from src.backend.traders import BaseTrader, TradeSignal


class SeloRoket(BaseTrader):
    trader_id = "selo"
    nickname = "Selo Roket"
    archetype = "75x Hacim Patlaması & Momentum Manyağı"
    base_leverage = 75

    def __init__(self, min_trade_usdt: float = 10_000.0, streak_count: int = 5) -> None:
        super().__init__()
        self.min_trade_usdt = min_trade_usdt
        self.streak_count = streak_count
        self._buy_streak: Dict[str, Deque[AggTradeEvent]] = {}

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        if not isinstance(event, AggTradeEvent):
            return None

        # is_buyer_maker == False means aggressive market BUY
        if not event.is_buyer_maker and event.quote_qty >= self.min_trade_usdt:
            q = self._buy_streak.setdefault(event.symbol, deque(maxlen=self.streak_count))
            q.append(event)
            if len(q) == self.streak_count and (q[-1].trade_time_ms - q[0].trade_time_ms) <= 1000:
                q.clear()
                return TradeSignal(
                    trader_id=self.trader_id,
                    symbol=event.symbol,
                    side="LONG",
                    leverage=self.adjust_leverage(75),
                    margin_fraction=0.35,
                    stop_loss=round(event.price * 0.996, 2),
                    take_profit=round(event.price * 1.003, 2),  # Quick 3-5 pip scalp
                    reason="1 saniyede 5x $10k+ market buy hacim patlaması!",
                    signal_snapshot={"price": event.price, "last_quote_qty": event.quote_qty},
                )
        else:
            # Reset streak on sell or small trade
            if event.symbol in self._buy_streak:
                self._buy_streak[event.symbol].clear()
        return None
