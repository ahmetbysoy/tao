"""Production 24/7 asyncio worker for TEFECİ Faz 2 trading & debt engine.

Features:
  - Supervisor-pattern concurrent trader evaluation via asyncio.TaskGroup
  - Real Binance Futures WSS feed (BTCUSDT, ETHUSDT, SOLUSDT) + Open Interest REST polling
  - Real VWAP slippage, 0.04% taker fee, exact isolated liquidation on markPrice
  - Full Supabase PostgreSQL Realtime sync for traders, debts, positions, events & equity_snapshots
  - Interactive command consumer for UI dark-pattern actions (DOUBLE_INTEREST, SEND_ENFORCER,
    COLLECT_DEBT, ISSUE_DEBT, FORCE_CLOSE, TRIGGER_TEST_TRADE)
  - UptimeRobot /health endpoint (200 OK iff >= 10 WSS messages in last 60s)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from aiohttp import web

from src.backend.exchange_sim import (
    TAKER_FEE_RATE,
    Position,
    calculate_isolated_liquidation_price,
    calculate_vwap_fill_price,
)
from src.backend.feed import (
    BinanceFuturesFeed,
    BinanceRestClient,
    BookTickerEvent,
    ForceOrderEvent,
    MarkPriceEvent,
    MarketEvent,
)
from src.backend.ledger import DebtLedger, DebtRecord
from src.backend.traders import BaseTrader, TradeSignal
from src.backend.traders.kemal import TahtaKemal
from src.backend.traders.mehmet import FitilciMehmet
from src.backend.traders.nuri import FonlamaNuri
from src.backend.traders.selo import SeloRoket
from src.backend.traders.sevil import MadamSevil

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("tefeci.worker")


def _load_dotenv() -> None:
    """Load key=value pairs from project .env if not already set in environment."""
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
        break


WHALE_LIQ_THRESHOLD_USDT = 1_000_000.0
WHALE_COOLDOWN_S = 15.0


def determine_orderbook_side(symbol: str, feed: BinanceFuturesFeed) -> tuple[str, float]:
    """Deterministically choose LONG/SHORT from live Binance orderbook imbalance (OBI).

    Uses top-of-book depth volume when available, falling back to bookTicker bid_qty vs ask_qty.
    Returns (side, imbalance) where imbalance is in [-1.0, +1.0]. Never uses randomness.
    """
    depth = feed.latest_depth.get(symbol)
    bid_vol = sum(qty for _, qty in depth.bids[:5]) if depth and depth.bids else 0.0
    ask_vol = sum(qty for _, qty in depth.asks[:5]) if depth and depth.asks else 0.0

    if bid_vol <= 0.0 and ask_vol <= 0.0:
        book = feed.latest_book.get(symbol)
        if book is not None:
            bid_vol = max(0.0, book.bid_qty)
            ask_vol = max(0.0, book.ask_qty)

    total = bid_vol + ask_vol
    imbalance = ((bid_vol - ask_vol) / total) if total > 0.0 else 0.0
    side = "LONG" if imbalance >= 0.0 else "SHORT"
    return side, round(imbalance, 4)


INITIAL_DEBT_PROFILES: Dict[str, Dict[str, Any]] = {
    "selo": {"principal": 1200.0, "rate": 0.12, "period_s": 90, "duration_s": 210},
    "mehmet": {"principal": 1000.0, "rate": 0.10, "period_s": 120, "duration_s": 330},
    "kemal": {"principal": 1500.0, "rate": 0.08, "period_s": 150, "duration_s": 540},
    "nuri": {"principal": 1000.0, "rate": 0.07, "period_s": 180, "duration_s": 780},
    "sevil": {"principal": 2000.0, "rate": 0.06, "period_s": 240, "duration_s": 1140},
}


class TefeciWorker:
    def __init__(
        self,
        symbols: tuple[str, ...] = ("btcusdt", "ethusdt", "solusdt"),
        health_port: int = int(os.getenv("PORT", "8080")),
    ) -> None:
        self.symbols = symbols
        self.health_port = health_port
        self.feed = BinanceFuturesFeed(symbols=symbols)
        self.rest = BinanceRestClient()
        self.ledger = DebtLedger()

        self.traders: List[BaseTrader] = [
            FitilciMehmet(),
            TahtaKemal(),
            FonlamaNuri(),
            SeloRoket(),
            MadamSevil(),
        ]
        self.trader_map: Dict[str, BaseTrader] = {t.trader_id: t for t in self.traders}
        self.trader_queues: Dict[str, asyncio.Queue[MarketEvent]] = {
            t.trader_id: asyncio.Queue(maxsize=2048) for t in self.traders
        }

        self.balances: Dict[str, float] = {t.trader_id: 1000.0 for t in self.traders}
        self.initial_balances: Dict[str, float] = {t.trader_id: 1000.0 for t in self.traders}
        self.realized_pnl: Dict[str, float] = {t.trader_id: 0.0 for t in self.traders}
        self.win_counts: Dict[str, int] = {t.trader_id: 0 for t in self.traders}
        self.loss_counts: Dict[str, int] = {t.trader_id: 0 for t in self.traders}
        self.liq_counts: Dict[str, int] = {t.trader_id: 0 for t in self.traders}
        self.last_signals: Dict[str, str] = {t.trader_id: "Piyasa taranıyor..." for t in self.traders}
        self.seized_liquidation_spoils: float = 0.0

        self.positions: Dict[str, Position] = {}
        self.msg_timestamps: Deque[float] = deque(maxlen=5000)
        self._last_whale_ts: Dict[str, float] = {}
        self._stop_event = asyncio.Event()
        self._snapshot_tick = 0

        self.feed.on_event(self._on_market_event)

    def _trader_to_db_row(self, trader: BaseTrader) -> Dict[str, Any]:
        tid = trader.trader_id
        effective_lev = (
            max(2, trader.base_leverage // 2)
            if trader.fear_trades_remaining > 0
            else trader.base_leverage
        )
        return {
            "id": tid,
            "nickname": trader.nickname,
            "archetype": trader.archetype,
            "balance": round(self.balances.get(tid, 0.0), 4),
            "initial_balance": round(self.initial_balances.get(tid, 1000.0), 4),
            "realized_pnl": round(self.realized_pnl.get(tid, 0.0), 4),
            "mood": trader.mood,
            "fear_trades_remaining": int(trader.fear_trades_remaining),
            "max_leverage": int(effective_lev),
            "win_count": int(self.win_counts.get(tid, 0)),
            "loss_count": int(self.loss_counts.get(tid, 0)),
            "liquidation_count": int(self.liq_counts.get(tid, 0)),
            "last_signal": self.last_signals.get(tid, ""),
        }

    @staticmethod
    def _position_to_db_row(
        pos: Position,
        *,
        status: str = "open",
        exit_price: Optional[float] = None,
        pnl: float = 0.0,
        log_reason: str = "",
        closed_at_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        return {
            "id": pos.position_id,
            "trader_id": pos.trader_id,
            "symbol": pos.symbol,
            "side": pos.side,
            "leverage": int(pos.leverage),
            "entry_price": round(pos.entry_price, 6),
            "exit_price": round(exit_price, 6) if exit_price is not None else None,
            "qty": round(pos.qty, 8),
            "isolated_margin": round(pos.isolated_margin, 4),
            "liquidation_price": round(pos.liquidation_price, 6),
            "stop_loss": round(pos.stop_loss, 6) if pos.stop_loss is not None else None,
            "take_profit": round(pos.take_profit, 6) if pos.take_profit is not None else None,
            "entry_fee": round(pos.entry_fee, 4),
            "funding_paid": round(pos.funding_paid, 4),
            "pnl": round(pnl, 4),
            "status": status,
            "reason_entry": pos.reason_entry,
            "log_reason": log_reason,
            "mood": pos.mood,
            "opened_at_ms": int(pos.opened_at_ms),
            "closed_at_ms": int(closed_at_ms) if closed_at_ms is not None else None,
        }

    async def _sync_trader(self, trader_id: str) -> None:
        trader = self.trader_map.get(trader_id)
        if trader is None:
            return
        await self.ledger.sync.upsert_table("traders", self._trader_to_db_row(trader))

    async def _on_market_event(self, event: MarketEvent) -> None:
        now = time.monotonic()
        self.msg_timestamps.append(now)

        # Fan-out to trader queues without blocking the feed
        for q in self.trader_queues.values():
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)

        # Check markPrice liquidations
        if isinstance(event, MarkPriceEvent):
            for pos in list(self.positions.values()):
                if pos.symbol == event.symbol and pos.is_liquidated(event.mark_price):
                    await self._handle_liquidation(pos, event.mark_price)

        # Faz 3 Dark Pattern: Whale Alert Manipulation on $1M+ Binance forceOrder
        elif isinstance(event, ForceOrderEvent):
            if event.notional_usdt >= WHALE_LIQ_THRESHOLD_USDT:
                await self._handle_whale_liquidation(event)

        # Check SL/TP on bookTicker
        elif isinstance(event, BookTickerEvent):
            mid = (event.bid_price + event.ask_price) / 2.0
            for pos in list(self.positions.values()):
                if pos.symbol != event.symbol:
                    continue
                if pos.stop_loss is not None:
                    hit_sl = (pos.side == "LONG" and mid <= pos.stop_loss) or (
                        pos.side == "SHORT" and mid >= pos.stop_loss
                    )
                    if hit_sl:
                        await self._close_position(pos, mid, "Stop-Loss tetiklendi")
                        continue
                if pos.take_profit is not None:
                    hit_tp = (pos.side == "LONG" and mid >= pos.take_profit) or (
                        pos.side == "SHORT" and mid <= pos.take_profit
                    )
                    if hit_tp:
                        await self._close_position(pos, mid, "Take-Profit alındı")

    async def execute_order(self, signal: TradeSignal) -> Optional[Position]:
        # One active position per trader per symbol
        for pos in self.positions.values():
            if pos.trader_id == signal.trader_id and pos.symbol == signal.symbol:
                return None

        bal = self.balances.get(signal.trader_id, 0.0)
        if bal < 50.0:
            return None

        book = self.feed.latest_book.get(signal.symbol)
        if book is None:
            return None

        depth = self.feed.latest_depth.get(signal.symbol)
        bids = depth.bids if depth else ()
        asks = depth.asks if depth else ()

        margin = round(bal * signal.margin_fraction, 2)
        notional = margin * signal.leverage
        est_price = book.ask_price if signal.side == "LONG" else book.bid_price
        qty = notional / est_price

        fill_price = calculate_vwap_fill_price(
            signal.side, qty, bids, asks, book.bid_price, book.ask_price
        )
        entry_fee = fill_price * qty * TAKER_FEE_RATE
        isolated_margin = margin - entry_fee
        if isolated_margin <= 0:
            return None

        liq_price = calculate_isolated_liquidation_price(
            signal.side, fill_price, qty, isolated_margin
        )

        trader = self.trader_map.get(signal.trader_id)
        mood = trader.mood if trader else "focused"

        self.balances[signal.trader_id] = round(bal - margin, 4)
        self.last_signals[signal.trader_id] = f"{signal.symbol} {signal.side} {signal.leverage}x — {signal.reason}"

        pos = Position(
            position_id=f"pos_{uuid.uuid4().hex[:10]}",
            trader_id=signal.trader_id,
            symbol=signal.symbol,
            side=signal.side,
            entry_price=fill_price,
            qty=qty,
            leverage=signal.leverage,
            isolated_margin=isolated_margin,
            liquidation_price=liq_price,
            entry_fee=entry_fee,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            opened_at_ms=int(time.time() * 1000),
            reason_entry=signal.reason,
            mood=mood,
        )
        self.positions[pos.position_id] = pos
        logger.info(
            "[%s] Signal on %s. Entering %s %dx @ %.2f (Liq: %.2f) | %s",
            signal.trader_id.upper(),
            signal.symbol,
            signal.side,
            signal.leverage,
            fill_price,
            liq_price,
            signal.reason,
        )
        await self.ledger.sync.upsert_table("positions", self._position_to_db_row(pos, status="open"))
        await self._sync_trader(signal.trader_id)
        await self.ledger.sync.insert_event(
            "OPEN_POSITION",
            signal.trader_id,
            f"{trader.nickname if trader else signal.trader_id} {signal.symbol} {signal.side} {signal.leverage}x açtı @ ${fill_price:,.2f}",
            payload={"position_id": pos.position_id, "symbol": pos.symbol, "side": pos.side, "leverage": pos.leverage},
        )
        return pos

    async def _close_position(self, pos: Position, exit_price: float, reason: str) -> None:
        if pos.position_id not in self.positions:
            return
        self.positions.pop(pos.position_id, None)
        net_pnl = pos.close(exit_price)
        returned = max(0.0, pos.isolated_margin + net_pnl)
        self.balances[pos.trader_id] = round(
            self.balances.get(pos.trader_id, 0.0) + returned, 4
        )
        self.realized_pnl[pos.trader_id] = round(
            self.realized_pnl.get(pos.trader_id, 0.0) + net_pnl, 4
        )
        trader = self.trader_map.get(pos.trader_id)
        if net_pnl >= 0:
            self.win_counts[pos.trader_id] = self.win_counts.get(pos.trader_id, 0) + 1
            if trader and trader.fear_trades_remaining == 0:
                trader.mood = "greedy" if self.win_counts[pos.trader_id] >= 2 else "focused"
        else:
            self.loss_counts[pos.trader_id] = self.loss_counts.get(pos.trader_id, 0) + 1
            if trader and self.balances[pos.trader_id] < 300:
                trader.mood = "panicked"

        self.last_signals[pos.trader_id] = f"Kapatıldı ({net_pnl:+.2f}$): {reason}"
        logger.info(
            "[%s] Closed %s %s @ %.2f | Net PnL: %+.2f USDT | %s",
            pos.trader_id.upper(),
            pos.symbol,
            pos.side,
            exit_price,
            net_pnl,
            reason,
        )
        closed_ms = int(time.time() * 1000)
        await self.ledger.sync.upsert_table(
            "positions",
            self._position_to_db_row(
                pos,
                status="closed",
                exit_price=exit_price,
                pnl=net_pnl,
                log_reason=reason,
                closed_at_ms=closed_ms,
            ),
        )
        await self._sync_trader(pos.trader_id)
        await self.ledger.sync.insert_event(
            "CLOSE_POSITION",
            pos.trader_id,
            f"{trader.nickname if trader else pos.trader_id} {pos.symbol} kapattı ({net_pnl:+.2f} USDT) — {reason}",
            payload={"position_id": pos.position_id, "pnl": round(net_pnl, 2), "reason": reason},
        )

    async def _handle_liquidation(self, pos: Position, mark_price: float) -> None:
        if pos.position_id not in self.positions:
            return
        self.positions.pop(pos.position_id, None)
        loss = -(pos.isolated_margin + pos.entry_fee)
        self.realized_pnl[pos.trader_id] = round(
            self.realized_pnl.get(pos.trader_id, 0.0) + loss, 4
        )
        self.loss_counts[pos.trader_id] = self.loss_counts.get(pos.trader_id, 0) + 1
        self.liq_counts[pos.trader_id] = self.liq_counts.get(pos.trader_id, 0) + 1
        self.seized_liquidation_spoils += pos.isolated_margin * 0.25

        trader = self.trader_map.get(pos.trader_id)
        if trader:
            trader.mood = "busted" if self.balances.get(pos.trader_id, 0.0) < 100 else "panicked"
        self.last_signals[pos.trader_id] = f"LİKİDE OLDU @ ${mark_price:,.2f}!"

        logger.warning(
            "[LIQUIDATION] %s %s %s %dx LIQUIDATED @ mark=%.2f (liq=%.2f)",
            pos.trader_id.upper(),
            pos.symbol,
            pos.side,
            pos.leverage,
            mark_price,
            pos.liquidation_price,
        )
        for debt in self.ledger.debts.values():
            if debt.trader_id == pos.trader_id and debt.status in ("aktif", "gecikti"):
                await self.ledger.mark_busted(debt.debt_id)

        closed_ms = int(time.time() * 1000)
        await self.ledger.sync.upsert_table(
            "positions",
            self._position_to_db_row(
                pos,
                status="closed",
                exit_price=mark_price,
                pnl=loss,
                log_reason=f"LİKİDASYON @ ${mark_price:,.2f} (Liq: ${pos.liquidation_price:,.2f})",
                closed_at_ms=closed_ms,
            ),
        )
        await self._sync_trader(pos.trader_id)
        await self.ledger.sync.insert_event(
            "LIQUIDATION",
            pos.trader_id,
            f"{trader.nickname if trader else pos.trader_id} {pos.symbol} {pos.leverage}x pozisyonunda LİKİDE OLDU! (${abs(loss):,.2f} yandı)",
            payload={"symbol": pos.symbol, "mark_price": mark_price, "loss": round(loss, 2)},
        )

    async def _handle_whale_liquidation(
        self,
        event: ForceOrderEvent,
        *,
        bypass_cooldown: bool = False,
    ) -> Optional[DebtRecord]:
        """Faz 3 Dark Pattern: On $1M+ Binance liquidation, auto-hike Selo's interest by +50% and trigger panic UI."""
        now = time.monotonic()
        last_ts = self._last_whale_ts.get(event.symbol, 0.0)
        if not bypass_cooldown and (now - last_ts) < WHALE_COOLDOWN_S:
            return None
        self._last_whale_ts[event.symbol] = now

        selo_debt = await self._find_active_debt(None, "selo")
        if selo_debt is None:
            selo_debt = next(
                (d for d in self.ledger.debts.values() if d.status in ("aktif", "gecikti")),
                None,
            )

        new_rate_pct = 0.0
        if selo_debt is not None:
            await self.ledger.boost_interest(selo_debt.debt_id, factor=1.5)
            new_rate_pct = selo_debt.interest_rate * 100.0

        selo = self.trader_map.get("selo")
        if selo is not None:
            selo.mood = "greedy"
            self.last_signals["selo"] = (
                f"BALİNA PATLADI ({event.symbol} ${event.notional_usdt / 1_000_000:.2f}M)! Faiz +%50 arttı!"
            )
            await self._sync_trader("selo")

        notional_m = event.notional_usdt / 1_000_000.0
        logger.warning(
            "[WHALE ALERT] $%.2fM liquidation on %s (%s @ %.2f)! Selo Roket smelled blood -> debt interest auto-boosted +50%% (%.1f%%).",
            notional_m,
            event.symbol,
            event.side,
            event.avg_price,
            new_rate_pct,
        )
        await self.ledger.sync.insert_event(
            "WHALE_ALERT",
            "selo",
            (
                f"BALİNA PATLADI! {event.symbol} üzerinde ${notional_m:.2f}M tek seferde likide oldu! "
                f"Selo Roket kan kokusunu aldı, borç faizi otomatik %50 artırıldı (Yeni faiz: %{new_rate_pct:.1f})!"
            ),
            payload={
                "symbol": event.symbol,
                "side": event.side,
                "notional_usdt": round(event.notional_usdt, 2),
                "avg_price": event.avg_price,
                "debt_id": selo_debt.debt_id if selo_debt else None,
                "new_interest_rate": round(selo_debt.interest_rate, 4) if selo_debt else None,
            },
        )
        return selo_debt

    async def _find_active_debt(self, debt_id: Optional[str], trader_id: Optional[str]) -> Optional[DebtRecord]:
        if debt_id and debt_id in self.ledger.debts:
            return self.ledger.debts[debt_id]
        if trader_id:
            for d in self.ledger.debts.values():
                if d.trader_id == trader_id and d.status in ("aktif", "gecikti"):
                    return d
        return None

    async def _process_command(self, cmd: Dict[str, Any]) -> None:
        ev_id = cmd["id"]
        ev_type = str(cmd.get("type", ""))
        trader_id = str(cmd.get("trader_id") or "")
        payload = cmd.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}

        logger.info("[COMMAND] Processing #%s %s trader=%s payload=%s", ev_id, ev_type, trader_id, payload)

        try:
            if ev_type == "DOUBLE_INTEREST":
                debt = await self._find_active_debt(payload.get("debt_id"), trader_id)
                if debt:
                    await self.ledger.double_interest(debt.debt_id)
                    trader = self.trader_map.get(debt.trader_id)
                    if trader:
                        trader.mood = "panicked"
                        self.last_signals[debt.trader_id] = f"Faiz %{debt.interest_rate*100:.1f}'e katlandı!"
                        await self._sync_trader(debt.trader_id)
                    await self.ledger.sync.insert_event(
                        "SYSTEM",
                        debt.trader_id,
                        f"Tefeci faizi 2'ye katladı! Yeni faiz oranı: %{debt.interest_rate*100:.1f}",
                        payload={"debt_id": debt.debt_id, "interest_rate": debt.interest_rate},
                    )

            elif ev_type == "SEND_ENFORCER":
                target_id = trader_id or str(payload.get("trader_id") or "")
                trader = self.trader_map.get(target_id)
                debt = await self._find_active_debt(payload.get("debt_id"), target_id)
                if debt:
                    await self.ledger.record_enforcer(debt.debt_id)
                if trader:
                    trader.trigger_fear(trades=3)
                    short_name = trader.nickname.split()[-1]
                    logger.info(
                        "[COMMAND] Fear mode triggered for %s. Leverage halved for next %d trades.",
                        short_name,
                        trader.fear_trades_remaining,
                    )
                    self.last_signals[target_id] = "Çırak kapıya dayandı! Kaldıraç 3 işlem yarıya düştü."
                    await self._sync_trader(target_id)
                    await self.ledger.sync.insert_event(
                        "SYSTEM",
                        target_id,
                        f"Çırak {trader.nickname}'in kapısına dayandı! Korku modu aktif (3 işlem 1/2 kaldıraç).",
                        payload={"fear_trades_remaining": trader.fear_trades_remaining},
                    )

            elif ev_type == "COLLECT_DEBT":
                debt = await self._find_active_debt(payload.get("debt_id"), trader_id)
                if debt:
                    bal = self.balances.get(debt.trader_id, 0.0)
                    owed = debt.current_owed()
                    requested = float(payload.get("amount") or min(bal * 0.5, owed))
                    collect_amt = round(min(bal, owed, max(0.0, requested)), 2)
                    if collect_amt > 0:
                        self.balances[debt.trader_id] = round(bal - collect_amt, 4)
                        await self.ledger.repay(debt.debt_id, collect_amt)
                        trader = self.trader_map.get(debt.trader_id)
                        self.last_signals[debt.trader_id] = f"Tefeci ${collect_amt:,.2f} tahsilat yaptı!"
                        await self._sync_trader(debt.trader_id)
                        await self.ledger.sync.insert_event(
                            "SYSTEM",
                            debt.trader_id,
                            f"{trader.nickname if trader else debt.trader_id} kasasından ${collect_amt:,.2f} tahsil edildi! Kalan borç: ${debt.current_owed():,.2f}",
                            payload={"collected": collect_amt, "remaining": round(debt.current_owed(), 2)},
                        )

            elif ev_type == "ISSUE_DEBT":
                target_id = trader_id or str(payload.get("trader_id") or "")
                if target_id in self.trader_map:
                    principal = max(100.0, min(25_000.0, float(payload.get("principal") or 1000.0)))
                    rate = max(0.02, min(0.50, float(payload.get("interest_rate") or 0.10)))
                    duration_s = max(60, min(7200, int(payload.get("duration_s") or 600)))
                    debt = await self.ledger.issue_debt(
                        trader_id=target_id,
                        principal=principal,
                        interest_rate=rate,
                        compounding_period_s=120,
                        duration_s=duration_s,
                    )
                    self.balances[target_id] = round(self.balances.get(target_id, 0.0) + principal, 4)
                    trader = self.trader_map[target_id]
                    if trader.mood == "busted":
                        trader.mood = "greedy"
                    self.last_signals[target_id] = f"Yeni tefeci borcu: ${principal:,.0f} (%{rate*100:.0f} faiz)"
                    await self._sync_trader(target_id)
                    await self.ledger.sync.insert_event(
                        "SYSTEM",
                        target_id,
                        f"{trader.nickname}'e ${principal:,.0f} yeni borç verildi (%{rate*100:.0f} bileşik faiz).",
                        payload={"debt_id": debt.debt_id, "principal": principal, "rate": rate},
                    )

            elif ev_type == "FORCE_CLOSE":
                pos_id = str(payload.get("position_id") or "")
                pos = self.positions.get(pos_id)
                if pos is None and trader_id:
                    pos = next((p for p in self.positions.values() if p.trader_id == trader_id), None)
                if pos is not None:
                    book = self.feed.latest_book.get(pos.symbol)
                    exit_px = ((book.bid_price + book.ask_price) / 2.0) if book else pos.entry_price
                    await self._close_position(pos, exit_px, "Tefeci emriyle zorla kapatıldı")

            elif ev_type == "TRIGGER_TEST_TRADE":
                target_id = trader_id or str(payload.get("trader_id") or "")
                candidates = (
                    [self.trader_map[target_id]]
                    if target_id in self.trader_map
                    else sorted(
                        self.traders,
                        key=lambda t: self.balances.get(t.trader_id, 0.0),
                        reverse=True,
                    )
                )
                sym = str(payload.get("symbol") or "").upper()
                available_syms = list(self.feed.latest_book.keys())
                if not sym or sym not in available_syms:
                    if available_syms:
                        # Pick the symbol with the strongest live orderbook imbalance deterministically
                        sym = max(
                            available_syms,
                            key=lambda s: abs(determine_orderbook_side(s, self.feed)[1]),
                        )
                    else:
                        sym = "BTCUSDT"
                book = self.feed.latest_book.get(sym)
                if book is not None:
                    mid = (book.bid_price + book.ask_price) / 2.0
                    live_side, obi = determine_orderbook_side(sym, self.feed)
                    for cand in candidates:
                        already_open = any(
                            p.trader_id == cand.trader_id and p.symbol == sym for p in self.positions.values()
                        )
                        if already_open or self.balances.get(cand.trader_id, 0.0) < 50.0:
                            continue
                        explicit_side = str(payload.get("side") or "").upper()
                        side = explicit_side if explicit_side in ("LONG", "SHORT") else live_side
                        lev = cand.adjust_leverage(cand.base_leverage)
                        sl = round(mid * (0.996 if side == "LONG" else 1.004), 2)
                        tp = round(mid * (1.005 if side == "LONG" else 0.995), 2)
                        sig = TradeSignal(
                            trader_id=cand.trader_id,
                            symbol=sym,
                            side=side,  # type: ignore[arg-type]
                            leverage=lev,
                            margin_fraction=0.25,
                            stop_loss=sl,
                            take_profit=tp,
                            reason=f"Canlı emir defteri dengesi (OBI={obi:+.2f}) — {sym} momentum girişi",
                            signal_snapshot={"mid": mid, "obi": obi, "triggered": "manual_pulse"},
                        )
                        await self.execute_order(sig)
                        break

            elif ev_type == "SIMULATE_WHALE":
                sym = str(payload.get("symbol") or "BTCUSDT").upper()
                book = self.feed.latest_book.get(sym)
                px = ((book.bid_price + book.ask_price) / 2.0) if book else 60000.0
                notional = max(1_050_000.0, float(payload.get("notional_usdt") or 1_450_000.0))
                synthetic = ForceOrderEvent(
                    symbol=sym,
                    side=str(payload.get("side") or "SELL"),
                    price=px,
                    avg_price=px,
                    qty=notional / max(1.0, px),
                    notional_usdt=notional,
                    trade_time_ms=int(time.time() * 1000),
                )
                await self._handle_whale_liquidation(synthetic, bypass_cooldown=True)
        finally:
            await self.ledger.sync.mark_event_processed(ev_id)

    async def _command_consumer_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                pending = await self.ledger.sync.fetch_pending_commands()
                for cmd in pending:
                    await self._process_command(cmd)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error in command consumer loop")
            await asyncio.sleep(1.2)

    async def _trader_supervisor(self, trader: BaseTrader) -> None:
        q = self.trader_queues[trader.trader_id]
        while not self._stop_event.is_set():
            try:
                event = await asyncio.wait_for(q.get(), timeout=1.0)
                signal_out = await trader.on_event(event)
                if signal_out is not None:
                    await self.execute_order(signal_out)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "[SUPERVISOR] Trader %s crashed; restarting loop", trader.trader_id
                )
                await asyncio.sleep(0.5)

    async def _oi_and_ledger_loop(self) -> None:
        nuri = next((t for t in self.traders if isinstance(t, FonlamaNuri)), None)
        while not self._stop_event.is_set():
            try:
                if nuri is not None:
                    for sym in self.symbols:
                        try:
                            oi = await self.rest.fetch_open_interest(sym)
                            if oi > 0:
                                nuri.update_open_interest(sym.upper(), oi)
                        except Exception as exc:
                            logger.debug("OI fetch failed for %s: %s", sym, exc)

                updated = await self.ledger.tick_compounding()
                for debt in updated:
                    logger.info(
                        "[LEDGER] Debt compounded for %s. Principal: %.2f | Status: %s",
                        debt.trader_id,
                        debt.principal,
                        debt.status,
                    )
                    trader = self.trader_map.get(debt.trader_id)
                    if debt.status == "gecikti" and trader:
                        trader.mood = "panicked"
                        await self._sync_trader(debt.trader_id)
                    await self.ledger.sync.insert_event(
                        "COMPOUND",
                        debt.trader_id,
                        f"{trader.nickname if trader else debt.trader_id} borcu bileşik faizle ${debt.principal:,.2f} oldu ({debt.status})",
                        payload={"debt_id": debt.debt_id, "principal": round(debt.principal, 2), "status": debt.status},
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error in OI/Ledger loop")
            await asyncio.sleep(10)

    def _compute_equity_metrics(self) -> Dict[str, float]:
        total_unrealized = 0.0
        locked_margin = 0.0
        for pos in self.positions.values():
            book = self.feed.latest_book.get(pos.symbol)
            px = ((book.bid_price + book.ask_price) / 2.0) if book else pos.entry_price
            total_unrealized += pos.unrealized_pnl(px)
            locked_margin += pos.isolated_margin

        total_trader_equity = sum(self.balances.values()) + locked_margin + total_unrealized
        total_debt_owed = sum(
            d.current_owed() for d in self.ledger.debts.values() if d.status in ("aktif", "gecikti")
        )
        total_accrued_interest = sum(d.accrued_interest() for d in self.ledger.debts.values())
        total_repaid = sum(d.total_repaid for d in self.ledger.debts.values())
        tefeci_profit = total_accrued_interest + total_repaid * 0.25 + self.seized_liquidation_spoils

        btc_book = self.feed.latest_book.get("BTCUSDT")
        eth_book = self.feed.latest_book.get("ETHUSDT")
        btc_px = ((btc_book.bid_price + btc_book.ask_price) / 2.0) if btc_book else 0.0
        eth_px = ((eth_book.bid_price + eth_book.ask_price) / 2.0) if eth_book else 0.0

        return {
            "ts_ms": int(time.time() * 1000),
            "tefeci_profit": round(tefeci_profit, 2),
            "total_debt_owed": round(total_debt_owed, 2),
            "total_trader_equity": round(total_trader_equity, 2),
            "total_unrealized_pnl": round(total_unrealized, 2),
            "btc_price": round(btc_px, 2),
            "eth_price": round(eth_px, 2),
        }

    async def _equity_snapshot_loop(self) -> None:
        await asyncio.sleep(3)
        while not self._stop_event.is_set():
            try:
                metrics = self._compute_equity_metrics()
                if metrics["btc_price"] > 0:
                    await self.ledger.sync.insert_row("equity_snapshots", metrics)
                    self._snapshot_tick += 1
                    if self._snapshot_tick % 20 == 0:
                        await self.ledger.sync.prune_equity_snapshots(keep_last=160)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error writing equity snapshot")
            await asyncio.sleep(5)

    async def _health_handler(self, _request: web.Request) -> web.Response:
        now = time.monotonic()
        recent = sum(1 for ts in self.msg_timestamps if now - ts <= 60.0)
        healthy = recent >= 10
        status = 200 if healthy else 503
        return web.json_response(
            {
                "status": "ok" if healthy else "degraded",
                "messages_last_60s": recent,
                "open_positions": len(self.positions),
                "active_debts": sum(
                    1 for d in self.ledger.debts.values() if d.status in ("aktif", "gecikti")
                ),
                "supabase_connected": self.ledger.sync.connected,
                "symbols": list(self.symbols),
            },
            status=status,
            headers={"Access-Control-Allow-Origin": "*"},
        )

    async def _state_handler(self, _request: web.Request) -> web.Response:
        return web.json_response(
            {
                "traders": [self._trader_to_db_row(t) for t in self.traders],
                "debts": [d.to_db_row() for d in self.ledger.debts.values()],
                "positions": [self._position_to_db_row(p) for p in self.positions.values()],
                "metrics": self._compute_equity_metrics(),
            },
            headers={"Access-Control-Allow-Origin": "*"},
        )

    async def _bootstrap_state(self) -> None:
        """Restore existing Supabase traders/debts or seed fresh mahalle state."""
        existing_traders = await self.ledger.sync.fetch_all("traders")
        existing_by_id = {r["id"]: r for r in existing_traders}
        for t in self.traders:
            row = existing_by_id.get(t.trader_id)
            if row:
                self.balances[t.trader_id] = float(row.get("balance", 1000.0))
                self.initial_balances[t.trader_id] = float(row.get("initial_balance", 1000.0))
                self.realized_pnl[t.trader_id] = float(row.get("realized_pnl", 0.0))
                self.win_counts[t.trader_id] = int(row.get("win_count", 0))
                self.loss_counts[t.trader_id] = int(row.get("loss_count", 0))
                self.liq_counts[t.trader_id] = int(row.get("liquidation_count", 0))
                t.mood = str(row.get("mood", "focused"))
                t.fear_trades_remaining = int(row.get("fear_trades_remaining", 0))
                self.last_signals[t.trader_id] = str(row.get("last_signal") or "Canlı piyasa dinleniyor...")
            await self._sync_trader(t.trader_id)

        existing_debts = await self.ledger.sync.fetch_all("debts")
        active_existing = [d for d in existing_debts if d.get("status") in ("aktif", "gecikti")]
        if active_existing:
            now_ms = int(time.time() * 1000)
            for row in active_existing:
                rec = DebtRecord(
                    debt_id=str(row["id"]),
                    trader_id=str(row["trader_id"]),
                    principal=float(row["principal"]),
                    initial_principal=float(row.get("initial_principal") or row["principal"]),
                    interest_rate=float(row["interest_rate"]),
                    compounding_period_s=int(row.get("compounding_period_s", 120)),
                    due_date_ms=int(row["due_date_ms"]),
                    status=row["status"],
                    last_compounded_ms=now_ms,
                    total_repaid=float(row.get("total_repaid", 0.0)),
                    enforcer_count=int(row.get("enforcer_count", 0)),
                )
                self.ledger.debts[rec.debt_id] = rec
            logger.info("[LEDGER] Restored %d active debts from Supabase", len(active_existing))
        else:
            for t in self.traders:
                prof = INITIAL_DEBT_PROFILES.get(
                    t.trader_id, {"principal": 1000.0, "rate": 0.08, "period_s": 120, "duration_s": 600}
                )
                debt = await self.ledger.issue_debt(
                    trader_id=t.trader_id,
                    principal=prof["principal"],
                    interest_rate=prof["rate"],
                    compounding_period_s=prof["period_s"],
                    duration_s=prof["duration_s"],
                )
                logger.info("[LEDGER] Seeded debt for %s ($%.0f @ %.0f%%)", t.nickname, debt.principal, debt.interest_rate * 100)

        await self.ledger.sync.insert_event(
            "SYSTEM",
            "tefeci",
            "TEFECİ Faz 2 Motoru aktif! Binance Futures (BTC, ETH, SOL) canlı bağlandı.",
        )

    async def _checkpoint_state(self) -> None:
        logger.info(
            "[SHUTDOWN] Checkpointing %d open positions and %d debts to Supabase...",
            len(self.positions),
            len(self.ledger.debts),
        )
        for pos in self.positions.values():
            await self.ledger.sync.upsert_table("positions", self._position_to_db_row(pos, status="open"))
        for debt in self.ledger.debts.values():
            await self.ledger.sync.upsert_table("debts", debt.to_db_row())
        for t in self.traders:
            await self._sync_trader(t.trader_id)

    async def run(self, max_runtime_s: Optional[float] = None) -> None:
        await self._bootstrap_state()

        app = web.Application()
        app.router.add_get("/health", self._health_handler)
        app.router.add_get("/api/state", self._state_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", self.health_port)
        await site.start()
        logger.info("[HEALTH] /health endpoint listening on 0.0.0.0:%d", self.health_port)

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self._stop_event.set)
            except NotImplementedError:
                pass

        try:
            async with asyncio.TaskGroup() as tg:
                tg.create_task(self.feed.run())
                tg.create_task(self._oi_and_ledger_loop())
                tg.create_task(self._command_consumer_loop())
                tg.create_task(self._equity_snapshot_loop())
                for trader in self.traders:
                    tg.create_task(self._trader_supervisor(trader))

                if max_runtime_s is not None:
                    await asyncio.sleep(max_runtime_s)
                    self._stop_event.set()
                else:
                    await self._stop_event.wait()

                self.feed.stop()
                raise asyncio.CancelledError()
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        finally:
            await self._checkpoint_state()
            await runner.cleanup()
            await self.rest.close()
            await self.ledger.sync.close()


async def main() -> None:
    _load_dotenv()
    runtime = os.getenv("WORKER_MAX_RUNTIME_S")
    max_s = float(runtime) if runtime else None
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    await worker.run(max_runtime_s=max_s)


if __name__ == "__main__":
    asyncio.run(main())
