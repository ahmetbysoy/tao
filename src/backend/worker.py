"""Production 24/7 asyncio worker for Tefeci trading & debt engine.

Features:
  - Supervisor-pattern concurrent trader evaluation via asyncio.TaskGroup
  - Real Binance Futures WSS feed (BTCUSDT, ETHUSDT) + Open Interest REST polling
  - Real VWAP slippage, 0.04% taker fee, exact isolated liquidation on markPrice
  - UptimeRobot /health endpoint (200 OK iff >= 10 WSS messages in last 60s)
  - Graceful shutdown checkpointing open positions & debts to Firebase
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
import uuid
from collections import deque
from dataclasses import asdict
from typing import Deque, Dict, List, Optional

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
    MarkPriceEvent,
    MarketEvent,
)
from src.backend.ledger import DebtLedger
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


class TefeciWorker:
    def __init__(
        self,
        symbols: tuple[str, ...] = ("btcusdt", "ethusdt"),
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
        self.trader_queues: Dict[str, asyncio.Queue[MarketEvent]] = {
            t.trader_id: asyncio.Queue(maxsize=2048) for t in self.traders
        }
        self.balances: Dict[str, float] = {t.trader_id: 1000.0 for t in self.traders}
        self.positions: Dict[str, Position] = {}
        self.msg_timestamps: Deque[float] = deque(maxlen=5000)
        self._stop_event = asyncio.Event()

        self.feed.on_event(self._on_market_event)

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
            for pos_id, pos in list(self.positions.items()):
                if pos.symbol == event.symbol and pos.is_liquidated(event.mark_price):
                    await self._handle_liquidation(pos, event.mark_price)

        # Check SL/TP on bookTicker
        elif isinstance(event, BookTickerEvent):
            mid = (event.bid_price + event.ask_price) / 2.0
            for pos_id, pos in list(self.positions.items()):
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

        self.balances[signal.trader_id] = round(bal - margin, 4)
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
        await self.ledger.firebase.push_state(
            f"positions/{pos.position_id}", asdict(pos)
        )
        return pos

    async def _close_position(self, pos: Position, exit_price: float, reason: str) -> None:
        self.positions.pop(pos.position_id, None)
        net_pnl = pos.close(exit_price)
        returned = max(0.0, pos.isolated_margin + net_pnl)
        self.balances[pos.trader_id] = round(
            self.balances.get(pos.trader_id, 0.0) + returned, 4
        )
        logger.info(
            "[%s] Closed %s %s @ %.2f | Net PnL: %+.2f USDT | %s",
            pos.trader_id.upper(),
            pos.symbol,
            pos.side,
            exit_price,
            net_pnl,
            reason,
        )
        await self.ledger.firebase.push_state(
            f"positions/{pos.position_id}",
            {"status": "closed", "exit_price": exit_price, "net_pnl": net_pnl, "reason": reason},
        )

    async def _handle_liquidation(self, pos: Position, mark_price: float) -> None:
        self.positions.pop(pos.position_id, None)
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

        await self.ledger.firebase.push_state(
            f"events/{pos.position_id}",
            {
                "event": "LIQUIDATION",
                "trader_id": pos.trader_id,
                "symbol": pos.symbol,
                "mark_price": mark_price,
                "timestamp_ms": int(time.time() * 1000),
            },
        )

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
                        oi = await self.rest.fetch_open_interest(sym)
                        nuri.update_open_interest(sym.upper(), oi)
                updated = await self.ledger.tick_compounding()
                for debt in updated:
                    logger.info(
                        "[LEDGER] Debt updated for %s. Principal: %.2f | Status: %s",
                        debt.trader_id,
                        debt.principal,
                        debt.status,
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error in OI/Ledger loop")
            await asyncio.sleep(10)

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
            },
            status=status,
        )

    async def _checkpoint_state(self) -> None:
        logger.info("[SHUTDOWN] Checkpointing %d open positions and %d debts to Firebase...", len(self.positions), len(self.ledger.debts))
        for pos in self.positions.values():
            await self.ledger.firebase.push_state(f"positions/{pos.position_id}", asdict(pos))
        for debt in self.ledger.debts.values():
            await self.ledger.firebase.push_state(f"debts/{debt.debt_id}", asdict(debt))

    async def run(self, max_runtime_s: Optional[float] = None) -> None:
        # Seed initial active debts for the 5 traders
        for t in self.traders:
            debt = await self.ledger.issue_debt(
                trader_id=t.trader_id,
                principal=1000.0,
                interest_rate=0.08,
                compounding_period_s=120,
                duration_s=600,
            )
            logger.info("[LEDGER] Debt issued for %s. Status: %s", t.nickname, debt.status)

        app = web.Application()
        app.router.add_get("/health", self._health_handler)
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
            await self.ledger.firebase.close()


async def main() -> None:
    runtime = os.getenv("WORKER_MAX_RUNTIME_S")
    max_s = float(runtime) if runtime else None
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt"))
    await worker.run(max_runtime_s=max_s)


if __name__ == "__main__":
    asyncio.run(main())
