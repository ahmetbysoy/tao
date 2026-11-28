import React, { useMemo } from "react";
import { Flag, Gauge, Trophy } from "lucide-react";
import { TraderRow } from "../utils/supabase";
import { getTraderAvatarSrc, isTraderInFearVisualState } from "../utils/avatars";

interface TraderRacetrackGaugeProps {
  traders: TraderRow[];
  openPnlByTrader: Record<string, number>;
  lockedMarginByTrader: Record<string, number>;
}

const LANE_COLORS: Record<string, { bar: string; glow: string; text: string }> = {
  selo: {
    bar: "from-rose-600 via-orange-500 to-amber-400",
    glow: "rgba(251,113,133,0.55)",
    text: "text-rose-300",
  },
  mehmet: {
    bar: "from-amber-600 via-yellow-400 to-amber-200",
    glow: "rgba(251,191,36,0.55)",
    text: "text-amber-300",
  },
  nuri: {
    bar: "from-cyan-600 via-sky-400 to-cyan-200",
    glow: "rgba(34,211,238,0.55)",
    text: "text-cyan-300",
  },
  kemal: {
    bar: "from-emerald-600 via-teal-400 to-emerald-200",
    glow: "rgba(52,211,153,0.55)",
    text: "text-emerald-300",
  },
  sevil: {
    bar: "from-violet-600 via-fuchsia-500 to-pink-300",
    glow: "rgba(192,132,252,0.55)",
    text: "text-violet-300",
  },
};

const START_EQUITY = 1000;

/**
 * Visual Revolution V2 (TODO #4.2): Canlı Trader Yarış Pisti (Racetrack Equity Gauge).
 * Ranks all 5 algorithmic traders live by Total Equity (balance + locked margin + unrealized PnL)
 * along a neon cyberpunk racetrack with dynamic normal/fear avatars & ROI telemetry.
 */
export const TraderRacetrackGauge: React.FC<TraderRacetrackGaugeProps> = ({
  traders,
  openPnlByTrader,
  lockedMarginByTrader,
}) => {
  const racers = useMemo(() => {
    const computed = traders.map((t) => {
      const openPnl = Number(openPnlByTrader[t.id] ?? 0);
      const locked = Number(lockedMarginByTrader[t.id] ?? 0);
      const totalEquity = Math.max(0, Number(t.balance ?? 0) + locked + openPnl);
      const roiPct = ((totalEquity - START_EQUITY) / START_EQUITY) * 100;
      const isFear = isTraderInFearVisualState(t);
      return {
        trader: t,
        totalEquity,
        openPnl,
        roiPct,
        isFear,
      };
    });

    computed.sort((a, b) => b.totalEquity - a.totalEquity);
    const maxScale = Math.max(1600, ...(computed.map((r) => r.totalEquity * 1.12)));
    const leaderEquity = computed[0]?.totalEquity ?? START_EQUITY;

    return {
      rows: computed.map((r, idx) => ({
        ...r,
        rank: idx + 1,
        progressPct: Math.max(4, Math.min(96, (r.totalEquity / maxScale) * 100)),
        gapFromLeader: r.totalEquity - leaderEquity,
      })),
      maxScale,
      startLinePct: Math.min(90, (START_EQUITY / maxScale) * 100),
    };
  }, [traders, openPnlByTrader, lockedMarginByTrader]);

  return (
    <section className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-[#0e0c18] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-amber-300 uppercase sm:text-base">
            <Flag className="h-4 w-4 text-amber-400" />
            Canlı Trader Yarış Pisti · Racetrack Equity Gauge
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            5 trader&apos;ın canlı toplam özkaynak (Bakiye + Teminat + Açık PnL) ve liderlik farkı yarışı.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="rounded-md border border-red-500/35 bg-red-950/35 px-2 py-1 text-red-300">
            &lt;$300 Batış
          </span>
          <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-300">
            $1,000 Start
          </span>
          <span className="rounded-md border border-emerald-500/35 bg-emerald-950/35 px-2 py-1 text-emerald-300">
            Hedef ${Math.round(racers.maxScale).toLocaleString("en-US")}
          </span>
        </div>
      </div>

      {/* Neon Racetrack Lanes */}
      <div className="relative mt-3.5 space-y-2.5 rounded-xl border border-zinc-800/90 bg-black/70 p-3">
        {/* Vertical $1,000 Start Line Marker */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 z-0 border-l border-dashed border-amber-400/35"
          style={{ left: `calc(${racers.startLinePct}% * 0.72 + 12px)` }}
        />

        {racers.rows.map((r) => {
          const lane = LANE_COLORS[r.trader.id] ?? LANE_COLORS.selo;
          const avatarSrc = getTraderAvatarSrc(r.trader.id, r.isFear);

          return (
            <div key={r.trader.id} className="relative z-10 space-y-1">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-black ${
                      r.rank === 1
                        ? "bg-amber-400 text-black"
                        : r.rank === 2
                        ? "bg-zinc-300 text-black"
                        : r.rank === 3
                        ? "bg-amber-700 text-amber-100"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {r.rank === 1 ? <Trophy className="h-3 w-3" /> : `#${r.rank}`}
                  </span>
                  <span className={`truncate font-black ${lane.text}`}>
                    {r.trader.nickname}
                  </span>
                  <span className="hidden items-center gap-0.5 text-[10px] text-zinc-500 sm:inline-flex">
                    <Gauge className="h-3 w-3" />
                    {r.trader.max_leverage}x
                  </span>
                  {r.isFear && (
                    <span className="rounded bg-yellow-400/20 px-1 py-0.5 text-[9px] font-black text-yellow-300">
                      KORKU
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`text-[10px] font-bold ${
                      r.openPnl > 0
                        ? "text-emerald-400"
                        : r.openPnl < 0
                        ? "text-red-400"
                        : "text-zinc-500"
                    }`}
                  >
                    {r.openPnl !== 0
                      ? `Açık ${r.openPnl > 0 ? "+" : ""}$${r.openPnl.toFixed(1)}`
                      : "Beklemede"}
                  </span>
                  <span className="font-black text-white">
                    ${r.totalEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                  <span
                    className={`w-14 text-right text-[10px] font-bold ${
                      r.roiPct >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {r.roiPct >= 0 ? "+" : ""}
                    {r.roiPct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Track Bar + Moving Cyberpunk Avatar Pod */}
              <div className="relative h-8 w-full overflow-hidden rounded-full border border-zinc-800/90 bg-zinc-950/90">
                {/* Danger Zone shading on far left */}
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-[18%] bg-gradient-to-r from-red-950/55 to-transparent"
                />

                {/* Neon Thruster Trail */}
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${lane.bar} opacity-85 transition-all duration-500 ease-out`}
                  style={{
                    width: `${r.progressPct}%`,
                    boxShadow: `0 0 18px ${lane.glow}`,
                  }}
                />

                {/* Avatar Pod Riding the Tip */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500 ease-out"
                  style={{ left: `max(18px, calc(${r.progressPct}% - 4px))` }}
                >
                  <img
                    src={avatarSrc}
                    alt={r.trader.nickname}
                    className={`h-7 w-7 rounded-full border-2 object-cover shadow-lg ${
                      r.isFear ? "border-yellow-400" : "border-white"
                    }`}
                  />
                </div>

                {/* Gap readout on right end of lane */}
                {r.rank > 1 && (
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[9px] font-bold text-zinc-500">
                    {r.gapFromLeader.toFixed(0)}$ geride
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
