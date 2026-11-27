"""Fonlama Nuri — Funding Rate & Open Interest Divergence Arbitrageur."""

from __future__ import annotations

from typing import Dict, Optional

from src.backend.feed import MarkPriceEvent, MarketEvent
from src.backend.traders import BaseTrader, TradeSignal


class FonlamaNuri(BaseTrader):
    trader_id = "nuri"
    nickname = "Fonlama Nuri"

    def __init__(self, funding_threshold: float = 0.0001) -> None:
        super().__init__()
        self.funding_threshold = funding_threshold  # 0.01% = 0.0001
        self._last_oi: Dict[str, float] = {}
        self._oi_dropping: Dict[str, bool] = {}

    def update_open_interest(self, symbol: str, oi: float) -> None:
        prev = self._last_oi.get(symbol)
        if prev is not None:
            self._oi_dropping[symbol] = oi < prev
        self._last_oi[symbol] = oi

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        if isinstance(event, MarkPriceEvent):
            dropping = self._oi_dropping.get(event.symbol, False)
            if event.funding_rate > self.funding_threshold and dropping:
                return TradeSignal(
                    trader_id=self.trader_id,
                    symbol=event.symbol,
                    side="SHORT",
                    leverage=self.adjust_leverage(25),
                    margin_fraction=0.20,
                    stop_loss=round(event.mark_price * 1.006, 2),
                    take_profit=round(event.mark_price * 0.990, 2),
                    reason=f"Long squeeze sinyali: Funding={event.funding_rate*100:.4f}%, OI düşüyor",
                    signal_snapshot={
                        "funding_rate": event.funding_rate,
                        "oi": self._last_oi.get(event.symbol, 0.0),
                        "mark_price": event.mark_price,
                    },
                )
        return None
