import React, { useMemo } from "react";
import { Banknote, Flame, ShieldAlert, Skull, UserX } from "lucide-react";
import { DebtRow, TraderRow } from "../utils/supabase";
import { computeDebtEndurance } from "../utils/debtEndurance";
import { getTraderAvatarSrc, isTraderInFearVisualState } from "../utils/avatars";
import { hapticMedium, hapticShort } from "../utils/haptics";

interface WantedLedgerCardsProps {
  traders: TraderRow[];
  debts: DebtRow[];
  openPnlByTrader: Record<string, number>;
  onDoubleInterest: (debtId: string, traderId: string, nickname: string) => void;
  onSendEnforcer: (debtId: string, traderId: string, nickname: string) => void;
  onCollectDebt: (trader: TraderRow, debt: DebtRow) => void;
}

/**
 * Visual Revolution V2 (TODO #3.2): Retro Cyberpunk "ARANIYOR // WANTED" İntikam Defteri Poster Cards.
 * Converts live active/overdue debtors into holographic cyberpunk bounty posters with dynamic
 * normal/fear avatars, live compounding debt totals, hazard stamps, and 1-tap execution controls.
 */
export const WantedLedgerCards: React.FC<WantedLedgerCardsProps> = ({
  traders,
  debts,
  openPnlByTrader,
  onDoubleInterest,
  onSendEnforcer,
  onCollectDebt,
}) => {
  const posters = useMemo(() => {
    const now = Date.now();
    const traderById = new Map(traders.map((t) => [t.id, t]));

    return debts
      .filter((d) => d.status === "aktif" || d.status === "gecikti")
      .map((debt) => {
        const trader = traderById.get(debt.trader_id);
        const createdAtMs = debt.created_at
          ? Date.parse(debt.created_at) || debt.due_date_ms - 600_000
          : debt.due_date_ms - 600_000;
        const equity = Math.max(
          0,
          Number(trader?.balance ?? 0) + Number(openPnlByTrader[debt.trader_id] ?? 0)
        );
        const endurance = computeDebtEndurance({
          principal: Number(debt.principal),
          totalRepaid: Number(debt.total_repaid ?? 0),
          interestRate: Number(debt.interest_rate ?? 0.08),
          compoundingPeriodS: Number(debt.compounding_period_s ?? 300),
          createdAtMs,
          dueDateMs: Number(debt.due_date_ms),
          nowMs: now,
          traderEquity: equity,
          enforcerCount: Number(debt.enforcer_count ?? 0),
          status: debt.status,
        });
        const isOverdue = debt.status === "gecikti" || now >= debt.due_date_ms;
        const isFear = isTraderInFearVisualState(trader);
        return {
          debt,
          trader,
          endurance,
          isOverdue,
          isFear,
        };
      })
      .sort((a, b) => b.endurance.owedUsdt - a.endurance.owedUsdt);
  }, [traders, debts, openPnlByTrader]);

  if (posters.length === 0) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-zinc-950/90 p-5 text-center">
        <Skull className="mx-auto h-6 w-6 text-amber-400" />
        <h3 className="mt-2 font-display text-sm font-black tracking-wider text-amber-300 uppercase">
          ARANIYOR PANOSU BOŞ
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Şu an aktif veya gecikmiş borç senedi yok. Yeni senet keserek mahallede avı başlatabilirsin.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-red-500/40 bg-gradient-to-br from-[#16080a] via-zinc-950 to-zinc-950 p-3.5 shadow-2xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-red-300 uppercase sm:text-base">
            <Skull className="h-4 w-4 text-red-400" />
            İntikam Defteri · Siberpunk &ldquo;ARANIYOR // WANTED&rdquo; Posterleri
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Aktif ve gecikmiş borçlular canlı bileşik faiz ödülüyle afişe edilir; Çırak devredeyken portreler korku moduna geçer.
          </p>
        </div>
        <span className="rounded-lg border border-red-500/40 bg-red-950/50 px-2.5 py-1 font-mono text-xs font-black text-red-200">
          {posters.length} AKTİF HEDEF
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {posters.map(({ debt, trader, endurance, isOverdue, isFear }) => {
          const nickname = trader?.nickname ?? debt.trader_id.toUpperCase();
          const avatarSrc = getTraderAvatarSrc(debt.trader_id, isFear || isOverdue);
          const canCollect = Boolean(trader && trader.balance >= 20 && endurance.owedUsdt > 1);
          const interestPct = Math.round(Number(debt.interest_rate ?? 0.08) * 100);

          return (
            <article
              key={debt.id}
              className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-b from-[#1a0d0f] via-zinc-950 to-black p-3 shadow-xl transition ${
                isOverdue
                  ? "border-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.22)]"
                  : isFear
                  ? "border-yellow-400/75 shadow-[0_0_20px_rgba(250,204,21,0.18)]"
                  : "border-amber-500/50"
              }`}
            >
              {/* Top Retro Poster Header Ribbon */}
              <div
                className={`-mx-3 -mt-3 mb-2.5 flex items-center justify-between px-3 py-1 font-display text-[10px] font-black tracking-[0.22em] uppercase ${
                  isOverdue
                    ? "bg-red-600 text-white"
                    : isFear
                    ? "hazard-tape-banner text-black"
                    : "bg-amber-500/20 text-amber-300"
                }`}
              >
                <span className={isFear && !isOverdue ? "rounded bg-black/85 px-1.5 py-0.5 text-yellow-300" : ""}>
                  {isOverdue ? "ARANIYOR · VADESİ GEÇTİ" : "ARANIYOR // BORÇLU"}
                </span>
                <span className={isFear && !isOverdue ? "rounded bg-black/85 px-1.5 py-0.5 font-mono text-yellow-300" : "font-mono"}>
                  FAİZ %{interestPct}
                </span>
              </div>

              {/* Mugshot + Bounty Block */}
              <div className="flex items-start gap-3">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-amber-400/60 bg-black">
                  <img
                    src={avatarSrc}
                    alt={nickname}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {/* Diagonal Cyber Stamp */}
                  {(isOverdue || isFear) && (
                    <div className="absolute inset-x-0 bottom-0 bg-red-600/90 py-0.5 text-center font-mono text-[8px] font-black tracking-wider text-white uppercase">
                      {isFear ? "KORKU MODU" : "TEMERRÜT"}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm font-black text-white uppercase">
                    {nickname}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                    Anapara ${Number(debt.principal).toFixed(0)} · Bakiye $
                    {Number(trader?.balance ?? 0).toFixed(0)}
                  </div>

                  {/* Bounty Amount */}
                  <div className="mt-1.5 rounded-lg border border-amber-500/35 bg-black/75 px-2 py-1 font-mono">
                    <div className="text-[9px] tracking-wider text-amber-400/80 uppercase">
                      TOPLAM SENET ÖDÜLÜ
                    </div>
                    <div className="text-base font-black text-amber-300">
                      ${endurance.owedUsdt.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Badge & Endurance Bar */}
              <div className="mt-2.5 flex items-center justify-between font-mono text-[10px]">
                <span className="inline-flex items-center gap-1 text-zinc-400">
                  <ShieldAlert className="h-3 w-3 text-amber-400" />
                  Durum: <strong className="text-zinc-200">{endurance.badge}</strong>
                </span>
                <span className="text-red-300">
                  Çırak Baskını: {Number(debt.enforcer_count ?? 0)}x
                </span>
              </div>

              {/* Quick Execution Actions */}
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    hapticMedium();
                    onDoubleInterest(debt.id, debt.trader_id, nickname);
                  }}
                  className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-amber-500/50 bg-amber-500/15 px-1.5 text-[10px] font-black text-amber-200 transition hover:bg-amber-500/25 active:scale-95"
                >
                  <Flame className="h-3 w-3 text-amber-400" />
                  2x Faiz
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hapticMedium();
                    onSendEnforcer(debt.id, debt.trader_id, nickname);
                  }}
                  className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-fuchsia-500/50 bg-fuchsia-600/20 px-1.5 text-[10px] font-black text-fuchsia-200 transition hover:bg-fuchsia-600/35 active:scale-95"
                >
                  <UserX className="h-3 w-3 text-fuchsia-300" />
                  Çırak
                </button>
                <button
                  type="button"
                  disabled={!canCollect}
                  onClick={() => {
                    if (!trader) return;
                    hapticShort();
                    onCollectDebt(trader, debt);
                  }}
                  className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-1.5 text-[10px] font-black text-emerald-200 transition hover:bg-emerald-600/35 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Banknote className="h-3 w-3 text-emerald-300" />
                  Tahsil
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
