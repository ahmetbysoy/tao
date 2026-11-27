import pytest

from src.backend.feed import BookTickerEvent, DepthEvent
from src.backend.ledger import DebtLedger, SupabaseSync
from src.backend.scoring import (
    FITIL_START_POINTS,
    LeaderboardRow,
    calc_consistency_score,
    calc_streak_multiplier,
    check_rapid_cooldown,
    rank_by_consistency,
    settle_fitil_round,
)
from src.backend.worker import TefeciWorker, determine_orderbook_side


def test_determine_orderbook_side_uses_live_imbalance():
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))

    # Bid-heavy bookTicker -> LONG
    worker.feed.latest_book["BTCUSDT"] = BookTickerEvent(
        symbol="BTCUSDT",
        bid_price=60000.0,
        bid_qty=18.0,
        ask_price=60001.0,
        ask_qty=4.0,
        event_time_ms=1700000000000,
    )
    side, obi = determine_orderbook_side("BTCUSDT", worker.feed)
    assert side == "LONG"
    assert obi > 0.5

    # Ask-heavy depth overrides bookTicker -> SHORT
    worker.feed.latest_depth["BTCUSDT"] = DepthEvent(
        symbol="BTCUSDT",
        bids=((60000.0, 2.0), (59999.0, 1.0)),
        asks=((60001.0, 12.0), (60002.0, 8.0)),
        event_time_ms=1700000000500,
    )
    side2, obi2 = determine_orderbook_side("BTCUSDT", worker.feed)
    assert side2 == "SHORT"
    assert obi2 < -0.5


@pytest.mark.asyncio
async def test_trigger_test_trade_deterministic_without_explicit_side():
    worker = TefeciWorker(symbols=("btcusdt", "ethusdt", "solusdt"))
    worker.ledger = DebtLedger(sync=SupabaseSync(url="", key=""))
    # Ask-heavy orderbook -> must open SHORT deterministically
    worker.feed.latest_book["SOLUSDT"] = BookTickerEvent(
        symbol="SOLUSDT",
        bid_price=72.0,
        bid_qty=10.0,
        ask_price=72.05,
        ask_qty=90.0,
        event_time_ms=1700000000000,
    )
    await worker._process_command(
        {
            "id": 201,
            "type": "TRIGGER_TEST_TRADE",
            "trader_id": "kemal",
            "payload": {"trader_id": "kemal", "symbol": "SOLUSDT"},
        }
    )
    assert len(worker.positions) == 1
    pos = next(iter(worker.positions.values()))
    assert pos.side == "SHORT"
    assert "OBI=" in pos.reason_entry


def test_fitil_avi_settlement_and_streak_reset():
    assert FITIL_START_POINTS == 1000
    assert calc_streak_multiplier(1) == 1.0
    assert calc_streak_multiplier(2) == 1.25
    assert calc_streak_multiplier(3) == 1.5
    assert calc_streak_multiplier(5) == 2.0

    # Correct UP prediction increments streak and multiplies reward
    r1 = settle_fitil_round(
        direction="UP",
        entry_price=60000.0,
        exit_price=60025.0,
        connected=True,
        last_tick_age_ms=250,
        stake=100,
        current_streak=2,
    )
    assert r1["status"] == "won"
    assert r1["next_streak"] == 3
    assert r1["multiplier"] == 1.5
    assert r1["delta_points"] == 150

    # First wrong prediction resets streak to 0
    r2 = settle_fitil_round(
        direction="UP",
        entry_price=60025.0,
        exit_price=60010.0,
        connected=True,
        last_tick_age_ms=250,
        stake=100,
        current_streak=3,
    )
    assert r2["status"] == "lost"
    assert r2["next_streak"] == 0
    assert r2["delta_points"] == -100


def test_fitil_avi_cancels_on_disconnect_or_stale_price():
    r_disc = settle_fitil_round(
        direction="UP",
        entry_price=60000.0,
        exit_price=60100.0,
        connected=False,
        last_tick_age_ms=100,
        stake=100,
        current_streak=4,
    )
    assert r_disc["status"] == "cancelled"
    assert r_disc["delta_points"] == 0
    assert r_disc["next_streak"] == 4

    r_stale = settle_fitil_round(
        direction="DOWN",
        entry_price=60000.0,
        exit_price=59900.0,
        connected=True,
        last_tick_age_ms=5200,
        stake=100,
        current_streak=2,
    )
    assert r_stale["status"] == "cancelled"
    assert r_stale["delta_points"] == 0
    assert r_stale["next_streak"] == 2


def test_consistency_leaderboard_ranks_discipline_above_raw_profit():
    reckless_score = calc_consistency_score(wins=4, losses=6, discipline_multiplier=0.7)
    steady_score = calc_consistency_score(wins=8, losses=2, discipline_multiplier=1.25)
    assert steady_score > reckless_score

    ranked = rank_by_consistency(
        [
            LeaderboardRow(id="selo", name="Selo Roket", raw_profit=9500.0, consistency_score=reckless_score),
            LeaderboardRow(id="sevil", name="Madam Sevil", raw_profit=420.0, consistency_score=steady_score),
        ]
    )
    assert ranked[0].id == "sevil"
    assert ranked[1].id == "selo"


def test_rapid_round_cooldown_guard():
    now = 1_000_000
    assert not check_rapid_cooldown([now - 10_000, now - 20_000], now)
    assert check_rapid_cooldown([now - 5_000, now - 18_000, now - 35_000], now)
    assert not check_rapid_cooldown([now - 5_000, now - 50_000, now - 90_000], now)
