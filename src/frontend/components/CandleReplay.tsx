import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Award,
  FastForward,
  History,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Skull,
  StepForward,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  calcReplayConsistency,
  CandleSource,
  closeReplayPosition,
  evaluateReplayCandle,
  fetchHistoricalCandles,
  HistoricalCandle,
  openReplayPosition,
  REPLAY_INTERVALS,
  REPLAY_LEVERAGES,
  REPLAY_START_BALANCE,
  REPLAY_SYMBOLS,
  ReplayInterval,
  ReplayPosition,
  ReplaySymbol,
  ReplayTradeRecord,
} from "../utils/candleReplay";
import { hapticLong, hapticMedium, hapticShort } from "../utils/haptics";
import {
  playCashRegister,
  playClick,
  playLiquidationSiren,
  playTradeOpen,
  playWarningAlarm,
} from "../utils/sfx";

const INITIAL_VISIBLE_BARS = 32;
const VIEWPORT_WINDOW = 48;
const SPEED_MS: Record<number, number> = {
  1: 900,
  2: 450,
  4: 200,
};

export const CandleReplay: React.FC = () => {
  const [symbol, setSymbol] = useState<ReplaySymbol>("BTCUSDT");
  const [interval, setIntervalKey] = useState<ReplayInterval>("1m");
  const [candles, setCandles] = useState<HistoricalCandle[]>([]);
  const [source, setSource] = useState<CandleSource | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [cursor, setCursor] = useState<number>(INITIAL_VISIBLE_BARS - 1);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(2);

  // Isolated replay practice state (100% real historical candles, virtual practice balance)
  const [balance, setBalance] = useState<number>(REPLAY_START_BALANCE);
  const [leverage, setLeverage] = useState<number>(10);
  const [position, setPosition] = useState<ReplayPosition | null>(null);
  const [trades, setTrades] = useState<ReplayTradeRecord[]>([]);
  const [highLevTrades, setHighLevTrades] = useState<number>(0);
  const [lastBanner, setLastBanner] = useState<{ text: string; tone: "win" | "loss" | "liq" } | null>(
    null
  );

  const tradeIdRef = useRef<number>(0);

  const decimals = REPLAY_SYMBOLS.find((s) => s.key === symbol)?.decimals ?? 2;

  const loadCandles = useCallback(async (sym: ReplaySymbol, iv: ReplayInterval) => {
    setPlaying(false);
    setPosition(null);
    setLastBanner(null);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchHistoricalCandles(sym, iv, 120);
      setCandles(res.candles);
      setSource(res.source);
      setCursor(Math.min(INITIAL_VISIBLE_BARS - 1, Math.max(0, res.candles.length - 1)));
    } catch (err) {
      setCandles([]);
      setSource(null);
      setErrorMsg(
        err instanceof Error
          ? `${err.message} — Sahte/sentetik mum üretilmedi.`
          : "Gerçek mum verisi alınamadı — Sahte veri üretilmedi."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCandles(symbol, interval);
  }, [symbol, interval, loadCandles]);

  const currentCandle = candles[cursor] ?? null;
  const atEnd = candles.length > 0 && cursor >= candles.length - 1;

  // Evaluate active position whenever cursor advances onto a new real historical candle
  const stepForward = useCallback(() => {
    setCursor((prev) => {
      if (candles.length === 0 || prev >= candles.length - 1) {
        setPlaying(false);
        return prev;
      }
      return prev + 1;
    });
  }, [candles.length]);

  useEffect(() => {
    if (!playing || atEnd || candles.length === 0) return;
    const id = window.setInterval(() => {
      stepForward();
    }, SPEED_MS[speed]);
    return () => window.clearInterval(id);
  }, [playing, atEnd, speed, candles.length, stepForward]);

  // Intrabar wick liquidation & end-of-series check
  useEffect(() => {
    if (!position || !currentCandle) return;
    if (cursor <= position.openedIndex) return;

    const outcome = evaluateReplayCandle(position, currentCandle);
    if (outcome.status === "liquidated") {
      setPlaying(false);
      tradeIdRef.current += 1;
      const lossAmt = Math.abs(outcome.realizedPnl ?? position.isolatedMargin);
      setTrades((prev) => [
        {
          id: tradeIdRef.current,
          symbol: position.symbol,
          side: position.side,
          leverage: position.leverage,
          entryPrice: position.entryPrice,
          exitPrice: outcome.exitPrice ?? position.liquidationPrice,
          netPnl: -lossAmt,
          liquidated: true,
        },
        ...prev.slice(0, 19),
      ]);
      setPosition(null);
      hapticLong();
      playLiquidationSiren();
      setLastBanner({
        text: `FİTİL LİKİDE ETTİ! ${position.symbol} ${position.side} ${position.leverage}x · -$${lossAmt.toFixed(
          2
        )} (Liq $${position.liquidationPrice.toFixed(decimals)})`,
        tone: "liq",
      });
    }
  }, [cursor, currentCandle, position, decimals]);

  const liveEval = useMemo(() => {
    if (!position || !currentCandle) return null;
    return evaluateReplayCandle(position, currentCandle);
  }, [position, currentCandle]);

  const handleOpen = (side: "LONG" | "SHORT") => {
    if (!currentCandle || position || atEnd) return;
    const margin = Math.min(200, Math.floor(balance * 0.25));
    if (margin < 25) {
      setLastBanner({
        text: "Bakiye yetersiz — Yeni pratik için 'Başa Sar' ile sanal $1.000 bakiyeyi yenileyebilirsin.",
        tone: "loss",
      });
      return;
    }
    hapticMedium();
    playTradeOpen();
    setLastBanner(null);
    const nextPos = openReplayPosition({
      symbol,
      side,
      entryPrice: currentCandle.close,
      leverage,
      isolatedMargin: margin,
      openedIndex: cursor,
    });
    setBalance((b) => Number((b - margin).toFixed(2)));
    if (leverage >= 50) {
      setHighLevTrades((n) => n + 1);
    }
    setPosition(nextPos);
  };

  const handleClose = () => {
    if (!position || !currentCandle) return;
    const netPnl = closeReplayPosition(position, currentCandle.close);
    const returned = Math.max(0, position.isolatedMargin + netPnl);
    setBalance((b) => Number((b + returned).toFixed(2)));
    tradeIdRef.current += 1;
    setTrades((prev) => [
      {
        id: tradeIdRef.current,
        symbol: position.symbol,
        side: position.side,
        leverage: position.leverage,
        entryPrice: position.entryPrice,
        exitPrice: currentCandle.close,
        netPnl,
        liquidated: false,
      },
      ...prev.slice(0, 19),
    ]);
    setPosition(null);

    if (netPnl >= 0) {
      hapticMedium();
      playCashRegister();
      setLastBanner({
        text: `Kârla Kapandı: +$${netPnl.toFixed(2)} (${position.symbol} ${position.side} ${position.leverage}x)`,
        tone: "win",
      });
    } else {
      hapticShort();
      playWarningAlarm();
      setLastBanner({
        text: `Zararla Kapandı: -$${Math.abs(netPnl).toFixed(2)} (${position.symbol} ${position.side} ${position.leverage}x)`,
        tone: "loss",
      });
    }
  };

  const handleRestart = () => {
    hapticShort();
    playClick();
    setPlaying(false);
    setPosition(null);
    setLastBanner(null);
    setBalance(REPLAY_START_BALANCE);
    setTrades([]);
    setHighLevTrades(0);
    setCursor(Math.min(INITIAL_VISIBLE_BARS - 1, Math.max(0, candles.length - 1)));
  };

  // Consistency score (never raw profit!)
  const stats = useMemo(() => {
    const wins = trades.filter((t) => !t.liquidated && t.netPnl > 0).length;
    const losses = trades.filter((t) => t.liquidated || t.netPnl <= 0).length;
    const liquidations = trades.filter((t) => t.liquidated).length;
    const total = wins + losses;
    const accuracyPct = total > 0 ? Math.round((wins / total) * 100) : 0;
    const { disciplineMultiplier, consistencyScore } = calcReplayConsistency({
      wins,
      losses,
      liquidations,
      highLeverageTrades: highLevTrades,
    });
    return { wins, losses, liquidations, total, accuracyPct, disciplineMultiplier, consistencyScore };
  }, [trades, highLevTrades]);

  // Visible slice strictly up to cursor (future candles NEVER rendered)
  const visibleSlice = useMemo(() => {
    if (candles.length === 0) return [];
    const end = Math.min(candles.length, cursor + 1);
    const start = Math.max(0, end - VIEWPORT_WINDOW);
    return candles.slice(start, end);
  }, [candles, cursor]);

  const svgWidth = 720;
  const svgHeight = 220;
  const padX = 14;
  const padY = 18;

  const { minPx, maxPx } = useMemo(() => {
    if (visibleSlice.length === 0) return { minPx: 0, maxPx: 1 };
    let lo = Math.min(...visibleSlice.map((c) => c.low));
    let hi = Math.max(...visibleSlice.map((c) => c.high));
    if (position) {
      lo = Math.min(lo, position.entryPrice, position.liquidationPrice);
      hi = Math.max(hi, position.entryPrice, position.liquidationPrice);
    }
    const pad = Math.max((hi - lo) * 0.1, hi * 0.0005);
    return { minPx: lo - pad, maxPx: hi + pad };
  }, [visibleSlice, position]);

  const priceToY = (p: number) => {
    const span = Math.max(0.000001, maxPx - minPx);
    return svgHeight - padY - ((p - minPx) / span) * (svgHeight - padY * 2);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-[#071018] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
        {/* Header Row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-cyan-300 uppercase sm:text-base">
                <History className="h-4 w-4 text-cyan-400" />
                Geçmiş Mum Tekrarı (Candle Replay)
              </h2>
              {source && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                  {source === "binance_fapi" ? "BINANCE FUTURES REST" : "OKX SWAP FALLBACK"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Gelecek mumlar gizli — gerçek borsa OHLCV mumlarında fitil likidasyonu ve disiplin pratiği yap.
            </p>
          </div>

          {/* Consistency Score & Virtual Practice Balance */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-1.5">
              <div className="text-[9px] text-amber-300/80 uppercase">İstikrar Skoru</div>
              <div className="flex items-center gap-1 text-sm font-black text-amber-300">
                <Award className="h-3.5 w-3.5" />
                {stats.consistencyScore}
                <span className="text-[10px] font-normal text-zinc-400">
                  (%{stats.accuracyPct} · {stats.disciplineMultiplier.toFixed(2)}x)
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-black/50 px-3 py-1.5">
              <div className="text-[9px] text-zinc-500 uppercase">Sanal Kasa</div>
              <div className="text-sm font-black text-white">${balance.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Symbol & Interval Selector */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {REPLAY_SYMBOLS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  hapticShort();
                  playClick();
                  setSymbol(s.key);
                }}
                className={`min-h-[44px] cursor-pointer rounded-xl border px-3 font-mono text-xs font-black transition active:scale-95 ${
                  symbol === s.key
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {s.label}
              </button>
            ))}

            <span className="mx-0.5 text-zinc-700">|</span>

            {REPLAY_INTERVALS.map((iv) => (
              <button
                key={iv.key}
                type="button"
                onClick={() => {
                  hapticShort();
                  playClick();
                  setIntervalKey(iv.key);
                }}
                className={`min-h-[44px] cursor-pointer rounded-xl border px-2.5 font-mono text-xs font-bold transition active:scale-95 ${
                  interval === iv.key
                    ? "border-amber-400 bg-amber-500/20 text-amber-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              hapticShort();
              playClick();
              loadCandles(symbol, interval);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>

        {/* Error / Loading / Candlestick Chart */}
        {errorMsg ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-950/35 p-4 text-xs text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        ) : loading || visibleSlice.length === 0 ? (
          <div className="mt-3 flex h-[220px] items-center justify-center rounded-xl border border-zinc-800 bg-black/50 font-mono text-xs text-zinc-400">
            Gerçek borsa geçmiş mumları indiriliyor...
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-zinc-800/90 bg-black/65 p-2.5">
            {/* Current Candle OHLC Readout */}
            {currentCandle && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-bold text-zinc-400">
                    {new Date(currentCandle.ts).toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>
                    A: <strong className="text-zinc-200">${currentCandle.open.toFixed(decimals)}</strong>
                  </span>
                  <span>
                    Y: <strong className="text-emerald-400">${currentCandle.high.toFixed(decimals)}</strong>
                  </span>
                  <span>
                    D: <strong className="text-red-400">${currentCandle.low.toFixed(decimals)}</strong>
                  </span>
                  <span>
                    K:{" "}
                    <strong
                      className={
                        currentCandle.close >= currentCandle.open
                          ? "text-emerald-300"
                          : "text-red-300"
                      }
                    >
                      ${currentCandle.close.toFixed(decimals)}
                    </strong>
                  </span>
                </div>
                <span className="text-zinc-500">
                  Mum {cursor + 1} / {candles.length}
                </span>
              </div>
            )}

            {/* Real SVG OHLC Candlestick Chart */}
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="h-[200px] w-full select-none sm:h-[230px]"
              role="img"
              aria-label={`${symbol} geçmiş mum grafiği`}
            >
              {/* Horizontal grid lines */}
              {[0.2, 0.5, 0.8].map((frac) => {
                const y = padY + frac * (svgHeight - padY * 2);
                const px = maxPx - frac * (maxPx - minPx);
                return (
                  <g key={frac}>
                    <line
                      x1={padX}
                      x2={svgWidth - padX}
                      y1={y}
                      y2={y}
                      stroke="#27272a"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={svgWidth - padX - 2}
                      y={y - 3}
                      textAnchor="end"
                      fill="#71717a"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      ${px.toFixed(decimals)}
                    </text>
                  </g>
                );
              })}

              {/* Candles */}
              {visibleSlice.map((c, idx) => {
                const slotW = (svgWidth - padX * 2) / Math.max(VIEWPORT_WINDOW, visibleSlice.length);
                const cx = padX + idx * slotW + slotW / 2;
                const bodyW = Math.max(3, Math.min(11, slotW * 0.68));
                const up = c.close >= c.open;
                const color = up ? "#10b981" : "#ef4444";
                const yHigh = priceToY(c.high);
                const yLow = priceToY(c.low);
                const yTop = priceToY(Math.max(c.open, c.close));
                const yBot = priceToY(Math.min(c.open, c.close));
                const bodyH = Math.max(1.5, yBot - yTop);
                const isLatest = idx === visibleSlice.length - 1;

                return (
                  <g key={c.ts}>
                    <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1.3} />
                    <rect
                      x={cx - bodyW / 2}
                      y={yTop}
                      width={bodyW}
                      height={bodyH}
                      rx={1}
                      fill={color}
                      opacity={isLatest ? 1 : 0.88}
                    />
                  </g>
                );
              })}

              {/* Entry & Liquidation lines when a practice position is open */}
              {position && (
                <>
                  <line
                    x1={padX}
                    x2={svgWidth - padX}
                    y1={priceToY(position.entryPrice)}
                    y2={priceToY(position.entryPrice)}
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                  />
                  <line
                    x1={padX}
                    x2={svgWidth - padX}
                    y1={priceToY(position.liquidationPrice)}
                    y2={priceToY(position.liquidationPrice)}
                    stroke="#f43f5e"
                    strokeWidth={1.8}
                    strokeDasharray="3 3"
                  />
                </>
              )}
            </svg>

            {/* Timeline Progress Bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-amber-400 transition-all duration-200"
                style={{
                  width: `${candles.length > 0 ? ((cursor + 1) / candles.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Playback Controls (>= 44px touch targets) */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={loading || candles.length === 0 || atEnd}
              onClick={() => {
                hapticShort();
                playClick();
                setPlaying((p) => !p);
              }}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-cyan-500/60 bg-cyan-500/20 px-4 text-xs font-black text-cyan-100 uppercase transition hover:bg-cyan-500/30 active:scale-95 disabled:opacity-40"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? "Duraklat" : atEnd ? "Bitti" : "Oynat"}
            </button>

            <button
              type="button"
              disabled={loading || candles.length === 0 || atEnd}
              onClick={() => {
                hapticShort();
                setPlaying(false);
                stepForward();
              }}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800 active:scale-95 disabled:opacity-40"
            >
              <StepForward className="h-4 w-4" />
              +1 Mum
            </button>

            <button
              type="button"
              disabled={loading || candles.length === 0}
              onClick={handleRestart}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs font-bold text-zinc-400 transition hover:text-zinc-200 active:scale-95 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Başa Sar
            </button>
          </div>

          <div className="flex items-center gap-1">
            <FastForward className="h-3.5 w-3.5 text-zinc-500" />
            {([1, 2, 4] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => {
                  hapticShort();
                  setSpeed(sp);
                }}
                className={`min-h-[44px] min-w-[44px] cursor-pointer rounded-xl border font-mono text-xs font-bold transition ${
                  speed === sp
                    ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400"
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        {/* Result Banner */}
        {lastBanner && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${
              lastBanner.tone === "win"
                ? "border-emerald-500/50 bg-emerald-950/35 text-emerald-200"
                : lastBanner.tone === "liq"
                ? "border-red-500/70 bg-red-950/50 text-red-100"
                : "border-amber-500/50 bg-amber-950/35 text-amber-200"
            }`}
          >
            {lastBanner.tone === "liq" && <Skull className="h-4 w-4 shrink-0 text-red-400" />}
            <span>{lastBanner.text}</span>
          </div>
        )}

        {/* Interactive Paper Trading Controls over Real Historical Candles */}
        <div className="mt-3 rounded-xl border border-zinc-800/90 bg-zinc-900/45 p-3">
          {!position ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-zinc-400 uppercase">
                  Kaldıraç Seç (50x disiplin çarpanını düşürür)
                </span>
                <div className="flex gap-1.5">
                  {REPLAY_LEVERAGES.map((lev) => (
                    <button
                      key={lev}
                      type="button"
                      onClick={() => {
                        hapticShort();
                        setLeverage(lev);
                      }}
                      className={`min-h-[44px] min-w-[46px] cursor-pointer rounded-xl border font-mono text-xs font-black transition ${
                        leverage === lev
                          ? lev >= 50
                            ? "border-red-500 bg-red-600/25 text-red-200"
                            : "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400"
                      }`}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!currentCandle || atEnd}
                  onClick={() => handleOpen("LONG")}
                  className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-500/70 bg-emerald-600/90 text-sm font-black tracking-wider text-white uppercase shadow transition hover:bg-emerald-500 active:scale-95 disabled:opacity-40"
                >
                  <TrendingUp className="h-4 w-4" />
                  LONG AÇ ({leverage}x)
                </button>
                <button
                  type="button"
                  disabled={!currentCandle || atEnd}
                  onClick={() => handleOpen("SHORT")}
                  className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-500/70 bg-red-600/90 text-sm font-black tracking-wider text-white uppercase shadow transition hover:bg-red-500 active:scale-95 disabled:opacity-40"
                >
                  <TrendingDown className="h-4 w-4" />
                  SHORT AÇ ({leverage}x)
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 font-mono text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 font-black ${
                      position.side === "LONG"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {position.symbol} {position.side} {position.leverage}x
                  </span>
                  <span className="text-zinc-400">
                    Giriş: <strong className="text-white">${position.entryPrice.toFixed(decimals)}</strong>
                  </span>
                  <span className="text-red-400">
                    Liq: <strong>${position.liquidationPrice.toFixed(decimals)}</strong>
                  </span>
                </div>
                {liveEval && (
                  <div
                    className={`text-base font-black ${
                      liveEval.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {liveEval.unrealizedPnl >= 0 ? "+" : ""}${liveEval.unrealizedPnl.toFixed(2)} (
                    {liveEval.roePct >= 0 ? "+" : ""}
                    {liveEval.roePct.toFixed(1)}% ROE)
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="min-h-[48px] cursor-pointer rounded-xl border border-amber-400/70 bg-amber-600 px-5 text-xs font-black tracking-wider text-white uppercase shadow transition hover:bg-amber-500 active:scale-95"
              >
                Pozisyonu Kapat
              </button>
            </div>
          )}
        </div>

        {/* Recent Replay Practice Trades */}
        {trades.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="font-mono text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
              Tekrar Pratik Kayıtları ({trades.length})
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {trades.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 font-mono text-[11px] ${
                    t.liquidated
                      ? "border-red-500/50 bg-red-950/30"
                      : t.netPnl >= 0
                      ? "border-emerald-500/30 bg-emerald-950/20"
                      : "border-zinc-800 bg-zinc-950/80"
                  }`}
                >
                  <div>
                    <span className="font-bold text-white">
                      {t.symbol.replace("USDT", "")} {t.side} {t.leverage}x
                    </span>
                    <span className="ml-1.5 text-zinc-500">
                      ${t.entryPrice.toFixed(decimals)} → ${t.exitPrice.toFixed(decimals)}
                    </span>
                  </div>
                  <span
                    className={`font-black ${
                      t.liquidated
                        ? "text-red-400"
                        : t.netPnl >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {t.liquidated ? "LİKİDE" : `${t.netPnl >= 0 ? "+" : ""}$${t.netPnl.toFixed(2)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
