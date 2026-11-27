import React, { useEffect, useRef, useState } from "react";
import { Activity, Crosshair, Flame, WifiOff, XCircle, Zap } from "lucide-react";
import { hapticLong, hapticShort } from "../utils/haptics";

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
  binanceConnected: boolean;
  onForceClose: (pos: OpenPosition) => void;
  onTriggerPulse: () => void;
}

const HOLD_DURATION_MS = 900;

const HoldToForceCloseButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const firedRef = useRef<boolean>(false);

  const stopHold = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setHolding(false);
    setProgress(0);
  };

  useEffect(() => stopHold, []);

  const startHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    firedRef.current = false;
    startRef.current = performance.now();
    setHolding(true);
    hapticShort();

    const tick = (now: number) => {
      const pct = Math.min(100, ((now - startRef.current) / HOLD_DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (!firedRef.current) {
          firedRef.current = true;
          hapticLong();
          onConfirm();
        }
        stopHold();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(e) => e.preventDefault()}
      title="Zorla kapatmak için basılı tut"
      className="relative inline-flex min-h-[44px] min-w-[126px] shrink-0 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-red-500/60 bg-zinc-900/95 px-3 text-[11px] font-black text-red-200 uppercase touch-none select-none transition active:scale-[0.98]"
    >
      {/* Filling progress bar */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-red-600/80 to-rose-500/90"
        style={{ width: `${progress}%` }}
      />
      <span className="relative z-10 inline-flex items-center gap-1.5">
        <XCircle className="h-4 w-4 shrink-0" />
        {holding ? `KAPAT ${Math.round(progress)}%` : "BASILI TUT"}
      </span>
    </button>
  );
};

export const LivePnL: React.FC<LivePnLProps> = ({
  positions,
  livePrices,
  binanceConnected,
  onForceClose,
  onTriggerPulse,
}) => {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-amber-400 uppercase">
          <Activity className="h-4 w-4 text-emerald-400" />
          Canlı Açık Pozisyonlar (Milisaniye PnL)
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          ZORLA KAPAT için düğmeye basılı tut
        </span>
      </div>

      {!binanceConnected && positions.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/45 bg-red-950/35 px-3 py-2 font-mono text-[11px] text-red-200">
          <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
          Binance bağlantısı koptu — canlı PnL akışı duraklatıldı, yeniden bağlanılıyor.
        </div>
      )}

      {positions.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 p-5">
          <div className="space-y-1">
            <div className="font-display text-sm font-bold text-zinc-300">
              Şu an açık pozisyon yok — 5 bot canlı Binance Futures tahtasını tarıyor...
            </div>
            <p className="text-xs text-zinc-500">
              Algoritmalar gerçek emir defteri dengesi, funding sapması veya likidasyon fitili
              bekliyor.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onTriggerPulse();
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-red-500/60 bg-red-600/20 px-4 text-xs font-black tracking-wider text-red-200 uppercase transition hover:bg-red-600/35 active:scale-95"
          >
            <Zap className="h-4 w-4 text-red-400" />
            Anında İşlem Kışkırt
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {positions.map((pos) => {
            const livePx = binanceConnected ? livePrices[pos.symbol] : undefined;
            const current = livePx ?? pos.entryPrice;
            const rawPnl =
              pos.side === "LONG"
                ? (current - pos.entryPrice) * pos.qty
                : (pos.entryPrice - current) * pos.qty;
            const roiPct =
              pos.isolatedMargin > 0 ? (rawPnl / pos.isolatedMargin) * 100 : 0;
            const isProfit = rawPnl >= 0;

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
                className={`relative rounded-xl border p-3.5 transition-all sm:p-4 ${
                  isProfit
                    ? "pnl-profit border-emerald-500/60 bg-gradient-to-br from-emerald-950/35 via-zinc-950 to-zinc-950"
                    : "pnl-loss border-red-600/80 bg-gradient-to-br from-red-950/45 via-zinc-950 to-zinc-950"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-display text-sm font-bold text-white sm:text-base">
                        {pos.nickname}
                      </span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-200">
                        {pos.symbol}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-black ${
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

                  <HoldToForceCloseButton onConfirm={() => onForceClose(pos)} />
                </div>

                {/* Big Dopamine PnL Readout */}
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <div
                    className={`font-mono text-2xl font-black sm:text-3xl ${
                      !livePx
                        ? "text-zinc-500"
                        : isProfit
                        ? "text-emerald-400"
                        : "text-red-500"
                    }`}
                  >
                    {livePx ? (
                      <>
                        {isProfit ? "+" : ""}
                        {rawPnl.toFixed(2)}{" "}
                        <span className="text-sm font-bold opacity-80">USDT</span>
                      </>
                    ) : (
                      <span className="text-base">BAĞLANTI BEKLENİYOR</span>
                    )}
                  </div>
                  <div
                    className={`rounded-md px-2 py-0.5 font-mono text-xs font-black sm:text-sm ${
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
                      Mesafe %{distToLiqPct.toFixed(2)} ({liqDangerPct}%)
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
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-800/80 pt-2.5 font-mono text-[11px] sm:grid-cols-4">
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Giriş</div>
                    <div className="text-zinc-200">${pos.entryPrice.toFixed(decimals)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Anlık</div>
                    <div className="font-bold text-white">
                      {livePx ? `$${livePx.toFixed(decimals)}` : "KOPUK"}
                    </div>
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
