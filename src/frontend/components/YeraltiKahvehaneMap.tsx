import React, { useMemo, useState } from "react";
import {
  Coffee,
  Coins,
  Flame,
  Landmark,
  Skull,
  Volume2,
  Zap,
} from "lucide-react";
import { DebtRow, MarketFundingRow, TraderRow } from "../utils/supabase";
import { hapticShort } from "../utils/haptics";
import { playClick } from "../utils/sfx";
import { speakStreetEvent, StreetEventKind, TraderVoiceId } from "../utils/tts";
import { SimulationDisclaimerBanner } from "./SimulationDisclaimerBanner";

export type KahvehaneZoneId =
  | "likidasyon_cukuru"
  | "tefeci_masasi"
  | "kaldirac_masasi"
  | "cay_ocagi";

interface YeraltiKahvehaneMapProps {
  traders: TraderRow[];
  openPositions: Array<{
    traderId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    leverage: number;
  }>;
  debts: DebtRow[];
  livePrices: Record<string, number>;
  fundingSnapshots: MarketFundingRow[];
  binanceConnected: boolean;
  openPnlByTrader: Record<string, number>;
  recentLiqTraders: Record<string, number>;
}

const ZONE_META: Record<
  KahvehaneZoneId,
  {
    title: string;
    subtitle: string;
    borderClass: string;
    bgClass: string;
    titleClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  likidasyon_cukuru: {
    title: "Likidasyon Çukuru",
    subtitle: "Siren köşesi · Panik / ağır erime",
    borderClass: "border-red-500/55",
    bgClass: "bg-gradient-to-br from-red-950/55 via-zinc-950 to-zinc-950",
    titleClass: "text-red-400",
    Icon: Skull,
  },
  tefeci_masasi: {
    title: "Tefeci Masası & Senet",
    subtitle: "Geciken borç · Bileşik faiz baskısı",
    borderClass: "border-amber-500/55",
    bgClass: "bg-gradient-to-br from-amber-950/45 via-zinc-950 to-zinc-950",
    titleClass: "text-amber-300",
    Icon: Landmark,
  },
  kaldirac_masasi: {
    title: "Kaldıraç Masası (Tahta)",
    subtitle: "Aktif açık pozisyon · Canlı PnL",
    borderClass: "border-emerald-500/45",
    bgClass: "bg-gradient-to-br from-emerald-950/35 via-zinc-950 to-zinc-950",
    titleClass: "text-emerald-300",
    Icon: Flame,
  },
  cay_ocagi: {
    title: "Çay Ocağı & Ekran Başı",
    subtitle: "Beklemede · Gerçek sinyal taraması",
    borderClass: "border-zinc-700/70",
    bgClass: "bg-gradient-to-br from-zinc-900/70 via-zinc-950 to-zinc-950",
    titleClass: "text-zinc-300",
    Icon: Coffee,
  },
};

const TRADER_TAG: Record<string, { role: string; genderLabel: string; accent: string }> = {
  selo: { role: "FOMO / Tilt 75x", genderLabel: "E", accent: "text-rose-300 border-rose-500/40" },
  mehmet: { role: "Fitil Avcısı", genderLabel: "E", accent: "text-amber-300 border-amber-500/40" },
  nuri: { role: "Fonlama Avı", genderLabel: "E", accent: "text-cyan-300 border-cyan-500/40" },
  kemal: { role: "Tahta OBI", genderLabel: "E", accent: "text-emerald-300 border-emerald-500/40" },
  sevil: { role: "Madam Disiplin", genderLabel: "K", accent: "text-violet-300 border-violet-500/40" },
};

function assignKahvehaneZone(params: {
  mood: string;
  openPositionsCount: number;
  openPnl: number;
  overdueDebtCount: number;
  recentLiqCount: number;
}): KahvehaneZoneId {
  if (params.mood === "panicked" || params.mood === "busted" || (params.recentLiqCount > 0 && params.openPnl <= -120)) {
    return "likidasyon_cukuru";
  }
  if (params.overdueDebtCount > 0) {
    return "tefeci_masasi";
  }
  if (params.openPositionsCount > 0) {
    return "kaldirac_masasi";
  }
  return "cay_ocagi";
}

function formatFundingCountdown(nextFundingMs: number): string {
  if (!nextFundingMs || nextFundingMs <= Date.now()) return "Canlı";
  const sec = Math.max(0, Math.floor((nextFundingMs - Date.now()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}s ${String(m).padStart(2, "0")}d`;
}

/**
 * Sevil DOPAMİN: Yeraltı Kahvehanesi & Döviz Bürosu Canlı Mekan Haritası.
 * Places all 5 traders deterministically from live positions, debts, PnL, and real funding rates.
 */
export const YeraltiKahvehaneMap: React.FC<YeraltiKahvehaneMapProps> = ({
  traders,
  openPositions,
  debts,
  livePrices,
  fundingSnapshots,
  binanceConnected,
  openPnlByTrader,
  recentLiqTraders,
}) => {
  const [lastShout, setLastShout] = useState<{
    speaker: string;
    gender: "masculine" | "feminine";
    text: string;
  } | null>(null);

  const fundingBySym = useMemo(() => {
    const m: Record<string, MarketFundingRow> = {};
    for (const row of fundingSnapshots) {
      m[row.symbol] = row;
    }
    return m;
  }, [fundingSnapshots]);

  const placedTraders = useMemo(() => {
    const now = Date.now();
    const byZone: Record<
      KahvehaneZoneId,
      Array<{
        trader: TraderRow;
        zone: KahvehaneZoneId;
        openPnl: number;
        posCount: number;
        overdueCount: number;
        topPos?: { symbol: string; side: "LONG" | "SHORT"; leverage: number };
      }>
    > = {
      likidasyon_cukuru: [],
      tefeci_masasi: [],
      kaldirac_masasi: [],
      cay_ocagi: [],
    };

    for (const tr of traders) {
      const trPositions = openPositions.filter((p) => p.traderId === tr.id);
      const openPnl = openPnlByTrader[tr.id] ?? 0;
      const overdueCount = debts.filter(
        (d) =>
          d.trader_id === tr.id &&
          (d.status === "gecikti" || (d.status === "aktif" && Number(d.due_date_ms) <= now))
      ).length;
      const recentLiq = (recentLiqTraders[tr.id] ?? 0) > now - 120_000 ? 1 : 0;

      const zone = assignKahvehaneZone({
        mood: tr.mood || "focused",
        openPositionsCount: trPositions.length,
        openPnl,
        overdueDebtCount: overdueCount,
        recentLiqCount: recentLiq,
      });

      byZone[zone].push({
        trader: tr,
        zone,
        openPnl,
        posCount: trPositions.length,
        overdueCount,
        topPos: trPositions[0],
      });
    }

    return byZone;
  }, [traders, openPositions, debts, openPnlByTrader, recentLiqTraders]);

  const handleTapTrader = (
    tr: TraderRow,
    zone: KahvehaneZoneId,
    openPnl: number
  ) => {
    hapticShort();
    playClick();
    const voiceId = (["selo", "mehmet", "nuri", "kemal", "sevil"].includes(tr.id)
      ? tr.id
      : "tefeci") as TraderVoiceId;

    let kind: StreetEventKind = "wick_catch";
    if (zone === "likidasyon_cukuru") {
      kind = "liquidation";
    } else if (zone === "tefeci_masasi") {
      kind = "debt_pressure";
    } else if (tr.last_signal?.toLowerCase().includes("tilt") || tr.last_signal?.toLowerCase().includes("hata")) {
      kind = "tilt_revenge";
    } else if (tr.id === "nuri") {
      kind = "funding_squeeze";
    } else if (openPnl >= 10) {
      kind = "big_profit";
    } else if (openPnl <= -10) {
      kind = "big_loss";
    }

    const seed =
      (livePrices.BTCUSDT || 60000) +
      Math.abs(openPnl) * 10 +
      Number(tr.balance || 0);
    const delivery = speakStreetEvent(voiceId, kind, seed, false);
    setLastShout({
      speaker: tr.nickname,
      gender: delivery.gender,
      text: delivery.text,
    });
  };

  return (
    <section className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-[#120d08] via-[#09090d] to-[#0a0c12] p-3.5 shadow-2xl sm:p-4">
      {/* Header: Yeraltı Kahvehanesi & Döviz Bürosu */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-amber-300 uppercase sm:text-base">
              <Coffee className="h-4 w-4 text-amber-400" />
              Yeraltı Kahvehanesi &amp; Döviz Bürosu
            </h2>
            <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-200">
              CANLI MEKAN HARİTASI
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Beş karakter gerçek piyasa verisine göre masalar arasında yer değiştirir — konuşması için karakterin üstüne dokun.
          </p>
        </div>

        {/* Live Döviz Bürosu Funding Rate Ticker (Rıza RADAR real Binance/OKX data) */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/35 bg-cyan-950/30 px-2 py-1 font-bold text-cyan-300">
            <Coins className="h-3 w-3" />
            DÖVİZ &amp; FONLAMA PANOSU
          </span>
        </div>
      </div>

      {/* Real Exchange Funding Rate LED Board */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const).map((sym) => {
          const snap = fundingBySym[sym];
          const px = livePrices[sym] || snap?.mark_price || 0;
          const ratePct = snap ? snap.funding_rate * 100 : null;
          const hot = ratePct !== null && Math.abs(ratePct) >= 0.008;
          const decimals = sym === "SOLUSDT" ? 3 : 2;
          return (
            <div
              key={sym}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 font-mono text-xs ${
                hot
                  ? "border-amber-500/50 bg-amber-950/25"
                  : "border-zinc-800/90 bg-black/55"
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-white">{sym.replace("USDT", "")}</span>
                  <span className="text-[10px] text-zinc-400">
                    {px > 0
                      ? `$${px.toLocaleString("en-US", {
                          minimumFractionDigits: decimals,
                          maximumFractionDigits: decimals,
                        })}`
                      : binanceConnected
                      ? "Yükleniyor"
                      : "KOPUK"}
                  </span>
                </div>
                <div className="mt-0.5 text-[9px] text-zinc-500 uppercase">
                  {snap
                    ? `${snap.source === "binance_futures" ? "BINANCE" : "OKX SWAP"} · ${formatFundingCountdown(
                        snap.next_funding_ms
                      )}`
                    : "Gerçek fonlama bekleniyor"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-zinc-500 uppercase">Funding</div>
                <div
                  className={`font-black ${
                    ratePct === null
                      ? "text-zinc-500"
                      : ratePct > 0
                      ? "text-emerald-400"
                      : ratePct < 0
                      ? "text-rose-400"
                      : "text-zinc-300"
                  }`}
                >
                  {ratePct !== null ? `${ratePct >= 0 ? "+" : ""}${ratePct.toFixed(4)}%` : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4 Interactive Kahvehane Zones */}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {(
          ["kaldirac_masasi", "tefeci_masasi", "likidasyon_cukuru", "cay_ocagi"] as KahvehaneZoneId[]
        ).map((zoneId) => {
          const meta = ZONE_META[zoneId];
          const Icon = meta.Icon;
          const occupants = placedTraders[zoneId];

          return (
            <div
              key={zoneId}
              className={`rounded-xl border p-3 ${meta.borderClass} ${meta.bgClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-4 w-4 ${meta.titleClass}`} />
                  <span className={`font-display text-xs font-black tracking-wide uppercase ${meta.titleClass}`}>
                    {meta.title}
                  </span>
                </div>
                <span className="rounded-full bg-black/50 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                  {occupants.length} kişi
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-500">{meta.subtitle}</p>

              <div className="mt-2.5 flex flex-wrap gap-2">
                {occupants.length === 0 ? (
                  <span className="font-mono text-[10px] text-zinc-600 italic">
                    Masa şu an boş...
                  </span>
                ) : (
                  occupants.map(({ trader, openPnl, topPos }) => {
                    const metaTag = TRADER_TAG[trader.id] ?? {
                      role: "Trader",
                      genderLabel: "E",
                      accent: "text-zinc-200 border-zinc-700",
                    };
                    const isProfitFlash = openPnl >= 15;
                    const isLossFlash = openPnl <= -15;

                    return (
                      <button
                        key={trader.id}
                        type="button"
                        onClick={() => handleTapTrader(trader, zoneId, openPnl)}
                        className={`group flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border bg-black/65 px-2.5 py-1.5 text-left transition hover:bg-zinc-900 active:scale-95 ${
                          metaTag.accent
                        } ${
                          isProfitFlash
                            ? "ring-1 ring-emerald-400/50"
                            : isLossFlash
                            ? "ring-1 ring-red-500/60"
                            : ""
                        }`}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 font-mono text-[11px] font-black text-white">
                          {trader.nickname.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-black text-white">
                            <span className="truncate">{trader.nickname}</span>
                            <span className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-400">
                              {metaTag.genderLabel}
                            </span>
                            <Volume2 className="h-3 w-3 text-amber-400 opacity-75 transition group-hover:opacity-100" />
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                            {topPos ? (
                              <span
                                className={
                                  topPos.side === "LONG" ? "text-emerald-400" : "text-rose-400"
                                }
                              >
                                {topPos.symbol.replace("USDT", "")} {topPos.side} {topPos.leverage}x
                              </span>
                            ) : (
                              <span className="text-zinc-500">{metaTag.role}</span>
                            )}
                            {openPnl !== 0 && (
                              <span
                                className={`font-black ${
                                  openPnl >= 0 ? "text-emerald-300" : "text-red-400"
                                }`}
                              >
                                {openPnl >= 0 ? "+" : ""}${openPnl.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Latest Non-Repeating Street Shout Bubble + Efe Compliance Strip */}
      <div className="mt-3 space-y-2">
        {lastShout && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/45 bg-amber-950/30 px-3 py-2.5 text-xs">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-bold text-amber-300 uppercase">
                <span>{lastShout.speaker}</span>
                <span className="rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-zinc-300">
                  {lastShout.gender === "feminine" ? "KADIN TTS" : "ERKEK TTS"} · TEKRARLAMAZ
                </span>
              </div>
              <p className="mt-0.5 font-semibold text-amber-50">&ldquo;{lastShout.text}&rdquo;</p>
            </div>
          </div>
        )}
        <SimulationDisclaimerBanner compact />
      </div>
    </section>
  );
};
