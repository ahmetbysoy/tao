import json
import pytest

from src.backend.exchange_sim import (
    Position,
    calculate_isolated_liquidation_price,
    calculate_vwap_fill_price,
    get_margin_bracket,
)
from src.backend.feed import (
    AggTradeEvent,
    BookTickerEvent,
    ForceOrderEvent,
    MarkPriceEvent,
    parse_stream_message,
)
from src.backend.ledger import DebtLedger


def test_parse_binance_streams():
    bt_raw = json.dumps(
        {
            "stream": "btcusdt@bookTicker",
            "data": {"s": "BTCUSDT", "b": "95000.5", "B": "1.2", "a": "95001.0", "A": "0.8", "E": 1700000000000},
        }
    )
    bt = parse_stream_message(bt_raw)
    assert isinstance(bt, BookTickerEvent)
    assert bt.bid_price == 95000.5
    assert bt.ask_price == 95001.0

    fo_raw = json.dumps(
        {
            "stream": "btcusdt@forceOrder",
            "data": {
                "o": {"s": "BTCUSDT", "S": "SELL", "p": "94500", "ap": "94480", "q": "1.5", "T": 1700000000100}
            },
        }
    )
    fo = parse_stream_message(fo_raw)
    assert isinstance(fo, ForceOrderEvent)
    assert fo.side == "SELL"
    assert fo.notional_usdt == pytest.approx(94480 * 1.5)

    mp_raw = json.dumps(
        {
            "stream": "btcusdt@markPrice@1s",
            "data": {"s": "BTCUSDT", "p": "95000", "i": "94990", "r": "0.00015", "T": 1700000005000, "E": 1700000000200},
        }
    )
    mp = parse_stream_message(mp_raw)
    assert isinstance(mp, MarkPriceEvent)
    assert mp.funding_rate == pytest.approx(0.00015)

    at_raw = json.dumps(
        {
            "stream": "btcusdt@aggTrade",
            "data": {"s": "BTCUSDT", "p": "95010", "q": "0.5", "m": False, "T": 1700000000300},
        }
    )
    at = parse_stream_message(at_raw)
    assert isinstance(at, AggTradeEvent)
    assert at.is_buyer_maker is False
    assert at.quote_qty == pytest.approx(47505.0)


def test_vwap_slippage_and_liquidation_math():
    asks = [(100.0, 1.0), (101.0, 2.0)]
    bids = [(99.5, 1.0), (99.0, 2.0)]
    fill = calculate_vwap_fill_price("LONG", 2.0, bids, asks, 99.5, 100.0)
    assert fill == pytest.approx((1.0 * 100.0 + 1.0 * 101.0) / 2.0)

    bracket = get_margin_bracket(40_000.0)
    assert bracket.mmr == 0.0040
    assert bracket.cum == 0.0

    # 10x LONG at 100,000, qty=0.2 (notional=20,000, margin=2,000)
    liq_long = calculate_isolated_liquidation_price("LONG", 100_000.0, 0.2, 2_000.0)
    # (20000 - 2000 + 0) / (0.2 * (1 - 0.004)) = 18000 / 0.1992 = 90361.44578
    assert liq_long == pytest.approx(18_000.0 / (0.2 * 0.996))

    liq_short = calculate_isolated_liquidation_price("SHORT", 100_000.0, 0.2, 2_000.0)
    assert liq_short == pytest.approx(22_000.0 / (0.2 * 1.004))

    pos = Position(
        position_id="p1",
        trader_id="selo",
        symbol="BTCUSDT",
        side="LONG",
        entry_price=100_000.0,
        qty=0.2,
        leverage=10,
        isolated_margin=2_000.0,
        liquidation_price=liq_long,
        entry_fee=8.0,
    )
    assert pos.is_liquidated(90_000.0) is True
    assert pos.is_liquidated(95_000.0) is False


@pytest.mark.asyncio
async def test_debt_ledger_compounding():
    ledger = DebtLedger()
    debt = await ledger.issue_debt(
        trader_id="selo",
        principal=1000.0,
        interest_rate=0.10,
        compounding_period_s=60,
        duration_s=120,
    )
    # Advance 1 period (60s) -> 1000 * 1.10 = 1100
    await ledger.tick_compounding(now_ms=debt.created_at_ms + 60_000)
    assert debt.principal == pytest.approx(1100.0)
    assert debt.status == "aktif"

    # Advance past due date (120s + 1s = 121s) -> status becomes gecikti, penalty rate 0.10 * 1.5 = 0.15
    await ledger.tick_compounding(now_ms=debt.created_at_ms + 121_000)
    assert debt.status == "gecikti"
    assert debt.principal == pytest.approx(1100.0 * 1.15)
