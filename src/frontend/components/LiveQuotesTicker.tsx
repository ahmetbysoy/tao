import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  MessageSquareQuote,
  Radio,
  Volume2,
  WifiOff,
} from "lucide-react";
import { hapticShort } from "../utils/haptics";
import { LiveMarketQuote, SPEAKER_ACCENT } from "../utils/liveQuotes";
import { speakAs } from "../utils/tts";

interface LiveQuotesTickerProps {
  quotes: LiveMarketQuote[];
  binanceConnected: boolean;
  ttsOn: boolean;
}

function triggerLabel(type: LiveMarketQuote["triggerType"]): { text: string; cls: string } {
  switch (type) {
    case "liquidation":
      return {
        text: "GERÇEK LİKİDASYON",
        cls: "border-red-500/40 bg-red-950/50 text-red-300",
      };
    case "debt_pressure":
      return {
        text: "BORÇ BASKISI",
        cls: "border-amber-500/40 bg-amber-950/50 text-amber-300",
      };
    default:
      return {
        text: "CANLI MOMENTUM",
        cls: "border-emerald-500/40 bg-emerald-950/50 text-emerald-300",
      };
  }
}

export const LiveQuotesTicker: React.FC<LiveQuotesTickerProps> = ({
  quotes,
  binanceConnected,
  ttsOn,
}) => {
  const [expanded, setExpanded] = useState(false);
  const latest = quotes[0] ?? null;

  return (
    <section className="rounded-xl border border-zinc-800/90 bg-gradient-to-r from-[#0e0c14] via-zinc-950 to-zinc-950 p-3 shadow-lg sm:p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="font-display text-xs font-black tracking-wider text-zinc-100 uppercase">
            Mahalle Canlı Replikleri
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
              binanceConnected
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-red-500/20 text-red-300"
            }`}
          >
            {binanceConnected ? (
              <>
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                CANLI TETİK
              </>
            ) : (
              <>
                <WifiOff className="h-2.5 w-2.5" />
                AKIŞ KOPUK
              </>
            )}
          </span>
        </div>

        {quotes.length > 1 && (
          <button
            type="button"
            onClick={() => {
              hapticShort();
              setExpanded((prev) => !prev);
            }}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-[11px] font-bold text-zinc-300 transition hover:bg-zinc-800 active:scale-95"
          >
            Geçmiş ({quotes.length})
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Latest Live Triggered Quote */}
      {!binanceConnected && !latest ? (
        <div className="mt-2.5 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2.5 text-xs text-red-300">
          Binance canlı akışı koptuğu için piyasa repliği üretilmiyor. Bağlantı dönünce gerçek hareketlerle devam eder.
        </div>
      ) : !latest ? (
        <div className="mt-2.5 rounded-lg border border-zinc-800/80 bg-black/40 px-3 py-2.5 text-xs text-zinc-400">
          Canlı tahta dinleniyor — BTC/ETH/SOL ±%0.12 hareket ettiğinde veya $10K+ likidasyon düştüğünde mahalle konuşmaya başlar.
        </div>
      ) : (
        (() => {
          const accent = SPEAKER_ACCENT[latest.speakerId] ?? SPEAKER_ACCENT.tefeci;
          const trig = triggerLabel(latest.triggerType);
          const timeStr = new Date(latest.createdAtMs).toLocaleTimeString("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          return (
            <div
              className={`mt-2.5 flex flex-col gap-2 rounded-xl border bg-black/55 p-3 sm:flex-row sm:items-center sm:justify-between ${accent.border}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                  <span className={`rounded border px-1.5 py-0.5 font-bold uppercase ${accent.badge}`}>
                    {latest.speakerName} · {accent.shortTag}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 font-bold ${trig.cls}`}>
                    {trig.text}
                  </span>
                  <span className="text-zinc-500">{timeStr}</span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-100 sm:text-sm">
                  &ldquo;{latest.text}&rdquo;
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  hapticShort();
                  speakAs(latest.speakerId, latest.text);
                }}
                title={ttsOn ? "Repliği sesli oku" : "Sesli okuma (TTS kapalıysa tarayıcı ayarını açın)"}
                className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-950/40 px-3 text-[11px] font-bold text-amber-200 transition hover:bg-amber-900/50 active:scale-95"
              >
                <Volume2 className="h-4 w-4" />
                Dinle
              </button>
            </div>
          );
        })()
      )}

      {/* Expandable Recent History */}
      {expanded && quotes.length > 1 && (
        <div className="mt-2.5 space-y-1.5 border-t border-zinc-800/80 pt-2.5">
          {quotes.slice(1, 7).map((q) => {
            const accent = SPEAKER_ACCENT[q.speakerId] ?? SPEAKER_ACCENT.tefeci;
            const timeStr = new Date(q.createdAtMs).toLocaleTimeString("tr-TR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div
                key={q.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-zinc-900 bg-zinc-950/80 px-2.5 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className={`mr-1.5 inline-block rounded border px-1 py-0.5 font-mono text-[9px] font-bold uppercase ${accent.badge}`}>
                    {q.speakerName}
                  </span>
                  <span className="text-zinc-300">&ldquo;{q.text}&rdquo;</span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">{timeStr}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
