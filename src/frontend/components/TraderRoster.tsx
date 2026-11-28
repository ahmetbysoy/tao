import React, { useRef, useState } from "react";
import {
  BadgePlus,
  Banknote,
  ChevronRight,
  Flame,
  Gauge,
  ShieldAlert,
  Skull,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { hapticMedium, hapticShort } from "../utils/haptics";
import { DebtRow, TraderRow } from "../utils/supabase";
import { TraderVoiceId } from "../utils/tts";

interface TraderRosterProps {
  traders: TraderRow[];
  debts: DebtRow[];
  openPnlByTrader: Record<string, number>;
  openCountByTrader: Record<string, number>;
  flashingTraderIds: Record<string, number>;
  onOpenLoanFor: (traderId: TraderVoiceId) => void;
  onSendEnforcerTo: (traderId: TraderVoiceId, nickname: string) => void;
  onTriggerTradeFor: (traderId: TraderVoiceId, nickname: string) => void;
  onCollectFromTrader: (trader: TraderRow, debt: DebtRow) => void;
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
  selo: "from-rose-500 to-orange-500 border-rose-400/70",
  mehmet: "from-amber-400 to-red-500 border-amber-400/70",
  kemal: "from-emerald-400 to-teal-600 border-emerald-400/70",
  nuri: "from-cyan-400 to-blue-600 border-cyan-400/70",
  sevil: "from-violet-400 to-fuchsia-600 border-violet-400/70",
};

const TRADER_FX_META: Record<
  string,
  { badge: string; cardFx: string; badgeClass: string }
> = {
  selo: {
    badge: "ROKET ATEŞİ",
    cardFx: "fx-rocket-flame",
    badgeClass: "border-rose-500/40 bg-rose-950/50 text-rose-300",
  },
  mehmet: {
    badge: "FİTİL RADARI",
    cardFx: "",
    badgeClass: "border-amber-500/40 bg-amber-950/50 text-amber-300",
  },
  kemal: {
    badge: "X-RAY TAHTA",
    cardFx: "",
    badgeClass: "border-emerald-500/40 bg-emerald-950/50 text-emerald-300",
  },
  nuri: {
    badge: "FONLAMA NABZI",
    cardFx: "",
    badgeClass: "border-cyan-500/40 bg-cyan-950/50 text-cyan-300",
  },
  sevil: {
    badge: "BOLLINGER AURA",
    cardFx: "fx-bollinger-aura",
    badgeClass: "border-violet-500/40 bg-violet-950/50 text-violet-300",
  },
};

const SWIPE_COLLECT_THRESHOLD_PX = 84;
const MAX_SWIPE_PX = 128;

interface SwipeableTraderCardProps {
  trader: TraderRow;
  activeDebtObj: DebtRow | undefined;
  activeDebtAmount: number;
  livePnl: number;
  openCount: number;
  flashNonce: number | undefined;
  onOpenLoanFor: (traderId: TraderVoiceId) => void;
  onSendEnforcerTo: (traderId: TraderVoiceId, nickname: string) => void;
  onTriggerTradeFor: (traderId: TraderVoiceId, nickname: string) => void;
  onCollectFromTrader: (trader: TraderRow, debt: DebtRow) => void;
}

const SwipeableTraderCard: React.FC<SwipeableTraderCardProps> = ({
  trader: t,
  activeDebtObj,
  activeDebtAmount,
  livePnl,
  openCount,
  flashNonce,
  onOpenLoanFor,
  onSendEnforcerTo,
  onTriggerTradeFor,
  onCollectFromTrader,
}) => {
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startPosRef = useRef<{ x: number; y: number; active: boolean; lockedHorizontal: boolean }>({
    x: 0,
    y: 0,
    active: false,
    lockedHorizontal: false,
  });

  const canCollect = Boolean(activeDebtObj) && t.balance >= 20 && activeDebtAmount > 1;
  const estCollect = canCollect ? Math.min(t.balance * 0.5, activeDebtAmount) : 0;

  const moodCfg = MOOD_STYLE[t.mood] ?? MOOD_STYLE.focused;
  const fxMeta = TRADER_FX_META[t.id] ?? TRADER_FX_META.selo;
  const totalTrades = t.win_count + t.loss_count;
  const winRate = totalTrades > 0 ? Math.round((t.win_count / totalTrades) * 100) : 0;
  const isFearMode = t.fear_trades_remaining > 0;
  const cardFxClass =
    t.id === "selo" && (openCount > 0 || t.mood === "greedy")
      ? fxMeta.cardFx
      : t.id === "sevil" && t.mood !== "busted"
      ? fxMeta.cardFx
      : "";

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canCollect) return;
    if ((e.target as HTMLElement).closest("button")) return;
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      active: true,
      lockedHorizontal: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = startPosRef.current;
    if (!st.active) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;

    if (!st.lockedHorizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        st.active = false;
        setSwiping(false);
        setSwipeX(0);
        return;
      }
      if (dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        st.lockedHorizontal = true;
        setSwiping(true);
      } else {
        return;
      }
    }

    const clamped = Math.max(0, Math.min(MAX_SWIPE_PX, dx));
    setSwipeX(clamped);
  };

  const finishSwipe = () => {
    const st = startPosRef.current;
    if (!st.active) return;
    st.active = false;
    setSwiping(false);

    if (swipeX >= SWIPE_COLLECT_THRESHOLD_PX && activeDebtObj && canCollect) {
      hapticMedium();
      onCollectFromTrader(t, activeDebtObj);
    }
    setSwipeX(0);
  };

  const readyToCollect = swipeX >= SWIPE_COLLECT_THRESHOLD_PX;

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Swipe-Right Underlying Emerald Collection Rail */}
      {canCollect && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-start rounded-xl px-4 transition-colors ${
            readyToCollect
              ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-black"
              : "bg-emerald-950/90 text-emerald-300"
          }`}
        >
          <div className="flex items-center gap-2 font-display text-xs font-black tracking-wider uppercase">
            <Banknote className="h-5 w-5" />
            <div>
              <div>{readyToCollect ? "BIRAK · TAHSİL ET!" : "TAHSİL ET"}</div>
              <div className="font-mono text-[10px] opacity-85">
                ~${estCollect.toFixed(0)} çek
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Foreground Card */}
      <div
        key={flashNonce ? `${t.id}-${flashNonce}` : t.id}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
        onPointerLeave={swiping ? finishSwipe : undefined}
        style={{
          transform: `translate3d(${swipeX}px, 0, 0)`,
          transition: swiping ? "none" : "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className={`relative flex flex-col justify-between overflow-hidden rounded-xl border bg-zinc-950 p-3.5 touch-pan-y select-none ${
          moodCfg.ring
        } ${cardFxClass} ${flashNonce ? "trader-liq-flash" : ""}`}
      >
        {/* Tahta Kemal X-Ray Scan Beam */}
        {t.id === "kemal" && (
          <div
            aria-hidden="true"
            className="fx-xray-scan pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-400/12 to-transparent"
          />
        )}

        {/* Fear Mode Yellow/Black Hazard Tape Top Edge */}
        {isFearMode && (
          <div
            aria-hidden="true"
            className="hazard-tape-banner absolute inset-x-0 top-0 h-1.5"
          />
        )}

        <div>
          {/* Header row with Cyberpunk WebP Avatar */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border-2 bg-gradient-to-br shadow-lg ${
                  AVATAR_ACCENT[t.id] ?? "from-zinc-400 to-zinc-600 border-zinc-500"
                }`}
              >
                <img
                  src={`/avatars/${t.id}.webp`}
                  alt={t.nickname}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {openCount > 0 && (
                  <span className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full border border-black bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-bold text-white">
                  {t.nickname}
                </div>
                <div className="truncate text-[10px] text-zinc-400">
                  {t.archetype}
                </div>
                <span
                  className={`mt-0.5 inline-block rounded border px-1 py-0.2 font-mono text-[8px] font-black uppercase ${fxMeta.badgeClass}`}
                >
                  {fxMeta.badge}
                </span>
              </div>
            </div>
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase ${moodCfg.badge}`}
            >
              {moodCfg.label}
            </span>
          </div>

          {/* Swipe hint pill on mobile */}
          {canCollect && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-500/20 bg-emerald-950/20 px-2 py-1 font-mono text-[10px] text-emerald-300/90">
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="h-3 w-3 animate-pulse" />
                Sağa kaydır: TAHSİL ET
              </span>
              <span className="font-bold">~${estCollect.toFixed(0)}</span>
            </div>
          )}

          {/* Fear Mode Hazard Banner */}
          {isFearMode && (
            <div className="mt-2 overflow-hidden rounded-md border border-yellow-400/60 bg-zinc-950">
              <div className="hazard-tape-banner h-1.5 w-full" />
              <div className="flex items-center justify-between bg-amber-950/55 px-2 py-1 text-[10px] font-black text-yellow-200">
                <span className="inline-flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 animate-pulse text-yellow-400" />
                  ÇIRAK KAPIDA · KORKU MODU
                </span>
                <span className="font-mono">
                  {t.fear_trades_remaining} işlem 1/2x
                </span>
              </div>
            </div>
          )}

          {/* Key Numbers */}
          <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg border border-zinc-900 bg-black/50 p-2.5 font-mono">
            <div>
              <div className="text-[9px] text-zinc-500 uppercase">Bakiye</div>
              <div className="text-sm font-black text-white">
                ${t.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-zinc-500 uppercase">Borç</div>
              <div className="text-sm font-black text-amber-400">
                ${activeDebtAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
                {t.realized_pnl >= 0 ? "+" : ""}${t.realized_pnl.toFixed(1)}
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
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-zinc-400">
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

        {/* Per-trader quick action buttons (ALL >= 44px touch targets) */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-zinc-900 pt-2.5 sm:grid-cols-4 xl:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onOpenLoanFor(t.id);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 text-[11px] font-bold text-amber-300 transition hover:bg-amber-500/20 active:scale-95"
            title="Bu trader'a yeni borç ver"
          >
            <BadgePlus className="h-3.5 w-3.5" /> Borç
          </button>
          <button
            type="button"
            onClick={() => {
              hapticMedium();
              onSendEnforcerTo(t.id, t.nickname);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/10 px-2 text-[11px] font-bold text-fuchsia-300 transition hover:bg-fuchsia-500/20 active:scale-95"
            title="Çırağı gönder (Korku modu)"
          >
            <ShieldAlert className="h-3.5 w-3.5" /> Çırak
          </button>
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onTriggerTradeFor(t.id, t.nickname);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-red-500/35 bg-red-500/10 px-2 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 active:scale-95"
            title="Canlı emir defteri dengesiyle pozisyon açtır"
          >
            <Zap className="h-3.5 w-3.5" /> Kışkırt
          </button>
          <button
            type="button"
            disabled={!canCollect}
            onClick={() => {
              if (!activeDebtObj || !canCollect) return;
              hapticMedium();
              onCollectFromTrader(t, activeDebtObj);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            title="Kasadan tahsilat yap (Mobilde sağa da kaydırabilirsin)"
          >
            <Banknote className="h-3.5 w-3.5" /> Tahsil
          </button>
        </div>
      </div>
    </div>
  );
};

export const TraderRoster: React.FC<TraderRosterProps> = ({
  traders,
  debts,
  openPnlByTrader,
  openCountByTrader,
  flashingTraderIds,
  onOpenLoanFor,
  onSendEnforcerTo,
  onTriggerTradeFor,
  onCollectFromTrader,
}) => {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-zinc-100 uppercase">
          <Users className="h-4 w-4 text-amber-400" />
          Mahalle Trader Kartları (5 Canlı Bot)
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          Kartı sağa kaydırarak TAHSİL ET · Korku modunda kaldıraç 1/2
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {traders.map((t) => {
          const traderDebts = debts.filter(
            (d) =>
              d.trader_id === t.id &&
              (d.status === "aktif" || d.status === "gecikti")
          );
          const activeDebtAmount = traderDebts.reduce(
            (acc, d) => acc + Math.max(0, d.principal - d.total_repaid),
            0
          );
          return (
            <SwipeableTraderCard
              key={t.id}
              trader={t}
              activeDebtObj={traderDebts[0]}
              activeDebtAmount={activeDebtAmount}
              livePnl={openPnlByTrader[t.id] ?? 0}
              openCount={openCountByTrader[t.id] ?? 0}
              flashNonce={flashingTraderIds[t.id]}
              onOpenLoanFor={onOpenLoanFor}
              onSendEnforcerTo={onSendEnforcerTo}
              onTriggerTradeFor={onTriggerTradeFor}
              onCollectFromTrader={onCollectFromTrader}
            />
          );
        })}
      </div>
    </section>
  );
};
