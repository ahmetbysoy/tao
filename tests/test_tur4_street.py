import pytest

from src.backend.replay import (
    close_replay_position,
    evaluate_replay_candle,
    open_replay_position,
    parse_okx_candles,
)
from src.backend.tur4_street import (
    AntiRepeatStreetVoice,
    assign_kahvehane_zone,
    detect_candle_gaps,
    evaluate_human_trader_decision,
    parse_okx_funding_rate,
    should_persist_candle_batch,
)


def test_riza_funding_rate_parse_and_candle_gap_detector():
    snap = parse_okx_funding_rate(
        "BTCUSDT",
        {
            "code": "0",
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "fundingRate": "0.00005382",
                    "nextFundingTime": "1795910400000",
                }
            ],
        },
    )
    assert snap.symbol == "BTCUSDT"
    assert snap.funding_rate == pytest.approx(0.00005382)
    assert snap.next_funding_ms == 1795910400000
    assert snap.source == "okx_swap"

    # Gap between minute 2 (120_000) and minute 5 (300_000) -> missing 180_000..240_000
    gaps = detect_candle_gaps([0, 60_000, 120_000, 300_000], "1m")
    assert gaps == [(180_000, 240_000)]
    assert detect_candle_gaps([0, 60_000, 120_000], "1m") == []


def test_kemal_rate_limited_candle_vault_guard():
    assert should_persist_candle_batch(None, 100_000, cooldown_ms=30_000) is True
    assert should_persist_candle_batch(100_000, 120_000, cooldown_ms=30_000) is False
    assert should_persist_candle_batch(100_000, 130_000, cooldown_ms=30_000) is True


def test_nuri_human_flaw_strategies_on_real_market_telemetry():
    # Selo tilt revenge mistake after losses -> bumps leverage
    selo_tilt = evaluate_human_trader_decision(
        trader_id="selo",
        base_leverage=50,
        fear_trades_remaining=0,
        mood="tilted",
        wins=1,
        losses=4,
        change_pct_24h=1.2,
        imbalance=0.45,
        funding_rate=0.00005,
    )
    assert selo_tilt.side == "LONG"
    assert selo_tilt.leverage == 65
    assert selo_tilt.flaw_tag == "FOMO_TILT_REVENGE"

    # Mehmet catching falling knife on sharp drop
    mehmet_knife = evaluate_human_trader_decision(
        trader_id="mehmet",
        base_leverage=25,
        fear_trades_remaining=0,
        mood="focused",
        wins=2,
        losses=2,
        change_pct_24h=-2.8,
        imbalance=-0.2,
        funding_rate=-0.00002,
    )
    assert mehmet_knife.side == "LONG"
    assert mehmet_knife.flaw_tag == "FALLING_KNIFE_WICK"

    # Nuri real funding rate contrarian squeeze trap
    nuri_squeeze = evaluate_human_trader_decision(
        trader_id="nuri",
        base_leverage=15,
        fear_trades_remaining=0,
        mood="focused",
        wins=3,
        losses=1,
        change_pct_24h=2.1,
        imbalance=0.1,
        funding_rate=0.00011,
    )
    assert nuri_squeeze.side == "SHORT"
    assert nuri_squeeze.flaw_tag == "FUNDING_SQUEEZE_TRAP"

    # Sevil disciplined sniper vs rare greed slip
    sevil_calm = evaluate_human_trader_decision(
        trader_id="sevil",
        base_leverage=10,
        fear_trades_remaining=0,
        mood="focused",
        wins=5,
        losses=1,
        change_pct_24h=1.6,
        imbalance=0.1,
        funding_rate=0.00004,
    )
    assert sevil_calm.side == "SHORT"
    assert sevil_calm.leverage == 10
    assert sevil_calm.flaw_tag == "DISCIPLINED_MEAN_REV"


def test_selo_anti_repeat_street_voice_and_gender_profiles():
    voice = AntiRepeatStreetVoice(history_window=6)
    seen = []
    for i in range(6):
        delivery = voice.next_delivery("selo", "liquidation", seed_number=60000.0 + i * 17.5)
        assert delivery.gender == "masculine"
        seen.append(delivery.text)
    # Zero duplicate lines across 6 consecutive liquidation events!
    assert len(set(seen)) == 6

    sevil_line = voice.next_delivery("sevil", "big_profit", seed_number=1672.5)
    assert sevil_line.gender == "feminine"
    assert sevil_line.pitch > 1.0


def test_sevil_kahvehane_zone_assignment():
    assert (
        assign_kahvehane_zone(
            mood="panicked",
            open_positions_count=1,
            open_pnl=-40,
            overdue_debt_count=1,
            recent_liquidations=1,
        )
        == "likidasyon_cukuru"
    )
    assert (
        assign_kahvehane_zone(
            mood="focused",
            open_positions_count=1,
            open_pnl=25,
            overdue_debt_count=1,
            recent_liquidations=0,
        )
        == "tefeci_masasi"
    )
    assert (
        assign_kahvehane_zone(
            mood="focused",
            open_positions_count=2,
            open_pnl=80,
            overdue_debt_count=0,
            recent_liquidations=0,
        )
        == "kaldirac_masasi"
    )
    assert (
        assign_kahvehane_zone(
            mood="focused",
            open_positions_count=0,
            open_pnl=0,
            overdue_debt_count=0,
            recent_liquidations=0,
        )
        == "cay_ocagi"
    )


def test_burak_short_historical_replay_scenario():
    """Burak: Short 5-bar real-format OKX replay scenario validating entry, hold, and exit."""
    raw_okx = [
        ["1795860240000", "59920.0", "60150.0", "59910.0", "60110.0", "142.0"],
        ["1795860180000", "59880.0", "59950.0", "59840.0", "59920.0", "118.0"],
        ["1795860120000", "59810.0", "59900.0", "59790.0", "59880.0", "99.0"],
        ["1795860060000", "59830.0", "59860.0", "59760.0", "59810.0", "130.0"],
        ["1795860000000", "59800.0", "59850.0", "59780.0", "59830.0", "105.0"],
    ]
    candles = parse_okx_candles({"code": "0", "data": raw_okx})
    assert len(candles) == 5
    assert candles[0].ts < candles[-1].ts

    pos = open_replay_position(
        symbol="BTCUSDT",
        side="LONG",
        entry_price=candles[0].close,
        leverage=10,
        isolated_margin=200.0,
        opened_index=0,
    )
    for bar in candles[1:-1]:
        step = evaluate_replay_candle(pos, bar)
        assert step.status == "open"
    net_pnl = close_replay_position(pos, candles[-1].close)
    assert net_pnl > 0
