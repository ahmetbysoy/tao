import React, { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { LivePnL, OpenPosition } from "./components/LivePnL";
import { DebtLedger, LedgerEntry } from "./components/DebtLedger";
import { DarkPatternAlerts, UrgentDebt } from "./components/DarkPatternAlerts";
import { pushDarkPatternEvent, subscribeTable } from "./utils/supabase";
import { speakAs, TraderVoiceId, unlockAudio } from "./utils/tts";

const TRADER_NAMES: Record<string, string> = {
  mehmet: "Fitilci Mehmet",
  kemal: "Tahta Kemal",
  nuri: "Fonlama Nuri",
  selo: "Selo Roket",
  sevil: "Madam Sevil",
};

export default function App() {
  const [entered, setEntered] = useState(false);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [debts, setDebts] = useState<UrgentDebt[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const handleEnterNeighborhood = async () => {
    unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore notification denial
      }
    }
    setEntered(true);
    speakAs("tefeci", "Mahalleye hoş geldin. Bakalım bugün kim likide olacak.");
  };

  useEffect(() => {
    if (!entered) return;

    // 1. Live Binance public bookTicker for millisecond local PnL
    const ws = new WebSocket(
      "wss://fstream.binance.com/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker"
    );
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg.data;
        if (d?.s && d?.b && d?.a) {
          const mid = (parseFloat(d.b) + parseFloat(d.a)) / 2;
          setLivePrices((prev) => ({ ...prev, [d.s]: mid }));
        }
      } catch {
        // Ignore malformed frame
      }
    };

    // 2. Supabase Realtime subscriptions
    const unsubPositions = subscribeTable<Record<string, unknown>>("positions", (rows) => {
      const openList: OpenPosition[] = [];
      const closedList: LedgerEntry[] = [];

      rows.forEach((item) => {
        const id = String(item.id ?? "");
        if (item.status === "closed") {
          closedList.push({
            positionId: id,
            nickname: TRADER_NAMES[String(item.trader_id)] ?? String(item.trader_id),
            symbol: String(item.symbol ?? "BTCUSDT"),
            side: (item.side as "LONG" | "SHORT") ?? "LONG",
            leverage: Number(item.leverage ?? 1),
            netPnl: Number(item.pnl ?? 0),
            reasonEntry: String(item.reason_entry ?? ""),
            reasonExit: String(item.log_reason ?? "Kapatıldı"),
            mood: String(item.mood ?? "focused"),
          });
        } else if (item.entry_price) {
          openList.push({
            positionId: id,
            traderId: String(item.trader_id),
            nickname: TRADER_NAMES[String(item.trader_id)] ?? String(item.trader_id),
            symbol: String(item.symbol),
            side: item.side as "LONG" | "SHORT",
            entryPrice: Number(item.entry_price),
            qty: Number(item.qty),
            leverage: Number(item.leverage),
            isolatedMargin: Number(item.isolated_margin),
            liquidationPrice: Number(item.liquidation_price),
          });
        }
      });

      setPositions(openList);
      setLedgerEntries(closedList);
    });

    const unsubDebts = subscribeTable<Record<string, unknown>>("debts", (rows) => {
      const list: UrgentDebt[] = rows
        .filter((d) => d.status === "aktif" || d.status === "gecikti")
        .map((d) => ({
          debtId: String(d.id ?? ""),
          traderId: (d.trader_id as TraderVoiceId) ?? "selo",
          nickname: TRADER_NAMES[String(d.trader_id)] ?? String(d.trader_id),
          owedUsdt: Number(d.principal ?? 0) - Number(d.total_repaid ?? 0),
          dueDateMs: Number(d.due_date_ms ?? Date.now() + 1800_000),
        }));
      setDebts(list);
    });

    const unsubEvents = subscribeTable<Record<string, unknown>>("events", (rows) => {
      const latest = rows[rows.length - 1];
      if (latest?.type === "LIQUIDATION") {
        confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
        speakAs(
          "tefeci",
          `${TRADER_NAMES[String(latest.trader_id)] ?? "Trader"} likide oldu! Parayı bastın, helal olsun!`
        );
      }
    });

    return () => {
      ws.close();
      unsubPositions();
      unsubDebts();
      unsubEvents();
    };
  }, [entered]);

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!entered) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-center">
        <h1 className="mb-3 text-4xl font-black tracking-tighter text-amber-400 uppercase sm:text-6xl">
          TEFECİ TERMİNALİ
        </h1>
        <p className="mb-8 max-w-md text-sm text-zinc-400">
          Gerçek Binance Futures verisi, acımasız bileşik faiz ve canlı tahsilat.
        </p>
        <button
          onClick={handleEnterNeighborhood}
          className="animate-pulse rounded-xl border-2 border-red-500 bg-red-600 px-10 py-5 text-xl font-black tracking-widest text-white uppercase shadow-[0_0_40px_rgba(220,38,38,0.6)] transition hover:scale-105 hover:bg-red-500"
        >
          MAHALLEYE GİR
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-4 text-zinc-100 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <h1 className="text-2xl font-black tracking-wider text-amber-400 uppercase">
            TEFECİ // CANLI TAHSiLAT
          </h1>
          <div className="flex gap-4 font-mono text-xs text-zinc-400">
            <span>BTC: ${livePrices.BTCUSDT?.toFixed(2) ?? "..."}</span>
            <span>ETH: ${livePrices.ETHUSDT?.toFixed(2) ?? "..."}</span>
          </div>
        </header>

        <DarkPatternAlerts
          debts={debts}
          onDoubleInterest={(debtId) =>
            pushDarkPatternEvent("DOUBLE_INTEREST", "", `Faiz katlandı: ${debtId}`)
          }
          onSendEnforcer={(traderId) =>
            pushDarkPatternEvent("SEND_ENFORCER", traderId, `Çırak gönderildi: ${traderId}`)
          }
        />

        <LivePnL positions={positions} livePrices={livePrices} />

        <DebtLedger
          entries={ledgerEntries}
          onExportJson={() =>
            downloadFile(
              "tefeci-zarar-loglari.json",
              JSON.stringify(ledgerEntries.filter((e) => e.netPnl < 0), null, 2),
              "application/json"
            )
          }
          onExportMarkdown={() => {
            const losses = ledgerEntries.filter((e) => e.netPnl < 0);
            const md = [
              "# TEFECİ İNTİKAM DEFTERİ — ZARAR RAPORU",
              "",
              "| Trader | Coin | Net PnL | Neden Battı |",
              "|---|---|---:|---|",
              ...losses.map(
                (l) => `| ${l.nickname} | ${l.symbol} ${l.side} ${l.leverage}x | ${l.netPnl.toFixed(2)}$ | ${l.reasonExit} |`
              ),
            ].join("\n");
            downloadFile("tefeci-zarar-raporu.md", md, "text/markdown");
          }}
        />
      </div>
    </div>
  );
}
