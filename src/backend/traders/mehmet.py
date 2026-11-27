"""Fitilci Mehmet — Liquidation Wick Hunter (forceOrder + 1s wick reversal)."""

from __future__ import annotations

from typing import Dict, Optional

from src.backend.feed import BookTickerEvent, ForceOrderEvent, MarketEvent
from src.backend.traders import BaseTrader, TradeSignal


class FitilciMehmet(BaseTrader):
    trader_id = "mehmet"
    nickname = "Fitilci Mehmet"
    archetype = "Likidasyon Fitil Avcısı (50x)"
    base_leverage = 50

    def __init__(self, min_liq_usdt: float = 50_000.0, max_leverage: int = 50) -> None:
        super().__init__()
        self.min_liq_usdt = min_liq_usdt
        self.max_leverage = max_leverage
        self._pending_wick: Dict[str, ForceOrderEvent] = {}

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        if isinstance(event, ForceOrderEvent):
            if event.notional_usdt >= self.min_liq_usdt:
                self._pending_wick[event.symbol] = event
            return None

        if isinstance(event, BookTickerEvent) and event.symbol in self._pending_wick:
            liq = self._pending_wick[event.symbol]
            dt_ms = event.event_time_ms - liq.trade_time_ms
            if dt_ms > 1500:
                del self._pending_wick[event.symbol]
                return None

            mid = (event.bid_price + event.ask_price) / 2.0
            # Long liquidation (SELL) -> wick down -> enter LONG on bounce
            if liq.side == "SELL" and mid > liq.avg_price:
                del self._pending_wick[event.symbol]
                sl = round(liq.avg_price * 1.001, 2)  # %0.1 above liq price
                return TradeSignal(
                    trader_id=self.trader_id,
                    symbol=event.symbol,
                    side="LONG",
                    leverage=self.adjust_leverage(self.max_leverage),
                    margin_fraction=0.25,
                    stop_loss=sl,
                    take_profit=round(mid * 1.008, 2),
                    reason=f"Büyük long likidasyonu (${liq.notional_usdt:,.0f}) sonrası fitil dönüşü",
                    signal_snapshot={"liq_notional": liq.notional_usdt, "liq_price": liq.avg_price, "mid": mid},
                )

            # Short liquidation (BUY) -> wick up -> enter SHORT on rejection
            if liq.side == "BUY" and mid < liq.avg_price:
                del self._pending_wick[event.symbol]
                sl = round(liq.avg_price * 0.999, 2)
                return TradeSignal(
                    trader_id=self.trader_id,
                    symbol=event.symbol,
                    side="SHORT",
                    leverage=self.adjust_leverage(self.max_leverage),
                    margin_fraction=0.25,
                    stop_loss=sl,
                    take_profit=round(mid * 0.992, 2),
                    reason=f"Büyük short likidasyonu (${liq.notional_usdt:,.0f}) sonrası fitil reddi",
                    signal_snapshot={"liq_notional": liq.notional_usdt, "liq_price": liq.avg_price, "mid": mid},
                )
        return None
