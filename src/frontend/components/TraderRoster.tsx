import React from "react";
import {
  BadgePlus,
  Flame,
  Gauge,
  ShieldAlert,
  Skull,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { DebtRow, TraderRow } from "../utils/supabase";
import { TraderVoiceId } from "../utils/tts";

interface TraderRosterProps {
  traders: TraderRow[];
  debts: DebtRow[];
  openPnlByTrader: Record<string, number>;
  openCountByTrader: Record<string, number>;
  onOpenLoanFor: (traderId: TraderVoiceId) => void;
  onSendEnforcerTo: (traderId: TraderVoiceId, nickname: string) => void;
  onTriggerTradeFor: (traderId: TraderVoiceId, nickname: string) => void;
}

const MOOD_STYLE: Record<
  string,
  { label: string; badge: string; ring: string }
> = {
  focused: {
    label: "ODAKLI",
    badge: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
    ring: "border-zinc-800",
  },
  greedy: {
    label: "AÇGÖZLÜ",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    ring: "border-emerald-500/35",
  },
  panicked: {
    label: "PANİKTE",
    badge: "border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-300 animate-pulse",
    ring: "border-fuchsia-500/45 shadow-[0_0_20px_rgba(217,70,239,0.16)]",
  },
  busted: {
    label: "BATIK",
    badge: "border-red-500/60 bg-red-600/25 text-red-300",
    ring: "border-red-600/50 bg-red-950/15",
  },
};

const AVATAR_ACCENT: Record<string, string> = {
  selo: "from-rose-500 to-orange-500",
  mehmet: "from-amber-400 to-red-500",
  kemal: "from-emerald-400 to-teal-600",
  nuri: "from-cyan-400 to-blue-600",
  sevil: "from-violet-400 to-fuchsia-600",
};

export const TraderRoster: React.FC<TraderRosterProps> = ({
  traders,
  debts,
  openPnlByTrader,
  openCountByTrader,
  onOpenLoanFor,
  onSendEnforcerTo,
  onTriggerTradeFor,
}) => {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-zinc-100 uppercase">
          <Users className="h-4 w-4 text-amber-400" />
          Mahalle Trader Kartları (5 Canlı Bot)
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          Korku modu aktifken kaldıraç otomatik yarıya iner
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {traders.map((t) => {
          const moodCfg = MOOD_STYLE[t.mood] ?? MOOD_STYLE.focused;
          const activeDebt = debts
            .filter(
              (d) =>
                d.trader_id === t.id &&
                (d.status === "aktif" || d.status === "gecikti")
            )
            .reduce((acc, d) => acc + Math.max(0, d.principal - d.total_repaid), 0);

          const livePnl = openPnlByTrader[t.id] ?? 0;
          const openCount = openCountByTrader[t.id] ?? 0;
          const totalTrades = t.win_count + t.loss_count;
          const winRate =
            totalTrades > 0 ? Math.round((t.win_count / totalTrades) * 100) : 0;
          const initials = t.nickname
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={t.id}
              className={`flex flex-col justify-between rounded-xl border bg-zinc-950/90 p-3.5 transition-all hover:border-zinc-700 ${moodCfg.ring}`}
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-display text-xs font-black text-black shadow ${
                        AVATAR_ACCENT[t.id] ?? "from-zinc-400 to-zinc-600"
                      }`}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-display text-sm font-bold text-white">
                        {t.nickname}
                      </div>
                      <div className="truncate text-[10px] text-zinc-500">
                        {t.archetype}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase ${moodCfg.badge}`}
                  >
                    {moodCfg.label}
                  </span>
                </div>

                {/* Fear Mode Banner */}
                {t.fear_trades_remaining > 0 && (
                  <div className="mt-2.5 flex items-center justify-between rounded-md border border-fuchsia-500/40 bg-fuchsia-950/50 px-2 py-1 text-[10px] font-bold text-fuchsia-200">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3 text-fuchsia-400" />
                      KORKU MODU
                    </span>
                    <span className="font-mono">
                      {t.fear_trades_remaining} işlem 1/2x
                    </span>
                  </div>
                )}

                {/* Key Numbers */}
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-zinc-900 bg-black/50 p-2.5 font-mono">
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Bakiye</div>
                    <div className="text-sm font-black text-white">
                      ${t.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">Borç</div>
                    <div className="text-sm font-black text-amber-400">
                      ${activeDebt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">
                      Realized PnL
                    </div>
                    <div
                      className={`text-xs font-bold ${
                        t.realized_pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.realized_pnl >= 0 ? "+" : ""}
                      ${t.realized_pnl.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase">
                      Kaldıraç / Açık
                    </div>
                    <div className="flex items-center gap-1 text-xs font-bold text-zinc-200">
                      <Gauge className="h-3 w-3 text-amber-400" />
                      {t.max_leverage}x
                      {openCount > 0 && (
                        <span
                          className={`ml-1 rounded px-1 text-[9px] ${
                            livePnl >= 0
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {livePnl >= 0 ? "+" : ""}
                          {livePnl.toFixed(0)}$
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* W / L / Liq Micro Bar */}
                <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-zinc-400">
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Sparkles className="h-3 w-3" /> {t.win_count}W
                  </span>
                  <span className="text-zinc-500">{t.loss_count}L</span>
                  <span className="inline-flex items-center gap-0.5 text-red-400">
                    <Skull className="h-3 w-3" /> {t.liquidation_count}
                  </span>
                  <span className="text-zinc-500">WR %{winRate}</span>
                </div>

                {/* Last Signal Log */}
                <div
                  title={t.last_signal}
                  className="mt-2 truncate rounded border border-zinc-900 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400"
                >
                  <Flame className="mr-1 inline h-3 w-3 text-orange-400" />
                  {t.last_signal || "Sinyal bekleniyor..."}
                </div>
              </div>

              {/* Per-trader quick action buttons */}
              <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-zinc-900 pt-2.5">
                <button
                  onClick={() => onOpenLoanFor(t.id)}
                  className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 py-1 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500/20"
                  title="Bu trader'a yeni borç ver"
                >
                  <BadgePlus className="h-3 w-3" /> Borç
                </button>
                <button
                  onClick={() => onSendEnforcerTo(t.id, t.nickname)}
                  className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-fuchsia-500/35 bg-fuchsia-500/10 py-1 text-[10px] font-bold text-fuchsia-300 transition hover:bg-fuchsia-500/20"
                  title="Çırağı gönder (Korku modu)"
                >
                  <ShieldAlert className="h-3 w-3" /> Çırak
                </button>
                <button
                  onClick={() => onTriggerTradeFor(t.id, t.nickname)}
                  className="inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-red-500/35 bg-red-500/10 py-1 text-[10px] font-bold text-red-300 transition hover:bg-red-500/20"
                  title="Canlı fiyattan hemen pozisyon açtır"
                >
                  <Zap className="h-3 w-3" /> Kışkırt
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
