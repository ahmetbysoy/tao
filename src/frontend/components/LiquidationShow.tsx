import React, { useEffect, useRef, useState } from "react";
import { Flame, Radio, Skull, Vibrate, Volume2, VolumeX, Waves } from "lucide-react";
import {
  formatCompactUsd,
  LiveLiquidationItem,
} from "../utils/liquidation";

interface LiquidationShowProps {
  items: LiveLiquidationItem[];
  cumulativeUsdt: number;
  eventCount: number;
  impactCount: number;
  whaleCount: number;
  binanceConnected: boolean;
  shakeOn: boolean;
  sfxOn: boolean;
  onToggleShake: () => void;
  onToggleSfx: () => void;
}

export const LiquidationShow: React.FC<LiquidationShowProps> = ({
  items,
  cumulativeUsdt,
  eventCount,
  impactCount,
  whaleCount,
  binanceConnected,
  shakeOn,
  sfxOn,
  onToggleShake,
  onToggleSfx,
}) => {
  // Smoothly animated growing cumulative counter
  const [displayTotal, setDisplayTotal] = useState(cumulativeUsdt);
  const currentValRef = useRef(cumulativeUsdt);

  useEffect(() => {
    const start = currentValRef.current;
    const target = cumulativeUsdt;
    if (start === target) return;
    const startTime = performance.now();
    const duration = 420;
    let rafId = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = start + (target - start) * eased;
      currentValRef.current = val;
      setDisplayTotal(val);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [cumulativeUsdt]);

  return (
    <section className="rounded-xl border border-red-900/50 bg-gradient-to-br from-[#12070a] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      {/* Header & Cumulative Counter */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display flex items-center gap-1.5 text-xs font-black tracking-wider text-red-400 uppercase sm:text-sm">
              <Skull className="h-4 w-4 shrink-0 text-red-500" />
              Gerçek Likidasyon Şovu
            </h2>
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                binanceConnected
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-red-600/25 text-red-300"
              }`}
            >
              <Radio className="h-2.5 w-2.5" />
              {binanceConnected ? "!forceOrder@arr CANLI" : "BAĞLANTI KOPUK"}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
            $10K+ olay ({eventCount}) · $100K+ darbe ({impactCount}) · $1M+ balina ({whaleCount})
          </p>
        </div>

        {/* Growing Counter + Quick Motion/Sound Controls */}
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-red-500/35 bg-red-950/40 px-3 py-1.5 text-right">
            <div className="font-mono text-[9px] tracking-wider text-red-300/80 uppercase">
              Oturumda Yanan
            </div>
            <div className="font-mono text-base font-black text-red-400 sm:text-lg">
              ${Math.round(displayTotal).toLocaleString("en-US")}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleShake}
            title={shakeOn ? "Ekran sarsıntısını kapat" : "Ekran sarsıntısını aç"}
            aria-pressed={shakeOn}
            className={`flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border transition active:scale-95 ${
              shakeOn
                ? "border-amber-500/45 bg-amber-500/15 text-amber-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            <Waves className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleSfx}
            title={sfxOn ? "Sesi kapat" : "Sesi aç"}
            aria-pressed={sfxOn}
            className={`flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border transition active:scale-95 ${
              sfxOn
                ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            {sfxOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Live Ribbon of Real Binance forceOrder Events */}
      <div className="mt-3 overflow-x-auto pb-1">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-800/90 bg-black/40 px-3 py-2.5 font-mono text-[11px] text-zinc-500">
            <Vibrate className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            {binanceConnected
              ? "Tüm Binance Futures piyasasında $10K+ gerçek forceOrder bekleniyor..."
              : "Binance WebSocket bağlantısı bekleniyor — sahte olay üretilmez."}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {items.slice(0, 18).map((ev) => {
              const isWhale = ev.tier === "whale";
              const isImpact = ev.tier === "impact";
              const isMajor =
                ev.symbol === "BTCUSDT" ||
                ev.symbol === "ETHUSDT" ||
                ev.symbol === "SOLUSDT";

              return (
                <div
                  key={ev.id}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 font-mono text-xs transition ${
                    isWhale
                      ? "border-red-500 bg-red-600/25 text-white shadow-[0_0_20px_rgba(239,68,68,0.45)]"
                      : isImpact
                      ? "border-orange-500/70 bg-orange-950/50 text-orange-100"
                      : isMajor
                      ? "border-red-800/60 bg-red-950/30 text-zinc-200"
                      : "border-zinc-800 bg-zinc-900/80 text-zinc-300"
                  }`}
                >
                  {isWhale ? (
                    <Skull className="h-3.5 w-3.5 shrink-0 animate-bounce text-red-400" />
                  ) : isImpact ? (
                    <Flame className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                  ) : null}

                  <span className="font-black text-white">
                    {ev.symbol.replace("USDT", "")}
                  </span>

                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                      ev.liquidatedSide === "LONG"
                        ? "bg-red-500/25 text-red-300"
                        : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {ev.liquidatedSide}
                  </span>

                  <span
                    className={`font-black ${
                      isWhale
                        ? "text-red-300"
                        : isImpact
                        ? "text-amber-300"
                        : "text-zinc-200"
                    }`}
                  >
                    {formatCompactUsd(ev.notionalUsdt)}
                  </span>

                  <span className="text-[10px] text-zinc-500">
                    {new Date(ev.timestampMs).toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
