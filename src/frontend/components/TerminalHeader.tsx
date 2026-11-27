import React from "react";
import {
  Activity,
  BadgePlus,
  Database,
  Flame,
  Mic,
  MicOff,
  Radio,
  Skull,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";

export interface PriceTick {
  price: number;
  prevPrice: number;
}

interface TerminalHeaderProps {
  ticks: Record<string, PriceTick>;
  binanceConnected: boolean;
  supabaseConnected: boolean;
  workerHealthy: boolean | null;
  sfxOn: boolean;
  ttsOn: boolean;
  onToggleSfx: () => void;
  onToggleTts: () => void;
  onOpenLoanModal: () => void;
  onTriggerPulse: () => void;
  onSimulateWhale: () => void;
  triggerBusy: boolean;
}

const SYMBOLS = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
];

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  ticks,
  binanceConnected,
  supabaseConnected,
  workerHealthy,
  sfxOn,
  ttsOn,
  onToggleSfx,
  onToggleTts,
  onOpenLoanModal,
  onTriggerPulse,
  onSimulateWhale,
  triggerBusy,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#07080c]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-red-600/20 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
            <Flame className="h-5 w-5 text-amber-400" />
            <span className="pulse-ring absolute inset-0 rounded-xl border border-amber-400/40" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-black tracking-wider text-white uppercase sm:text-xl">
                TEFECİ <span className="text-amber-400">//</span>{" "}
                <span className="text-red-500">CANLI TAHSİLAT</span>
              </h1>
              <span className="hidden rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 sm:inline-block">
                FAZ 3
              </span>
            </div>
            {/* Live status pills */}
            <div className="mt-0.5 flex flex-wrap items-center gap-2.5 text-[10px] font-mono text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <Radio
                  className={`h-3 w-3 ${
                    binanceConnected ? "text-emerald-400" : "text-red-500"
                  }`}
                />
                WSS: {binanceConnected ? "CANLI" : "KOPUK"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Database
                  className={`h-3 w-3 ${
                    supabaseConnected ? "text-emerald-400" : "text-amber-400"
                  }`}
                />
                DB: {supabaseConnected ? "REALTIME" : "SENK"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Activity
                  className={`h-3 w-3 ${
                    workerHealthy === true
                      ? "text-emerald-400"
                      : workerHealthy === false
                      ? "text-amber-400"
                      : "text-zinc-500"
                  }`}
                />
                MOTOR:{" "}
                {workerHealthy === true
                  ? "AKTİF"
                  : workerHealthy === false
                  ? "ISINIYOR"
                  : "BEKLİYOR"}
              </span>
            </div>
          </div>
        </div>

        {/* Live Binance Futures Tickers */}
        <div className="flex flex-wrap items-center gap-2">
          {SYMBOLS.map(({ key, label, decimals }) => {
            const tick = ticks[key];
            const px = tick?.price ?? 0;
            const delta = tick ? tick.price - tick.prevPrice : 0;
            const up = delta >= 0;
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-1.5 font-mono text-xs"
              >
                <span className="font-bold text-zinc-400">{label}</span>
                <span
                  className={`font-bold transition-colors ${
                    px === 0
                      ? "text-zinc-500"
                      : up
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {px > 0
                    ? `$${px.toLocaleString("en-US", {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                      })}`
                    : "..."}
                </span>
                {px > 0 && (
                  <span
                    className={`text-[10px] ${
                      up ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {up ? "▲" : "▼"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onSimulateWhale}
            disabled={triggerBusy}
            title="Faz 3 Dark Pattern: $1.5M Balina Likidasyonu simüle et (0.5s kan flaşı + TTS + %50 otomatik faiz)"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/60 bg-rose-950/60 px-2.5 py-1.5 text-xs font-black text-rose-200 transition hover:bg-rose-900/70 disabled:opacity-50"
          >
            <Skull className="h-3.5 w-3.5 text-red-400" />
            <span className="hidden md:inline">Balina $1M+</span>
          </button>

          <button
            onClick={onTriggerPulse}
            disabled={triggerBusy}
            title="Canlı Binance fiyatından anında bir mahalle trader'ını işleme sok"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-600/20 px-3 py-1.5 text-xs font-bold text-red-200 transition hover:bg-red-600/35 disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5 text-red-400" />
            <span className="hidden sm:inline">Piyasayı Kışkırt</span>
          </button>

          <button
            onClick={onOpenLoanModal}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25"
          >
            <BadgePlus className="h-3.5 w-3.5 text-amber-400" />
            <span>Borç Ver</span>
          </button>

          <button
            onClick={onToggleSfx}
            title={sfxOn ? "Ses Efektlerini Kapat" : "Ses Efektlerini Aç"}
            className={`cursor-pointer rounded-lg border p-2 transition ${
              sfxOn
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            {sfxOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            onClick={onToggleTts}
            title={ttsOn ? "Türkçe Sesli Konuşmayı Kapat" : "Türkçe Sesli Konuşmayı Aç"}
            className={`cursor-pointer rounded-lg border p-2 transition ${
              ttsOn
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            {ttsOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
