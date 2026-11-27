import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Award,
  Clock,
  Flame,
  Radio,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import {
  buildConsistencyLeaderboard,
  calcConsistencyScore,
  calcStreakMultiplier,
  checkRapidCooldown,
  FITIL_ROUND_DURATION_MS,
  FITIL_STAKE_OPTIONS,
  FitilDirection,
  FitilSettlement,
  FitilStats,
  FitilSymbol,
  loadFitilStats,
  saveFitilStats,
  settleFitilRound,
  STALE_FEED_LIMIT_MS,
  TILT_COOLDOWN_MS,
} from "../utils/fitilScoring";
import { hapticMedium, hapticShort } from "../utils/haptics";
import { playCashRegister, playClick, playWarningAlarm } from "../utils/sfx";
import { TraderRow } from "../utils/supabase";
import { PriceTick } from "./TerminalHeader";

interface FitilAviProps {
  ticks: Record<string, PriceTick>;
  binanceConnected: boolean;
  traders: TraderRow[];
  onStatsChange?: (stats: FitilStats) => void;
  onRoundCancelled?: () => void;
}

interface ActiveRound {
  symbol: FitilSymbol;
  direction: FitilDirection;
  entryPrice: number;
  stake: number;
  startedAtMs: number;
  endsAtMs: number;
}

const SYMBOL_LIST: Array<{ key: FitilSymbol; label: string; decimals: number }> = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
];

export const FitilAvi: React.FC<FitilAviProps> = ({
  ticks,
  binanceConnected,
  traders,
  onStatsChange,
  onRoundCancelled,
}) => {
  const [symbol, setSymbol] = useState<FitilSymbol>("BTCUSDT");
  const [stake, setStake] = useState<number>(100);
  const [stats, setStats] = useState<FitilStats>(() => loadFitilStats());
  const [activeRound, setActiveRound] = useState<ActiveRound | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [lastResult, setLastResult] = useState<
    (FitilSettlement & { symbol: FitilSymbol; entryPrice: number; exitPrice: number | null; direction: FitilDirection }) | null
  >(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number>(0);

  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const connectedRef = useRef(binanceConnected);
  connectedRef.current = binanceConnected;
  const statsRef = useRef(stats);
  statsRef.current = stats;

  const onStatsChangeRef = useRef(onStatsChange);
  onStatsChangeRef.current = onStatsChange;
  const onRoundCancelledRef = useRef(onRoundCancelled);
  onRoundCancelledRef.current = onRoundCancelled;

  useEffect(() => {
    saveFitilStats(stats);
    onStatsChangeRef.current?.(stats);
  }, [stats]);

  // 100ms UI timer for countdown & cooldown & freshness checks
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const currentTick = ticks[symbol];
  const currentPrice = currentTick?.price ?? 0;
  const currentTickAgeMs = currentTick?.updatedAtMs
    ? Math.max(0, nowMs - currentTick.updatedAtMs)
    : Number.POSITIVE_INFINITY;
  const isFeedFresh =
    binanceConnected && currentPrice > 0 && currentTickAgeMs <= STALE_FEED_LIMIT_MS;

  // Cancel active round immediately if connection drops or feed goes stale (NEVER settle on old price!)
  useEffect(() => {
    if (!activeRound) return;
    const roundTick = ticks[activeRound.symbol];
    const age = roundTick?.updatedAtMs
      ? Math.max(0, nowMs - roundTick.updatedAtMs)
      : Number.POSITIVE_INFINITY;

    if (!binanceConnected || age > STALE_FEED_LIMIT_MS) {
      const cancelled = settleFitilRound({
        direction: activeRound.direction,
        entryPrice: activeRound.entryPrice,
        exitPrice: null,
        connected: false,
        lastTickAgeMs: age,
        stake: activeRound.stake,
        currentStreak: statsRef.current.streak,
      });
      setLastResult({
        ...cancelled,
        symbol: activeRound.symbol,
        entryPrice: activeRound.entryPrice,
        exitPrice: null,
        direction: activeRound.direction,
      });
      setActiveRound(null);
      onRoundCancelledRef.current?.();
      hapticShort();
      playWarningAlarm();
      return;
    }

    // Settle exactly at the 10-second mark using the real live bookTicker price
    if (nowMs >= activeRound.endsAtMs) {
      const latest = ticksRef.current[activeRound.symbol];
      const latestAge = latest?.updatedAtMs
        ? Math.max(0, Date.now() - latest.updatedAtMs)
        : Number.POSITIVE_INFINITY;
      const settlement = settleFitilRound({
        direction: activeRound.direction,
        entryPrice: activeRound.entryPrice,
        exitPrice: latest?.price ?? null,
        connected: connectedRef.current,
        lastTickAgeMs: latestAge,
        stake: activeRound.stake,
        currentStreak: statsRef.current.streak,
      });

      setLastResult({
        ...settlement,
        symbol: activeRound.symbol,
        entryPrice: activeRound.entryPrice,
        exitPrice: settlement.status === "cancelled" ? null : latest?.price ?? null,
        direction: activeRound.direction,
      });
      setActiveRound(null);

      if (settlement.status === "won" || settlement.status === "lost") {
        const settledNow = Date.now();
        setStats((prev) => {
          const nextTimestamps = [...prev.recentRoundTimestamps, settledNow].slice(-10);
          const rapid = checkRapidCooldown(nextTimestamps, settledNow);
          if (rapid) {
            setCooldownUntilMs(settledNow + TILT_COOLDOWN_MS);
          }
          const disciplineDelta = rapid
            ? -0.1
            : settlement.won
            ? 0.04
            : -0.03;
          const nextDiscipline = Number(
            Math.max(0.5, Math.min(1.4, prev.disciplineMultiplier + disciplineDelta)).toFixed(2)
          );
          return {
            points: Math.max(0, prev.points + settlement.deltaPoints),
            wins: prev.wins + (settlement.won ? 1 : 0),
            losses: prev.losses + (settlement.won ? 0 : 1),
            streak: settlement.nextStreak,
            bestStreak: Math.max(prev.bestStreak, settlement.nextStreak),
            disciplineMultiplier: nextDiscipline,
            recentRoundTimestamps: nextTimestamps,
          };
        });

        if (settlement.won) {
          hapticMedium();
          playCashRegister();
        } else {
          hapticShort();
          playWarningAlarm();
        }
      } else {
        hapticShort();
      }
    }
  }, [activeRound, binanceConnected, nowMs, ticks]);

  const cooldownRemainingSec = Math.max(0, Math.ceil((cooldownUntilMs - nowMs) / 1000));
  const inCooldown = cooldownRemainingSec > 0;

  const startRound = (direction: FitilDirection) => {
    if (activeRound || inCooldown || !isFeedFresh) return;
    const effectiveStake = Math.min(stake, stats.points);
    if (effectiveStake <= 0) return;
    const lockedPrice = currentTick.price;
    const started = Date.now();
    hapticShort();
    playClick();
    setLastResult(null);
    setActiveRound({
      symbol,
      direction,
      entryPrice: lockedPrice,
      stake: effectiveStake,
      startedAtMs: started,
      endsAtMs: started + FITIL_ROUND_DURATION_MS,
    });
  };

  const activeRemainingMs = activeRound ? Math.max(0, activeRound.endsAtMs - nowMs) : 0;
  const activeProgressPct = activeRound
    ? Math.min(100, ((FITIL_ROUND_DURATION_MS - activeRemainingMs) / FITIL_ROUND_DURATION_MS) * 100)
    : 0;
  const activeDecimals = SYMBOL_LIST.find((s) => s.key === (activeRound?.symbol ?? symbol))?.decimals ?? 2;
  const liveDelta = activeRound && currentPrice > 0 ? currentPrice - activeRound.entryPrice : 0;
  const liveDeltaPct =
    activeRound && activeRound.entryPrice > 0 ? (liveDelta / activeRound.entryPrice) * 100 : 0;
  const liveWinning =
    activeRound &&
    ((activeRound.direction === "UP" && liveDelta > 0) ||
      (activeRound.direction === "DOWN" && liveDelta < 0));

  const userTotal = stats.wins + stats.losses;
  const userAccuracyPct = userTotal > 0 ? Math.round((stats.wins / userTotal) * 100) : 0;
  const userConsistency = calcConsistencyScore(
    stats.wins,
    stats.losses,
    stats.disciplineMultiplier
  );
  const nextMultiplier = calcStreakMultiplier(stats.streak + 1);

  const leaderboard = useMemo(
    () => buildConsistencyLeaderboard(stats, traders),
    [stats, traders]
  );

  return (
    <section className="space-y-4">
      {/* Main Fitil Avı 10s Card */}
      <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-950/20 via-zinc-950 to-zinc-950 p-4 shadow-xl">
        {/* Top Row: Title + Balance + Streak */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display flex items-center gap-1.5 text-base font-black tracking-wider text-amber-300 uppercase">
                <Flame className="h-4 w-4 text-amber-400" />
                Fitil Avı · 10 Sn Canlı Tur
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                  isFeedFresh
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-600/25 text-red-300"
                }`}
              >
                {isFeedFresh ? (
                  <>
                    <Radio className="h-3 w-3" /> CANLI bookTicker
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3" /> KOPUK / BAYAT
                  </>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">
              Giriş fiyatı gerçek tahtadan kilitlenir, 10. saniyedeki gerçek fiyat sonucu belirler.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <div className="rounded-xl border border-zinc-800 bg-black/60 px-3 py-1.5 text-right">
              <div className="text-[9px] text-zinc-500 uppercase">Sanal Puan</div>
              <div className="text-base font-black text-white">
                {stats.points.toLocaleString("tr-TR")}
              </div>
            </div>
            <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-1.5 text-right">
              <div className="text-[9px] text-amber-300/80 uppercase">Seri / Çarpan</div>
              <div className="text-base font-black text-amber-300">
                {stats.streak} · {nextMultiplier.toFixed(2)}x
              </div>
            </div>
          </div>
        </div>

        {/* Symbol Selector (>= 44px touch targets) */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {SYMBOL_LIST.map(({ key, label, decimals }) => {
            const tk = ticks[key];
            const selected = (activeRound?.symbol ?? symbol) === key;
            const fresh =
              binanceConnected &&
              tk?.price > 0 &&
              nowMs - (tk.updatedAtMs ?? 0) <= STALE_FEED_LIMIT_MS;

            return (
              <button
                key={key}
                type="button"
                disabled={Boolean(activeRound)}
                onClick={() => {
                  hapticShort();
                  setSymbol(key);
                }}
                className={`flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-2 font-mono transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected
                    ? "border-amber-400 bg-amber-500/15 text-white shadow-[0_0_20px_rgba(245,158,11,0.18)]"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <span className="text-xs font-black">{label}</span>
                <span className={`text-[11px] font-bold ${fresh ? "text-emerald-300" : "text-red-400"}`}>
                  {fresh
                    ? `$${tk.price.toLocaleString("en-US", {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                      })}`
                    : "KOPUK"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Live Price Arena & 10s Progress */}
        <div className="mt-4 rounded-xl border border-zinc-800/90 bg-black/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] text-zinc-500 uppercase">
                {activeRound ? "Kilitli Giriş → Canlı Fiyat" : `${symbol} Canlı Binance Fiyatı`}
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2 font-mono">
                {activeRound && (
                  <span className="text-sm font-bold text-zinc-400">
                    ${activeRound.entryPrice.toFixed(activeDecimals)} →
                  </span>
                )}
                <span
                  className={`text-2xl font-black sm:text-3xl ${
                    !isFeedFresh
                      ? "text-red-400"
                      : activeRound
                      ? liveWinning
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-white"
                  }`}
                >
                  {isFeedFresh ? `$${currentPrice.toFixed(activeDecimals)}` : "BAĞLANTI KOPUK"}
                </span>
              </div>
            </div>

            {activeRound ? (
              <div className="text-right font-mono">
                <div className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-lg font-black text-amber-300">
                  <Clock className="h-4 w-4" />
                  {(activeRemainingMs / 1000).toFixed(1)}s
                </div>
                <div
                  className={`mt-1 text-xs font-bold ${
                    liveDelta >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {liveDelta >= 0 ? "+" : ""}
                  {liveDelta.toFixed(activeDecimals)} ({liveDeltaPct >= 0 ? "+" : ""}
                  {liveDeltaPct.toFixed(3)}%)
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {FITIL_STAKE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      hapticShort();
                      setStake(opt);
                    }}
                    className={`min-h-[44px] min-w-[52px] cursor-pointer rounded-lg border px-2 font-mono text-xs font-black transition active:scale-95 ${
                      stake === opt
                        ? "border-amber-400 bg-amber-500/20 text-amber-200"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    {opt}p
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 10s Progress Bar */}
          {activeRound && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between font-mono text-[10px] text-zinc-400">
                <span>
                  Tahmin:{" "}
                  <strong
                    className={
                      activeRound.direction === "UP" ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {activeRound.direction === "UP" ? "YUKARI ▲" : "AŞAĞI ▼"}
                  </strong>{" "}
                  ({activeRound.stake} puan)
                </span>
                <span>{Math.round(activeProgressPct)}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    liveWinning
                      ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                      : "bg-gradient-to-r from-red-600 to-orange-500"
                  }`}
                  style={{ width: `${activeProgressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Gülay's Rapid-Play Cooling-Off Warning */}
        {inCooldown && (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-amber-500/60 bg-amber-950/45 px-3.5 py-2.5 text-xs text-amber-100">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <div className="font-display font-black uppercase">
                Nefes Al · Disiplin Soğuması ({cooldownRemainingSec} sn)
              </div>
              <p className="text-[11px] text-amber-200/85">
                Üst üste çok hızlı tur açtın. Acele kararlar risk algısını bozar ve tutarlılık
                çarpanını düşürür — kısa mola ver.
              </p>
            </div>
          </div>
        )}

        {/* Disconnect / Stale Guard Notice */}
        {!isFeedFresh && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-950/45 px-3.5 py-2.5 text-xs text-red-200">
            <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
            <span>
              Canlı Binance bağlantısı koptu veya fiyat güncellenmiyor. Eski fiyatla tur başlatılmaz
              ve sonuç üretilmez.
            </span>
          </div>
        )}

        {/* Big Thumb-Friendly UP / DOWN Controls (>= 56px) */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(activeRound) || inCooldown || !isFeedFresh || stats.points <= 0}
            onClick={() => startRound("UP")}
            className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-emerald-500/80 bg-gradient-to-b from-emerald-500/25 to-emerald-700/25 px-4 py-3 font-display text-sm font-black tracking-wider text-emerald-200 uppercase shadow-lg transition hover:bg-emerald-500/35 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            YUKARI ▲
          </button>
          <button
            type="button"
            disabled={Boolean(activeRound) || inCooldown || !isFeedFresh || stats.points <= 0}
            onClick={() => startRound("DOWN")}
            className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-red-500/80 bg-gradient-to-b from-red-500/25 to-red-800/25 px-4 py-3 font-display text-sm font-black tracking-wider text-red-200 uppercase shadow-lg transition hover:bg-red-500/35 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <TrendingDown className="h-5 w-5 text-red-400" />
            AŞAĞI ▼
          </button>
        </div>

        {/* If user ran out of virtual points, offer calm reset back to 1000 */}
        {stats.points <= 0 && !activeRound && (
          <button
            type="button"
            onClick={() => {
              hapticShort();
              setStats((prev) => ({ ...prev, points: 1000, streak: 0 }));
            }}
            className="mt-3 min-h-[44px] w-full cursor-pointer rounded-xl border border-amber-500/50 bg-amber-500/15 text-xs font-black text-amber-200 uppercase"
          >
            Sanal Puanı 1.000 Puanla Yenile
          </button>
        )}

        {/* Last Round Settlement Banner */}
        {lastResult && (
          <div
            className={`mt-3 rounded-xl border p-3 font-mono text-xs ${
              lastResult.status === "won"
                ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-200"
                : lastResult.status === "lost"
                ? "border-red-500/50 bg-red-950/40 text-red-200"
                : "border-amber-500/50 bg-amber-950/35 text-amber-200"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1 font-bold">
              <span>
                {lastResult.symbol} · {lastResult.direction === "UP" ? "YUKARI" : "AŞAĞI"} —{" "}
                {lastResult.reason}
              </span>
              {lastResult.deltaPoints !== 0 && (
                <span className="text-sm font-black">
                  {lastResult.deltaPoints > 0 ? "+" : ""}
                  {lastResult.deltaPoints} puan
                </span>
              )}
            </div>
            {lastResult.exitPrice !== null && (
              <div className="mt-1 text-[11px] opacity-85">
                Giriş: ${lastResult.entryPrice.toFixed(activeDecimals)} → 10. sn Gerçek Fiyat: $
                {lastResult.exitPrice.toFixed(activeDecimals)} (Fark:{" "}
                {lastResult.priceDiff >= 0 ? "+" : ""}
                {lastResult.priceDiff.toFixed(activeDecimals)} /{" "}
                {lastResult.priceDiffPct >= 0 ? "+" : ""}
                {lastResult.priceDiffPct.toFixed(3)}%)
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gülay: Consistency Score Breakdown & Consistency Leaderboard (NOT Raw Profit) */}
      <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/90 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-cyan-300 uppercase">
              <Award className="h-4 w-4 text-cyan-400" />
              Tutarlılık Skor Panosu
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Sıralama ham kâra göre değil, <strong>İsabet Oranı × Disiplin Çarpanı</strong> ile
              belirlenir.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-1.5 font-mono text-xs">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <span className="text-zinc-300">
              Senin Puanın: <strong className="text-cyan-300">{userConsistency}</strong>
            </span>
            <span className="text-[10px] text-zinc-500">
              (%{userAccuracyPct} × {stats.disciplineMultiplier.toFixed(2)}x)
            </span>
          </div>
        </div>

        <div className="mt-3 divide-y divide-zinc-900">
          {leaderboard.map((row, idx) => (
            <div
              key={row.id}
              className={`flex items-center justify-between gap-3 py-2.5 ${
                row.isUser ? "rounded-lg bg-cyan-950/25 px-2.5" : "px-1"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-black ${
                    idx === 0
                      ? "bg-amber-500/25 text-amber-300"
                      : idx === 1
                      ? "bg-zinc-700/60 text-zinc-200"
                      : "bg-zinc-900 text-zinc-500"
                  }`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-bold text-white">
                    {row.name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-zinc-400">
                    İsabet %{row.accuracyPct} · Disiplin {row.disciplineMultiplier.toFixed(2)}x ·{" "}
                    {row.note}
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right font-mono">
                <div className="text-sm font-black text-cyan-300">{row.consistencyScore}</div>
                <div className="text-[9px] text-zinc-500 uppercase">{row.rounds} tur</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
