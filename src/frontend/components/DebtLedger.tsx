import React from "react";

export interface LedgerEntry {
  positionId: string;
  nickname: string;
  symbol: string;
  side: "LONG" | "SHORT";
  leverage: number;
  netPnl: number;
  reasonEntry: string;
  reasonExit: string;
  mood: string;
}

interface DebtLedgerProps {
  entries: LedgerEntry[];
  onExportJson: () => void;
  onExportMarkdown: () => void;
}

export const DebtLedger: React.FC<DebtLedgerProps> = ({
  entries,
  onExportJson,
  onExportMarkdown,
}) => {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black tracking-wider text-rose-400 uppercase">
          İntikam Defteri (The Ledger)
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onExportJson}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-200 hover:bg-zinc-800"
          >
            Logları İndir (JSON)
          </button>
          <button
            onClick={onExportMarkdown}
            className="rounded border border-rose-700 bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-900/60"
          >
            Zarar Raporu (MD)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-800 text-zinc-400 uppercase">
            <tr>
              <th className="py-2 pr-3">Trader</th>
              <th className="py-2 pr-3">Coin / Yön</th>
              <th className="py-2 pr-3">Net PnL</th>
              <th className="py-2 pr-3">Giriş Nedeni</th>
              <th className="py-2">Neden Battı / Çıktı?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {entries.map((row) => (
              <tr key={row.positionId} className="hover:bg-zinc-900/50">
                <td className="py-2.5 pr-3 font-bold text-zinc-100">
                  {row.nickname}{" "}
                  <span className="text-[10px] text-zinc-500">({row.mood})</span>
                </td>
                <td className="py-2.5 pr-3 font-mono text-zinc-300">
                  {row.symbol} {row.side} {row.leverage}x
                </td>
                <td
                  className={`py-2.5 pr-3 font-mono font-bold ${
                    row.netPnl >= 0 ? "text-emerald-400" : "text-red-500"
                  }`}
                >
                  {row.netPnl >= 0 ? "+" : ""}
                  {row.netPnl.toFixed(2)} $
                </td>
                <td className="py-2.5 pr-3 text-zinc-400">{row.reasonEntry}</td>
                <td className="py-2.5 text-rose-300">{row.reasonExit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
