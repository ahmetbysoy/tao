import React, { useState } from "react";
import { Activity, CheckSquare, Coffee, Flame, ShieldAlert, Square, Volume2, Zap } from "lucide-react";

interface HeroGateProps {
  livePrices: Record<string, number>;
  binanceConnected: boolean;
  supabaseReady: boolean;
  inviteCupCode?: string | null;
  onEnter: () => void;
}

const PREVIEW_TRADERS = [
  { id: "selo", name: "Selo Roket", tag: "75x Tilt & Hacim · Erkek TTS", color: "text-rose-400 border-rose-500/35 bg-rose-950/30" },
  { id: "mehmet", name: "Fitilci Mehmet", tag: "50x Fitil Avcısı · Erkek TTS", color: "text-amber-400 border-amber-500/35 bg-amber-950/30" },
  { id: "nuri", name: "Fonlama Nuri", tag: "25x Canlı Funding · Erkek TTS", color: "text-cyan-400 border-cyan-500/35 bg-cyan-950/30" },
  { id: "kemal", name: "Tahta Kemal", tag: "20x OBI Tahta · Erkek TTS", color: "text-emerald-400 border-emerald-500/35 bg-emerald-950/30" },
  { id: "sevil", name: "Madam Sevil", tag: "10x Disiplin · Kadın TTS", color: "text-violet-400 border-violet-500/35 bg-violet-950/30" },
];

export const HeroGate: React.FC<HeroGateProps> = ({
  livePrices,
  binanceConnected,
  supabaseReady,
  inviteCupCode,
  onEnter,
}) => {
  // Efe BANNER: Mandatory hard confirmation gate before entering the simulation
  const [riskAccepted, setRiskAccepted] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-8 text-center">
      {/* Ambient Yeraltı Kahvehanesi & Döviz Bürosu neon glow */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600/15 blur-[130px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-72 w-72 rounded-full bg-red-600/15 blur-[120px]" />

      <div className="relative z-10 mx-auto max-w-2xl space-y-5 sm:space-y-6">
        {/* Live telemetry pill */}
        <div className="inline-flex flex-wrap items-center justify-center gap-2.5 rounded-full border border-zinc-800 bg-zinc-950/90 px-4 py-1.5 font-mono text-xs text-zinc-300 shadow-lg">
          <span
            className={`inline-flex items-center gap-1.5 ${
              binanceConnected ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            <span
              className={`h-2 w-2 animate-pulse rounded-full ${
                binanceConnected ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {binanceConnected ? "GERÇEK BORSA AKIŞI CANLI" : "GERÇEK VERİ BAĞLANIYOR..."}
          </span>
          <span className="text-zinc-700">|</span>
          <span>
            BTC{" "}
            <strong className="text-white">
              {binanceConnected && livePrices.BTCUSDT
                ? `$${livePrices.BTCUSDT.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "—"}
            </strong>
          </span>
          <span>
            ETH{" "}
            <strong className="text-white">
              {binanceConnected && livePrices.ETHUSDT
                ? `$${livePrices.ETHUSDT.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "—"}
            </strong>
          </span>
          <span>
            SOL{" "}
            <strong className="text-white">
              {binanceConnected && livePrices.SOLUSDT
                ? `$${livePrices.SOLUSDT.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "—"}
            </strong>
          </span>
        </div>

        {/* Title */}
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-bold tracking-[0.2em] text-amber-300 uppercase">
            <Coffee className="h-3.5 w-3.5" />
            YERALTI KAHVEHANESİ &amp; DÖVİZ BÜROSU // %100 GERÇEK VERİ
          </div>
          {inviteCupCode && (
            <div className="mx-auto max-w-md rounded-xl border border-cyan-500/50 bg-cyan-950/40 px-4 py-2.5 text-xs text-cyan-100 shadow-lg">
              Davet Kodu Algılandı:{" "}
              <strong className="font-mono tracking-widest text-cyan-300">
                {inviteCupCode}
              </strong>{" "}
              — Onaylayıp girdiğinde Mahalle Kupası ekranı otomatik açılır (üyelik gerekmez).
            </div>
          )}
          <h1 className="font-display text-5xl font-black tracking-tight text-white uppercase sm:text-7xl">
            TEFECİ{" "}
            <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 bg-clip-text text-transparent">
              TERMİNALİ
            </span>
          </h1>
          <p className="mx-auto max-w-lg text-sm leading-relaxed text-zinc-400 sm:text-base">
            Sıfır mock veri! Gerçek Binance/OKX fiyat, fonlama ve geçmiş mum kayıtları üstünde çalışan
            5 insan-hatası yapan mahalle karakteri, tekrarlamayan sokak TTS&apos;i ve canlı mekan haritası.
          </p>
        </div>

        {/* Trader preview chips with custom cyberpunk WebP portraits */}
        <div className="flex flex-wrap justify-center gap-2">
          {PREVIEW_TRADERS.map((t) => (
            <div
              key={t.id}
              className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] shadow-md ${t.color}`}
            >
              <img
                src={`/avatars/${t.id}.webp`}
                alt={t.name}
                className="h-7 w-7 rounded-lg border border-white/20 object-cover"
              />
              <div className="text-left leading-tight">
                <div className="font-bold">{t.name}</div>
                <div className="text-[9px] opacity-80">{t.tag}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Efe BANNER: Mandatory Hard Game & Simulation Risk Gate */}
        <div className="mx-auto max-w-xl rounded-2xl border-2 border-amber-500/60 bg-gradient-to-b from-amber-950/45 via-red-950/30 to-zinc-950/95 p-4 text-left shadow-xl">
          <div className="flex items-center gap-2 text-xs font-black tracking-wider text-amber-300 uppercase">
            <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
            ZORUNLU SİMÜLASYON &amp; RİSK ONAYI (EFE BANNER)
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-200">
            <strong className="text-white">BU BİR OYUN &amp; SİMÜLASYONDUR!</strong> Gerçek borsa
            hesabına emir gönderilmez, gerçek para riski yoktur ve burada geçen sokak jargonu
            diyaloglar kesinlikle <strong className="text-amber-300">yatırım tavsiyesi değildir</strong>.
            Ekrandaki tüm fiyat, fonlama ve mum verileri gerçek borsa kayıtlarıdır; hiçbir kazanç
            garantisi sunmaz.
          </p>

          <button
            type="button"
            role="checkbox"
            aria-checked={riskAccepted}
            onClick={() => setRiskAccepted((prev) => !prev)}
            className={`mt-3 flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs font-bold transition active:scale-[0.99] ${
              riskAccepted
                ? "border-emerald-500/70 bg-emerald-950/45 text-emerald-100"
                : "border-amber-500/50 bg-black/55 text-amber-100 hover:bg-black/75"
            }`}
          >
            {riskAccepted ? (
              <CheckSquare className="h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <Square className="h-5 w-5 shrink-0 text-amber-400" />
            )}
            <span>
              OKUDUM VE ONAYLIYORUM: Bu uygulamanın %100 kurgusal bir oyun/simülasyon olduğunu, gerçek
              para riski ve yatırım tavsiyesi içermediğini kabul ediyorum.
            </span>
          </button>
        </div>

        {/* Enter CTA (locked until mandatory confirmation is checked) */}
        <div className="flex flex-col items-center gap-3 pt-1">
          <button
            type="button"
            disabled={!riskAccepted}
            onClick={onEnter}
            className={`group relative inline-flex min-h-[56px] items-center gap-3 rounded-2xl border-2 px-10 py-4 text-lg font-black tracking-[0.15em] uppercase transition-all duration-200 sm:px-12 sm:text-xl ${
              riskAccepted
                ? "cursor-pointer border-red-500 bg-gradient-to-b from-red-600 to-red-700 text-white shadow-[0_0_50px_rgba(220,38,38,0.55)] hover:scale-[1.03] hover:from-red-500 hover:to-red-600 hover:shadow-[0_0_75px_rgba(239,68,68,0.8)] active:scale-[0.99]"
                : "cursor-not-allowed border-zinc-800 bg-zinc-900/80 text-zinc-500 opacity-70"
            }`}
          >
            <Zap
              className={`h-6 w-6 transition-transform ${
                riskAccepted ? "fill-amber-300 text-amber-300 group-hover:rotate-12" : "text-zinc-600"
              }`}
            />
            {riskAccepted ? "KAHVEHANEYE GİR" : "ÖNCE YUKARIDAKİ ONAYI İŞARETLE"}
          </button>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <Volume2 className="h-3.5 w-3.5 text-amber-500" />
              Erkek + Kadın Tekrarlamayan Türkçe TTS
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-500" />
              Supabase Frankfurt: {supabaseReady ? "Hazır (v7)" : "Yapılandırılmadı"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-red-500" />
              Sıfır Mock · %100 Gerçek Borsa Verisi
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
