import React, { useEffect, useRef, useState } from "react";
import { Box, Layers, Radar, ShieldAlert } from "lucide-react";
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
  spoofAlert: string | null;
  spoofSide: "bid" | "ask" | null;
  spoofIndex: number;
  maxBidQty: number;
  maxAskQty: number;
  tsMs: number;
  source: "binance_depth20" | "worker_obi";
}

const DEPTH_WSS =
  "wss://fstream.binance.com/public/stream?streams=btcusdt@depth20@100ms/ethusdt@depth20@100ms/solusdt@depth20@100ms";

/**
 * Draw a true 3D Isometric Extruded Neon Pillar (top diamond + left lit face + right shaded face).
 */
function drawIsoPillar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  halfW: number,
  isoD: number,
  height: number,
  topColor: string,
  leftColor: string,
  rightColor: string,
  highlightGold: boolean
) {
  const topY = baseY - height;

  // Left lit face
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY);
  ctx.lineTo(cx, topY + isoD);
  ctx.lineTo(cx, baseY + isoD);
  ctx.lineTo(cx - halfW, baseY);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  // Right shaded face
  ctx.beginPath();
  ctx.moveTo(cx + halfW, topY);
  ctx.lineTo(cx, topY + isoD);
  ctx.lineTo(cx, baseY + isoD);
  ctx.lineTo(cx + halfW, baseY);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();

  // Top isometric diamond face
  ctx.beginPath();
  ctx.moveTo(cx, topY - isoD);
  ctx.lineTo(cx + halfW, topY);
  ctx.lineTo(cx, topY + isoD);
  ctx.lineTo(cx - halfW, topY);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  if (highlightGold) {
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

/**
 * Visual Revolution V2 (TODO #2.1 — Tahta Kemal 3D İzometrik Emir Defteri Duvarı):
 * Streams real Binance Futures depth20@100ms levels into extruded 3D isometric bid/ask columns
 * (with 2D wave fallback toggle), computes live OBI imbalance, and detects rapid whale wall
 * spoofing/flickering between real 100ms snapshots.
 */
export const OrderbookDepthVisualizer: React.FC<OrderbookDepthVisualizerProps> = ({
  fundingSnapshots,
}) => {
  const [symbol, setSymbol] = useState<DepthSymbol>("BTCUSDT");
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [depthConnected, setDepthConnected] = useState(false);
  const [meta, setMeta] = useState<{
    obi: number;
    wallAlert: string | null;
    spoofAlert: string | null;
    spreadBps: number;
    source: "binance_depth20" | "worker_obi";
  }>({
    obi: 0,
    wallAlert: null,
    spoofAlert: null,
    spreadBps: 0,
    source: "worker_obi",
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const booksRef = useRef<Record<string, DepthSnapshot>>({});
  const symbolRef = useRef<DepthSymbol>(symbol);
  symbolRef.current = symbol;
  const viewModeRef = useRef<"3d" | "2d">(viewMode);
  viewModeRef.current = viewMode;

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

  // Connect live Binance depth20@100ms WebSocket + Real Spoof Flicker Detector
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
            .slice(0, 12)
            .map((r: [string, string]) => ({
              price: parseFloat(r[0]),
              qty: parseFloat(r[1]),
            }))
            .filter((x: DepthLevel) => x.price > 0 && x.qty > 0);
          const asks: DepthLevel[] = d.a
            .slice(0, 12)
            .map((r: [string, string]) => ({
              price: parseFloat(r[0]),
              qty: parseFloat(r[1]),
            }))
            .filter((x: DepthLevel) => x.price > 0 && x.qty > 0);

          const bidVol = bids.reduce((a, b) => a + b.qty, 0);
          const askVol = asks.reduce((a, b) => a + b.qty, 0);
          const total = bidVol + askVol;
          const obi = total > 0 ? (bidVol - askVol) / total : 0;

          let maxBidIdx = 0;
          let maxBid = { price: 0, qty: 0 };
          bids.forEach((b, idx) => {
            if (b.qty > maxBid.qty) {
              maxBid = b;
              maxBidIdx = idx;
            }
          });

          let maxAskIdx = 0;
          let maxAsk = { price: 0, qty: 0 };
          asks.forEach((a, idx) => {
            if (a.qty > maxAsk.qty) {
              maxAsk = a;
              maxAskIdx = idx;
            }
          });

          const dec = sym === "SOLUSDT" ? 3 : 2;
          let wallAlert: string | null = null;
          if (bidVol > 0 && maxBid.qty / bidVol >= 0.27) {
            wallAlert = `X-RAY ALIM DUVARI @ $${maxBid.price.toFixed(dec)} (%${Math.round(
              (maxBid.qty / bidVol) * 100
            )} derinlik)`;
          } else if (askVol > 0 && maxAsk.qty / askVol >= 0.27) {
            wallAlert = `X-RAY SATIM DUVARI @ $${maxAsk.price.toFixed(dec)} (%${Math.round(
              (maxAsk.qty / askVol) * 100
            )} derinlik)`;
          }

          // Real Spoofing / Flicker Detector: detect sudden >=40% wall spike or disappearance within <900ms
          const now = Date.now();
          const prev = booksRef.current[sym];
          let spoofAlert: string | null = prev?.spoofAlert ?? null;
          let spoofSide: "bid" | "ask" | null = prev?.spoofSide ?? null;
          let spoofIndex = prev?.spoofIndex ?? -1;

          if (prev && now - prev.tsMs <= 900) {
            const bidJump =
              prev.maxBidQty > 0 ? (maxBid.qty - prev.maxBidQty) / prev.maxBidQty : 0;
            const askJump =
              prev.maxAskQty > 0 ? (maxAsk.qty - prev.maxAskQty) / prev.maxAskQty : 0;
            if (Math.abs(bidJump) >= 0.48 && maxBid.qty / Math.max(bidVol, 0.0001) >= 0.22) {
              spoofAlert = `SPOOF / HIZLI ALIM DUVARI ${bidJump > 0 ? "BELİRDİ" : "ÇEKİLDİ"} @ $${maxBid.price.toFixed(dec)}`;
              spoofSide = "bid";
              spoofIndex = maxBidIdx;
            } else if (
              Math.abs(askJump) >= 0.48 &&
              maxAsk.qty / Math.max(askVol, 0.0001) >= 0.22
            ) {
              spoofAlert = `SPOOF / HIZLI SATIM DUVARI ${askJump > 0 ? "BELİRDİ" : "ÇEKİLDİ"} @ $${maxAsk.price.toFixed(dec)}`;
              spoofSide = "ask";
              spoofIndex = maxAskIdx;
            } else if (now - prev.tsMs > 2500) {
              spoofAlert = null;
              spoofSide = null;
              spoofIndex = -1;
            }
          }

          booksRef.current[sym] = {
            bids,
            asks,
            obi,
            wallAlert,
            spoofAlert,
            spoofSide,
            spoofIndex,
            maxBidQty: maxBid.qty,
            maxAskQty: maxAsk.qty,
            tsMs: now,
            source: "binance_depth20",
          };

          if (sym === symbolRef.current && now - lastUiSync >= 200) {
            lastUiSync = now;
            const bestBid = bids[0]?.price ?? 0;
            const bestAsk = asks[0]?.price ?? 0;
            const spreadBps =
              bestBid > 0 && bestAsk > bestBid
                ? ((bestAsk - bestBid) / bestBid) * 10000
                : 0;
            setMeta({
              obi,
              wallAlert,
              spoofAlert,
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

  // 60 FPS Canvas Renderer: 3D Isometric Orderbook Pillars OR 2D Depth Wave
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
      const h = Math.max(190, Math.round(rect.height));

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep Matrix Canvas Bg
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#040b09");
      bg.addColorStop(1, "#080b10");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const book = booksRef.current[symbolRef.current];
      const midX = w / 2;
      const padBottom = 22;
      const chartH = h - padBottom - 18;
      const dec = symbolRef.current === "SOLUSDT" ? 3 : 2;

      if (book && book.bids.length > 0 && book.asks.length > 0) {
        if (viewModeRef.current === "3d") {
          // 3D Isometric Perspective Floor Lines
          ctx.strokeStyle = "rgba(16, 185, 129, 0.12)";
          ctx.lineWidth = 1;
          for (let row = 0; row < 4; row++) {
            const gy = h - padBottom - row * 12;
            ctx.beginPath();
            ctx.moveTo(12, gy);
            ctx.lineTo(w - 12, gy);
            ctx.stroke();
          }

          const levels = Math.min(10, book.bids.length, book.asks.length);
          const maxQty = Math.max(
            ...book.bids.slice(0, levels).map((b) => b.qty),
            ...book.asks.slice(0, levels).map((a) => a.qty),
            0.0001
          );
          const slotW = (midX - 24) / Math.max(1, levels);
          const halfW = Math.max(5, Math.min(13, slotW * 0.42));
          const isoD = Math.max(3, halfW * 0.48);

          // Draw Back-to-Front for accurate 3D Painter's Algorithm overlap
          for (let i = levels - 1; i >= 0; i--) {
            // BID 3D Isometric Emerald Pillar (left of center, index 0 closest to spread)
            const bid = book.bids[i];
            const bx = midX - 14 - i * slotW - halfW;
            const bBaseY = h - padBottom - i * 3.2;
            const bHeight = Math.max(8, (bid.qty / maxQty) * (chartH * 0.78));
            const isSpoofBid = book.spoofSide === "bid" && book.spoofIndex === i;

            drawIsoPillar(
              ctx,
              bx,
              bBaseY,
              halfW,
              isoD,
              bHeight,
              isSpoofBid ? "#fde047" : "#6ee7b7",
              isSpoofBid ? "#eab308" : "#10b981",
              isSpoofBid ? "#a16207" : "#047857",
              isSpoofBid
            );

            // ASK 3D Isometric Crimson Pillar (right of center)
            const ask = book.asks[i];
            const ax = midX + 14 + i * slotW + halfW;
            const aBaseY = h - padBottom - i * 3.2;
            const aHeight = Math.max(8, (ask.qty / maxQty) * (chartH * 0.78));
            const isSpoofAsk = book.spoofSide === "ask" && book.spoofIndex === i;

            drawIsoPillar(
              ctx,
              ax,
              aBaseY,
              halfW,
              isoD,
              aHeight,
              isSpoofAsk ? "#fde047" : "#fca5a5",
              isSpoofAsk ? "#eab308" : "#ef4444",
              isSpoofAsk ? "#a16207" : "#991b1b",
              isSpoofAsk
            );
          }

          // Spread center laser line
          ctx.strokeStyle = "rgba(251, 191, 36, 0.65)";
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(midX, 10);
          ctx.lineTo(midX, h - padBottom + 4);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // Classic 2D Cumulative Depth Wave Mode
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

          const stepBid = (midX - 12) / Math.max(1, bidPoints.length);
          ctx.beginPath();
          ctx.moveTo(midX - 4, h - padBottom);
          bidPoints.forEach((pt, idx) => {
            ctx.lineTo(
              midX - 4 - idx * stepBid,
              h - padBottom - (pt.cum / maxCum) * chartH
            );
          });
          ctx.lineTo(8, h - padBottom);
          ctx.closePath();
          ctx.fillStyle = "rgba(16, 185, 129, 0.32)";
          ctx.fill();
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 2;
          ctx.stroke();

          const stepAsk = (midX - 12) / Math.max(1, askPoints.length);
          ctx.beginPath();
          ctx.moveTo(midX + 4, h - padBottom);
          askPoints.forEach((pt, idx) => {
            ctx.lineTo(
              midX + 4 + idx * stepAsk,
              h - padBottom - (pt.cum / maxCum) * chartH
            );
          });
          ctx.lineTo(w - 8, h - padBottom);
          ctx.closePath();
          ctx.fillStyle = "rgba(239, 68, 68, 0.32)";
          ctx.fill();
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Bottom Best Bid / Best Ask Readouts
        ctx.font = "bold 10px ui-monospace, SFMono-Regular, monospace";
        ctx.fillStyle = "#6ee7b7";
        ctx.textAlign = "left";
        ctx.fillText(`3D BID $${book.bids[0].price.toFixed(dec)}`, 10, h - 6);
        ctx.fillStyle = "#fde68a";
        ctx.textAlign = "center";
        ctx.fillText("SPREAD", midX, h - 6);
        ctx.fillStyle = "#fca5a5";
        ctx.textAlign = "right";
        ctx.fillText(`3D ASK $${book.asks[0].price.toFixed(dec)}`, w - 10, h - 6);
      } else {
        ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
        ctx.fillStyle = "#71717a";
        ctx.textAlign = "center";
        ctx.fillText(
          "Binance depth20@100ms 3D canlı emir defteri sütunları bekleniyor...",
          midX,
          h / 2
        );
      }

      // Tahta Kemal Emerald X-Ray Sweep Beam
      scanX = (scanX + 2.2) % w;
      const beamGrad = ctx.createLinearGradient(scanX - 24, 0, scanX + 4, 0);
      beamGrad.addColorStop(0, "rgba(16, 185, 129, 0)");
      beamGrad.addColorStop(1, "rgba(16, 185, 129, 0.14)");
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
  const activeAlert = meta.spoofAlert ?? meta.wallAlert;

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
                <Box className="h-4 w-4 text-emerald-400" />
                Tahta Kemal · 3D İzometrik Emir Defteri Duvarı
              </h3>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {depthConnected ? "DEPTH20 @ 100ms" : "WORKER OBI"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Canlı 3D izometrik likidite sütunları, anlık OBI baskısı ve hızlı spoofing duvar tarayıcısı.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              hapticShort();
              setViewMode((m) => (m === "3d" ? "2d" : "3d"));
            }}
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-2.5 font-mono text-[10px] font-black text-emerald-200 uppercase"
          >
            <Layers className="h-3.5 w-3.5" />
            {viewMode === "3d" ? "3D İZO" : "2D DALGA"}
          </button>
          {(["BTCUSDT", "ETHUSDT", "SOLUSDT"] as DepthSymbol[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                hapticShort();
                setSymbol(s);
              }}
              className={`min-h-[38px] cursor-pointer rounded-xl border px-2.5 font-mono text-xs font-black transition ${
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
          <span className="font-bold text-emerald-400">ALICI %{bidRatioPct}</span>
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

      {/* 3D Isometric Pillars Canvas */}
      <div className="mt-3 overflow-hidden rounded-xl border border-emerald-500/25">
        <canvas
          ref={canvasRef}
          className="block h-[200px] w-full sm:h-[220px]"
          aria-label="Canlı Binance 3D izometrik emir defteri sütunları"
        />
      </div>

      {/* Tahta Kemal X-Ray & Spoofing Anomaly Readout */}
      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-black/55 px-3 py-2 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          {activeAlert ? (
            <ShieldAlert className="h-4 w-4 shrink-0 animate-pulse text-amber-400" />
          ) : (
            <Radar className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <span className={activeAlert ? "font-bold text-amber-200" : "text-zinc-400"}>
            {activeAlert ??
              "3D X-Ray & Spoof taraması aktif — Emir defteri sütunları dengeli."}
          </span>
        </div>
      </div>
    </section>
  );
};
