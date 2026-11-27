// Rıza: Debt Endurance Timer, interest burn rate, pressure index & survival tier badges.
// Exact TypeScript mirror of src/backend/tur2_engine.py (zero randomness, real Supabase debt math).

export type EnduranceBadge =
  | "BORÇSUZ"
  | "YENİ BORÇLU"
  | "TERLEYEN"
  | "DEMİR SİNİR"
  | "EFSANE DAYANIKLI"
  | "VADE AŞIMI"
  | "KRİTİK GECİKME";

export interface DebtEnduranceSnapshot {
  owedUsdt: number;
  elapsedMs: number;
  remainingMs: number;
  overdueMs: number;
  isOverdue: boolean;
  burnRatePerMin: number;
  debtToEquityRatio: number;
  pressurePct: number;
  badge: EnduranceBadge;
}

export function computeDebtEndurance(params: {
  principal: number;
  totalRepaid: number;
  interestRate: number;
  compoundingPeriodS: number;
  createdAtMs: number;
  dueDateMs: number;
  nowMs: number;
  traderEquity: number;
  enforcerCount?: number;
  status?: string;
}): DebtEnduranceSnapshot {
  const owed = Math.max(0, Number(params.principal) - Number(params.totalRepaid ?? 0));
  const elapsedMs = Math.max(0, Math.floor(params.nowMs - params.createdAtMs));
  const remainingMs = Math.floor(params.dueDateMs - params.nowMs);
  const isOverdue = owed > 0 && (params.status === "gecikti" || remainingMs <= 0);
  const overdueMs = isOverdue ? Math.max(0, -remainingMs) : 0;

  const periodMinutes = Math.max(1 / 60, Math.max(1, params.compoundingPeriodS || 300) / 60);
  const burnRatePerMin = Number(
    (owed * (Math.max(0, Number(params.interestRate || 0)) / periodMinutes)).toFixed(4)
  );

  const safeEquity = Math.max(1, Number(params.traderEquity || 0));
  const debtToEquityRatio = Number((owed / safeEquity).toFixed(3));

  let pressurePct = 0;
  let badge: EnduranceBadge = "BORÇSUZ";

  if (owed > 0) {
    const ratioScore = Math.min(55, debtToEquityRatio * 28);
    const overdueScore = isOverdue
      ? 30
      : Math.max(0, 15 * (1 - Math.min(1, remainingMs / 300_000)));
    const enforcerScore = Math.min(15, Math.max(0, params.enforcerCount ?? 0) * 5);
    pressurePct = Math.round(Math.min(100, ratioScore + overdueScore + enforcerScore));

    if (isOverdue && overdueMs >= 300_000) {
      badge = "KRİTİK GECİKME";
    } else if (isOverdue) {
      badge = "VADE AŞIMI";
    } else if (elapsedMs >= 3_600_000) {
      badge = "EFSANE DAYANIKLI";
    } else if (elapsedMs >= 1_200_000) {
      badge = "DEMİR SİNİR";
    } else if (elapsedMs >= 300_000) {
      badge = "TERLEYEN";
    } else {
      badge = "YENİ BORÇLU";
    }
  }

  return {
    owedUsdt: Number(owed.toFixed(2)),
    elapsedMs,
    remainingMs,
    overdueMs,
    isOverdue,
    burnRatePerMin,
    debtToEquityRatio,
    pressurePct,
    badge,
  };
}

export function formatDurationCompact(ms: number): string {
  const totalSec = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}sa ${String(minutes).padStart(2, "0")}dk`;
  }
  if (minutes > 0) {
    return `${minutes}dk ${String(seconds).padStart(2, "0")}sn`;
  }
  return `${seconds}sn`;
}

export function getEnduranceBadgeStyle(badge: EnduranceBadge): string {
  switch (badge) {
    case "KRİTİK GECİKME":
      return "border-red-500/80 bg-red-600/25 text-red-200 animate-pulse";
    case "VADE AŞIMI":
      return "border-rose-500/70 bg-rose-600/20 text-rose-200";
    case "EFSANE DAYANIKLI":
      return "border-amber-400/70 bg-amber-500/20 text-amber-200";
    case "DEMİR SİNİR":
      return "border-cyan-500/60 bg-cyan-500/15 text-cyan-200";
    case "TERLEYEN":
      return "border-orange-500/60 bg-orange-500/15 text-orange-200";
    case "YENİ BORÇLU":
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
    default:
      return "border-emerald-500/50 bg-emerald-500/15 text-emerald-300";
  }
}
