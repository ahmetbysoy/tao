import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Flame, Shield, Timer } from "lucide-react";
import {
  computeDebtEndurance,
  DebtEnduranceSnapshot,
  formatDurationCompact,
  getEnduranceBadgeStyle,
} from "../utils/debtEndurance";
import { DebtRow, TraderRow } from "../utils/supabase";

interface DebtEndurancePanelProps {
  debts: DebtRow[];
  traders: TraderRow[];
  openPnlByTrader: Record<string, number>;
}

interface EnrichedEndurance {
  debtId: string;
  traderId: string;
  nickname: string;
  interestRatePct: number;
  enforcerCount: number;
  snapshot: DebtEnduranceSnapshot;
}

export const DebtEndurancePanel: React.FC<DebtEndurancePanelProps> = ({
  debts,
  traders,
  openPnlByTrader,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const traderMap = useMemo(() => {
    const map: Record<string, TraderRow> = {};
    traders.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [traders]);

  const items: EnrichedEndurance[] = useMemo(() => {
    return debts
      .filter((d) => d.status === "aktif" || d.status === "gecikti")
      .map((d) => {
        const trader = traderMap[d.trader_id];
        const createdAtMs = d.created_at
          ? Date.parse(d.created_at) || d.due_date_ms - 600_000
          : d.due_date_ms - 600_000;
        const traderEquity = Math.max(
          0,
          Number(trader?.balance ?? 0) + Number(openPnlByTrader[d.trader_id] ?? 0)
        );
        const snapshot = computeDebtEndurance({
          principal: Number(d.principal),
          totalRepaid: Number(d.total_repaid ?? 0),
          interestRate: Number(d.interest_rate ?? 0.08),
          compoundingPeriodS: Number(d.compounding_period_s ?? 300),
          createdAtMs,
          dueDateMs: Number(d.due_date_ms),
          nowMs,
          traderEquity,
          enforcerCount: Number(d.enforcer_count ?? 0),
          status: d.status,
        });
        return {
          debtId: d.id,
          traderId: d.trader_id,
          nickname: trader?.nickname ?? d.trader_id,
          interestRatePct: Math.round(Number(d.interest_rate ?? 0) * 100),
          enforcerCount: Number(d.enforcer_count ?? 0),
          snapshot,
        };
      })
      .sort((a, b) => {
        // Most pressured / overdue on top
        if (b.snapshot.isOverdue !== a.snapshot.isOverdue) {
          return b.snapshot.isOverdue ? 1 : -1;
        }
        return b.snapshot.pressurePct - a.snapshot.pressurePct;
      });
  }, [debts, traderMap, openPnlByTrader, nowMs]);

  const totalBurnPerMin = useMemo(
    () => items.reduce((acc, item) => acc + item.snapshot.burnRatePerMin, 0),
    [items]
  );

  const longestSurvivor = useMemo(() => {
    if (items.length === 0) return null;
    return items.reduce((best, cur) =>
      cur.snapshot.elapsedMs > best.snapshot.elapsedMs ? cur : best
    );
  }, [items]);

  return (
    <section className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-[#120e07] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="font-display flex items-center gap-2 text-xs font-black tracking-wider text-amber-300 uppercase sm:text-sm">
            <Timer className="h-4 w-4 shrink-0 text-amber-400" />
            Borç Dayanıklılık Sayacı
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Canlı bileşik faiz yanma hızı, vade baskısı ve hayatta kalma rozetleri.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <div className="rounded-lg border border-amber-500/35 bg-amber-950/35 px-2.5 py-1.5">
            <span className="text-zinc-400">Faiz Yanışı: </span>
            <strong className="text-amber-300">
              ${totalBurnPerMin.toFixed(2)}/dk
            </strong>
          </div>
          {longestSurvivor && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1.5">
              <span className="text-zinc-400">En Dayanıklı: </span>
              <strong className="text-cyan-200">
                {longestSurvivor.nickname} ({formatDurationCompact(longestSurvivor.snapshot.elapsedMs)})
              </strong>
            </div>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-black/40 p-4 text-center text-xs text-zinc-500">
          Aktif senet yok — yeni borç açıldığında dayanıklılık sayaçları anlık başlar.
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const { snapshot } = item;
            const barColor =
              snapshot.pressurePct >= 80
                ? "bg-red-500"
                : snapshot.pressurePct >= 50
                ? "bg-amber-500"
                : "bg-emerald-500";

            return (
              <div
                key={item.debtId}
                className={`rounded-xl border p-3 transition-colors ${
                  snapshot.isOverdue
                    ? "border-red-500/60 bg-red-950/20"
                    : "border-zinc-800 bg-zinc-900/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-xs font-black text-white uppercase">
                      {item.nickname}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                      Borç:{" "}
                      <strong className="text-zinc-100">
                        ${snapshot.owedUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>{" "}
                      · %{item.interestRatePct}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${getEnduranceBadgeStyle(
                      snapshot.badge
                    )}`}
                  >
                    {snapshot.badge}
                  </span>
                </div>

                {/* Live ticking timers */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg border border-zinc-800/80 bg-black/50 p-2 font-mono text-[11px]">
                  <div>
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Shield className="h-3 w-3 text-cyan-400" />
                      DAYANMA
                    </div>
                    <div className="mt-0.5 font-bold text-cyan-300">
                      {formatDurationCompact(snapshot.elapsedMs)}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      {snapshot.isOverdue ? (
                        <AlertTriangle className="h-3 w-3 text-red-400" />
                      ) : (
                        <Clock className="h-3 w-3 text-amber-400" />
                      )}
                      {snapshot.isOverdue ? "GECİKME" : "VADEYE"}
                    </div>
                    <div
                      className={`mt-0.5 font-bold ${
                        snapshot.isOverdue ? "text-red-400" : "text-amber-300"
                      }`}
                    >
                      {snapshot.isOverdue
                        ? `+${formatDurationCompact(snapshot.overdueMs)}`
                        : formatDurationCompact(snapshot.remainingMs)}
                    </div>
                  </div>
                </div>

                {/* Pressure meter & burn rate */}
                <div className="mt-2.5">
                  <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Flame className="h-3 w-3 text-orange-400" />
                      Baskı %{snapshot.pressurePct} · Borç/Özsermaye{" "}
                      {snapshot.debtToEquityRatio.toFixed(2)}x
                    </span>
                    <span className="font-bold text-amber-300">
                      ${snapshot.burnRatePerMin.toFixed(2)}/dk
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${Math.max(4, snapshot.pressurePct)}%` }}
                    />
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
