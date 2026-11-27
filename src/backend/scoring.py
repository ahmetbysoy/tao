"""Deterministic scoring & discipline rules for Fitil Avı (Tur 1 — Kemal & Gülay).

Mirrors src/frontend/utils/fitilScoring.ts so both backend tests and frontend UI
share the exact consistency-first ranking rules:
  - Starting virtual balance: 1000 points
  - Streak multiplier resets immediately to 0 on first wrong prediction
  - Consistency score = round(accuracy * 1000 * discipline_multiplier * volume_factor)
  - Leaderboard sorts by consistency_score, NOT raw profit
  - Rapid-fire play triggers a short cooling-off guard & risk warning
  - Stale / disconnected feed cancels the round cleanly with no artificial settlement
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Literal, Optional, Sequence

FITIL_START_POINTS = 1000
FITIL_ROUND_DURATION_MS = 10_000
STALE_FEED_LIMIT_MS = 4_000
TILT_WINDOW_MS = 45_000
TILT_ROUND_LIMIT = 3
TILT_COOLDOWN_MS = 8_000


def calc_streak_multiplier(streak: int) -> float:
    """Return streak reward multiplier (1.0x up to 2.0x); 0 streak -> 1.0x base."""
    if streak <= 1:
        return 1.0
    if streak == 2:
        return 1.25
    if streak == 3:
        return 1.5
    if streak == 4:
        return 1.75
    return 2.0


def calc_consistency_score(
    wins: int,
    losses: int,
    discipline_multiplier: float = 1.0,
) -> int:
    """Compute consistency score: accuracy * 1000 * discipline_multiplier * volume_factor.

    Rewards steady accuracy and disciplined pacing rather than reckless high-variance profit.
    """
    total = max(0, wins) + max(0, losses)
    if total == 0:
        return 0
    accuracy = max(0.0, min(1.0, wins / total))
    clamped_discipline = max(0.5, min(1.4, discipline_multiplier))
    volume_factor = 1.0 + min(total, 20) * 0.02
    return round(accuracy * 1000.0 * clamped_discipline * volume_factor)


def settle_fitil_round(
    direction: Literal["UP", "DOWN"],
    entry_price: float,
    exit_price: Optional[float],
    connected: bool,
    last_tick_age_ms: int,
    stake: int,
    current_streak: int,
) -> dict:
    """Settle a 10-second live Fitil Avı round strictly on fresh real prices.

    If disconnected or stale (> STALE_FEED_LIMIT_MS) or prices are invalid,
    the round is cancelled cleanly without changing points or streak.
    """
    if (
        not connected
        or last_tick_age_ms > STALE_FEED_LIMIT_MS
        or entry_price <= 0
        or exit_price is None
        or exit_price <= 0
    ):
        return {
            "status": "cancelled",
            "won": None,
            "delta_points": 0,
            "next_streak": current_streak,
            "multiplier": calc_streak_multiplier(current_streak),
            "price_diff": 0.0,
            "reason": "Bağlantı koptu veya fiyat bayatladı; eski fiyatla sonuç üretilmedi.",
        }

    diff = exit_price - entry_price
    if diff == 0.0:
        return {
            "status": "draw",
            "won": None,
            "delta_points": 0,
            "next_streak": current_streak,
            "multiplier": calc_streak_multiplier(current_streak),
            "price_diff": 0.0,
            "reason": "Fiyat 10 saniyede sabit kaldı — puan iade.",
        }

    won = (direction == "UP" and diff > 0) or (direction == "DOWN" and diff < 0)
    if won:
        next_streak = current_streak + 1
        mult = calc_streak_multiplier(next_streak)
        delta_points = round(stake * mult)
        return {
            "status": "won",
            "won": True,
            "delta_points": delta_points,
            "next_streak": next_streak,
            "multiplier": mult,
            "price_diff": round(diff, 6),
            "reason": f"İsabet! ({next_streak}x seri · {mult:.2f}x çarpan)",
        }

    # First miss resets streak to 0 immediately
    return {
        "status": "lost",
        "won": False,
        "delta_points": -stake,
        "next_streak": 0,
        "multiplier": 1.0,
        "price_diff": round(diff, 6),
        "reason": "Ters yöne fitil attı — seri sıfırlandı.",
    }


def check_rapid_cooldown(recent_timestamps_ms: Sequence[int], now_ms: int) -> bool:
    """Return True if user played >= TILT_ROUND_LIMIT rounds inside TILT_WINDOW_MS."""
    recent = [ts for ts in recent_timestamps_ms if 0 <= (now_ms - ts) <= TILT_WINDOW_MS]
    return len(recent) >= TILT_ROUND_LIMIT


@dataclass(frozen=True)
class LeaderboardRow:
    id: str
    name: str
    raw_profit: float
    consistency_score: int


def rank_by_consistency(rows: Iterable[LeaderboardRow]) -> List[LeaderboardRow]:
    """Sort leaderboard strictly by consistency_score descending (NOT raw_profit)."""
    return sorted(rows, key=lambda r: (-r.consistency_score, r.name))
