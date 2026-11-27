import React, { useMemo, useState } from "react";
import { BookOpen, Download, FileText, Filter, Search, Skull } from "lucide-react";

export interface LedgerEntry {
  positionId: string;
  traderId: string;
  nickname: string;
  symbol: string;
  side: "LONG" | "SHORT";
  leverage: number;
  entryPrice: number;
  exitPrice: number | null;
  netPnl: number;
  reasonEntry: string;
  reasonExit: string;
  mood: string;
  closedAtMs: number | null;
}

interface DebtLedgerProps {
  entries: LedgerEntry[];
  onExportJson: (filtered: LedgerEntry[]) => void;
  onExportMarkdown: (filtered: LedgerEntry[]) => void;
}

type OutcomeFilter = "ALL" | "LOSS" | "WIN" | "LIQ";

export const DebtLedger: React.FC<DebtLedgerProps> = ({
  entries,
  onExportJson,
  onExportMarkdown,
}) => {
  const [traderFilter, setTraderFilter] = useState<string>("ALL");
  const [symbolFilter, setSymbolFilter] = useState<string>("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
  const [search, setSearch] = useState<string>("");

  const uniqueTraders = useMemo(
    () => Array.from(new Set(entries.map((e) => e.nickname))).sort(),
    [entries]
  );

  const uniqueSymbols = useMemo(
    () => Array.from(new Set(entries.map((e) => e.symbol))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries]
      .sort((a, b) => (b.closedAtMs ?? 0) - (a.closedAtMs ?? 0))
      .filter((row) => {
        if (traderFilter !== "ALL" && row.nickname !== traderFilter) return false;
        if (symbolFilter !== "ALL" && row.symbol !== symbolFilter) return false;
        if (outcomeFilter === "LOSS" && row.netPnl >= 0) return false;
        if (outcomeFilter === "WIN" && row.netPnl < 0) return false;
        if (
          outcomeFilter === "LIQ" &&
          !row.reasonExit.toUpperCase().includes("LİKİD")
        ) {
          return false;
        }
        if (q) {
          const hay =
            `${row.nickname} ${row.symbol} ${row.reasonEntry} ${row.reasonExit} ${row.mood}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [entries, traderFilter, symbolFilter, outcomeFilter, search]);

  const totalNet = filtered.reduce((acc, r) => acc + r.netPnl, 0);
  const wins = filtered.filter((r) => r.netPnl >= 0).length;
  const winRate = filtered.length > 0 ? Math.round((wins / filtered.length) * 100) : 0;

  return (
    <section className="rounded-xl border border-zinc-800/90 bg-zinc-950/90 p-4 shadow-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-rose-400 uppercase sm:text-base">
            <BookOpen className="h-4 w-4 text-rose-500" />
            İntikam Defteri (The Ledger)
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-zinc-400">
            <span>
              Kayıt: <strong className="text-zinc-200">{filtered.length}</strong>
            </span>
            <span>
              Kazanma Oranı: <strong className="text-zinc-200">%{winRate}</strong>
            </span>
            <span>
              Toplam Net:{" "}
              <strong className={totalNet >= 0 ? "text-emerald-400" : "text-red-400"}>
                {totalNet >= 0 ? "+" : ""}
                ${totalNet.toFixed(2)}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onExportJson(filtered)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Logları İndir (JSON)
          </button>
          <button
            onClick={() => onExportMarkdown(filtered)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-700/80 bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-200 transition hover:bg-rose-900/60"
          >
            <FileText className="h-3.5 w-3.5" />
            Zarar Raporu (MD)
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-900 bg-black/50 p-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sebep, coin veya trader ara..."
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pr-3 pl-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          <select
            value={traderFilter}
            onChange={(e) => setTraderFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
          >
            <option value="ALL">Tüm Trader&apos;lar</option>
            {uniqueTraders.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
          >
            <option value="ALL">Tüm Coin&apos;ler</option>
            {uniqueSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-1">
          {(
            [
              ["ALL", "Tümü"],
              ["LOSS", "Zarar"],
              ["WIN", "Kâr"],
              ["LIQ", "Likidasyon"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setOutcomeFilter(id)}
              className={`cursor-pointer rounded border px-2 py-1 text-[11px] font-bold transition ${
                outcomeFilter === id
                  ? "border-rose-500/60 bg-rose-500/20 text-rose-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-zinc-900 bg-black/40 p-6 text-center text-xs text-zinc-500">
            Seçili filtrelere uyan kapanmış pozisyon henüz yok. İşlemler kapandıkça İntikam Defteri
            otomatik dolar.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 font-mono text-[10px] text-zinc-400 uppercase">
              <tr>
                <th className="py-2 pr-3">Trader</th>
                <th className="py-2 pr-3">Coin / Yön</th>
                <th className="py-2 pr-3">Giriş → Çıkış</th>
                <th className="py-2 pr-3">Net PnL</th>
                <th className="py-2 pr-3">Giriş Nedeni</th>
                <th className="py-2">Neden Battı / Çıktı?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/90">
              {filtered.map((row) => {
                const isLiq = row.reasonExit.toUpperCase().includes("LİKİD");
                return (
                  <tr
                    key={row.positionId}
                    className={`transition hover:bg-zinc-900/50 ${
                      isLiq ? "bg-red-950/20" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-bold text-zinc-100">{row.nickname}</div>
                      <div className="font-mono text-[10px] text-zinc-500">
                        {row.mood}
                        {row.closedAtMs
                          ? ` · ${new Date(row.closedAtMs).toLocaleTimeString("tr-TR")}`
                          : ""}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono">
                      <span className="font-bold text-zinc-200">{row.symbol}</span>{" "}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                          row.side === "LONG"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-red-500/15 text-red-300"
                        }`}
                      >
                        {row.side} {row.leverage}x
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-zinc-400">
                      ${row.entryPrice.toFixed(2)} →{" "}
                      {row.exitPrice ? `$${row.exitPrice.toFixed(2)}` : "—"}
                    </td>
                    <td
                      className={`py-2.5 pr-3 font-mono font-black ${
                        row.netPnl >= 0 ? "text-emerald-400" : "text-red-500"
                      }`}
                    >
                      {row.netPnl >= 0 ? "+" : ""}
                      {row.netPnl.toFixed(2)} $
                    </td>
                    <td className="max-w-[220px] truncate py-2.5 pr-3 text-zinc-400">
                      {row.reasonEntry || "—"}
                    </td>
                    <td className="py-2.5 text-rose-300">
                      <span className="inline-flex items-center gap-1">
                        {isLiq && <Skull className="h-3.5 w-3.5 text-red-500" />}
                        {row.reasonExit}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
