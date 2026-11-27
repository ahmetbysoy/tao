// Kemal & Gülay: Fitil Avı 10-second live bookTicker mini-game & Consistency Score engine.
// Mirrors src/backend/scoring.py with zero randomness and strict live-feed integrity.

import { TraderRow } from "./supabase";

export const FITIL_START_POINTS = 1000;
export const FITIL_ROUND_DURATION_MS = 10_000;
export const FITIL_STAKE_OPTIONS = [50, 100, 200] as const;
export const STALE_FEED_LIMIT_MS = 4_000;
export const TILT_WINDOW_MS = 45_000;
export const TILT_ROUND_LIMIT = 3;
export const TILT_COOLDOWN_MS = 8_000;

export type FitilSymbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
export type FitilDirection = "UP" | "DOWN";

export interface FitilSettlement {
  status: "won" | "lost" | "draw" | "cancelled";
  won: boolean | null;
  deltaPoints: number;
  nextStreak: number;
  multiplier: number;
  priceDiff: number;
  priceDiffPct: number;
  reason: string;
}

export interface FitilStats {
  points: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  disciplineMultiplier: number;
  recentRoundTimestamps: number[];
}

export interface ConsistencyRankRow {
  id: string;
  name: string;
  isUser: boolean;
  accuracyPct: number;
  disciplineMultiplier: number;
  consistencyScore: number;
  rounds: number;
  note: string;
}

export function calcStreakMultiplier(streak: number): number {
  if (streak <= 1) return 1.0;
  if (streak === 2) return 1.25;
  if (streak === 3) return 1.5;
  if (streak === 4) return 1.75;
  return 2.0;
}

export function calcConsistencyScore(
  wins: number,
  losses: number,
  disciplineMultiplier = 1.0
): number {
  const total = Math.max(0, wins) + Math.max(0, losses);
  if (total === 0) return 0;
  const accuracy = Math.max(0, Math.min(1, wins / total));
  const clampedDiscipline = Math.max(0.5, Math.min(1.4, disciplineMultiplier));
  const volumeFactor = 1.0 + Math.min(total, 20) * 0.02;
  return Math.round(accuracy * 1000 * clampedDiscipline * volumeFactor);
}

export function checkRapidCooldown(recentTimestampsMs: number[], nowMs: number): boolean {
  const recent = recentTimestampsMs.filter((ts) => nowMs - ts >= 0 && nowMs - ts <= TILT_WINDOW_MS);
  return recent.length >= TILT_ROUND_LIMIT;
}

export function settleFitilRound(params: {
  direction: FitilDirection;
  entryPrice: number;
  exitPrice: number | null;
  connected: boolean;
  lastTickAgeMs: number;
  stake: number;
  currentStreak: number;
}): FitilSettlement {
  const { direction, entryPrice, exitPrice, connected, lastTickAgeMs, stake, currentStreak } =
    params;

  if (
    !connected ||
    lastTickAgeMs > STALE_FEED_LIMIT_MS ||
    entryPrice <= 0 ||
    exitPrice === null ||
    exitPrice <= 0
  ) {
    return {
      status: "cancelled",
      won: null,
      deltaPoints: 0,
      nextStreak: currentStreak,
      multiplier: calcStreakMultiplier(currentStreak),
      priceDiff: 0,
      priceDiffPct: 0,
      reason: "Bağlantı koptu veya fiyat bayatladı — eski fiyatla sonuç üretilmedi, tur iptal.",
    };
  }

  const diff = exitPrice - entryPrice;
  const diffPct = (diff / entryPrice) * 100;

  if (diff === 0) {
    return {
      status: "draw",
      won: null,
      deltaPoints: 0,
      nextStreak: currentStreak,
      multiplier: calcStreakMultiplier(currentStreak),
      priceDiff: 0,
      priceDiffPct: 0,
      reason: "10 saniyede fiyat aynı kaldı — puan iade edildi.",
    };
  }

  const won = (direction === "UP" && diff > 0) || (direction === "DOWN" && diff < 0);
  if (won) {
    const nextStreak = currentStreak + 1;
    const multiplier = calcStreakMultiplier(nextStreak);
    const deltaPoints = Math.round(stake * multiplier);
    return {
      status: "won",
      won: true,
      deltaPoints,
      nextStreak,
      multiplier,
      priceDiff: diff,
      priceDiffPct: diffPct,
      reason: `İsabet! ${nextStreak} seri (${multiplier.toFixed(2)}x çarpan)`,
    };
  }

  // First wrong prediction resets streak immediately
  return {
    status: "lost",
    won: false,
    deltaPoints: -stake,
    nextStreak: 0,
    multiplier: 1.0,
    priceDiff: diff,
    priceDiffPct: diffPct,
    reason: "Ters yöne fitil attı — seri sıfırlandı.",
  };
}

export function buildConsistencyLeaderboard(
  userStats: FitilStats,
  traders: TraderRow[]
): ConsistencyRankRow[] {
  const userTotal = userStats.wins + userStats.losses;
  const userAcc = userTotal > 0 ? Math.round((userStats.wins / userTotal) * 100) : 0;
  const rows: ConsistencyRankRow[] = [
    {
      id: "user_tefeci",
      name: "Sen (Tefeci)",
      isUser: true,
      accuracyPct: userAcc,
      disciplineMultiplier: Number(userStats.disciplineMultiplier.toFixed(2)),
      consistencyScore: calcConsistencyScore(
        userStats.wins,
        userStats.losses,
        userStats.disciplineMultiplier
      ),
      rounds: userTotal,
      note:
        userTotal === 0
          ? "İlk 10 sn turunu oyna"
          : `${userStats.points.toLocaleString("tr-TR")} puan · ${userStats.streak}x seri`,
    },
  ];

  for (const t of traders) {
    const total = t.win_count + t.loss_count;
    const acc = total > 0 ? Math.round((t.win_count / total) * 100) : 0;
    // Bots with lower leverage & zero liquidations earn higher discipline multiplier
    const leveragePenalty = Math.max(0, (t.max_leverage - 15) * 0.008);
    const liqPenalty = t.liquidation_count * 0.14;
    const fearPenalty = t.fear_trades_remaining > 0 ? 0.06 : 0;
    const discipline = Number(
      Math.max(0.55, Math.min(1.3, 1.15 - leveragePenalty - liqPenalty - fearPenalty)).toFixed(2)
    );
    rows.push({
      id: t.id,
      name: t.nickname,
      isUser: false,
      accuracyPct: acc,
      disciplineMultiplier: discipline,
      consistencyScore: calcConsistencyScore(t.win_count, t.loss_count, discipline),
      rounds: total,
      note: `${t.max_leverage}x kaldıraç · ${t.liquidation_count} lik`,
    });
  }

  // Strictly ranked by consistencyScore (NOT raw profit)
  return rows.sort((a, b) => {
    if (b.consistencyScore !== a.consistencyScore) {
      return b.consistencyScore - a.consistencyScore;
    }
    if (a.isUser !== b.isUser) return a.isUser ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

const STATS_STORAGE_KEY = "tefeci_fitil_stats_v1";

export function loadFitilStats(): FitilStats {
  const fallback: FitilStats = {
    points: FITIL_START_POINTS,
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
    disciplineMultiplier: 1.0,
    recentRoundTimestamps: [],
  };
  try {
    const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FitilStats>;
    return {
      points:
        typeof parsed.points === "number" && Number.isFinite(parsed.points)
          ? Math.max(0, Math.round(parsed.points))
          : FITIL_START_POINTS,
      wins: typeof parsed.wins === "number" ? Math.max(0, Math.floor(parsed.wins)) : 0,
      losses: typeof parsed.losses === "number" ? Math.max(0, Math.floor(parsed.losses)) : 0,
      streak: typeof parsed.streak === "number" ? Math.max(0, Math.floor(parsed.streak)) : 0,
      bestStreak:
        typeof parsed.bestStreak === "number" ? Math.max(0, Math.floor(parsed.bestStreak)) : 0,
      disciplineMultiplier:
        typeof parsed.disciplineMultiplier === "number"
          ? Math.max(0.5, Math.min(1.4, parsed.disciplineMultiplier))
          : 1.0,
      recentRoundTimestamps: Array.isArray(parsed.recentRoundTimestamps)
        ? parsed.recentRoundTimestamps.filter((x): x is number => typeof x === "number").slice(-10)
        : [],
    };
  } catch {
    return fallback;
  }
}

export function saveFitilStats(stats: FitilStats): void {
  try {
    window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore storage error
  }
}
