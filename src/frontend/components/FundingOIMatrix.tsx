import React, { useEffect, useMemo, useState } from "react";
import { Activity, Compass, RefreshCw } from "lucide-react";
import { MarketFundingRow } from "../utils/supabase";
import { formatCompactUsd } from "../utils/liquidation";

interface FundingOIMatrixProps {
  fundingSnapshots: MarketFundingRow[];
  livePrices: Record<string, number>;
}

interface LiveOiEntry {
  symbol: "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
  oiUsd: number;
  oiCoin: number;
  deltaPct: number;
  source: "okx_swap" | "binance_fapi";
  updatedAtMs: number;
}

const SYMBOLS: Array<{
  symbol: "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
  okxInst: string;
  label: string;
  color: string;
}> = [
  { symbol: "BTCUSDT", okxInst: "BTC-USDT-SWAP", label: "BTC", color: "#f59e0b" },
  { symbol: "ETHUSDT", okxInst: "ETH-USDT-SWAP", label: "ETH", color: "#22d3ee" },
  { symbol: "SOLUSDT", okxInst: "SOL-USDT-SWAP", label: "SOL", color: "#c084fc" },
];

/**
 * Visual Revolution V2 (TODO #2.3): Fonlama Nuri — Canlı Funding Rate & Open Interest Vektör Matrisi.
 * Combines real Worker funding snapshots (Supabase market_funding_snapshots) with real live
 * Open Interest fetched directly from OKX Swap / Binance Futures public REST APIs. Zero mock data.
 */
export const FundingOIMatrix: React.FC<FundingOIMatrixProps> = ({
  fundingSnapshots,
  livePrices,
}) => {
  const [oiMap, setOiMap] = useState<Record<string, LiveOiEntry>>({});
  const [oiStatus, setOiStatus] = useState<"loading" | "live" | "unavailable">("loading");
  const [fetching, setFetching] = useState(false);

  const fetchLiveOpenInterest = async () => {
    setFetching(true);
    try {
      const next: Record<string, LiveOiEntry> = {};
      // Try OKX public SWAP Open Interest first (globally accessible & CORS-friendly)
      const okxResp = await fetch(
        "https://www.okx.com/api/v5/public/open-interest?instType=SWAP"
      );
      if (okxResp.ok) {
        const json = await okxResp.json();
        const rows: Array<{ instId: string; oiUsd?: string; oiCcy?: string }> =
          Array.isArray(json?.data) ? json.data : [];
        const byInst = new Map(rows.map((r) => [r.instId, r]));
        SYMBOLS.forEach(({ symbol, okxInst }) => {
          const hit = byInst.get(okxInst);
          if (hit) {
            const oiUsd = parseFloat(hit.oiUsd ?? "0");
            const oiCoin = parseFloat(hit.oiCcy ?? "0");
            if (oiUsd > 0) {
              next[symbol] = {
                symbol,
                oiUsd,
                oiCoin,
                deltaPct: 0,
                source: "okx_swap",
                updatedAtMs: Date.now(),
              };
            }
          }
        });
      }

      // Fallback to Binance Futures public Open Interest if any symbol missing
      for (const { symbol } of SYMBOLS) {
        if (next[symbol]) continue;
        try {
          const bResp = await fetch(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`
          );
          if (bResp.ok) {
            const bJson = await bResp.json();
            const oiCoin = parseFloat(bJson?.openInterest ?? "0");
            const px = livePrices[symbol] ?? 0;
            const oiUsd = oiCoin * (px > 0 ? px : 1);
            if (oiCoin > 0 && px > 0) {
              next[symbol] = {
                symbol,
                oiUsd,
                oiCoin,
                deltaPct: 0,
                source: "binance_fapi",
                updatedAtMs: Date.now(),
              };
            }
          }
        } catch {
          // Ignore blocked region
        }
      }

      if (Object.keys(next).length > 0) {
        setOiMap((prev) => {
          const merged: Record<string, LiveOiEntry> = { ...prev };
          Object.entries(next).forEach(([sym, entry]) => {
            const oldUsd = prev[sym]?.oiUsd ?? entry.oiUsd;
            const deltaPct = oldUsd > 0 ? ((entry.oiUsd - oldUsd) / oldUsd) * 100 : 0;
            merged[sym] = { ...entry, deltaPct };
          });
          return merged;
        });
        setOiStatus("live");
      } else {
        setOiStatus("unavailable");
      }
    } catch {
      setOiStatus("unavailable");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchLiveOpenInterest();
    const id = window.setInterval(fetchLiveOpenInterest, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const vectors = useMemo(() => {
    const maxOi = Math.max(
      1,
      ...SYMBOLS.map((s) => oiMap[s.symbol]?.oiUsd ?? 0)
    );
    return SYMBOLS.map((cfg) => {
      const fRow = fundingSnapshots.find((f) => f.symbol === cfg.symbol);
      const oi = oiMap[cfg.symbol];
      const fundingRate = Number(fRow?.funding_rate ?? 0);
      const fundingBps = fundingRate * 10_000; // 1 bps = 0.01%
      const annualizedPct = fundingRate * 3 * 365 * 100;
      const obi = Number(fRow?.imbalance ?? 0);

      // Map X in [50..370] based on funding bps clamped to [-6..+6 bps]
      const clampedBps = Math.max(-6, Math.min(6, fundingBps));
      const x = 210 + (clampedBps / 6) * 145;

      // Map Y in [40..200] based on real OI USD ratio (higher OI => higher on chart)
      const oiRatio = oi ? Math.min(1, oi.oiUsd / maxOi) : 0.45;
      const y = 195 - oiRatio * 140;

      // Nuri's crowd-pressure interpretation
      let regime = "Dengeli Tahta";
      if (fundingBps >= 1.2) regime = "Long Kalabalığı · Ters Short Sinyali";
      else if (fundingBps <= -0.8) regime = "Negatif Funding · Short Sıkışması";
      else if (Math.abs(obi) >= 0.25)
        regime = obi > 0 ? "OBI Alım Baskısı" : "OBI Satım Baskısı";

      return {
        ...cfg,
        fundingRate,
        fundingBps,
        annualizedPct,
        obi,
        oiUsd: oi?.oiUsd ?? 0,
        oiDeltaPct: oi?.deltaPct ?? 0,
        oiSource: oi?.source ?? null,
        x,
        y,
        regime,
      };
    });
  }, [fundingSnapshots, oiMap]);

  return (
    <section className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-[#06131a] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src="/avatars/nuri.webp"
            alt="Fonlama Nuri"
            className="h-9 w-9 rounded-xl border border-cyan-500/60 object-cover"
          />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-black tracking-wider text-cyan-300 uppercase">
                <Compass className="h-4 w-4 text-cyan-400" />
                Fonlama Nuri · Funding &amp; Open Interest Vektör Matrisi
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                  oiStatus === "live"
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                <Activity className="h-3 w-3" />
                {oiStatus === "live" ? "CANLI FUNDING + OI" : "FUNDING SENK"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Çift eksenli canlı Funding ayrışması (X) &amp; gerçek Open Interest hacim matrisi (Y).
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={fetching}
          onClick={fetchLiveOpenInterest}
          aria-label="Open Interest verisini yenile"
          className="inline-flex min-h-[38px] min-w-[38px] cursor-pointer items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-950/35 text-cyan-300 transition hover:bg-cyan-900/45 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        {/* Dual-Axis Vector Quadrant SVG */}
        <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-[#050a0f] lg:col-span-7">
          <svg
            viewBox="0 0 420 235"
            className="h-[220px] w-full select-none"
            role="img"
            aria-label="Canlı Funding Rate ve Open Interest çift eksenli vektör matrisi"
          >
            {/* Quadrant Shaded Zones */}
            <rect x="44" y="24" width="166" height="90" fill="rgba(16,185,129,0.06)" />
            <rect x="210" y="24" width="175" height="90" fill="rgba(239,68,68,0.07)" />
            <rect x="44" y="114" width="166" height="92" fill="rgba(34,211,238,0.03)" />
            <rect x="210" y="114" width="175" height="92" fill="rgba(245,158,11,0.04)" />

            {/* Axes */}
            <line x1="210" y1="22" x2="210" y2="208" stroke="#3f3f46" strokeDasharray="4 4" />
            <line x1="44" y1="114" x2="386" y2="114" stroke="#3f3f46" strokeDasharray="4 4" />
            <rect x="44" y="24" width="342" height="182" fill="none" stroke="#27272a" />

            {/* Quadrant Corner Labels */}
            <text x="50" y="38" fill="#34d399" fontSize="9" fontFamily="monospace" fontWeight="bold">
              SHORT SIKIŞMASI (-Funding · Yüksek OI)
            </text>
            <text x="380" y="38" textAnchor="end" fill="#fb7185" fontSize="9" fontFamily="monospace" fontWeight="bold">
              LONG KALABALIĞI (+Funding · Yüksek OI)
            </text>
            <text x="210" y="224" textAnchor="middle" fill="#a1a1aa" fontSize="9" fontFamily="monospace">
              ← Negatif Funding (-6 bps) | 0% | Pozitif Funding (+6 bps) →
            </text>
            <text
              x="16"
              y="115"
              fill="#a1a1aa"
              fontSize="9"
              fontFamily="monospace"
              transform="rotate(-90 16 115)"
              textAnchor="middle"
            >
              GERÇEK OPEN INTEREST ($) ↑
            </text>

            {/* Vector Arrows & Coin Nodes */}
            {vectors.map((v) => {
              const vecDx = Math.max(-24, Math.min(24, v.obi * 28));
              const vecDy = Math.max(-18, Math.min(18, -v.oiDeltaPct * 12));
              return (
                <g key={v.symbol}>
                  {/* Origin-to-Node guide */}
                  <line
                    x1="210"
                    y1="114"
                    x2={v.x}
                    y2={v.y}
                    stroke={v.color}
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                  />
                  {/* Live OBI/OI Momentum Vector Tail */}
                  {(Math.abs(vecDx) > 2 || Math.abs(vecDy) > 2) && (
                    <line
                      x1={v.x}
                      y1={v.y}
                      x2={v.x + vecDx}
                      y2={v.y + vecDy}
                      stroke={v.color}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                    />
                  )}
                  <circle cx={v.x} cy={v.y} r="15" fill={v.color} fillOpacity={0.18} />
                  <circle
                    cx={v.x}
                    cy={v.y}
                    r="8"
                    fill="#09090b"
                    stroke={v.color}
                    strokeWidth="2.4"
                  />
                  <text
                    x={v.x}
                    y={v.y - 14}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {v.label} ({v.fundingBps >= 0 ? "+" : ""}
                    {v.fundingBps.toFixed(2)} bps)
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Live Telemetry Cards per Core Coin */}
        <div className="space-y-2 lg:col-span-5">
          {vectors.map((v) => (
            <div
              key={v.symbol}
              className="rounded-xl border border-zinc-800/90 bg-black/60 px-3 py-2 font-mono text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-black" style={{ color: v.color }}>
                  {v.symbol}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    v.fundingRate >= 0
                      ? "bg-rose-500/15 text-rose-300"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  8s Funding: {(v.fundingRate * 100).toFixed(4)}% (Yıllık{" "}
                  {v.annualizedPct >= 0 ? "+" : ""}
                  {v.annualizedPct.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-300">
                <span>
                  Açık Pozisyon (OI):{" "}
                  <strong className="text-white">
                    {v.oiUsd > 0 ? formatCompactUsd(v.oiUsd) : "Yükleniyor..."}
                  </strong>
                </span>
                <span className="text-[10px] text-cyan-300">{v.regime}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
