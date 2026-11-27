"""Live CI/CD smoke test for RUTHLESS DEPLOY PIPELINE.

Connects to REAL Binance Futures WSS (BTCUSDT, ETHUSDT, SOLUSDT), verifies real ticks,
executes Selo Roket 75x entry on live SOLUSDT price, triggers Kemal Fear Mode,
and verifies Faz 3 $1M+ Whale Alert +50% interest hike.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time

from src.backend.feed import ForceOrderEvent
from src.backend.ledger import DebtLedger, SupabaseSync
from src.backend.traders import TradeSignal
from src.backend.worker import TefeciWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("tefeci.pipeline")


async def run_smoke_test() -> None:
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    # Keep CI smoke test non-destructive against live production DB tables
    worker.ledger = DebtLedger(sync=SupabaseSync(url="", key=""))

    selo_debt = await worker.ledger.issue_debt(
        trader_id="selo",
        principal=1200.0,
        interest_rate=0.12,
        compounding_period_s=90,
        duration_s=300,
    )
    kemal_debt = await worker.ledger.issue_debt(
        trader_id="kemal",
        principal=1500.0,
        interest_rate=0.08,
        compounding_period_s=150,
        duration_s=600,
    )

    feed_task = asyncio.create_task(worker.feed.run())
    try:
        deadline = time.monotonic() + 18.0
        while time.monotonic() < deadline:
            if all(s in worker.feed.latest_book for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT")):
                break
            await asyncio.sleep(0.2)

        assert all(
            s in worker.feed.latest_book for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT")
        ), f"Missing live Binance Futures books: {list(worker.feed.latest_book.keys())}"

        btc_mid = (
            worker.feed.latest_book["BTCUSDT"].bid_price
            + worker.feed.latest_book["BTCUSDT"].ask_price
        ) / 2.0
        eth_mid = (
            worker.feed.latest_book["ETHUSDT"].bid_price
            + worker.feed.latest_book["ETHUSDT"].ask_price
        ) / 2.0
        sol_mid = (
            worker.feed.latest_book["SOLUSDT"].bid_price
            + worker.feed.latest_book["SOLUSDT"].ask_price
        ) / 2.0
        logger.info(
            "[FEED] Live prices verified -> BTC=$%.2f | ETH=$%.2f | SOL=$%.3f",
            btc_mid,
            eth_mid,
            sol_mid,
        )

        # 1. Verify Selo Roket 75x entry on REAL live SOLUSDT price
        sig = TradeSignal(
            trader_id="selo",
            symbol="SOLUSDT",
            side="LONG",
            leverage=worker.trader_map["selo"].adjust_leverage(75),
            margin_fraction=0.35,
            stop_loss=round(sol_mid * 0.996, 3),
            take_profit=round(sol_mid * 1.003, 3),
            reason="1 saniyede 5x $10k+ market buy hacim patlaması!",
            signal_snapshot={"price": sol_mid},
        )
        pos = await worker.execute_order(sig)
        assert pos is not None, "Selo order execution failed"
        logger.info(
            "[SELO] Volume spike detected on SOLUSDT. Entering LONG 75x @ %.3f (Liq: %.3f).",
            pos.entry_price,
            pos.liquidation_price,
        )

        # 2. Verify Fear Mode command on Tahta Kemal
        await worker._process_command(
            {
                "id": 1001,
                "type": "SEND_ENFORCER",
                "trader_id": "kemal",
                "payload": {"debt_id": kemal_debt.debt_id, "trader_id": "kemal"},
            }
        )
        kemal = worker.trader_map["kemal"]
        assert kemal.fear_trades_remaining == 3
        assert worker._trader_to_db_row(kemal)["max_leverage"] == 10

        # 3. Verify Faz 3 Whale Alert Manipulation ($1.48M liquidation -> Selo interest +50%)
        whale = ForceOrderEvent(
            symbol="SOLUSDT",
            side="SELL",
            price=sol_mid,
            avg_price=sol_mid,
            qty=1_480_000.0 / sol_mid,
            notional_usdt=1_480_000.0,
            trade_time_ms=int(time.time() * 1000),
        )
        await worker._on_market_event(whale)
        assert selo_debt.interest_rate == 0.18, f"Expected 0.18, got {selo_debt.interest_rate}"

        # 4. Verify OKX/Binance Open Interest polling fallback works
        oi = await worker.rest.fetch_open_interest("BTCUSDT")
        logger.info("[REST] Open Interest verified for BTCUSDT: %.2f", oi)
        assert oi > 0

        logger.info("[PIPELINE] ALL RUTHLESS CHECKS PASSED — 200 OK READY.")
    finally:
        worker.feed.stop()
        feed_task.cancel()
        try:
            await feed_task
        except asyncio.CancelledError:
            pass
        await worker.rest.close()


if __name__ == "__main__":
    try:
        asyncio.run(run_smoke_test())
    except Exception as exc:
        logger.exception("Pipeline smoke test failed: %s", exc)
        sys.exit(1)
