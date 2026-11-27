import React from "react";
import { Activity, Crosshair, Flame, XCircle, Zap } from "lucide-react";

export interface OpenPosition {
  positionId: string;
  traderId: string;
  nickname: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  qty: number;
  leverage: number;
  isolatedMargin: number;
  liquidationPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reasonEntry: string;
}

interface LivePnLProps {
  positions: OpenPosition[];
  livePrices: Record<string, number>;
  onForceClose: (pos: OpenPosition) => void;
  onTriggerPulse: () => void;
}

export const LivePnL: React.FC<LivePnLProps> = ({
  positions,
  livePrices,
  onForceClose,
  onTriggerPulse,
}) => {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-amber-400 uppercase">
          <Activity className="h-4 w-4 text-emerald-400" />
          Canlı Açık Pozisyonlar (Milisaniye PnL Akışı)
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          Likidasyon barı kırmızıya vurduğunda hesap patlar
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6">
          <div className="space-y-1">
            <div className="font-display text-sm font-bold text-zinc-300">
              Şu an açık pozisyon yok — 5 bot canlı Binance Futures tahtasını tarıyor...
            </div>
            <p className="text-xs text-zinc-500">
              Algoritmalar gerçek likidasyon fitili, OBI duvarı, funding sapması veya hacim
              patlaması bekliyor. Hemen aksiyon görmek için piyasayı kışkırtabilirsin.
            </p>
          </div>
          <button
            onClick={onTriggerPulse}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/60 bg-red-600/20 px-4 py-2 text-xs font-black tracking-wider text-red-200 uppercase transition hover:bg-red-600/35"
          >
            <Zap className="h-4 w-4 text-red-400" />
            Anında İşlem Kışkırt
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {positions.map((pos) => {
            const current = livePrices[pos.symbol] ?? pos.entryPrice;
            const rawPnl =
              pos.side === "LONG"
                ? (current - pos.entryPrice) * pos.qty
                : (pos.entryPrice - current) * pos.qty;
            const roiPct =
              pos.isolatedMargin > 0 ? (rawPnl / pos.isolatedMargin) * 100 : 0;
            const isProfit = rawPnl >= 0;

            // Danger meter: 0% at entry or profit, 100% at liquidation price
            const distEntryToLiq = Math.abs(pos.entryPrice - pos.liquidationPrice);
            const adverseMove =
              pos.side === "LONG"
                ? Math.max(0, pos.entryPrice - current)
                : Math.max(0, current - pos.entryPrice);
            const liqDangerPct =
              distEntryToLiq > 0
                ? Math.min(100, Math.round((adverseMove / distEntryToLiq) * 100))
                : 0;
            const distToLiqPct =
              current > 0
                ? (Math.abs(current - pos.liquidationPrice) / current) * 100
                : 0;
            const decimals = pos.symbol === "SOLUSDT" ? 3 : 2;

            return (
              <div
                key={pos.positionId}
                className={`relative rounded-xl border p-4 transition-all ${
                  isProfit
                    ? "pnl-profit border-emerald-500/60 bg-gradient-to-br from-emerald-950/35 via-zinc-950 to-zinc-950"
                    : "pnl-loss border-red-600/80 bg-gradient-to-br from-red-950/45 via-zinc-950 to-zinc-950"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold text-white">
                        {pos.nickname}
                      </span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs font-bold text-zinc-200">
                        {pos.symbol}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[11px] font-black ${
                          pos.side === "LONG"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        {pos.side} {pos.leverage}x
                      </span>
                    </div>
                    {pos.reasonEntry && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
                        <Flame className="h-3 w-3 shrink-0 text-amber-400" />
                        <span className="truncate">{pos.reasonEntry}</span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => onForceClose(pos)}
                    title="Pozisyonu canlı fiyattan zorla kapat"
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[10px] font-bold text-zinc-300 uppercase transition hover:border-red-500 hover:bg-red-950/70 hover:text-red-200"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Kapat
                  </button>
                </div>

                {/* Big Dopamine PnL Readout */}
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <div
                    className={`font-mono text-2xl font-black sm:text-3xl ${
                      isProfit ? "text-emerald-400" : "text-red-500"
                    }`}
                  >
                    {isProfit ? "+" : ""}
                    {rawPnl.toFixed(2)}{" "}
                    <span className="text-sm font-bold opacity-80">USDT</span>
                  </div>
                  <div
                    className={`rounded-md px-2 py-0.5 font-mono text-sm font-black ${
                      isProfit
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {isProfit ? "+" : ""}
                    {roiPct.toFixed(1)}% ROI
                  </div>
                </div>

                {/* Liquidation Proximity Danger Bar */}
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Crosshair className="h-3 w-3 text-red-400" />
                      Likidasyon Riski
                    </span>
                    <span
                      className={`font-bold ${
                        liqDangerPct >= 65
                          ? "text-red-400 animate-pulse"
                          : liqDangerPct >= 30
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      Liq mesafesi %{distToLiqPct.toFixed(2)} ({liqDangerPct}% tehlike)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={`h-full rounded-full transition-all duration-150 ${
                        liqDangerPct >= 65
                          ? "bg-gradient-to-r from-orange-500 to-red-600"
                          : liqDangerPct >= 30
                          ? "bg-gradient-to-r from-amber-500 to-orange-500"
                          : "bg-emerald-500/70"
                      }`}
                      style={{ width: `${Math.max(4, liqDangerPct)}%` }}
                    />
                  </div>
                </div>

                {/* Telemetry grid */}
                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-zinc-800/80 pt-2.5 font-mono text-[11px]">
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Giriş</div>
                    <div className="text-zinc-200">${pos.entryPrice.toFixed(decimals)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Anlık</div>
                    <div className="font-bold text-white">${current.toFixed(decimals)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Teminat</div>
                    <div className="text-amber-300">${pos.isolatedMargin.toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Likidasyon</div>
                    <div className="font-bold text-red-400">
                      ${pos.liquidationPrice.toFixed(decimals)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
