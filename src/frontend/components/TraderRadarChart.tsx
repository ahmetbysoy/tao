import React, { useMemo, useState } from "react";
import { Radar } from "lucide-react";
import { TraderRow } from "../utils/supabase";
import { hapticShort } from "../utils/haptics";

interface TraderRadarChartProps {
  traders: TraderRow[];
  openPnlByTrader: Record<string, number>;
}

const AXES = [
  { key: "leverage", label: "Kaldıraç" },
  { key: "winRate", label: "Kazanma %" },
  { key: "pnl", label: "Canlı PnL" },
  { key: "discipline", label: "Disiplin" },
  { key: "survival", label: "Hayatta Kalma" },
] as const;

const TRADER_COLORS: Record<string, string> = {
  selo: "#fb7185",
  mehmet: "#fbbf24",
  nuri: "#22d3ee",
  kemal: "#34d399",
  sevil: "#c084fc",
};

/**
 * Faz 4: Live 5-Axis Risk & Performance Spider/Radar Chart comparing all 5 neighborhood traders.
 */
export const TraderRadarChart: React.FC<TraderRadarChartProps> = ({
  traders,
  openPnlByTrader,
}) => {
  const [focusedId, setFocusedId] = useState<string | "all">("all");

  const profiles = useMemo(() => {
    return traders.map((t) => {
      const wins = Number(t.win_count ?? 0);
      const losses = Number(t.loss_count ?? 0);
      const total = wins + losses;
      const winRate = total > 0 ? (wins / total) * 100 : 50;
      const levScore = Math.min(100, (Number(t.max_leverage ?? 10) / 75) * 100);
      const totalPnl = Number(t.realized_pnl ?? 0) + (openPnlByTrader[t.id] ?? 0);
      const pnlScore = Math.max(5, Math.min(100, 50 + totalPnl / 15));
      const liqs = Number(t.liquidation_count ?? 0);
      const survivalScore = Math.max(10, Math.min(100, 100 - liqs * 24));
      const disciplineScore = Math.max(
        10,
        Math.min(100, 100 - levScore * 0.55 - liqs * 14 + (t.fear_trades_remaining > 0 ? -10 : 5))
      );

      return {
        id: t.id,
        nickname: t.nickname,
        color: TRADER_COLORS[t.id] ?? "#a1a1aa",
        values: [levScore, winRate, pnlScore, disciplineScore, survivalScore],
        raw: {
          leverage: Number(t.max_leverage ?? 10),
          winRate: Math.round(winRate),
          totalPnl,
          discipline: Math.round(disciplineScore),
          survival: Math.round(survivalScore),
        },
      };
    });
  }, [traders, openPnlByTrader]);

  const cx = 175;
  const cy = 152;
  const maxR = 104;

  const pointAt = (axisIdx: number, score0to100: number) => {
    const angle = -Math.PI / 2 + (axisIdx * Math.PI * 2) / AXES.length;
    const r = (Math.max(8, Math.min(100, score0to100)) / 100) * maxR;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  };

  return (
    <section className="rounded-2xl border border-violet-500/35 bg-gradient-to-br from-[#100918] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-violet-300 uppercase sm:text-base">
            <Radar className="h-4 w-4 text-violet-400" />
            Canlı Risk &amp; Performans Radar Grafiği
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            5 trader&apos;ın Kaldıraç, Kazanma %, Canlı PnL, Disiplin ve Hayatta Kalma beşgen karşılaştırması.
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => {
              hapticShort();
              setFocusedId("all");
            }}
            className={`min-h-[38px] cursor-pointer rounded-lg border px-2.5 font-mono text-[10px] font-black uppercase transition ${
              focusedId === "all"
                ? "border-violet-400 bg-violet-500/20 text-violet-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400"
            }`}
          >
            Tümü
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                hapticShort();
                setFocusedId(p.id);
              }}
              className={`min-h-[38px] cursor-pointer rounded-lg border px-2 font-mono text-[10px] font-bold transition ${
                focusedId === p.id
                  ? "border-white/70 bg-zinc-800 text-white"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {p.nickname.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid items-center gap-4 md:grid-cols-12">
        {/* 5-Axis Spider SVG */}
        <div className="flex justify-center md:col-span-6">
          <svg
            viewBox="0 0 350 300"
            className="h-[250px] w-full max-w-[340px] select-none"
            role="img"
            aria-label="5 trader canlı performans radar grafiği"
          >
            {/* Concentric pentagons */}
            {[25, 50, 75, 100].map((lvl) => {
              const pts = AXES.map((_, i) => {
                const p = pointAt(i, lvl);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              }).join(" ");
              return (
                <polygon
                  key={lvl}
                  points={pts}
                  fill="none"
                  stroke="#27272a"
                  strokeDasharray={lvl === 100 ? undefined : "3 3"}
                />
              );
            })}

            {/* Axis spokes & labels */}
            {AXES.map((ax, i) => {
              const tip = pointAt(i, 100);
              const lbl = pointAt(i, 122);
              return (
                <g key={ax.key}>
                  <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="#27272a" />
                  <text
                    x={lbl.x}
                    y={lbl.y + 3}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {ax.label}
                  </text>
                </g>
              );
            })}

            {/* Trader Radar Polygons */}
            {profiles.map((p) => {
              const hidden = focusedId !== "all" && focusedId !== p.id;
              const pts = p.values
                .map((v, i) => {
                  const pt = pointAt(i, v);
                  return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                })
                .join(" ");
              return (
                <polygon
                  key={p.id}
                  points={pts}
                  fill={p.color}
                  fillOpacity={hidden ? 0.03 : focusedId === p.id ? 0.34 : 0.14}
                  stroke={p.color}
                  strokeOpacity={hidden ? 0.14 : 0.95}
                  strokeWidth={focusedId === p.id ? 2.6 : 1.7}
                />
              );
            })}
          </svg>
        </div>

        {/* Live Metric Comparison Strips */}
        <div className="space-y-2 md:col-span-6">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                hapticShort();
                setFocusedId((prev) => (prev === p.id ? "all" : p.id));
              }}
              className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-left font-mono text-xs transition ${
                focusedId === p.id
                  ? "border-violet-400/70 bg-violet-950/35"
                  : "border-zinc-800/90 bg-black/55 hover:bg-zinc-900/70"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <img
                  src={`/avatars/${p.id}.webp`}
                  alt={p.nickname}
                  className="h-8 w-8 rounded-full border object-cover"
                  style={{ borderColor: p.color }}
                />
                <div>
                  <div className="font-black text-white">{p.nickname}</div>
                  <div className="text-[10px] text-zinc-400">
                    {p.raw.leverage}x · Win %{p.raw.winRate} · Disiplin {p.raw.discipline}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-black ${
                    p.raw.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {p.raw.totalPnl >= 0 ? "+" : ""}${p.raw.totalPnl.toFixed(1)}
                </div>
                <div className="text-[10px] text-zinc-500">Sağlık %{p.raw.survival}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
