import pytest

from src.backend.feed import BookTickerEvent, build_stream_url
from src.backend.ledger import DebtLedger, SupabaseSync
from src.backend.worker import TefeciWorker


@pytest.mark.asyncio
async def test_faz2_command_processing_end_to_end():
    """Verify UI dark-pattern commands mutate real worker state (fear, double interest, collect, issue)."""
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    # Disconnect real network sync for pure unit test
    worker.ledger = DebtLedger(sync=SupabaseSync(url="", key=""))

    debt = await worker.ledger.issue_debt(
        trader_id="selo",
        principal=1000.0,
        interest_rate=0.10,
        compounding_period_s=120,
        duration_s=600,
    )

    # 1. DOUBLE_INTEREST doubles rate and panics trader
    await worker._process_command(
        {
            "id": 1,
            "type": "DOUBLE_INTEREST",
            "trader_id": "selo",
            "payload": {"debt_id": debt.debt_id},
        }
    )
    assert debt.interest_rate == pytest.approx(0.20)
    assert worker.trader_map["selo"].mood == "panicked"

    # 2. SEND_ENFORCER activates 3-trade fear mode (halves effective leverage)
    await worker._process_command(
        {
            "id": 2,
            "type": "SEND_ENFORCER",
            "trader_id": "selo",
            "payload": {"debt_id": debt.debt_id, "trader_id": "selo"},
        }
    )
    selo = worker.trader_map["selo"]
    assert selo.fear_trades_remaining == 3
    assert debt.enforcer_count == 1
    assert worker._trader_to_db_row(selo)["max_leverage"] == 37  # 75 // 2

    # 3. COLLECT_DEBT deducts trader balance and repays debt
    await worker._process_command(
        {
            "id": 3,
            "type": "COLLECT_DEBT",
            "trader_id": "selo",
            "payload": {"debt_id": debt.debt_id, "amount": 250.0},
        }
    )
    assert worker.balances["selo"] == pytest.approx(750.0)
    assert debt.total_repaid == pytest.approx(250.0)
    assert debt.current_owed() == pytest.approx(750.0)

    # 4. ISSUE_DEBT adds balance and registers a fresh active debt
    await worker._process_command(
        {
            "id": 4,
            "type": "ISSUE_DEBT",
            "trader_id": "selo",
            "payload": {"trader_id": "selo", "principal": 500.0, "interest_rate": 0.15, "duration_s": 300},
        }
    )
    assert worker.balances["selo"] == pytest.approx(1250.0)
    assert len(worker.ledger.debts) == 2

    # 5. TRIGGER_TEST_TRADE & FORCE_CLOSE execute realistic VWAP open & close
    worker.feed.latest_book["BTCUSDT"] = BookTickerEvent(
        symbol="BTCUSDT",
        bid_price=60000.0,
        bid_qty=5.0,
        ask_price=60001.0,
        ask_qty=5.0,
        event_time_ms=1700000000000,
    )
    await worker._process_command(
        {
            "id": 5,
            "type": "TRIGGER_TEST_TRADE",
            "trader_id": "selo",
            "payload": {"trader_id": "selo", "symbol": "BTCUSDT", "side": "LONG"},
        }
    )
    assert len(worker.positions) == 1
    pos = next(iter(worker.positions.values()))
    assert pos.trader_id == "selo"
    assert pos.leverage == 37  # Fear mode halved Selo's 75x leverage!

    # Force close at higher price -> positive net PnL
    worker.feed.latest_book["BTCUSDT"] = BookTickerEvent(
        symbol="BTCUSDT",
        bid_price=60500.0,
        bid_qty=5.0,
        ask_price=60501.0,
        ask_qty=5.0,
        event_time_ms=1700000005000,
    )
    await worker._process_command(
        {
            "id": 6,
            "type": "FORCE_CLOSE",
            "trader_id": "selo",
            "payload": {"position_id": pos.position_id},
        }
    )
    assert len(worker.positions) == 0
    assert worker.realized_pnl["selo"] > 0


def test_stream_url_includes_solusdt():
    url = build_stream_url(("btcusdt", "ethusdt", "solusdt"))
    assert "solusdt@bookTicker" in url
    assert "btcusdt@markPrice@1s" in url
    assert "ethusdt@depth20@100ms" in url
