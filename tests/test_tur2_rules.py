"""Tur 2 QA & Rules Unit Tests (Rıza, Tuncay, Bülent, Gülay)."""

from src.backend.tur2_engine import (
    can_join_cup,
    compute_debt_endurance,
    evaluate_debt_pressure_quote,
    evaluate_liquidation_quote,
    evaluate_momentum_quote,
    normalize_invite_code,
    rank_cup_participants,
)


def test_riza_debt_endurance_badges_and_burn_rate():
    now = 1_700_000_000_000
    # 25 minutes survived, still before due date -> DEMİR SİNİR
    snap = compute_debt_endurance(
        principal=1_200.0,
        total_repaid=200.0,
        interest_rate=0.10,
        compounding_period_s=300,  # 5 min period -> 2% per min -> $20/min
        created_at_ms=now - 25 * 60 * 1000,
        due_date_ms=now + 10 * 60 * 1000,
        now_ms=now,
        trader_equity=1_000.0,
        enforcer_count=1,
        status="aktif",
    )
    assert snap.owed_usdt == 1000.0
    assert snap.is_overdue is False
    assert snap.burn_rate_per_min == 20.0
    assert snap.badge == "DEMİR SİNİR"
    assert 0 < snap.pressure_pct <= 100

    # 8 minutes overdue -> KRİTİK GECİKME
    overdue_snap = compute_debt_endurance(
        principal=1_500.0,
        total_repaid=0.0,
        interest_rate=0.15,
        compounding_period_s=300,
        created_at_ms=now - 60 * 60 * 1000,
        due_date_ms=now - 8 * 60 * 1000,
        now_ms=now,
        trader_equity=600.0,
        enforcer_count=2,
        status="gecikti",
    )
    assert overdue_snap.is_overdue is True
    assert overdue_snap.overdue_ms == 8 * 60 * 1000
    assert overdue_snap.badge == "KRİTİK GECİKME"
    assert overdue_snap.pressure_pct >= 80


def test_tuncay_quotes_only_trigger_on_live_data_and_respect_cooldown():
    now = 1_700_000_050_000

    # Disconnected or stale feed must NEVER emit a price quote
    assert (
        evaluate_momentum_quote(
            symbol="BTCUSDT",
            live_price=60_000.0,
            pct_change_15s=0.35,
            connected=False,
            last_tick_age_ms=200,
            now_ms=now,
            last_quote_ms=0,
        )
        is None
    )
    assert (
        evaluate_momentum_quote(
            symbol="BTCUSDT",
            live_price=60_000.0,
            pct_change_15s=0.35,
            connected=True,
            last_tick_age_ms=8_000,
            now_ms=now,
            last_quote_ms=0,
        )
        is None
    )

    # Small noise move (< 0.12%) does not spam
    assert (
        evaluate_momentum_quote(
            symbol="ETHUSDT",
            live_price=1_700.0,
            pct_change_15s=0.04,
            connected=True,
            last_tick_age_ms=100,
            now_ms=now,
            last_quote_ms=0,
        )
        is None
    )

    # Real sharp move triggers deterministic speaker quote
    q1 = evaluate_momentum_quote(
        symbol="SOLUSDT",
        live_price=72.5,
        pct_change_15s=-0.28,
        connected=True,
        last_tick_age_ms=100,
        now_ms=now,
        last_quote_ms=0,
        seq=0,
    )
    assert q1 is not None
    assert q1.speaker_id == "mehmet"
    assert "SOL" in q1.text

    # Cooldown prevents spam within 12s
    assert (
        evaluate_momentum_quote(
            symbol="SOLUSDT",
            live_price=72.1,
            pct_change_15s=-0.40,
            connected=True,
            last_tick_age_ms=100,
            now_ms=now + 4_000,
            last_quote_ms=now,
        )
        is None
    )


def test_tuncay_liquidation_and_debt_pressure_quotes():
    now = 1_700_000_100_000
    # Sub-$10K liquidation ignored
    assert (
        evaluate_liquidation_quote(
            symbol="BTCUSDT",
            liquidated_side="LONG",
            notional_usdt=4_500.0,
            price=60_000.0,
            now_ms=now,
            last_quote_ms=0,
        )
        is None
    )

    # $1M+ whale bypasses normal cooldown and triggers Tefeci quote
    whale_q = evaluate_liquidation_quote(
        symbol="ETHUSDT",
        liquidated_side="SHORT",
        notional_usdt=1_450_000.0,
        price=1_680.0,
        now_ms=now + 2_000,
        last_quote_ms=now,
    )
    assert whale_q is not None
    assert whale_q.speaker_id == "tefeci"
    assert "$1.45M" in whale_q.text

    endurance = compute_debt_endurance(
        principal=1_500.0,
        total_repaid=0.0,
        interest_rate=0.10,
        compounding_period_s=300,
        created_at_ms=now - 600_000,
        due_date_ms=now - 60_000,
        now_ms=now,
        trader_equity=800.0,
        status="gecikti",
    )
    debt_q = evaluate_debt_pressure_quote(
        nickname="Selo Roket",
        endurance=endurance,
        now_ms=now,
        last_quote_ms=0,
    )
    assert debt_q is not None
    assert "Selo Roket" in debt_q.text


def test_bulent_invite_code_and_join_validation():
    assert normalize_invite_code("  kupa-7x ") == "KUPA7X"
    assert normalize_invite_code("abc") is None  # too short
    assert normalize_invite_code("DROP TABLE;") is None

    now = 1_700_000_000_000
    ok, _ = can_join_cup(status="active", ends_at_ms=now + 600_000, now_ms=now, participant_count=4)
    assert ok is True

    expired_ok, msg = can_join_cup(
        status="active", ends_at_ms=now - 1_000, now_ms=now, participant_count=4
    )
    assert expired_ok is False
    assert "sona" in msg.lower()

    full_ok, _ = can_join_cup(
        status="active", ends_at_ms=now + 600_000, now_ms=now, participant_count=32, max_participants=32
    )
    assert full_ok is False


def test_bulent_cup_leaderboard_ranks_by_consistency_not_raw_points():
    ranked = rank_cup_participants(
        [
            {
                "id": "gambler",
                "nickname": "Degen Ali",
                "points": 8500.0,  # Huge raw points from lucky max bets, poor discipline
                "wins": 4,
                "losses": 6,
                "best_streak": 2,
                "discipline_multiplier": 0.7,
            },
            {
                "id": "disciplined",
                "nickname": "Sabırlı Ayşe",
                "points": 1450.0,  # Lower raw points, high accuracy & discipline
                "wins": 8,
                "losses": 2,
                "best_streak": 5,
                "discipline_multiplier": 1.15,
            },
        ]
    )
    assert ranked[0]["nickname"] == "Sabırlı Ayşe"
    assert ranked[0]["consistency_score"] > ranked[1]["consistency_score"]
