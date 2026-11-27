import React from "react";
import { Coins, Flame, Skull, TrendingDown, TrendingUp, Wallet } from "lucide-react";

interface KpiBarProps {
  tefeciProfit: number;
  totalOwed: number;
  overdueCount: number;
  liveUnrealizedPnl: number;
  openPositionCount: number;
  totalLiquidations: number;
  totalCollected: number;
}

export const KpiBar: React.FC<KpiBarProps> = ({
  tefeciProfit,
  totalOwed,
  overdueCount,
  liveUnrealizedPnl,
  openPositionCount,
  totalLiquidations,
  totalCollected,
}) => {
  const pnlPos = liveUnrealizedPnl >= 0;

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* Tefeci Profit */}
      <div className="relative overflow-hidden rounded-xl border border-amber-500/35 bg-gradient-to-br from-zinc-950 via-zinc-950 to-amber-950/25 p-4">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-amber-400/90 uppercase">
          <span>Tefeci Kârı &amp; Faiz</span>
          <Coins className="h-4 w-4 text-amber-400" />
        </div>
        <div className="mt-2 font-mono text-2xl font-black text-amber-300 sm:text-3xl">
          +${tefeciProfit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Tahsil Edilen Nakit</span>
          <span className="font-mono font-semibold text-emerald-400">
            ${totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Total Active Debts */}
      <div className="relative overflow-hidden rounded-xl border border-rose-500/35 bg-gradient-to-br from-zinc-950 via-zinc-950 to-rose-950/25 p-4">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-rose-400/90 uppercase">
          <span>Aktif Toplam Alacak</span>
          <Wallet className="h-4 w-4 text-rose-400" />
        </div>
        <div className="mt-2 font-mono text-2xl font-black text-white sm:text-3xl">
          ${totalOwed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Geciken Senet</span>
          <span
            className={`font-mono font-bold ${
              overdueCount > 0 ? "text-red-400 animate-pulse" : "text-zinc-500"
            }`}
          >
            {overdueCount > 0 ? `${overdueCount} KRİTİK GECİKME!` : "0 gecikme"}
          </span>
        </div>
      </div>

      {/* Live Millisecond Unrealized PnL */}
      <div
        className={`relative overflow-hidden rounded-xl border p-4 transition-colors ${
          openPositionCount === 0
            ? "border-zinc-800 bg-zinc-950/90"
            : pnlPos
            ? "border-emerald-500/45 bg-gradient-to-br from-zinc-950 to-emerald-950/25"
            : "border-red-500/50 bg-gradient-to-br from-zinc-950 to-red-950/30"
        }`}
      >
        <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          <span>Mahalle Canlı PnL</span>
          {pnlPos ? (
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-400" />
          )}
        </div>
        <div
          className={`mt-2 font-mono text-2xl font-black sm:text-3xl ${
            openPositionCount === 0
              ? "text-zinc-500"
              : pnlPos
              ? "text-emerald-400"
              : "text-red-500"
          }`}
        >
          {pnlPos ? "+" : ""}
          ${liveUnrealizedPnl.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Milisaniye Binance Hesabı</span>
          <span className="font-mono font-semibold text-zinc-300">
            {openPositionCount} açık pozisyon
          </span>
        </div>
      </div>

      {/* Liquidations & Heat */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/90 p-4">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          <span>Likidasyon &amp; Kan Skoru</span>
          <Skull className="h-4 w-4 text-red-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-black text-red-400 sm:text-3xl">
            {totalLiquidations}
          </span>
          <span className="text-xs font-semibold text-zinc-500 uppercase">
            patlayan hesap
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Flame className="h-3 w-3 text-orange-400" />
            Açık Masa
          </span>
          <span className="font-mono font-semibold text-amber-300">
            {openPositionCount} aktif işlem
          </span>
        </div>
      </div>
    </section>
  );
};
