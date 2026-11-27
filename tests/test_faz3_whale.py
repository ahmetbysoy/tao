import pytest

from src.backend.feed import BookTickerEvent, ForceOrderEvent
from src.backend.ledger import DebtLedger, SupabaseSync
from src.backend.worker import TefeciWorker


@pytest.mark.asyncio
async def test_whale_alert_threshold_and_auto_interest_hike():
    """$1M+ Binance forceOrder must boost Selo's interest by +50% and shift mood to greedy."""
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    worker.ledger = DebtLedger(sync=SupabaseSync(url="", key=""))

    selo_debt = await worker.ledger.issue_debt(
        trader_id="selo",
        principal=1200.0,
        interest_rate=0.12,
        compounding_period_s=90,
        duration_s=300,
    )

    # Below threshold ($950k) -> must NOT boost interest
    small_liq = ForceOrderEvent(
        symbol="BTCUSDT",
        side="SELL",
        price=60000.0,
        avg_price=60000.0,
        qty=950_000.0 / 60000.0,
        notional_usdt=950_000.0,
        trade_time_ms=1700000000000,
    )
    await worker._on_market_event(small_liq)
    assert selo_debt.interest_rate == pytest.approx(0.12)

    # Above threshold ($1.45M on SOLUSDT) -> auto +50% interest hike (0.12 -> 0.18)
    whale_liq = ForceOrderEvent(
        symbol="SOLUSDT",
        side="SELL",
        price=72.5,
        avg_price=72.5,
        qty=20_000.0,
        notional_usdt=1_450_000.0,
        trade_time_ms=1700000001000,
    )
    await worker._on_market_event(whale_liq)
    assert selo_debt.interest_rate == pytest.approx(0.18)
    assert worker.trader_map["selo"].mood == "greedy"

    # Immediate duplicate within cooldown -> must NOT double-hike
    await worker._on_market_event(whale_liq)
    assert selo_debt.interest_rate == pytest.approx(0.18)


@pytest.mark.asyncio
async def test_simulate_whale_command():
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    worker.ledger = DebtLedger(sync=SupabaseSync(url="", key=""))
    worker.feed.latest_book["SOLUSDT"] = BookTickerEvent(
        symbol="SOLUSDT",
        bid_price=72.0,
        bid_qty=100.0,
        ask_price=72.1,
        ask_qty=100.0,
        event_time_ms=1700000000000,
    )
    selo_debt = await worker.ledger.issue_debt(
        trader_id="selo",
        principal=1200.0,
        interest_rate=0.10,
        compounding_period_s=90,
        duration_s=300,
    )
    await worker._process_command(
        {
            "id": 99,
            "type": "SIMULATE_WHALE",
            "trader_id": "selo",
            "payload": {"symbol": "SOLUSDT", "notional_usdt": 1_500_000.0},
        }
    )
    assert selo_debt.interest_rate == pytest.approx(0.15)
