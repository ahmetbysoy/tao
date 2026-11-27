// Tuncay: Live Market-Triggered Turkish Quotes Engine.
// ZERO randomness, ZERO fake triggers: every line fires strictly from real Binance bookTicker
// momentum moves, real !forceOrder@arr liquidations, or real Supabase debt pressure milestones.

import { DebtEnduranceSnapshot } from "./debtEndurance";
import { TraderVoiceId } from "./tts";

export const QUOTE_MOMENTUM_THRESHOLD_PCT = 0.12;
export const QUOTE_DEFAULT_COOLDOWN_MS = 12_000;
export const QUOTE_STALE_FEED_MS = 5_000;

export type QuoteTriggerType = "momentum" | "liquidation" | "debt_pressure";

export interface LiveMarketQuote {
  id: string;
  speakerId: TraderVoiceId;
  speakerName: string;
  triggerType: QuoteTriggerType;
  text: string;
  symbol: string | null;
  createdAtMs: number;
}

let quoteSeq = 0;

function nextQuoteId(nowMs: number): string {
  quoteSeq += 1;
  return `q_${nowMs}_${quoteSeq}`;
}

export function evaluateMomentumQuote(params: {
  symbol: string;
  livePrice: number;
  pctChange15s: number;
  connected: boolean;
  lastTickAgeMs: number;
  nowMs: number;
  lastQuoteMs: number;
  cooldownMs?: number;
}): LiveMarketQuote | null {
  const cooldown = params.cooldownMs ?? QUOTE_DEFAULT_COOLDOWN_MS;
  if (
    !params.connected ||
    params.lastTickAgeMs > QUOTE_STALE_FEED_MS ||
    !Number.isFinite(params.livePrice) ||
    params.livePrice <= 0
  ) {
    return null;
  }
  if (params.nowMs - params.lastQuoteMs < cooldown) return null;
  if (Math.abs(params.pctChange15s) < QUOTE_MOMENTUM_THRESHOLD_PCT) return null;

  const cleanSym = params.symbol.replace("USDT", "");
  const pxStr =
    params.livePrice < 500
      ? `$${params.livePrice.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
      : `$${params.livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sign = params.pctChange15s >= 0 ? "+" : "";
  const pctStr = `${sign}${params.pctChange15s.toFixed(2)}%`;

  const templates: Array<[TraderVoiceId, string, string]> =
    params.pctChange15s > 0
      ? [
          [
            "selo",
            "Selo Roket",
            `${cleanSym} ${pxStr} oldu (${pctStr})! Roketi ateşlediler, shortçuların nefesi kesildi!`,
          ],
          [
            "kemal",
            "Tahta Kemal",
            `${cleanSym} tahtasında alıcı duvarı yırttı: ${pxStr} (${pctStr}). FOMO'ya kapılan yanar.`,
          ],
        ]
      : [
          [
            "mehmet",
            "Fitilci Mehmet",
            `${cleanSym} ${pxStr} seviyesine sert fitil attı (${pctStr})! Kaldıraçlı longlar terliyor.`,
          ],
          [
            "sevil",
            "Madam Sevil",
            `${cleanSym} ${pctStr} sarktı (${pxStr}). Panik yapan değil, disiplinli kalan kazanır.`,
          ],
        ];

  const [speakerId, speakerName, text] = templates[quoteSeq % templates.length];
  return {
    id: nextQuoteId(params.nowMs),
    speakerId,
    speakerName,
    triggerType: "momentum",
    text,
    symbol: params.symbol,
    createdAtMs: params.nowMs,
  };
}

export function evaluateLiquidationQuote(params: {
  symbol: string;
  liquidatedSide: "LONG" | "SHORT";
  notionalUsdt: number;
  price: number;
  nowMs: number;
  lastQuoteMs: number;
  cooldownMs?: number;
}): LiveMarketQuote | null {
  const cooldown = params.cooldownMs ?? QUOTE_DEFAULT_COOLDOWN_MS;
  if (params.notionalUsdt < 10_000 || params.price <= 0) return null;
  if (params.nowMs - params.lastQuoteMs < cooldown && params.notionalUsdt < 1_000_000) {
    return null;
  }

  const cleanSym = params.symbol.replace("USDT", "");
  const usdStr =
    params.notionalUsdt >= 1_000_000
      ? `$${(params.notionalUsdt / 1_000_000).toFixed(2)}M`
      : `$${(params.notionalUsdt / 1_000).toFixed(1)}K`;

  if (params.notionalUsdt >= 1_000_000) {
    return {
      id: nextQuoteId(params.nowMs),
      speakerId: "tefeci",
      speakerName: "Tefeci Abi",
      triggerType: "liquidation",
      text: `BALİNA PATLADI! ${cleanSym} ${params.liquidatedSide} tarafında tek kalemde ${usdStr} buharlaştı — faiz defterini açın!`,
      symbol: params.symbol,
      createdAtMs: params.nowMs,
    };
  }

  const templates: Array<[TraderVoiceId, string, string]> = [
    [
      "mehmet",
      "Fitilci Mehmet",
      `${cleanSym} ${params.liquidatedSide} likidasyonu: ${usdStr} masada kaldı. Fitil yine kurbanını seçti!`,
    ],
    [
      "nuri",
      "Fonlama Nuri",
      `${cleanSym} tahtasında ${usdStr} ${params.liquidatedSide} silindi. Yüksek kaldıraçla inatlaşan hep faturayı öder.`,
    ],
  ];

  const [speakerId, speakerName, text] = templates[quoteSeq % templates.length];
  return {
    id: nextQuoteId(params.nowMs),
    speakerId,
    speakerName,
    triggerType: "liquidation",
    text,
    symbol: params.symbol,
    createdAtMs: params.nowMs,
  };
}

export function evaluateDebtPressureQuote(params: {
  nickname: string;
  endurance: DebtEnduranceSnapshot;
  nowMs: number;
  lastQuoteMs: number;
  cooldownMs?: number;
}): LiveMarketQuote | null {
  const cooldown = params.cooldownMs ?? QUOTE_DEFAULT_COOLDOWN_MS;
  if (params.endurance.owedUsdt <= 0) return null;
  if (params.nowMs - params.lastQuoteMs < cooldown) return null;
  if (!params.endurance.isOverdue && params.endurance.pressurePct < 75) return null;

  const text = params.endurance.isOverdue
    ? `${params.nickname} vadesini aştı! Aktif borç $${params.endurance.owedUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, dakikalık faiz yükü $${params.endurance.burnRatePerMin.toFixed(2)}. Çırağı kapıya gönderelim mi?`
    : `${params.nickname} borç baskısı %${params.endurance.pressurePct} seviyesinde ($${params.endurance.owedUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Rozet: ${params.endurance.badge}.`;

  return {
    id: nextQuoteId(params.nowMs),
    speakerId: "tefeci",
    speakerName: "Tefeci Abi",
    triggerType: "debt_pressure",
    text,
    symbol: null,
    createdAtMs: params.nowMs,
  };
}

export const SPEAKER_ACCENT: Record<
  TraderVoiceId,
  { badge: string; border: string; shortTag: string }
> = {
  tefeci: {
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/50",
    border: "border-amber-500/40",
    shortTag: "KASA",
  },
  selo: {
    badge: "bg-rose-500/20 text-rose-300 border-rose-500/50",
    border: "border-rose-500/40",
    shortTag: "75x",
  },
  mehmet: {
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/50",
    border: "border-orange-500/40",
    shortTag: "FİTİL",
  },
  kemal: {
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
    border: "border-emerald-500/40",
    shortTag: "OBI",
  },
  nuri: {
    badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/50",
    border: "border-cyan-500/40",
    shortTag: "FON",
  },
  sevil: {
    badge: "bg-violet-500/20 text-violet-300 border-violet-500/50",
    border: "border-violet-500/40",
    shortTag: "DİSİPLİN",
  },
};
