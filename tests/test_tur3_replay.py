"""Tur 3 QA & Historical Candle Replay Unit Tests (Sinan & Gülay)."""

import pytest

from src.backend.replay import (
    HistoricalCandle,
    calc_replay_consistency,
    close_replay_position,
    evaluate_replay_candle,
    open_replay_position,
    parse_binance_klines,
    parse_okx_candles,
    validate_candle_request,
)


def test_parse_binance_and_okx_candles_ascending_and_sanitized():
    # Binance format (oldest-first)
    binance_raw = [
        [1700000060000, "60000", "60100", "59950", "60050", "120.5"],
        [1700000000000, "59900", "60020", "59880", "60000", "98.2"],
        [0, "0", "0", "0", "0", "0"],  # invalid -> filtered out
    ]
    b_candles = parse_binance_klines(binance_raw)
    assert len(b_candles) == 2
    assert b_candles[0].ts < b_candles[1].ts
    assert b_candles[0].close == 60000.0
    assert b_candles[1].close == 60050.0

    # OKX format (newest-first -> must be reversed to ascending!)
    okx_raw = {
        "code": "0",
        "data": [
            ["1700000120000", "60050", "60150", "60010", "60120", "300"],
            ["1700000060000", "60000", "60090", "59980", "60050", "250"],
        ],
    }
    o_candles = parse_okx_candles(okx_raw)
    assert len(o_candles) == 2
    assert o_candles[0].ts == 1700000060000
    assert o_candles[1].ts == 1700000120000
    assert o_candles[1].high == 60150.0


def test_validate_candle_request_rejects_bad_symbols_or_intervals():
    sym, iv, lim = validate_candle_request("solusdt", "15m", 500)
    assert sym == "SOLUSDT"
    assert iv == "15m"
    assert lim == 200  # clamped

    with pytest.raises(ValueError):
        validate_candle_request("FAKECOIN", "1m", 60)

    with pytest.raises(ValueError):
        validate_candle_request("BTCUSDT", "3s", 60)


def test_replay_intrabar_wick_liquidation_and_manual_close():
    # 20x LONG at $100 -> liq_move = 0.05 - 0.005 = 0.045 -> liq_price = $95.50
    pos = open_replay_position(
        symbol="SOLUSDT",
        side="LONG",
        entry_price=100.0,
        leverage=20,
        isolated_margin=100.0,
        opened_index=10,
    )
    assert pos.liquidation_price == pytest.approx(95.5, abs=1e-4)

    # Normal green candle -> stays open with positive net PnL after taker fees
    c1 = HistoricalCandle(ts=1700000060000, open=100.0, high=102.0, low=99.2, close=101.5, volume=50)
    out1 = evaluate_replay_candle(pos, c1)
    assert out1.status == "open"
    assert out1.unrealized_pnl > 0

    # Deep wick touches $95.00 even though close recovers to $98.00 -> MUST liquidate!
    c2 = HistoricalCandle(ts=1700000120000, open=101.5, high=101.5, low=95.0, close=98.0, volume=200)
    out2 = evaluate_replay_candle(pos, c2)
    assert out2.status == "liquidated"
    assert out2.realized_pnl == -100.0
    assert out2.exit_price == pos.liquidation_price

    # Manual close check
    pnl_close = close_replay_position(pos, 102.0)
    # Gross = (102 - 100) * 20 = +40, fees ~= 0.8 + 0.816 = 1.616 -> ~38.38
    assert 38.0 < pnl_close < 39.0


def test_replay_consistency_penalizes_liquidations_and_reckless_leverage():
    safe_disc, safe_score = calc_replay_consistency(
        wins=4, losses=1, liquidations=0, high_leverage_trades=0
    )
    degen_disc, degen_score = calc_replay_consistency(
        wins=4, losses=1, liquidations=1, high_leverage_trades=3
    )
    assert safe_disc > degen_disc
    assert safe_score > degen_score
