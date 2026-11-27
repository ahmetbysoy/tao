import React, { useMemo, useState } from "react";
import { LineChart, Sparkles } from "lucide-react";
import { EquitySnapshotRow } from "../utils/supabase";

type ChartMetric = "trader_equity" | "unrealized_pnl" | "tefeci_profit" | "debt_owed";

interface LiveEquityChartProps {
  snapshots: EquitySnapshotRow[];
  livePoint: {
    tefeci_profit: number;
    total_debt_owed: number;
    total_trader_equity: number;
    total_unrealized_pnl: number;
  };
}

const METRIC_META: Record<
  ChartMetric,
  { label: string; color: string; fillId: string; stroke: string; prefix: string }
> = {
  trader_equity: {
    label: "Mahalle Özsermayesi",
    color: "text-emerald-400",
    fillId: "grad-emerald",
    stroke: "#10b981",
    prefix: "$",
  },
  unrealized_pnl: {
    label: "Canlı PnL Eğrisi",
    color: "text-cyan-400",
    fillId: "grad-cyan",
    stroke: "#22d3ee",
    prefix: "$",
  },
  tefeci_profit: {
    label: "Tefeci Kârı",
    color: "text-amber-400",
    fillId: "grad-amber",
    stroke: "#f59e0b",
    prefix: "+$",
  },
  debt_owed: {
    label: "Toplam Borç Yükü",
    color: "text-rose-400",
    fillId: "grad-rose",
    stroke: "#f43f5e",
    prefix: "$",
  },
};

export const LiveEquityChart: React.FC<LiveEquityChartProps> = ({
  snapshots,
  livePoint,
}) => {
  const [metric, setMetric] = useState<ChartMetric>("trader_equity");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(() => {
    const ordered = [...snapshots]
      .sort((a, b) => a.ts_ms - b.ts_ms)
      .slice(-80);

    const points = ordered.map((row) => ({
      ts: row.ts_ms,
      trader_equity: Number(row.total_trader_equity ?? 0),
      unrealized_pnl: Number(row.total_unrealized_pnl ?? 0),
      tefeci_profit: Number(row.tefeci_profit ?? 0),
      debt_owed: Number(row.total_debt_owed ?? 0),
    }));

    // Always append real-time millisecond tail point so chart breathes live
    points.push({
      ts: Date.now(),
      trader_equity: livePoint.total_trader_equity,
      unrealized_pnl: livePoint.total_unrealized_pnl,
      tefeci_profit: livePoint.tefeci_profit,
      debt_owed: livePoint.total_debt_owed,
    });

    if (points.length === 1) {
      points.unshift({ ...points[0], ts: points[0].ts - 5000 });
    }
    return points;
  }, [snapshots, livePoint]);

  const width = 760;
  const height = 210;
  const padX = 14;
  const padY = 18;

  const values = series.map((p) => p[metric]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(1, rawMax - rawMin);
  const minVal = rawMin - span * 0.12;
  const maxVal = rawMax + span * 0.12;

  const coords = series.map((p, idx) => {
    const x = padX + (idx / Math.max(1, series.length - 1)) * (width - padX * 2);
    const norm = (p[metric] - minVal) / Math.max(0.0001, maxVal - minVal);
    const y = height - padY - norm * (height - padY * 2);
    return { x, y, val: p[metric], ts: p.ts };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(
    height - padY
  ).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - padY).toFixed(1)} Z`;

  const zeroY =
    minVal < 0 && maxVal > 0
      ? height - padY - ((0 - minVal) / (maxVal - minVal)) * (height - padY * 2)
      : null;

  const meta = METRIC_META[metric];
  const activeCoord =
    hoverIndex !== null && coords[hoverIndex]
      ? coords[hoverIndex]
      : coords[coords.length - 1];
  const firstVal = values[0] ?? 0;
  const lastVal = values[values.length - 1] ?? 0;
  const diff = lastVal - firstVal;

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/90 p-4 shadow-xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
            <LineChart className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-sm font-black tracking-wider text-zinc-100 uppercase">
              Canlı Equity &amp; PnL Eğrisi
            </h2>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className={`font-black ${meta.color}`}>
                {activeCoord.val < 0 ? "-" : meta.prefix}
                {Math.abs(activeCoord.val).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span
                className={`text-[11px] ${
                  diff >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                ({diff >= 0 ? "+" : ""}
                {diff.toFixed(2)} son periyot)
              </span>
              <span className="text-[10px] text-zinc-500">
                {new Date(activeCoord.ts).toLocaleTimeString("tr-TR")}
              </span>
            </div>
          </div>
        </div>

        {/* Metric selector pills */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(METRIC_META) as ChartMetric[]).map((k) => {
            const active = metric === k;
            return (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-bold transition ${
                  active
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {METRIC_META[k].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Responsive interactive SVG chart */}
      <div className="relative w-full overflow-hidden rounded-lg border border-zinc-900 bg-[#040507] p-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 w-full select-none sm:h-52"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            const ratio = Math.max(0, Math.min(1, (relX - padX) / (width - padX * 2)));
            const idx = Math.round(ratio * (coords.length - 1));
            setHoverIndex(idx);
          }}
        >
          <defs>
            <linearGradient id="grad-emerald" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="grad-cyan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="grad-amber" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="grad-rose" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal gridlines */}
          {[0.2, 0.5, 0.8].map((pct) => {
            const y = padY + pct * (height - padY * 2);
            return (
              <line
                key={pct}
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeDasharray="3 5"
              />
            );
          })}

          {/* Zero baseline if chart crosses 0 */}
          {zeroY !== null && (
            <line
              x1={padX}
              y1={zeroY}
              x2={width - padX}
              y2={zeroY}
              stroke="rgba(255,255,255,0.2)"
              strokeDasharray="4 4"
            />
          )}

          {/* Area gradient */}
          <path d={areaPath} fill={`url(#${meta.fillId})`} />

          {/* Neon curve */}
          <path
            d={linePath}
            fill="none"
            stroke={meta.stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Hover vertical line */}
          {hoverIndex !== null && coords[hoverIndex] && (
            <line
              x1={coords[hoverIndex].x}
              y1={padY}
              x2={coords[hoverIndex].x}
              y2={height - padY}
              stroke="rgba(255,255,255,0.22)"
              strokeDasharray="2 3"
            />
          )}

          {/* Live / hovered marker */}
          <circle
            cx={activeCoord.x}
            cy={activeCoord.y}
            r="8"
            fill={meta.stroke}
            opacity="0.22"
          />
          <circle
            cx={activeCoord.x}
            cy={activeCoord.y}
            r="4"
            fill={meta.stroke}
            stroke="#050608"
            strokeWidth="2"
          />
        </svg>

        <div className="pointer-events-none absolute top-2 right-3 inline-flex items-center gap-1 rounded bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          <Sparkles className="h-3 w-3 text-amber-400" />
          {series.length} canlı örnek
        </div>
      </div>
    </div>
  );
};
