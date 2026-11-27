"""Algorithmic trader strategy engines."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

from src.backend.exchange_sim import Side
from src.backend.feed import MarketEvent


@dataclass(frozen=True, slots=True)
class TradeSignal:
    trader_id: str
    symbol: str
    side: Side
    leverage: int
    margin_fraction: float  # Fraction of available capital to risk (0.05 - 0.50)
    stop_loss: Optional[float]
    take_profit: Optional[float]
    reason: str
    signal_snapshot: Dict[str, float | str]


class BaseTrader:
    trader_id: str = "base"
    nickname: str = "Base"
    archetype: str = "Algoritmik Trader"
    base_leverage: int = 20

    def __init__(self) -> None:
        self.fear_trades_remaining: int = 0
        self.mood: str = "focused"  # focused | greedy | panicked | busted

    def trigger_fear(self, trades: int = 3) -> None:
        self.fear_trades_remaining = trades
        self.mood = "panicked"

    def adjust_leverage(self, desired_leverage: int) -> int:
        if self.fear_trades_remaining > 0:
            self.fear_trades_remaining -= 1
            if self.fear_trades_remaining == 0 and self.mood == "panicked":
                self.mood = "focused"
            return max(2, desired_leverage // 2)
        return desired_leverage

    async def on_event(self, event: MarketEvent) -> Optional[TradeSignal]:
        raise NotImplementedError
