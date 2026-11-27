import React from "react";

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
}

interface LivePnLProps {
  positions: OpenPosition[];
  livePrices: Record<string, number>; // symbol -> latest bookTicker mid price
}

export const LivePnL: React.FC<LivePnLProps> = ({ positions, livePrices }) => {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-black tracking-wider text-amber-400 uppercase">
        Canlı PnL Akışı (Milisaniye)
      </h2>
      {positions.length === 0 ? (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          Şu an açık pozisyon yok. Piyasa kan kokusu bekliyor...
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {positions.map((pos) => {
            const current = livePrices[pos.symbol] ?? pos.entryPrice;
            const rawPnl =
              pos.side === "LONG"
                ? (current - pos.entryPrice) * pos.qty
                : (pos.entryPrice - current) * pos.qty;
            const roiPct = (rawPnl / pos.isolatedMargin) * 100;
            const isProfit = rawPnl >= 0;

            return (
              <div
                key={pos.positionId}
                className={`rounded-lg border p-4 transition-all ${
                  isProfit
                    ? "pnl-profit border-emerald-500/60 bg-emerald-950/30"
                    : "pnl-loss border-red-600/80 bg-red-950/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    {pos.nickname} · {pos.symbol}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-black ${
                      pos.side === "LONG"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {pos.side} {pos.leverage}x
                  </span>
                </div>
                <div
                  className={`mt-2 font-mono text-2xl font-black ${
                    isProfit ? "text-emerald-400" : "text-red-500"
                  }`}
                >
                  {isProfit ? "+" : ""}
                  {rawPnl.toFixed(2)} USDT ({roiPct.toFixed(1)}%)
                </div>
                <div className="mt-1 flex justify-between text-xs text-zinc-400">
                  <span>Giriş: ${pos.entryPrice.toFixed(2)}</span>
                  <span>Anlık: ${current.toFixed(2)}</span>
                  <span className="text-red-400">
                    Liq: ${pos.liquidationPrice.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
