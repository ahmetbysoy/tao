import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Time,
} from "lightweight-charts";
import { Activity, CandlestickChart, RefreshCw, Skull } from "lucide-react";
import {
  CandleSource,
  fetchHistoricalCandles,
  ReplaySymbol,
} from "../utils/candleReplay";
import { OpenPosition } from "./LivePnL";
import { LedgerEntry } from "./DebtLedger";
import { hapticShort } from "../utils/haptics";

interface LiveCandlestickBoardProps {
  openPositions: OpenPosition[];
  closedLedger: LedgerEntry[];
  livePrices: Record<string, number>;
  binanceConnected: boolean;
}

const SYMBOLS: Array<{ key: ReplaySymbol; label: string; decimals: number }> = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
];

const KLINE_WSS =
  "wss://fstream.binance.com/market/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m/solusdt@kline_1m";

/**
 * Faz 3: TradingView Lightweight-Charts v5 Live Candlestick Board.
 * Seeds with 100% real historical 1m candles (Frankfurt worker Binance->OKX fallback),
 * streams live real Binance Futures kline_1m bars, plots every trader's active Entry & Liquidation
 * price lines, and drops "PATLADI" markers on real liquidations.
 */
export const LiveCandlestickBoard: React.FC<LiveCandlestickBoardProps> = ({
  openPositions,
  closedLedger,
  livePrices,
  binanceConnected,
}) => {
  const [symbol, setSymbol] = useState<ReplaySymbol>("BTCUSDT");
  const [source, setSource] = useState<CandleSource | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [klineLive, setKlineLive] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const symbolRef = useRef<ReplaySymbol>(symbol);
  symbolRef.current = symbol;

  const activePositions = useMemo(
    () => openPositions.filter((p) => p.symbol === symbol),
    [openPositions, symbol]
  );

  // Initialize TradingView Lightweight-Charts v5 instance once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#06080d" },
        textColor: "#a1a1aa",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(39, 39, 42, 0.45)" },
        horzLines: { color: "rgba(39, 39, 42, 0.45)" },
      },
      crosshair: {
        vertLine: { color: "rgba(245, 158, 11, 0.5)", labelBackgroundColor: "#f59e0b" },
        horzLine: { color: "rgba(245, 158, 11, 0.5)", labelBackgroundColor: "#f59e0b" },
      },
      rightPriceScale: {
        borderColor: "#27272a",
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
      },
      width: el.clientWidth,
      height: 300,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const markerPlugin = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markerPlugin;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Load real 1m historical candles whenever symbol changes
  const reloadSeries = async (sym: ReplaySymbol) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchHistoricalCandles(sym, "1m", 120);
      setSource(res.source);
      if (seriesRef.current) {
        const formatted = res.candles.map((c) => ({
          time: Math.floor(c.ts / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        seriesRef.current.setData(formatted);
        chartRef.current?.timeScale().fitContent();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `${err.message} — Sahte mum üretilmedi.`
          : "Canlı mum geçmişi alınamadı."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadSeries(symbol);
  }, [symbol]);

  // Live Binance Futures kline_1m WebSocket updates (real exchange candles!)
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(KLINE_WSS);
      ws.onopen = () => setKlineLive(true);
      ws.onclose = () => {
        setKlineLive(false);
        if (!closed) {
          retryTimer = window.setTimeout(connect, 3500);
        }
      };
      ws.onerror = () => setKlineLive(false);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const k = msg?.data?.k;
          if (!k || k.s !== symbolRef.current || !seriesRef.current) return;
          const t = Math.floor(Number(k.t) / 1000) as Time;
          const o = parseFloat(k.o);
          const h = parseFloat(k.h);
          const l = parseFloat(k.l);
          const c = parseFloat(k.c);
          if (Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
            seriesRef.current.update({ time: t, open: o, high: h, low: l, close: c });
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

  // Overlay live trader open-position Entry & Liquidation horizontal price lines + "PATLADI" markers
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Clear old price lines
    priceLinesRef.current.forEach((pl) => {
      try {
        series.removePriceLine(pl);
      } catch {
        // Ignore already removed
      }
    });
    priceLinesRef.current = [];

    activePositions.forEach((pos) => {
      const shortName = pos.nickname.split(" ")[0];
      const entryLine = series.createPriceLine({
        price: pos.entryPrice,
        color: pos.side === "LONG" ? "#10b981" : "#f43f5e",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `${shortName} ${pos.side} ${pos.leverage}x`,
      });
      const liqLine = series.createPriceLine({
        price: pos.liquidationPrice,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `LIQ ${shortName}`,
      });
      priceLinesRef.current.push(entryLine, liqLine);
    });

    // Plot recent real closed liquidations ("PATLADI") as markers on timeline
    if (markersRef.current) {
      const liqMarkers = closedLedger
        .filter(
          (e) =>
            e.symbol === symbol &&
            e.closedAtMs &&
            e.reasonExit.toLowerCase().includes("likidasyon")
        )
        .slice(0, 6)
        .map((e) => ({
          time: (Math.floor((e.closedAtMs ?? Date.now()) / 60000) * 60) as Time,
          position: "aboveBar" as const,
          color: "#ef4444",
          shape: "arrowDown" as const,
          text: `PATLADI · ${e.nickname.split(" ")[0]}`,
        }))
        .sort((a, b) => Number(a.time) - Number(b.time));
      markersRef.current.setMarkers(liqMarkers);
    }
  }, [activePositions, closedLedger, symbol]);

  const decimals = SYMBOLS.find((s) => s.key === symbol)?.decimals ?? 2;
  const livePx = livePrices[symbol] ?? 0;

  return (
    <section className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-[#07111a] via-zinc-950 to-zinc-950 p-3.5 shadow-2xl sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-cyan-300 uppercase sm:text-base">
              <CandlestickChart className="h-4 w-4 text-cyan-400" />
              TradingView Canlı Mum &amp; Trader Pozisyon Katmanı
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                klineLive || binanceConnected
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              <Activity className="h-3 w-3 animate-pulse" />
              {klineLive ? "BINANCE KLINE 1m CANLI" : source === "okx_swap" ? "OKX SWAP GERÇEK" : "BAĞLANIYOR"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Trader&apos;ların gerçek giriş seviyeleri (düz çizgi), izole likidasyon duvarları (kesikli kırmızı) ve PATLADI damgaları canlı grafikte.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SYMBOLS.map((s) => {
            const count = openPositions.filter((p) => p.symbol === s.key).length;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  hapticShort();
                  setSymbol(s.key);
                }}
                className={`min-h-[40px] cursor-pointer rounded-xl border px-2.5 font-mono text-xs font-black transition ${
                  symbol === s.key
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {s.label} {count > 0 ? `(${count})` : ""}
              </button>
            );
          })}
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              hapticShort();
              reloadSeries(symbol);
            }}
            aria-label="Grafiği yenile"
            className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Active position overlay badges */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <span className="rounded-lg border border-zinc-800 bg-black/60 px-2.5 py-1 text-zinc-300">
          {symbol}:{" "}
          <strong className="text-white">
            {livePx > 0 ? `$${livePx.toFixed(decimals)}` : "—"}
          </strong>
        </span>
        {activePositions.map((p) => (
          <span
            key={p.positionId}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold ${
              p.side === "LONG"
                ? "border-emerald-500/40 bg-emerald-950/35 text-emerald-200"
                : "border-rose-500/40 bg-rose-950/35 text-rose-200"
            }`}
          >
            <img
              src={`/avatars/${p.traderId}.webp`}
              alt={p.nickname}
              className="h-4 w-4 rounded-full object-cover"
            />
            {p.nickname.split(" ")[0]} {p.side} {p.leverage}x · Liq ${p.liquidationPrice.toFixed(decimals)}
          </span>
        ))}
        {activePositions.length === 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <Skull className="h-3 w-3" /> Bu paritede şu an açık trader pozisyonu yok
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="mt-2.5 rounded-xl border border-red-500/45 bg-red-950/35 px-3 py-2 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Lightweight-Charts Container */}
      <div
        ref={containerRef}
        className="mt-3 w-full overflow-hidden rounded-xl border border-zinc-800/90 bg-[#06080d]"
      />
    </section>
  );
};
