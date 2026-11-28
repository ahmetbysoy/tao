import React, { useMemo, useState } from "react";
import { Banknote, Flame, Network, Skull, UserX } from "lucide-react";
import { DebtRow, TraderRow } from "../utils/supabase";
import { hapticMedium, hapticShort } from "../utils/haptics";
import { playClick } from "../utils/sfx";
import { TraderVoiceId } from "../utils/tts";
import { getTraderAvatarSrc, isTraderInFearVisualState } from "../utils/avatars";

interface DebtNetworkGraphProps {
  traders: TraderRow[];
  debts: DebtRow[];
  openPnlByTrader: Record<string, number>;
  tefeciProfit: number;
  shockwaveKey: number;
  onDoubleInterest: (debtId: string, traderId: TraderVoiceId, nickname: string) => void;
  onSendEnforcer: (debtId: string, traderId: TraderVoiceId, nickname: string) => void;
  onCollectDebt: (trader: TraderRow, debt: DebtRow) => void;
}

const NODE_POSITIONS: Record<string, { x: number; y: number; color: string }> = {
  selo: { x: 140, y: 84, color: "#fb7185" },
  mehmet: { x: 580, y: 84, color: "#fbbf24" },
  nuri: { x: 115, y: 245, color: "#22d3ee" },
  kemal: { x: 605, y: 245, color: "#34d399" },
  sevil: { x: 360, y: 300, color: "#c084fc" },
};

/**
 * Faz 2: Interactive SVG Network Node Graph for İntikam Defteri (Debt Relationships).
 * Center hub = Tefeci Kasa. Nodes scale by total debt/equity; laser edges thicken & turn red-hot
 * with compounding interest rate & overdue status.
 */
export const DebtNetworkGraph: React.FC<DebtNetworkGraphProps> = ({
  traders,
  debts,
  openPnlByTrader,
  tefeciProfit,
  shockwaveKey,
  onDoubleInterest,
  onSendEnforcer,
  onCollectDebt,
}) => {
  const [selectedId, setSelectedId] = useState<TraderVoiceId | null>("selo");

  const nodes = useMemo(() => {
    const now = Date.now();
    return traders.map((tr) => {
      const activeDebts = debts.filter(
        (d) => d.trader_id === tr.id && (d.status === "aktif" || d.status === "gecikti")
      );
      const totalOwed = activeDebts.reduce(
        (acc, d) => acc + Math.max(0, Number(d.principal) - Number(d.total_repaid ?? 0)),
        0
      );
      const maxRate = activeDebts.reduce(
        (acc, d) => Math.max(acc, Number(d.interest_rate ?? 0)),
        0
      );
      const overdue = activeDebts.some(
        (d) => d.status === "gecikti" || Number(d.due_date_ms) <= now
      );
      const equity = Math.max(50, Number(tr.balance ?? 0) + (openPnlByTrader[tr.id] ?? 0));
      const stressRatio = Math.min(2.5, totalOwed / equity);
      const pos = NODE_POSITIONS[tr.id] ?? { x: 360, y: 260, color: "#a1a1aa" };
      const radius = Math.round(24 + Math.min(14, (totalOwed + equity) / 350));

      return {
        trader: tr,
        primaryDebt: activeDebts[0] ?? null,
        totalOwed,
        maxRate,
        overdue,
        stressRatio,
        radius,
        ...pos,
      };
    });
  }, [traders, debts, openPnlByTrader]);

  const selectedNode = nodes.find((n) => n.trader.id === selectedId) ?? nodes[0] ?? null;
  const cx = 360;
  const cy = 165;

  return (
    <section className="rounded-2xl border border-rose-500/35 bg-gradient-to-br from-[#12080d] via-zinc-950 to-zinc-950 p-3.5 shadow-2xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-rose-300 uppercase sm:text-base">
            <Network className="h-4 w-4 text-rose-400" />
            İntikam Defteri · Canlı Borç İlişkileri Ağı
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Düğüm boyutu = Borç/Kasa hacmi · Lazer çizgisi kalınlaştıkça faiz ve gecikme baskısı artar.
          </p>
        </div>
        <span className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 font-mono text-[10px] font-bold text-rose-200">
          İNTERAKTİF NODE GRAPH
        </span>
      </div>

      {/* Interactive Network SVG */}
      <div className="relative mt-3 overflow-hidden rounded-xl border border-zinc-800/90 bg-black/75">
        <svg
          viewBox="0 0 720 355"
          className="h-[260px] w-full select-none sm:h-[320px]"
          role="img"
          aria-label="Tefeci borç ilişkileri ağı"
        >
          <defs>
            <radialGradient id="tefeciHubGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
            <clipPath id="clipTefeciHub">
              <circle cx={cx} cy={cy} r="32" />
            </clipPath>
            {nodes.map((n) => (
              <clipPath key={`clip-${n.trader.id}`} id={`clip-${n.trader.id}`}>
                <circle cx={n.x} cy={n.y} r={n.radius - 2} />
              </clipPath>
            ))}
          </defs>

          {/* Subtle radar rings around Tefeci center */}
          <circle cx={cx} cy={cy} r="90" fill="none" stroke="#27272a" strokeDasharray="4 6" />
          <circle cx={cx} cy={cy} r="165" fill="none" stroke="#27272a" strokeDasharray="2 6" />
          <circle cx={cx} cy={cy} r="85" fill="url(#tefeciHubGlow)" />

          {/* Golden Shockwave Ring triggered by "FAİZİ KATLA" */}
          {shockwaveKey > 0 && (
            <circle
              key={shockwaveKey}
              cx={cx}
              cy={cy}
              r="34"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="4"
              className="fx-gold-shockwave"
            />
          )}

          {/* Laser Edges connecting Tefeci Kasa -> Each Debtor */}
          {nodes.map((n) => {
            const hasDebt = n.totalOwed > 0;
            const edgeColor = !hasDebt
              ? "#3f3f46"
              : n.overdue
              ? "#ef4444"
              : n.maxRate >= 0.2
              ? "#f97316"
              : "#f59e0b";
            const strokeW = hasDebt ? Math.min(6.5, 1.8 + n.maxRate * 14 + (n.overdue ? 1.5 : 0)) : 1.2;
            const midX = (cx + n.x) / 2;
            const midY = (cy + n.y) / 2;

            return (
              <g key={`edge-${n.trader.id}`}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={n.x}
                  y2={n.y}
                  stroke={edgeColor}
                  strokeWidth={strokeW}
                  strokeOpacity={hasDebt ? 0.85 : 0.35}
                  strokeDasharray={n.overdue ? "8 5" : undefined}
                />
                {hasDebt && (
                  <g>
                    <rect
                      x={midX - 42}
                      y={midY - 11}
                      width="84"
                      height="20"
                      rx="6"
                      fill="#09090b"
                      stroke={edgeColor}
                      strokeWidth="1"
                    />
                    <text
                      x={midX}
                      y={midY + 3}
                      textAnchor="middle"
                      fill={n.overdue ? "#fca5a5" : "#fde68a"}
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      ${n.totalOwed.toFixed(0)} · %{(n.maxRate * 100).toFixed(0)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Center Tefeci Boss Node */}
          <g>
            <image
              href="/avatars/tefeci.webp"
              x={cx - 32}
              y={cy - 32}
              width="64"
              height="64"
              clipPath="url(#clipTefeciHub)"
              preserveAspectRatio="xMidYMid slice"
            />
            <circle cx={cx} cy={cy} r="32" fill="none" stroke="#f59e0b" strokeWidth="3" />
            <rect x={cx - 56} y={cy + 36} width="112" height="19" rx="5" fill="#18181b" stroke="#f59e0b" />
            <text
              x={cx}
              y={cy + 49}
              textAnchor="middle"
              fill="#fde68a"
              fontSize="10"
              fontFamily="monospace"
              fontWeight="bold"
            >
              TEFECİ · ${tefeciProfit.toFixed(0)}
            </text>
          </g>

          {/* Orbiting Trader Nodes */}
          {nodes.map((n) => {
            const selected = selectedNode?.trader.id === n.trader.id;
            return (
              <g
                key={n.trader.id}
                className="cursor-pointer"
                onClick={() => {
                  hapticShort();
                  playClick();
                  setSelectedId(n.trader.id);
                }}
              >
                {selected && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.radius + 7}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.65"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                )}
                {n.overdue && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.radius + 4}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="2.5"
                  />
                )}
                <image
                  href={getTraderAvatarSrc(
                    n.trader.id,
                    isTraderInFearVisualState(n.trader) || n.overdue
                  )}
                  x={n.x - (n.radius - 2)}
                  y={n.y - (n.radius - 2)}
                  width={(n.radius - 2) * 2}
                  height={(n.radius - 2) * 2}
                  clipPath={`url(#clip-${n.trader.id})`}
                  preserveAspectRatio="xMidYMid slice"
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.radius}
                  fill="none"
                  stroke={n.overdue ? "#ef4444" : n.color}
                  strokeWidth={selected ? 3.2 : 2.2}
                />
                <text
                  x={n.x}
                  y={n.y + n.radius + 14}
                  textAnchor="middle"
                  fill="#f4f4f5"
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {n.trader.nickname}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Node Interactive Command Strip */}
      {selectedNode && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/55 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img
              src={`/avatars/${selectedNode.trader.id}.webp`}
              alt={selectedNode.trader.nickname}
              className="h-11 w-11 rounded-xl border border-zinc-700 object-cover"
            />
            <div className="font-mono text-xs">
              <div className="flex items-center gap-2 font-black text-white">
                <span>{selectedNode.trader.nickname}</span>
                {selectedNode.overdue && (
                  <span className="inline-flex items-center gap-1 rounded bg-red-600/30 px-1.5 py-0.5 text-[10px] text-red-300">
                    <Skull className="h-3 w-3" /> GECİKTİ
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-400">
                Borç: <strong className="text-amber-300">${selectedNode.totalOwed.toFixed(2)}</strong> ·
                Faiz: <strong className="text-rose-300">%{(selectedNode.maxRate * 100).toFixed(1)}</strong> ·
                Kasa: <strong className="text-emerald-300">${Number(selectedNode.trader.balance).toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {selectedNode.primaryDebt ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  hapticMedium();
                  onDoubleInterest(
                    selectedNode.primaryDebt!.id,
                    selectedNode.trader.id,
                    selectedNode.trader.nickname
                  );
                }}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl border border-amber-500/60 bg-amber-600/20 px-3 text-[11px] font-black text-amber-200 uppercase transition hover:bg-amber-600/35 active:scale-95"
              >
                <Flame className="h-3.5 w-3.5" />
                Faizi Katla
              </button>
              <button
                type="button"
                onClick={() => {
                  hapticMedium();
                  onSendEnforcer(
                    selectedNode.primaryDebt!.id,
                    selectedNode.trader.id,
                    selectedNode.trader.nickname
                  );
                }}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl border border-yellow-500/60 bg-yellow-500/15 px-3 text-[11px] font-black text-yellow-200 uppercase transition hover:bg-yellow-500/30 active:scale-95"
              >
                <UserX className="h-3.5 w-3.5" />
                Çırak
              </button>
              <button
                type="button"
                onClick={() => {
                  hapticMedium();
                  onCollectDebt(selectedNode.trader, selectedNode.primaryDebt!);
                }}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl border border-emerald-500/60 bg-emerald-600/20 px-3 text-[11px] font-black text-emerald-200 uppercase transition hover:bg-emerald-600/35 active:scale-95"
              >
                <Banknote className="h-3.5 w-3.5" />
                Tahsil Et
              </button>
            </div>
          ) : (
            <span className="font-mono text-[11px] text-zinc-500">
              Aktif senet yok — Temiz sicil.
            </span>
          )}
        </div>
      )}
    </section>
  );
};
