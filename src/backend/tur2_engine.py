"""Tur 2 Deterministic Rules Engine (Rıza, Tuncay, Bülent).

Zero randomness, zero fake prices:
  - Rıza: Debt Endurance Timer, burn rate, pressure score & survival tier badges.
  - Tuncay: Real market-triggered live Turkish quotes (momentum, forceOrder, debt pressure).
  - Bülent: Mahalle Kupası invite-code validation & consistency-first leaderboard ranking.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from src.backend.scoring import calc_consistency_score

INVITE_CODE_RE = re.compile(r"^[A-Z0-9]{6,10}$")
QUOTE_MOMENTUM_THRESHOLD_PCT = 0.12
QUOTE_DEFAULT_COOLDOWN_MS = 12_000
STALE_FEED_MS = 5_000


# ---------------------------------------------------------------------------
# Rıza — Debt Endurance Timer & Risk Pressure
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class DebtEnduranceSnapshot:
    owed_usdt: float
    elapsed_ms: int
    remaining_ms: int
    overdue_ms: int
    is_overdue: bool
    burn_rate_per_min: float
    debt_to_equity_ratio: float
    pressure_pct: int
    badge: str


def compute_debt_endurance(
    *,
    principal: float,
    total_repaid: float,
    interest_rate: float,
    compounding_period_s: int,
    created_at_ms: int,
    due_date_ms: int,
    now_ms: int,
    trader_equity: float,
    enforcer_count: int = 0,
    status: str = "aktif",
) -> DebtEnduranceSnapshot:
    owed = max(0.0, float(principal) - float(total_repaid))
    elapsed_ms = max(0, int(now_ms) - int(created_at_ms))
    remaining_ms = int(due_date_ms) - int(now_ms)
    is_overdue = owed > 0 and (status == "gecikti" or remaining_ms <= 0)
    overdue_ms = max(0, -remaining_ms) if is_overdue else 0

    period_minutes = max(1.0 / 60.0, float(max(1, compounding_period_s)) / 60.0)
    burn_rate_per_min = round(owed * (max(0.0, float(interest_rate)) / period_minutes), 4)

    safe_equity = max(1.0, float(trader_equity))
    debt_to_equity = round(owed / safe_equity, 3)

    if owed <= 0:
        pressure_pct = 0
        badge = "BORÇSUZ"
    else:
        ratio_score = min(55.0, debt_to_equity * 28.0)
        overdue_score = 30.0 if is_overdue else max(0.0, 15.0 * (1.0 - min(1.0, remaining_ms / 300_000.0)))
        enforcer_score = min(15.0, max(0, int(enforcer_count)) * 5.0)
        pressure_pct = int(round(min(100.0, ratio_score + overdue_score + enforcer_score)))

        if is_overdue and overdue_ms >= 300_000:
            badge = "KRİTİK GECİKME"
        elif is_overdue:
            badge = "VADE AŞIMI"
        elif elapsed_ms >= 3_600_000:
            badge = "EFSANE DAYANIKLI"
        elif elapsed_ms >= 1_200_000:
            badge = "DEMİR SİNİR"
        elif elapsed_ms >= 300_000:
            badge = "TERLEYEN"
        else:
            badge = "YENİ BORÇLU"

    return DebtEnduranceSnapshot(
        owed_usdt=round(owed, 2),
        elapsed_ms=elapsed_ms,
        remaining_ms=remaining_ms,
        overdue_ms=overdue_ms,
        is_overdue=is_overdue,
        burn_rate_per_min=burn_rate_per_min,
        debt_to_equity_ratio=debt_to_equity,
        pressure_pct=pressure_pct,
        badge=badge,
    )


# ---------------------------------------------------------------------------
# Tuncay — Deterministic Live Market Quotes Engine
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class LiveMarketQuote:
    speaker_id: str
    speaker_name: str
    trigger_type: str  # "momentum" | "liquidation" | "debt_pressure"
    text: str
    symbol: Optional[str]
    created_at_ms: int


def evaluate_momentum_quote(
    *,
    symbol: str,
    live_price: float,
    pct_change_15s: float,
    connected: bool,
    last_tick_age_ms: int,
    now_ms: int,
    last_quote_ms: int,
    seq: int = 0,
    cooldown_ms: int = QUOTE_DEFAULT_COOLDOWN_MS,
) -> Optional[LiveMarketQuote]:
    """Emit a deterministic neighborhood quote ONLY on real live momentum moves."""
    if not connected or last_tick_age_ms > STALE_FEED_MS or live_price <= 0:
        return None
    if now_ms - last_quote_ms < cooldown_ms:
        return None
    if abs(pct_change_15s) < QUOTE_MOMENTUM_THRESHOLD_PCT:
        return None

    clean_sym = symbol.replace("USDT", "")
    px_str = f"${live_price:,.3f}" if live_price < 500 else f"${live_price:,.2f}"
    sign = "+" if pct_change_15s >= 0 else ""

    if pct_change_15s > 0:
        templates = [
            (
                "selo",
                "Selo Roket",
                f"{clean_sym} {px_str} oldu ({sign}{pct_change_15s:.2f}%)! Roketi ateşlediler, shortçuların nefesi kesildi!",
            ),
            (
                "kemal",
                "Tahta Kemal",
                f"{clean_sym} tahtasında alıcı duvarı yırttı: {px_str} ({sign}{pct_change_15s:.2f}%). FOMO'ya kapılan yanar.",
            ),
        ]
    else:
        templates = [
            (
                "mehmet",
                "Fitilci Mehmet",
                f"{clean_sym} {px_str} seviyesine sert fitil attı ({pct_change_15s:.2f}%)! Kaldıraçlı longlar terliyor.",
            ),
            (
                "sevil",
                "Madam Sevil",
                f"{clean_sym} {pct_change_15s:.2f}% sarktı ({px_str}). Panik yapan değil, disiplinli kalan kazanır.",
            ),
        ]

    speaker_id, speaker_name, text = templates[abs(int(seq)) % len(templates)]
    return LiveMarketQuote(
        speaker_id=speaker_id,
        speaker_name=speaker_name,
        trigger_type="momentum",
        text=text,
        symbol=symbol,
        created_at_ms=now_ms,
    )


def evaluate_liquidation_quote(
    *,
    symbol: str,
    liquidated_side: str,
    notional_usdt: float,
    price: float,
    now_ms: int,
    last_quote_ms: int,
    seq: int = 0,
    cooldown_ms: int = QUOTE_DEFAULT_COOLDOWN_MS,
) -> Optional[LiveMarketQuote]:
    """Emit a deterministic quote ONLY on real Binance !forceOrder@arr liquidations >= $10K."""
    if notional_usdt < 10_000 or price <= 0:
        return None
    if now_ms - last_quote_ms < cooldown_ms and notional_usdt < 1_000_000:
        return None

    clean_sym = symbol.replace("USDT", "")
    usd_str = (
        f"${notional_usdt / 1_000_000:.2f}M"
        if notional_usdt >= 1_000_000
        else f"${notional_usdt / 1_000:.1f}K"
    )
    side_tr = "LONG" if liquidated_side.upper() == "LONG" else "SHORT"

    if notional_usdt >= 1_000_000:
        return LiveMarketQuote(
            speaker_id="tefeci",
            speaker_name="Tefeci Abi",
            trigger_type="liquidation",
            text=f"BALİNA PATLADI! {clean_sym} {side_tr} tarafında tek kalemde {usd_str} buharlaştı — faiz defterini açın!",
            symbol=symbol,
            created_at_ms=now_ms,
        )

    templates = [
        (
            "mehmet",
            "Fitilci Mehmet",
            f"{clean_sym} {side_tr} likidasyonu: {usd_str} masada kaldı. Fitil yine kurbanını seçti!",
        ),
        (
            "nuri",
            "Fonlama Nuri",
            f"{clean_sym} tahtasında {usd_str} {side_tr} silindi. Yüksek kaldıraçla inatlaşan hep faturayı öder.",
        ),
    ]
    speaker_id, speaker_name, text = templates[abs(int(seq)) % len(templates)]
    return LiveMarketQuote(
        speaker_id=speaker_id,
        speaker_name=speaker_name,
        trigger_type="liquidation",
        text=text,
        symbol=symbol,
        created_at_ms=now_ms,
    )


def evaluate_debt_pressure_quote(
    *,
    nickname: str,
    endurance: DebtEnduranceSnapshot,
    now_ms: int,
    last_quote_ms: int,
    cooldown_ms: int = QUOTE_DEFAULT_COOLDOWN_MS,
) -> Optional[LiveMarketQuote]:
    if endurance.owed_usdt <= 0 or now_ms - last_quote_ms < cooldown_ms:
        return None
    if not endurance.is_overdue and endurance.pressure_pct < 75:
        return None

    if endurance.is_overdue:
        text = (
            f"{nickname} vadesini aştı! Aktif borç ${endurance.owed_usdt:,.2f}, "
            f"dakikalık faiz yükü ${endurance.burn_rate_per_min:,.2f}. Çırağı kapıya gönderelim mi?"
        )
    else:
        text = (
            f"{nickname} borç baskısı %{endurance.pressure_pct} seviyesinde "
            f"(${endurance.owed_usdt:,.2f}). Dayanıklılık rozeti: {endurance.badge}."
        )

    return LiveMarketQuote(
        speaker_id="tefeci",
        speaker_name="Tefeci Abi",
        trigger_type="debt_pressure",
        text=text,
        symbol=None,
        created_at_ms=now_ms,
    )


# ---------------------------------------------------------------------------
# Bülent — Mahalle Kupası (Invite Code, No Auth, Consistency-First Ranking)
# ---------------------------------------------------------------------------
def normalize_invite_code(raw: str) -> Optional[str]:
    stripped = (raw or "").strip().replace("-", "").upper()
    if not INVITE_CODE_RE.match(stripped):
        return None
    return stripped


def can_join_cup(
    *,
    status: str,
    ends_at_ms: int,
    now_ms: int,
    participant_count: int,
    max_participants: int = 32,
) -> tuple[bool, str]:
    if status != "active" or now_ms >= ends_at_ms:
        return False, "Bu Mahalle Kupası sona ermiş."
    if participant_count >= max_participants:
        return False, "Kupa odası dolu."
    return True, "Katılıma açık"


def rank_cup_participants(participants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rank cup participants strictly by Consistency Score (never raw profit/points)."""
    enriched: list[dict[str, Any]] = []
    for row in participants:
        wins = max(0, int(row.get("wins", 0)))
        losses = max(0, int(row.get("losses", 0)))
        rounds = wins + losses
        discipline = float(row.get("discipline_multiplier", 1.0))
        score = calc_consistency_score(wins, losses, discipline)
        accuracy_pct = round((wins / rounds) * 100.0, 1) if rounds > 0 else 0.0
        enriched.append(
            {
                **row,
                "rounds": rounds,
                "accuracy_pct": accuracy_pct,
                "consistency_score": score,
            }
        )

    return sorted(
        enriched,
        key=lambda r: (
            -int(r["consistency_score"]),
            -float(r["accuracy_pct"]),
            -int(r.get("best_streak", 0)),
            -int(r["rounds"]),
            str(r.get("nickname", "")).lower(),
        ),
    )
