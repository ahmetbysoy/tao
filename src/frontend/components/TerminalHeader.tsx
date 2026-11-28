import React, { useEffect, useState } from "react";
import {
  Activity,
  BadgePlus,
  Database,
  Mic,
  MicOff,
  Monitor,
  Radio,
  Smartphone,
  Volume2,
  VolumeX,
  Waves,
  Zap,
} from "lucide-react";
import { hapticShort } from "../utils/haptics";
import { NavTab } from "./BottomNav";

export interface PriceTick {
  price: number;
  prevPrice: number;
  updatedAtMs: number;
}

interface TerminalHeaderProps {
  ticks: Record<string, PriceTick>;
  binanceConnected: boolean;
  supabaseConnected: boolean;
  workerHealthy: boolean | null;
  sfxOn: boolean;
  ttsOn: boolean;
  hapticsOn: boolean;
  shakeOn: boolean;
  crtOn: boolean;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onToggleSfx: () => void;
  onToggleTts: () => void;
  onToggleHaptics: () => void;
  onToggleShake: () => void;
  onToggleCrt: () => void;
  onOpenLoanModal: () => void;
  onTriggerPulse: () => void;
  triggerBusy: boolean;
}

const SYMBOLS = [
  { key: "BTCUSDT", label: "BTC", decimals: 2 },
  { key: "ETHUSDT", label: "ETH", decimals: 2 },
  { key: "SOLUSDT", label: "SOL", decimals: 3 },
];

const STALE_HEADER_MS = 5_000;

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  ticks,
  binanceConnected,
  supabaseConnected,
  workerHealthy,
  sfxOn,
  ttsOn,
  hapticsOn,
  shakeOn,
  crtOn,
  activeTab,
  onSelectTab,
  onToggleSfx,
  onToggleTts,
  onToggleHaptics,
  onToggleShake,
  onToggleCrt,
  onOpenLoanModal,
  onTriggerPulse,
  triggerBusy,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#07080c]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:py-3">
        {/* Top Row on Mobile: Brand + Status Pills + Primary Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-amber-500/60 bg-black shadow-[0_0_20px_rgba(245,158,11,0.28)]">
              <img
                src="/avatars/tefeci.webp"
                alt="Patron Tefeci"
                className="h-full w-full object-cover"
              />
              <span className="pulse-ring absolute inset-0 rounded-xl border border-amber-400/40" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate font-display text-base font-black tracking-wider text-white uppercase sm:text-lg">
                  TEFECİ <span className="text-amber-400">//</span>{" "}
                  <span className="text-red-500">CANLI</span>
                </h1>
                <span className="rounded border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                  NEO V5
                </span>
              </div>
              {/* Live status pills */}
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-400">
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
                  DB: {supabaseConnected ? "RT" : "SENK"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Activity
                    className={`h-3 w-3 ${
                      workerHealthy === true
                        ? "text-emerald-400"
                        : workerHealthy === false
                        ? "text-red-400"
                        : "text-amber-400"
                    }`}
                  />
                  MOTOR:{" "}
                  {workerHealthy === true
                    ? "AKTİF"
                    : workerHealthy === false
                    ? "HATA"
                    : "KONTROL"}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile Primary CTA: Borç Ver (>= 44px) */}
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={() => {
                hapticShort();
                onTriggerPulse();
              }}
              disabled={triggerBusy}
              title="Canlı emir defteri dengesiyle bir trader'ı tahtaya sür"
              className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-red-500/50 bg-red-600/20 text-red-200 transition active:scale-95 disabled:opacity-50"
            >
              <Zap className="h-4 w-4 text-red-400" />
            </button>
            <button
              type="button"
              onClick={() => {
                hapticShort();
                onOpenLoanModal();
              }}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 px-3 text-xs font-black text-amber-200 transition active:scale-95"
            >
              <BadgePlus className="h-4 w-4 text-amber-400" />
              <span>Borç</span>
            </button>
          </div>
        </div>

        {/* Live Binance Futures Tickers (NEVER shows stale/disconnected price as live) */}
        <div className="grid grid-cols-3 gap-1.5 lg:flex lg:items-center lg:gap-2">
          {SYMBOLS.map(({ key, label, decimals }) => {
            const tick = ticks[key];
            const fresh =
              binanceConnected &&
              Boolean(tick?.price) &&
              nowMs - (tick?.updatedAtMs ?? 0) <= STALE_HEADER_MS;
            const px = tick?.price ?? 0;
            const delta = tick ? tick.price - tick.prevPrice : 0;
            const up = delta >= 0;
            return (
              <div
                key={key}
                className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 font-mono text-[11px] sm:px-3 sm:text-xs ${
                  fresh
                    ? "border-zinc-800 bg-zinc-950/90"
                    : "border-red-900/60 bg-red-950/25"
                }`}
              >
                <span className="font-bold text-zinc-400">{label}</span>
                {fresh ? (
                  <span
                    className={`truncate font-bold transition-colors ${
                      up ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    $
                    {px.toLocaleString("en-US", {
                      minimumFractionDigits: decimals,
                      maximumFractionDigits: decimals,
                    })}
                  </span>
                ) : (
                  <span className="font-bold text-red-400">KOPUK</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Controls Bar: Desktop Navigation + Sensory Toggles (ALL >= 44px) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 lg:justify-end">
          {/* Desktop Section Switcher */}
          <div className="hidden items-center gap-1 rounded-xl border border-zinc-800/90 bg-zinc-950/90 p-1 lg:flex">
            {(
              [
                ["market", "Piyasa"],
                ["traders", "Traderlar"],
                ["fitil", "Fitil & Kupa"],
                ["debts", "Senetler"],
                ["replay", "Mum Tekrarı"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTab(id)}
                className={`min-h-[36px] cursor-pointer rounded-lg px-2.5 text-xs font-bold transition ${
                  activeTab === id
                    ? "bg-amber-500/20 text-amber-300"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Desktop Action Buttons */}
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onTriggerPulse();
            }}
            disabled={triggerBusy}
            title="Canlı emir defteri dengesiyle bir trader'ı işleme sok"
            className="hidden min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-600/20 px-3 text-xs font-bold text-red-200 transition hover:bg-red-600/35 disabled:opacity-50 lg:inline-flex"
          >
            <Zap className="h-3.5 w-3.5 text-red-400" />
            <span>Piyasayı Kışkırt</span>
          </button>

          <button
            type="button"
            onClick={() => {
              hapticShort();
              onOpenLoanModal();
            }}
            className="hidden min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/15 px-3 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25 lg:inline-flex"
          >
            <BadgePlus className="h-3.5 w-3.5 text-amber-400" />
            <span>Borç Ver</span>
          </button>

          {/* 4 Sensory Switches: SFX, TTS, Shake, Haptics (ALL >= 44x44px) */}
          <div className="flex w-full items-center justify-between gap-1.5 lg:w-auto">
            <button
              type="button"
              onClick={onToggleSfx}
              aria-pressed={sfxOn}
              title={sfxOn ? "Ses Efektlerini Kapat" : "Ses Efektlerini Aç"}
              className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition active:scale-95 lg:min-w-[44px] lg:flex-none ${
                sfxOn
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              {sfxOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="lg:hidden">Ses</span>
            </button>

            <button
              type="button"
              onClick={onToggleTts}
              aria-pressed={ttsOn}
              title={ttsOn ? "Sesli Konuşmayı Kapat" : "Sesli Konuşmayı Aç"}
              className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition active:scale-95 lg:min-w-[44px] lg:flex-none ${
                ttsOn
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              {ttsOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              <span className="lg:hidden">Spiker</span>
            </button>

            <button
              type="button"
              onClick={onToggleShake}
              aria-pressed={shakeOn}
              title={shakeOn ? "Ekran Sarsıntısını Kapat" : "Ekran Sarsıntısını Aç"}
              className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition active:scale-95 lg:min-w-[44px] lg:flex-none ${
                shakeOn
                  ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              <Waves className="h-4 w-4" />
              <span className="lg:hidden">Sarsıntı</span>
            </button>

            <button
              type="button"
              onClick={onToggleHaptics}
              aria-pressed={hapticsOn}
              title={hapticsOn ? "Titreşimi (Haptik) Kapat" : "Titreşimi (Haptik) Aç"}
              className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition active:scale-95 lg:min-w-[44px] lg:flex-none ${
                hapticsOn
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              <span className="lg:hidden">Haptik</span>
            </button>

            <button
              type="button"
              onClick={onToggleCrt}
              aria-pressed={crtOn}
              title={crtOn ? "Retro CRT Tarama Çizgisini Kapat" : "Retro CRT Tarama Çizgisini Aç"}
              className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-bold transition active:scale-95 lg:min-w-[44px] lg:flex-none ${
                crtOn
                  ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              <Monitor className="h-4 w-4" />
              <span className="lg:hidden">CRT</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
