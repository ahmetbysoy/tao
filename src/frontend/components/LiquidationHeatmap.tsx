import React, { useMemo, useState } from "react";
import { AlertTriangle, Flame, Skull } from "lucide-react";
import { OpenPosition } from "./LivePnL";
import { hapticShort } from "../utils/haptics";

interface LiquidationHeatmapProps {
  openPositions: OpenPosition[];
  livePrices: Record<string, number>;
}

const SYMBOLS = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
] as const;

/**
 * Faz 2: Liquidation Wall Heatmap.
 * Displays every open trader position's exact isolated liquidation level relative to live mark price,
 * with intensity heat bars and shaking crimson proximity alerts when price nears a liquidation wall.
 */
export const LiquidationHeatmap: React.FC<LiquidationHeatmapProps> = ({
  openPositions,
  livePrices,
}) => {
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const decimals = SYMBOLS.find((s) => s.key === symbol)?.decimals ?? 2;
  const markPrice = livePrices[symbol] ?? 0;

  const walls = useMemo(() => {
    const filtered = openPositions.filter((p) => p.symbol === symbol);
    return filtered
      .map((p) => {
        const refPx = markPrice > 0 ? markPrice : p.entryPrice;
        const distPct =
          refPx > 0 ? (Math.abs(refPx - p.liquidationPrice) / refPx) * 100 : 100;
        const heat = Math.max(0.08, Math.min(1, 1 - distPct / 12));
        const critical = distPct <= 2.5;
        return {
          ...p,
          distPct,
          heat,
          critical,
        };
      })
      .sort((a, b) => a.distPct - b.distPct);
  }, [openPositions, symbol, markPrice]);

  return (
    <section className="rounded-2xl border border-orange-500/35 bg-gradient-to-br from-[#160a06] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-orange-300 uppercase sm:text-base">
            <Flame className="h-4 w-4 text-orange-400" />
            Likidasyon Duvarı Isı Haritası (Heatmap)
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Canlı fiyat izole likidasyon duvarına yaklaştıkça ısı skalası koyu kırmızıya döner.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {SYMBOLS.map((s) => {
            const cnt = openPositions.filter((p) => p.symbol === s.key).length;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  hapticShort();
                  setSymbol(s.key);
                }}
                className={`min-h-[40px] cursor-pointer rounded-xl border px-2.5 font-mono text-xs font-black transition ${
                  symbol === s.key
                    ? "border-orange-400 bg-orange-500/20 text-orange-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {s.label} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Mark Price Reference Ribbon */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-800 bg-black/60 px-3 py-2 font-mono text-xs">
        <span className="text-zinc-400">CANLI MARK FİYAT ({symbol})</span>
        <strong className="text-sm text-white">
          {markPrice > 0 ? `$${markPrice.toFixed(decimals)}` : "Canlı akış bekleniyor..."}
        </strong>
      </div>

      {/* Heat Bars */}
      <div className="mt-3 space-y-2">
        {walls.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/80 bg-black/40 p-4 text-center font-mono text-xs text-zinc-500">
            {symbol} üzerinde şu an açık pozisyon likidasyon duvarı yok.
          </div>
        ) : (
          walls.map((w) => {
            const barWidth = `${Math.round(w.heat * 100)}%`;
            return (
              <div
                key={w.positionId}
                className={`relative overflow-hidden rounded-xl border p-2.5 transition ${
                  w.critical
                    ? "border-red-500/80 bg-red-950/40 animate-pulse"
                    : "border-zinc-800/90 bg-zinc-950/90"
                }`}
              >
                {/* Background heat gradient meter */}
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 opacity-25 transition-all duration-300"
                  style={{
                    width: barWidth,
                    background: w.critical
                      ? "linear-gradient(90deg, #991b1b, #ef4444)"
                      : w.heat > 0.55
                      ? "linear-gradient(90deg, #9a3412, #f97316)"
                      : "linear-gradient(90deg, #065f46, #f59e0b)",
                  }}
                />

                <div className="relative flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={`/avatars/${w.traderId}.webp`}
                      alt={w.nickname}
                      className="h-8 w-8 rounded-full border border-zinc-700 object-cover"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 font-black text-white">
                        <span>{w.nickname}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            w.side === "LONG"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {w.side} {w.leverage}x
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        Giriş: ${w.entryPrice.toFixed(decimals)} · Marjin: ${w.isolatedMargin.toFixed(0)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1 font-black text-red-400">
                      {w.critical ? (
                        <Skull className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                      LIQ ${w.liquidationPrice.toFixed(decimals)}
                    </div>
                    <div
                      className={`text-[10px] font-bold ${
                        w.critical
                          ? "text-red-300"
                          : w.distPct <= 5
                          ? "text-orange-300"
                          : "text-emerald-300"
                      }`}
                    >
                      Mesafe: %{w.distPct.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
