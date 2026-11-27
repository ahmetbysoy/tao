"""Binance USD-M Futures execution, fee, funding, and isolated liquidation engine.

Implements:
  - Order-book depth walk for realistic market-order slippage
  - Taker (0.04%) and Maker (0.02%) fee deduction
  - Tiered Maintenance Margin Bracket table & exact isolated liquidation price
  - 8-hour funding rate settlement
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Sequence, Tuple

Side = Literal["LONG", "SHORT"]

TAKER_FEE_RATE = 0.0004  # 0.04%
MAKER_FEE_RATE = 0.0002  # 0.02%


@dataclass(frozen=True, slots=True)
class MarginBracket:
    notional_cap: float  # Upper bound in USDT (float('inf') for top tier)
    max_leverage: int
    mmr: float  # Maintenance Margin Rate (e.g. 0.004 = 0.4%)
    cum: float  # Maintenance Amount (cum) in USDT


# Binance USD-M Futures tiered maintenance margin brackets (BTCUSDT reference)
DEFAULT_BRACKETS: Tuple[MarginBracket, ...] = (
    MarginBracket(50_000.0, 125, 0.0040, 0.0),
    MarginBracket(250_000.0, 100, 0.0050, 50.0),
    MarginBracket(1_000_000.0, 50, 0.0100, 1_300.0),
    MarginBracket(5_000_000.0, 20, 0.0250, 16_300.0),
    MarginBracket(20_000_000.0, 10, 0.0500, 141_300.0),
    MarginBracket(50_000_000.0, 5, 0.1000, 1_141_300.0),
    MarginBracket(100_000_000.0, 4, 0.1250, 2_391_300.0),
    MarginBracket(200_000_000.0, 3, 0.1500, 4_891_300.0),
    MarginBracket(float("inf"), 1, 0.5000, 74_891_300.0),
)


def get_margin_bracket(
    notional_usdt: float,
    brackets: Sequence[MarginBracket] = DEFAULT_BRACKETS,
) -> MarginBracket:
    """Return the applicable maintenance margin bracket for a given notional."""
    abs_notional = abs(notional_usdt)
    for bracket in brackets:
        if abs_notional <= bracket.notional_cap:
            return bracket
    return brackets[-1]


def calculate_vwap_fill_price(
    side: Side,
    qty: float,
    bids: Sequence[Tuple[float, float]],
    asks: Sequence[Tuple[float, float]],
    fallback_bid: float,
    fallback_ask: float,
) -> float:
    """Walk the order book to compute realistic VWAP fill price with slippage."""
    levels = asks if side == "LONG" else bids
    if not levels or qty <= 0:
        return fallback_ask if side == "LONG" else fallback_bid

    remaining = qty
    total_cost = 0.0
    filled = 0.0

    for price, level_qty in levels:
        if remaining <= 0:
            break
        take = min(remaining, level_qty)
        total_cost += take * price
        filled += take
        remaining -= take

    if remaining > 0:
        # Depth exhausted: fill remainder at worst visible level + 0.15% impact
        last_price = levels[-1][0]
        impact_price = last_price * (1.0015 if side == "LONG" else 0.9985)
        total_cost += remaining * impact_price
        filled += remaining

    return total_cost / filled if filled > 0 else (
        fallback_ask if side == "LONG" else fallback_bid
    )


def calculate_isolated_liquidation_price(
    side: Side,
    entry_price: float,
    qty: float,
    isolated_margin: float,
    brackets: Sequence[MarginBracket] = DEFAULT_BRACKETS,
) -> float:
    """Compute exact Binance isolated-margin liquidation price.

    LONG:  liq = (entry_price * qty - isolated_margin + cum) / (qty * (1 - mmr))
    SHORT: liq = (entry_price * qty + isolated_margin - cum) / (qty * (1 + mmr))
    """
    if qty <= 0 or entry_price <= 0:
        raise ValueError("qty and entry_price must be positive")

    notional = entry_price * qty
    bracket = get_margin_bracket(notional, brackets)
    mmr = bracket.mmr
    cum = bracket.cum

    if side == "LONG":
        liq = (notional - isolated_margin + cum) / (qty * (1.0 - mmr))
        return max(0.0, liq)
    else:
        liq = (notional + isolated_margin - cum) / (qty * (1.0 + mmr))
        return max(0.0, liq)


@dataclass
class Position:
    position_id: str
    trader_id: str
    symbol: str
    side: Side
    entry_price: float
    qty: float
    leverage: int
    isolated_margin: float
    liquidation_price: float
    entry_fee: float
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    funding_paid: float = 0.0
    opened_at_ms: int = 0
    reason_entry: str = ""
    mood: str = "focused"

    def unrealized_pnl(self, mark_or_last_price: float) -> float:
        if self.side == "LONG":
            return (mark_or_last_price - self.entry_price) * self.qty
        return (self.entry_price - mark_or_last_price) * self.qty

    def is_liquidated(self, mark_price: float) -> bool:
        if self.side == "LONG":
            return mark_price <= self.liquidation_price
        return mark_price >= self.liquidation_price

    def apply_funding(self, mark_price: float, funding_rate: float) -> float:
        """Apply 8h funding fee. Positive rate: LONG pays, SHORT receives."""
        notional = mark_price * self.qty
        fee = notional * funding_rate
        if self.side == "SHORT":
            fee = -fee
        self.isolated_margin -= fee
        self.funding_paid += fee
        self.liquidation_price = calculate_isolated_liquidation_price(
            self.side, self.entry_price, self.qty, self.isolated_margin
        )
        return fee

    def close(
        self,
        exit_price: float,
        is_maker: bool = False,
    ) -> float:
        """Compute net realized PnL after exit fee and funding."""
        gross_pnl = self.unrealized_pnl(exit_price)
        fee_rate = MAKER_FEE_RATE if is_maker else TAKER_FEE_RATE
        exit_fee = exit_price * self.qty * fee_rate
        return gross_pnl - self.entry_fee - exit_fee - self.funding_paid
