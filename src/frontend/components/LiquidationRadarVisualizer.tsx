import React, { useEffect, useMemo, useRef } from "react";
import { Crosshair, Flame, Radio, Skull } from "lucide-react";
import { formatCompactUsd, LiveLiquidationItem } from "../utils/liquidation";

interface LiquidationRadarVisualizerProps {
  items: LiveLiquidationItem[];
  binanceConnected: boolean;
  cumulativeUsdt: number;
}

/**
 * Deterministic symbol angle on the 360-degree radar scope (hash-based, no randomness).
 */
function symbolToAngleRad(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) % 360;
  }
  return (hash * Math.PI) / 180;
}

/**
 * Visual Revolution V2 (TODO #2.2): Fitilci Mehmet'in Canlı Likidasyon Fitil & Radar Visualizer'ı.
 * 100% real Binance Futures !forceOrder@arr liquidation events rendered on a 60 FPS sweeping
 * amber/crimson radar canvas + real live liquidation wick needle strip.
 */
export const LiquidationRadarVisualizer: React.FC<LiquidationRadarVisualizerProps> = ({
  items,
  binanceConnected,
  cumulativeUsdt,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const itemsRef = useRef<LiveLiquidationItem[]>(items);
  itemsRef.current = items;

  const recentWicks = useMemo(() => items.slice(0, 14), [items]);
  const maxWickUsd = useMemo(
    () => Math.max(10_000, ...recentWicks.map((w) => w.notionalUsdt)),
    [recentWicks]
  );

  // 60 FPS Sweeping Cyberpunk Liquidation Radar Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const startMs = performance.now();

    const draw = (nowPerf: number) => {
      const t = (nowPerf - startMs) / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(240, Math.round(rect.width));
      const h = Math.max(220, Math.round(rect.height));

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep dark scope bg
      ctx.fillStyle = "#080607";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.43;

      // Concentric radar rings ($1M core, $100K inner, $25K mid, outer)
      const rings = [0.25, 0.5, 0.75, 1];
      rings.forEach((f, idx) => {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
        ctx.strokeStyle =
          idx === 0
            ? "rgba(239, 68, 68, 0.45)"
            : "rgba(245, 158, 11, 0.22)";
        ctx.lineWidth = idx === 0 ? 1.5 : 1;
        ctx.stroke();
      });

      // Crosshairs
      ctx.strokeStyle = "rgba(245, 158, 11, 0.16)";
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // Rotating Amber Radar Sweep Cone
      const sweepAngle = (t * 1.45) % (Math.PI * 2);
      const steps = 18;
      for (let i = 0; i < steps; i++) {
        const a0 = sweepAngle - (i / steps) * 0.75;
        const a1 = sweepAngle - ((i + 1) / steps) * 0.75;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, a1, a0);
        ctx.closePath();
        ctx.fillStyle = `rgba(245, 158, 11, ${0.18 * (1 - i / steps)})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Plot real Binance !forceOrder@arr blips
      const nowWall = Date.now();
      const liveItems = itemsRef.current.slice(0, 28);

      liveItems.forEach((ev, idx) => {
        const ageSec = Math.max(0, (nowWall - ev.timestampMs) / 1000);
        const fade = Math.max(0.22, 1 - ageSec / 90);
        const angle = symbolToAngleRad(ev.symbol) + (idx % 5) * 0.09;
        // Larger liquidation => closer to center danger epicenter (log scaled)
        const logMag = Math.min(1, Math.log10(Math.max(1000, ev.notionalUsdt)) / 6.3);
        const r = maxR * Math.max(0.14, 0.96 - logMag * 0.76);
        const bx = cx + Math.cos(angle) * r;
        const by = cy + Math.sin(angle) * r;

        const isWhale = ev.notionalUsdt >= 100_000;
        const isLongLiq = ev.liquidatedSide === "LONG";
        const baseColor = isWhale
          ? `rgba(251, 191, 36, ${fade})`
          : isLongLiq
          ? `rgba(239, 68, 68, ${fade})`
          : `rgba(16, 185, 129, ${fade})`;

        // Expanding shockwave ring on fresh events (< 8s old)
        if (ageSec < 8) {
          const ringR = 5 + ((ageSec * 22) % 28);
          ctx.beginPath();
          ctx.arc(bx, by, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = isWhale ? 2 : 1.2;
          ctx.stroke();
        }

        // Core blip dot
        const dotR = isWhale ? 5.5 : ev.notionalUsdt >= 25_000 ? 4 : 2.8;
        ctx.beginPath();
        ctx.arc(bx, by, dotR, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.fill();

        // Label top 5 freshest/largest blips
        if (idx < 5) {
          ctx.font = "bold 9px ui-monospace, SFMono-Regular, monospace";
          ctx.fillStyle = "#fde68a";
          ctx.textAlign = "left";
          ctx.fillText(
            `${ev.symbol.replace("USDT", "")} ${formatCompactUsd(ev.notionalUsdt)}`,
            bx + 7,
            by + 3
          );
        }
      });

      // Center Epicenter Label
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b";
      ctx.fill();

      ctx.font = "bold 9px ui-monospace, SFMono-Regular, monospace";
      ctx.fillStyle = "rgba(251, 191, 36, 0.75)";
      ctx.textAlign = "left";
      ctx.fillText("MERKEZ = $1M+ BALİNA", 8, 14);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(248, 113, 113, 0.85)";
      ctx.fillText("● LONG PATLADI", w - 8, 14);
      ctx.fillStyle = "rgba(52, 211, 153, 0.85)";
      ctx.fillText("● SHORT PATLADI", w - 8, 26);

      ctx.restore();
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-[#160b07] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src="/avatars/mehmet.webp"
            alt="Fitilci Mehmet"
            className="h-9 w-9 rounded-xl border border-amber-500/60 object-cover"
          />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-black tracking-wider text-amber-300 uppercase">
                <Crosshair className="h-4 w-4 text-amber-400" />
                Fitilci Mehmet · Canlı Likidasyon Fitil Radarı
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                  binanceConnected
                    ? "bg-red-500/20 text-red-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                <Radio className="h-3 w-3 animate-pulse" />
                {binanceConnected ? "!forceOrder@arr CANLI" : "BEKLİYOR"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Gerçek Binance Futures likidasyon patlamalarını ve fitil iğnelerini anlık radar taramasında yakalar.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-red-500/30 bg-red-950/35 px-2.5 py-1 font-mono text-xs font-black text-red-200">
          Oturum: {formatCompactUsd(cumulativeUsdt)}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-12">
        {/* 60 FPS Circular Sweeping Radar */}
        <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-black md:col-span-6">
          <canvas
            ref={canvasRef}
            className="block h-[225px] w-full"
            aria-label="Canlı Binance Futures likidasyon radarı"
          />
        </div>

        {/* Live Liquidation Wick Needles (Fitil İğneleri) */}
        <div className="flex flex-col justify-between rounded-xl border border-zinc-800/90 bg-black/60 p-3 md:col-span-6">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="inline-flex items-center gap-1 font-bold text-amber-300">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              CANLI FİTİL İĞNELERİ ({recentWicks.length})
            </span>
            <span className="text-zinc-500">Yükseklik = Gerçek USD</span>
          </div>

          {recentWicks.length === 0 ? (
            <div className="flex h-[160px] flex-col items-center justify-center gap-1.5 text-center text-xs text-zinc-500">
              <Skull className="h-5 w-5 text-zinc-600" />
              <span>Canlı Binance !forceOrder@arr patlaması bekleniyor...</span>
            </div>
          ) : (
            <div className="mt-2 flex h-[155px] items-end gap-1.5 overflow-x-auto px-1 pb-1">
              {recentWicks.map((w) => {
                const heightPct = Math.max(
                  14,
                  Math.round((w.notionalUsdt / maxWickUsd) * 100)
                );
                const isLong = w.liquidatedSide === "LONG";
                const isWhale = w.notionalUsdt >= 100_000;
                return (
                  <div
                    key={w.id}
                    title={`${w.symbol} ${w.liquidatedSide} ${formatCompactUsd(w.notionalUsdt)} @ $${w.price}`}
                    className="group flex h-full min-w-[26px] flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span className="font-mono text-[8px] font-bold text-zinc-400">
                      {formatCompactUsd(w.notionalUsdt).replace("$", "")}
                    </span>
                    {/* Thin upper wick needle */}
                    <div
                      className={`w-[2px] flex-shrink-0 ${
                        isWhale
                          ? "bg-amber-300"
                          : isLong
                          ? "bg-red-400"
                          : "bg-emerald-400"
                      }`}
                      style={{ height: `${Math.min(28, heightPct * 0.3)}%` }}
                    />
                    {/* Candle body */}
                    <div
                      className={`w-full max-w-[18px] rounded-t-sm transition-all ${
                        isWhale
                          ? "bg-gradient-to-t from-amber-600 to-yellow-300 shadow-[0_0_12px_rgba(251,191,36,0.75)]"
                          : isLong
                          ? "bg-gradient-to-t from-red-700 to-rose-400"
                          : "bg-gradient-to-t from-emerald-700 to-teal-300"
                      }`}
                      style={{ height: `${Math.max(12, heightPct * 0.7)}%` }}
                    />
                    <span className="truncate font-mono text-[8px] font-black text-zinc-300">
                      {w.symbol.replace("USDT", "").slice(0, 4)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-1.5 flex items-center justify-between border-t border-zinc-800/80 pt-1.5 font-mono text-[10px] text-zinc-400">
            <span>Fitilci Mehmet kuralı: Ani fitil → Tersine sıçrama avı</span>
            <span className="font-bold text-amber-300">%100 Gerçek Borsa</span>
          </div>
        </div>
      </div>
    </section>
  );
};
