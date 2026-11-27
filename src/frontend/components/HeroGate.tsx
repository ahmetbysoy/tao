import React from "react";
import { Activity, Flame, ShieldAlert, Volume2, Zap } from "lucide-react";

interface HeroGateProps {
  livePrices: Record<string, number>;
  supabaseReady: boolean;
  onEnter: () => void;
}

const PREVIEW_TRADERS = [
  { name: "Selo Roket", tag: "75x Hacim Manyağı", color: "text-rose-400 border-rose-500/30 bg-rose-950/30" },
  { name: "Fitilci Mehmet", tag: "50x Likidasyon Avcısı", color: "text-amber-400 border-amber-500/30 bg-amber-950/30" },
  { name: "Fonlama Nuri", tag: "25x Funding Arbitraj", color: "text-cyan-400 border-cyan-500/30 bg-cyan-950/30" },
  { name: "Tahta Kemal", tag: "20x OBI & Spoofing", color: "text-emerald-400 border-emerald-500/30 bg-emerald-950/30" },
  { name: "Madam Sevil", tag: "8x Bollinger + RSI", color: "text-violet-400 border-violet-500/30 bg-violet-950/30" },
];

export const HeroGate: React.FC<HeroGateProps> = ({
  livePrices,
  supabaseReady,
  onEnter,
}) => {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 text-center">
      {/* Ambient neon beams */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/15 blur-[130px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-72 w-72 rounded-full bg-amber-500/10 blur-[120px]" />

      <div className="relative z-10 mx-auto max-w-2xl space-y-8">
        {/* Live telemetry pill */}
        <div className="inline-flex flex-wrap items-center justify-center gap-3 rounded-full border border-zinc-800 bg-zinc-950/90 px-4 py-1.5 text-xs font-mono text-zinc-300 shadow-lg">
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            BINANCE FUTURES CANLI
          </span>
          <span className="text-zinc-700">|</span>
          <span>
            BTC{" "}
            <strong className="text-white">
              ${livePrices.BTCUSDT ? livePrices.BTCUSDT.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </strong>
          </span>
          <span>
            ETH{" "}
            <strong className="text-white">
              ${livePrices.ETHUSDT ? livePrices.ETHUSDT.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </strong>
          </span>
          <span>
            SOL{" "}
            <strong className="text-white">
              ${livePrices.SOLUSDT ? livePrices.SOLUSDT.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </strong>
          </span>
        </div>

        {/* Title */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold tracking-[0.25em] text-amber-400 uppercase">
            <Flame className="h-3.5 w-3.5" />
            FAZ 2 // DOPAMİN TERMİNALİ
          </div>
          <h1 className="font-display text-5xl font-black tracking-tight text-white uppercase sm:text-7xl">
            TEFECİ{" "}
            <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 bg-clip-text text-transparent">
              TERMİNALİ
            </span>
          </h1>
          <p className="mx-auto max-w-lg text-sm leading-relaxed text-zinc-400 sm:text-base">
            Gerçek zamanlı Binance Futures akışı, 5 acımasız algoritmik mahalle trader&apos;ı,
            bileşik faiz tahsilatı ve anlık likidasyon kontrol odası.
          </p>
        </div>

        {/* Trader preview chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {PREVIEW_TRADERS.map((t) => (
            <div
              key={t.name}
              className={`rounded-lg border px-3 py-1.5 text-xs ${t.color}`}
            >
              <span className="font-bold">{t.name}</span>{" "}
              <span className="opacity-75">· {t.tag}</span>
            </div>
          ))}
        </div>

        {/* Enter CTA */}
        <div className="flex flex-col items-center gap-4 pt-2">
          <button
            onClick={onEnter}
            className="group relative inline-flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-red-500 bg-gradient-to-b from-red-600 to-red-700 px-12 py-5 text-xl font-black tracking-[0.18em] text-white uppercase shadow-[0_0_50px_rgba(220,38,38,0.55)] transition-all duration-200 hover:scale-[1.03] hover:from-red-500 hover:to-red-600 hover:shadow-[0_0_75px_rgba(239,68,68,0.8)] active:scale-[0.99]"
          >
            <Zap className="h-6 w-6 fill-amber-300 text-amber-300 transition-transform group-hover:rotate-12" />
            MAHALLEYE GİR
          </button>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <Volume2 className="h-3.5 w-3.5 text-amber-500" />
              Web Audio SFX &amp; Türkçe TTS ses motorunu açar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-500" />
              Supabase Realtime: {supabaseReady ? "Hazır (Frankfurt)" : "Yapılandırılmadı"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
              Simülasyon — Gerçek para kullanılmaz
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
