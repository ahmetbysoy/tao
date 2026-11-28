import React, { useEffect, useRef, useState } from "react";
import { Layers, Radar, ShieldAlert } from "lucide-react";
import { MarketFundingRow } from "../utils/supabase";
import { hapticShort } from "../utils/haptics";

interface OrderbookDepthVisualizerProps {
  fundingSnapshots: MarketFundingRow[];
}

type DepthSymbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";

interface DepthLevel {
  price: number;
  qty: number;
}

interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  obi: number;
  wallAlert: string | null;
  source: "binance_depth20" | "worker_obi";
}

const DEPTH_WSS =
  "wss://fstream.binance.com/public/stream?streams=btcusdt@depth20@100ms/ethusdt@depth20@100ms/solusdt@depth20@100ms";

/**
 * Faz 3 (Tahta Kemal X-Ray): High-FPS HTML5 Canvas Orderbook Depth Wave + OBI Tower Visualizer.
 * Streams real Binance Futures depth20@100ms orderbook levels directly to canvas with zero React thrashing,
 * computes real Orderbook Imbalance (OBI), and flags whale liquidity walls (>25% single-level concentration).
 */
export const OrderbookDepthVisualizer: React.FC<OrderbookDepthVisualizerProps> = ({
  fundingSnapshots,
}) => {
  const [symbol, setSymbol] = useState<DepthSymbol>("BTCUSDT");
  const [depthConnected, setDepthConnected] = useState(false);
  const [meta, setMeta] = useState<{
    obi: number;
    wallAlert: string | null;
    spreadBps: number;
    source: "binance_depth20" | "worker_obi";
  }>({
    obi: 0,
    wallAlert: null,
    spreadBps: 0,
    source: "worker_obi",
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const booksRef = useRef<Record<string, DepthSnapshot>>({});
  const symbolRef = useRef<DepthSymbol>(symbol);
  symbolRef.current = symbol;

  // Fallback OBI telemetry from Frankfurt Worker's real funding/bookTicker snapshot
  useEffect(() => {
    const snap = fundingSnapshots.find((s) => s.symbol === symbol);
    if (snap && !booksRef.current[symbol]) {
      setMeta((prev) => ({
        ...prev,
        obi: snap.imbalance,
        source: "worker_obi",
      }));
    }
  }, [fundingSnapshots, symbol]);

  // Connect live Binance depth20@100ms WebSocket
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;
    let lastUiSync = 0;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(DEPTH_WSS);
      ws.onopen = () => setDepthConnected(true);
      ws.onclose = () => {
        setDepthConnected(false);
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => setDepthConnected(false);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const stream: string = msg.stream ?? "";
          const d = msg.data;
          if (!d || !Array.isArray(d.b) || !Array.isArray(d.a)) return;
          const sym = stream.split("@")[0]?.toUpperCase();
          if (!sym) return;

          const bids: DepthLevel[] = d.b
            .slice(0, 15)
            .map((r: [string, string]) => ({ price: parseFloat(r[0]), qty: parseFloat(r[1]) }))
            .filter((x: DepthLevel) => x.price > 0 && x.qty > 0);
          const asks: DepthLevel[] = d.a
            .slice(0, 15)
            .map((r: [string, string]) => ({ price: parseFloat(r[0]), qty: parseFloat(r[1]) }))
            .filter((x: DepthLevel) => x.price > 0 && x.qty > 0);

          const bidVol = bids.reduce((a, b) => a + b.qty, 0);
          const askVol = asks.reduce((a, b) => a + b.qty, 0);
          const total = bidVol + askVol;
          const obi = total > 0 ? (bidVol - askVol) / total : 0;

          // Tahta Kemal X-Ray Wall Detector: flag any single level > 26% of its side's top-15 liquidity
          let wallAlert: string | null = null;
          const maxBid = bids.reduce((m, b) => (b.qty > m.qty ? b : m), { price: 0, qty: 0 });
          const maxAsk = asks.reduce((m, a) => (a.qty > m.qty ? a : m), { price: 0, qty: 0 });
          if (bidVol > 0 && maxBid.qty / bidVol >= 0.28) {
            wallAlert = `X-RAY ALIM DUVARI @ $${maxBid.price.toFixed(sym === "SOLUSDT" ? 3 : 2)} (${Math.round(
              (maxBid.qty / bidVol) * 100
            )}% derinlik)`;
          } else if (askVol > 0 && maxAsk.qty / askVol >= 0.28) {
            wallAlert = `X-RAY SATIM DUVARI @ $${maxAsk.price.toFixed(sym === "SOLUSDT" ? 3 : 2)} (${Math.round(
              (maxAsk.qty / askVol) * 100
            )}% derinlik)`;
          }

          booksRef.current[sym] = {
            bids,
            asks,
            obi,
            wallAlert,
            source: "binance_depth20",
          };

          const now = Date.now();
          if (sym === symbolRef.current && now - lastUiSync >= 220) {
            lastUiSync = now;
            const bestBid = bids[0]?.price ?? 0;
            const bestAsk = asks[0]?.price ?? 0;
            const spreadBps =
              bestBid > 0 && bestAsk > bestBid ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;
            setMeta({
              obi,
              wallAlert,
              spreadBps,
              source: "binance_depth20",
            });
          }
        } catch {
          // Ignore malformed frame
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  // Smooth HTML5 Canvas Depth Wave + OBI Towers Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let scanX = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(300, Math.round(rect.width));
      const h = Math.max(170, Math.round(rect.height));

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Dark Matrix Background
      ctx.fillStyle = "#050908";
      ctx.fillRect(0, 0, w, h);

      // Subtle Horizontal Depth Grid
      ctx.strokeStyle = "rgba(16, 185, 129, 0.08)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const book = booksRef.current[symbolRef.current];
      const midX = w / 2;
      const padBottom = 20;
      const chartH = h - padBottom - 14;

      if (book && book.bids.length > 0 && book.asks.length > 0) {
        // Compute cumulative curves
        let cumBid = 0;
        const bidPoints = book.bids.map((b) => {
          cumBid += b.qty;
          return { ...b, cum: cumBid };
        });
        let cumAsk = 0;
        const askPoints = book.asks.map((a) => {
          cumAsk += a.qty;
          return { ...a, cum: cumAsk };
        });
        const maxCum = Math.max(cumBid, cumAsk, 0.0001);
        const maxSingle = Math.max(
          ...book.bids.map((b) => b.qty),
          ...book.asks.map((a) => a.qty),
          0.0001
        );

        // Left half: BID Cumulative Wave (Emerald) + Individual Liquidity Towers
        const stepBid = (midX - 12) / Math.max(1, bidPoints.length);
        ctx.beginPath();
        ctx.moveTo(midX - 4, h - padBottom);
        bidPoints.forEach((pt, idx) => {
          const x = midX - 4 - idx * stepBid;
          const y = h - padBottom - (pt.cum / maxCum) * chartH;
          ctx.lineTo(x, y);
        });
        ctx.lineTo(8, h - padBottom);
        ctx.closePath();
        const bidGrad = ctx.createLinearGradient(0, 12, 0, h - padBottom);
        bidGrad.addColorStop(0, "rgba(16, 185, 129, 0.42)");
        bidGrad.addColorStop(1, "rgba(16, 185, 129, 0.04)");
        ctx.fillStyle = bidGrad;
        ctx.fill();
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Bid individual level towers
        bidPoints.forEach((pt, idx) => {
          const x = midX - 6 - idx * stepBid;
          const barH = Math.max(2, (pt.qty / maxSingle) * (chartH * 0.55));
          ctx.fillStyle = "rgba(52, 211, 153, 0.65)";
          ctx.fillRect(x - stepBid * 0.35, h - padBottom - barH, Math.max(2, stepBid * 0.5), barH);
        });

        // Right half: ASK Cumulative Wave (Crimson) + Individual Liquidity Towers
        const stepAsk = (midX - 12) / Math.max(1, askPoints.length);
        ctx.beginPath();
        ctx.moveTo(midX + 4, h - padBottom);
        askPoints.forEach((pt, idx) => {
          const x = midX + 4 + idx * stepAsk;
          const y = h - padBottom - (pt.cum / maxCum) * chartH;
          ctx.lineTo(x, y);
        });
        ctx.lineTo(w - 8, h - padBottom);
        ctx.closePath();
        const askGrad = ctx.createLinearGradient(0, 12, 0, h - padBottom);
        askGrad.addColorStop(0, "rgba(239, 68, 68, 0.42)");
        askGrad.addColorStop(1, "rgba(239, 68, 68, 0.04)");
        ctx.fillStyle = askGrad;
        ctx.fill();
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.stroke();

        askPoints.forEach((pt, idx) => {
          const x = midX + 6 + idx * stepAsk;
          const barH = Math.max(2, (pt.qty / maxSingle) * (chartH * 0.55));
          ctx.fillStyle = "rgba(248, 113, 113, 0.65)";
          ctx.fillRect(x, h - padBottom - barH, Math.max(2, stepAsk * 0.5), barH);
        });

        // Center spread divider
        ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, 8);
        ctx.lineTo(midX, h - padBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price labels at bottom
        ctx.font = "bold 10px ui-monospace, SFMono-Regular, monospace";
        ctx.fillStyle = "#6ee7b7";
        ctx.textAlign = "left";
        ctx.fillText(`BID $${book.bids[0].price.toFixed(symbolRef.current === "SOLUSDT" ? 3 : 2)}`, 10, h - 6);
        ctx.fillStyle = "#fca5a5";
        ctx.textAlign = "right";
        ctx.fillText(`ASK $${book.asks[0].price.toFixed(symbolRef.current === "SOLUSDT" ? 3 : 2)}`, w - 10, h - 6);
      } else {
        ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
        ctx.fillStyle = "#71717a";
        ctx.textAlign = "center";
        ctx.fillText("Binance depth20@100ms canlı emir defteri bekleniyor...", midX, h / 2);
      }

      // Tahta Kemal Emerald X-Ray Sweep Beam
      scanX = (scanX + 2.2) % w;
      const beamGrad = ctx.createLinearGradient(scanX - 24, 0, scanX + 4, 0);
      beamGrad.addColorStop(0, "rgba(16, 185, 129, 0)");
      beamGrad.addColorStop(1, "rgba(16, 185, 129, 0.16)");
      ctx.fillStyle = beamGrad;
      ctx.fillRect(scanX - 24, 0, 28, h);

      ctx.restore();
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const obiPct = Math.round(meta.obi * 100);
  const bidRatioPct = Math.max(5, Math.min(95, Math.round(((meta.obi + 1) / 2) * 100)));

  return (
    <section className="rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-[#06130f] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src="/avatars/kemal.webp"
            alt="Tahta Kemal"
            className="h-9 w-9 rounded-xl border border-emerald-500/60 object-cover"
          />
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-black tracking-wider text-emerald-300 uppercase">
                <Layers className="h-4 w-4 text-emerald-400" />
                Tahta Kemal · OBI &amp; Derinlik X-Ray
              </h3>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {depthConnected ? "DEPTH20 @ 100ms" : "WORKER OBI"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Canlı alıcı/satıcı derinlik dalgası, anlık OBI baskısı ve büyük duvar tarayıcısı.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {(["BTCUSDT", "ETHUSDT", "SOLUSDT"] as DepthSymbol[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                hapticShort();
                setSymbol(s);
              }}
              className={`min-h-[40px] cursor-pointer rounded-xl border px-2.5 font-mono text-xs font-black transition ${
                symbol === s
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s.replace("USDT", "")}
            </button>
          ))}
        </div>
      </div>

      {/* Live OBI Imbalance Tug-of-War Meter */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="font-bold text-emerald-400">ALICI BASKISI %{bidRatioPct}</span>
          <span className="font-black text-zinc-200">
            OBI {obiPct >= 0 ? "+" : ""}
            {obiPct}% {meta.spreadBps > 0 ? `· Spread ${meta.spreadBps.toFixed(2)} bps` : ""}
          </span>
          <span className="font-bold text-red-400">SATICI %{100 - bidRatioPct}</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-200"
            style={{ width: `${bidRatioPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-red-500 to-rose-700 transition-all duration-200"
            style={{ width: `${100 - bidRatioPct}%` }}
          />
        </div>
      </div>

      {/* Live Depth Wave Canvas */}
      <div className="mt-3 overflow-hidden rounded-xl border border-emerald-500/25">
        <canvas
          ref={canvasRef}
          className="block h-[175px] w-full sm:h-[195px]"
          aria-label="Canlı Binance emir defteri derinlik dalgası"
        />
      </div>

      {/* Tahta Kemal X-Ray Wall Anomaly Readout */}
      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-black/55 px-3 py-2 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          {meta.wallAlert ? (
            <ShieldAlert className="h-4 w-4 shrink-0 animate-pulse text-amber-400" />
          ) : (
            <Radar className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <span className={meta.wallAlert ? "font-bold text-amber-200" : "text-zinc-400"}>
            {meta.wallAlert ?? "X-Ray tarama aktif — Derinlik dengeli, belirgin duvar anomalisi yok."}
          </span>
        </div>
      </div>
    </section>
  );
};
