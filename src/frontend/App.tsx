import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Skull, Sparkles } from "lucide-react";
import { HeroGate } from "./components/HeroGate";
import { PriceTick, TerminalHeader } from "./components/TerminalHeader";
import { KpiBar } from "./components/KpiBar";
import { LiveEquityChart } from "./components/LiveEquityChart";
import { DarkPatternAlerts, UrgentDebt } from "./components/DarkPatternAlerts";
import { TraderRoster } from "./components/TraderRoster";
import { LivePnL, OpenPosition } from "./components/LivePnL";
import { NotificationFeed } from "./components/NotificationFeed";
import { DebtLedger, LedgerEntry } from "./components/DebtLedger";
import { LoanModal } from "./components/LoanModal";
import {
  DebtRow,
  EquitySnapshotRow,
  EventRow,
  isSupabaseConfigured,
  PositionRow,
  pushCommand,
  subscribeTable,
  TraderRow,
} from "./utils/supabase";
import {
  isSfxEnabled,
  playCashRegister,
  playClick,
  playEnforcerKnock,
  playLiquidationSiren,
  playTradeOpen,
  playWhaleAlertSiren,
  setSfxEnabled,
  unlockSfx,
} from "./utils/sfx";
import {
  isTtsEnabled,
  setTtsEnabled,
  speakAs,
  TraderVoiceId,
  unlockAudio,
} from "./utils/tts";

const TRADER_NAMES: Record<string, string> = {
  mehmet: "Fitilci Mehmet",
  kemal: "Tahta Kemal",
  nuri: "Fonlama Nuri",
  selo: "Selo Roket",
  sevil: "Madam Sevil",
};

interface ToastItem {
  id: number;
  title: string;
  message: string;
  tone: "danger" | "gold" | "success" | "info";
}

export default function App() {
  const [entered, setEntered] = useState(false);
  const [ticks, setTicks] = useState<Record<string, PriceTick>>({});
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [workerHealthy, setWorkerHealthy] = useState<boolean | null>(null);

  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [debtRows, setDebtRows] = useState<DebtRow[]>([]);
  const [positionRows, setPositionRows] = useState<PositionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [snapshots, setSnapshots] = useState<EquitySnapshotRow[]>([]);

  const [sfxOn, setSfxOn] = useState<boolean>(() => isSfxEnabled());
  const [ttsOn, setTtsOn] = useState<boolean>(() => isTtsEnabled());
  const [loanModalOpen, setLoanModalOpen] = useState(false);
  const [loanModalTrader, setLoanModalTrader] = useState<TraderVoiceId>("selo");
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [liqFlashKey, setLiqFlashKey] = useState<number>(0);
  const [whaleFlashKey, setWhaleFlashKey] = useState<number>(0);
  const [whalePanicActive, setWhalePanicActive] = useState<boolean>(false);
  const [whaleBannerText, setWhaleBannerText] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const lastSeenEventIdRef = useRef<number>(0);
  const initializedEventsRef = useRef<boolean>(false);
  const lastWhaleAlertMsRef = useRef<number>(0);
  const whalePanicTimerRef = useRef<number | null>(null);

  const addToast = useCallback(
    (title: string, message: string, tone: ToastItem["tone"] = "info") => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev.slice(-3), { id, title, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  // Faz 3 Dark Pattern: Whale Alert Manipulator ($1M+ Binance liquidation)
  const triggerWhaleManipulator = useCallback(
    (symbol: string, notionalUsdt: number, customMsg?: string) => {
      const now = Date.now();
      if (now - lastWhaleAlertMsRef.current < 8000) return;
      lastWhaleAlertMsRef.current = now;

      const notionalM = (notionalUsdt / 1_000_000).toFixed(2);
      const banner =
        customMsg ||
        `${symbol} üzerinde $${notionalM}M tek seferde likide oldu! Selo Roket kan kokusunu aldı, borç faizi otomatik %50 artırıldı!`;

      // 1. 0.5-second blood-red full-screen flash
      setWhaleFlashKey(now);

      // 2. Whale siren + Turkish TTS scream
      playWhaleAlertSiren();
      speakAs(
        "tefeci",
        "BALİNA PATLADI! Selo Roket kan kokusunu aldı, borç faizini otomatik yüzde elli artırdım!"
      );

      // 3. Activate pulsing heartbeat mode on "FAİZİ KATLA" buttons for 15 seconds
      setWhaleBannerText(banner);
      setWhalePanicActive(true);
      if (whalePanicTimerRef.current) {
        window.clearTimeout(whalePanicTimerRef.current);
      }
      whalePanicTimerRef.current = window.setTimeout(() => {
        setWhalePanicActive(false);
      }, 15_000);

      confetti({
        particleCount: 130,
        spread: 110,
        origin: { y: 0.45 },
        colors: ["#dc2626", "#ef4444", "#f59e0b"],
      });
      addToast(`BALİNA PATLADI! ($${notionalM}M ${symbol})`, banner, "danger");
    },
    [addToast]
  );

  // Live Binance Futures WebSocket (bookTicker + $1M+ forceOrder Whale Alert stream)
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(
        "wss://fstream.binance.com/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/solusdt@bookTicker/btcusdt@forceOrder/ethusdt@forceOrder/solusdt@forceOrder"
      );
      ws.onopen = () => setBinanceConnected(true);
      ws.onclose = () => {
        setBinanceConnected(false);
        if (!closed) {
          retryTimer = window.setTimeout(connect, 2500);
        }
      };
      ws.onerror = () => {
        setBinanceConnected(false);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const stream: string = msg.stream ?? "";
          const d = msg.data;
          if (stream.endsWith("@bookTicker") && d?.s && d?.b && d?.a) {
            const mid = (parseFloat(d.b) + parseFloat(d.a)) / 2;
            setTicks((prev) => ({
              ...prev,
              [d.s]: {
                price: mid,
                prevPrice: prev[d.s]?.price ?? mid,
              },
            }));
          } else if (stream.endsWith("@forceOrder") && d?.o) {
            const o = d.o;
            const avgPx = parseFloat(o.ap ?? o.p ?? "0");
            const qty = parseFloat(o.q ?? "0");
            const notional = avgPx * qty;
            if (notional >= 1_000_000 && entered) {
              triggerWhaleManipulator(String(o.s ?? "BTCUSDT"), notional);
            }
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
  }, [entered, triggerWhaleManipulator]);

  // Poll worker /health via Vite relative proxy
  useEffect(() => {
    if (!entered) return;
    let active = true;
    const pollHealth = async () => {
      try {
        const res = await fetch("/health");
        if (!active) return;
        setWorkerHealthy(res.ok);
      } catch {
        if (active) setWorkerHealthy(null);
      }
    };
    pollHealth();
    const timer = window.setInterval(pollHealth, 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [entered]);

  // Supabase Realtime subscriptions for all 5 tables
  useEffect(() => {
    if (!entered) return;

    const unsubTraders = subscribeTable<TraderRow>("traders", setTraders, {
      orderBy: { column: "id", ascending: true },
      onStatusChange: setSupabaseConnected,
    });

    const unsubDebts = subscribeTable<DebtRow>("debts", setDebtRows, {
      orderBy: { column: "due_date_ms", ascending: true },
    });

    const unsubPositions = subscribeTable<PositionRow>("positions", setPositionRows, {
      orderBy: { column: "created_at", ascending: false },
      limit: 150,
    });

    const unsubSnapshots = subscribeTable<EquitySnapshotRow>(
      "equity_snapshots",
      setSnapshots,
      {
        orderBy: { column: "ts_ms", ascending: false },
        limit: 90,
        pollMs: 6000,
      }
    );

    const unsubEvents = subscribeTable<EventRow>(
      "events",
      (rows) => {
        setEvents(rows);
        if (rows.length === 0) return;

        const maxId = Math.max(...rows.map((r) => r.id));
        if (!initializedEventsRef.current) {
          initializedEventsRef.current = true;
          lastSeenEventIdRef.current = maxId;
          return;
        }

        const fresh = rows
          .filter((r) => r.id > lastSeenEventIdRef.current)
          .sort((a, b) => a.id - b.id);
        if (fresh.length === 0) return;
        lastSeenEventIdRef.current = maxId;

        fresh.forEach((ev) => {
          if (ev.type === "WHALE_ALERT") {
            const sym = String(ev.payload?.symbol ?? "BTCUSDT");
            const notional = Number(ev.payload?.notional_usdt ?? 1_250_000);
            triggerWhaleManipulator(sym, notional, ev.message);
          } else if (ev.type === "LIQUIDATION") {
            setLiqFlashKey(Date.now());
            playLiquidationSiren();
            confetti({
              particleCount: 110,
              spread: 95,
              origin: { y: 0.55 },
              colors: ["#ef4444", "#f59e0b", "#10b981"],
            });
            const who = TRADER_NAMES[ev.trader_id ?? ""] ?? ev.trader_id ?? "Trader";
            speakAs("tefeci", `${who} likide oldu! Parayı bastın, helal olsun!`);
            addToast("LİKİDASYON!", ev.message, "danger");
          } else if (ev.type === "OPEN_POSITION") {
            playTradeOpen();
            addToast("Yeni Canlı Pozisyon", ev.message, "info");
          } else if (ev.type === "CLOSE_POSITION") {
            const pnl = Number(ev.payload?.pnl ?? 0);
            if (pnl >= 0) playCashRegister();
            addToast("Pozisyon Kapandı", ev.message, pnl >= 0 ? "success" : "danger");
          } else if (ev.type === "COMPOUND") {
            addToast("Bileşik Faiz İşledi", ev.message, "gold");
          } else if (ev.type === "SYSTEM" && ev.trader_id !== "tefeci") {
            addToast("Tahsilat Güncellemesi", ev.message, "gold");
          }
        });
      },
      {
        orderBy: { column: "id", ascending: false },
        limit: 60,
        pollMs: 3000,
      }
    );

    return () => {
      unsubTraders();
      unsubDebts();
      unsubPositions();
      unsubSnapshots();
      unsubEvents();
    };
  }, [entered, addToast, triggerWhaleManipulator]);

  const livePrices = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(ticks).forEach(([k, v]) => {
      out[k] = v.price;
    });
    return out;
  }, [ticks]);

  const traderMap = useMemo(() => {
    const m: Record<string, TraderRow> = {};
    traders.forEach((t) => {
      m[t.id] = t;
    });
    return m;
  }, [traders]);

  const { openPositions, closedLedger, openPnlByTrader, openCountByTrader, totalUnrealizedPnl, lockedMargin } =
    useMemo(() => {
      const openList: OpenPosition[] = [];
      const closedList: LedgerEntry[] = [];
      const pnlMap: Record<string, number> = {};
      const countMap: Record<string, number> = {};
      let sumUnrealized = 0;
      let sumLocked = 0;

      positionRows.forEach((row) => {
        const nickname = traderMap[row.trader_id]?.nickname ?? TRADER_NAMES[row.trader_id] ?? row.trader_id;
        if (row.status === "open") {
          const pos: OpenPosition = {
            positionId: row.id,
            traderId: row.trader_id,
            nickname,
            symbol: row.symbol,
            side: row.side,
            entryPrice: Number(row.entry_price),
            qty: Number(row.qty),
            leverage: Number(row.leverage),
            isolatedMargin: Number(row.isolated_margin),
            liquidationPrice: Number(row.liquidation_price),
            stopLoss: row.stop_loss !== null ? Number(row.stop_loss) : null,
            takeProfit: row.take_profit !== null ? Number(row.take_profit) : null,
            reasonEntry: row.reason_entry ?? "",
          };
          openList.push(pos);
          const cur = livePrices[pos.symbol] ?? pos.entryPrice;
          const upnl =
            pos.side === "LONG"
              ? (cur - pos.entryPrice) * pos.qty
              : (pos.entryPrice - cur) * pos.qty;
          sumUnrealized += upnl;
          sumLocked += pos.isolatedMargin;
          pnlMap[pos.traderId] = (pnlMap[pos.traderId] ?? 0) + upnl;
          countMap[pos.traderId] = (countMap[pos.traderId] ?? 0) + 1;
        } else {
          closedList.push({
            positionId: row.id,
            traderId: row.trader_id,
            nickname,
            symbol: row.symbol,
            side: row.side,
            leverage: Number(row.leverage),
            entryPrice: Number(row.entry_price),
            exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
            netPnl: Number(row.pnl ?? 0),
            reasonEntry: row.reason_entry ?? "",
            reasonExit: row.log_reason || "Kapatıldı",
            mood: row.mood || "focused",
            closedAtMs: row.closed_at_ms ? Number(row.closed_at_ms) : null,
          });
        }
      });

      return {
        openPositions: openList,
        closedLedger: closedList,
        openPnlByTrader: pnlMap,
        openCountByTrader: countMap,
        totalUnrealizedPnl: sumUnrealized,
        lockedMargin: sumLocked,
      };
    }, [positionRows, traderMap, livePrices]);

  const urgentDebts: UrgentDebt[] = useMemo(
    () =>
      debtRows
        .filter((d) => d.status === "aktif" || d.status === "gecikti")
        .map((d) => ({
          debtId: d.id,
          traderId: d.trader_id,
          nickname: traderMap[d.trader_id]?.nickname ?? TRADER_NAMES[d.trader_id] ?? d.trader_id,
          owedUsdt: Math.max(0, Number(d.principal) - Number(d.total_repaid ?? 0)),
          interestRate: Number(d.interest_rate ?? 0.08),
          dueDateMs: Number(d.due_date_ms),
          status: d.status,
          enforcerCount: Number(d.enforcer_count ?? 0),
          traderBalance: Number(traderMap[d.trader_id]?.balance ?? 0),
        })),
    [debtRows, traderMap]
  );

  // Live aggregate metrics
  const totalOwed = urgentDebts.reduce((acc, d) => acc + d.owedUsdt, 0);
  const overdueCount = urgentDebts.filter(
    (d) => d.status === "gecikti" || d.dueDateMs <= Date.now()
  ).length;
  const totalCollected = debtRows.reduce((acc, d) => acc + Number(d.total_repaid ?? 0), 0);
  const totalAccruedInterest = debtRows.reduce(
    (acc, d) => acc + Math.max(0, Number(d.principal) - Number(d.initial_principal ?? d.principal)),
    0
  );
  const totalLiquidations = traders.reduce((acc, t) => acc + Number(t.liquidation_count ?? 0), 0);
  const tefeciProfit = totalAccruedInterest + totalCollected * 0.25 + totalLiquidations * 62.5;
  const totalTraderEquity =
    traders.reduce((acc, t) => acc + Number(t.balance ?? 0), 0) +
    lockedMargin +
    totalUnrealizedPnl;

  const handleEnterNeighborhood = async () => {
    unlockSfx();
    unlockAudio();
    playCashRegister();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore denial
      }
    }
    setEntered(true);
    speakAs("tefeci", "Mahalleye hoş geldin. Bakalım bugün kim likide olacak.");
  };

  const handleTriggerPulse = async (traderId?: TraderVoiceId, nickname?: string) => {
    if (triggerBusy) return;
    setTriggerBusy(true);
    playClick();
    await pushCommand(
      "TRIGGER_TEST_TRADE",
      traderId ?? "",
      nickname
        ? `${nickname} için canlı piyasa girişi kışkırtıldı!`
        : "Mahalle piyasası kışkırtıldı — yeni canlı işlem açılıyor!",
      traderId ? { trader_id: traderId } : {}
    );
    addToast(
      "Kışkırtma Emri Gönderildi",
      nickname ? `${nickname} tahtaya sürülüyor...` : "Bir bot canlı Binance fiyatıyla işleme giriyor...",
      "info"
    );
    window.setTimeout(() => setTriggerBusy(false), 1400);
  };

  const handleSimulateWhale = async () => {
    if (triggerBusy) return;
    setTriggerBusy(true);
    const symbol = "SOLUSDT";
    const notional = 1_480_000;
    triggerWhaleManipulator(symbol, notional);
    await pushCommand(
      "SIMULATE_WHALE",
      "selo",
      `BALİNA TESTİ: ${symbol} üzerinde $1.48M likidasyon tetiklendi!`,
      { symbol, notional_usdt: notional, side: "SELL" }
    );
    window.setTimeout(() => setTriggerBusy(false), 2000);
  };

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
      <HeroGate
        livePrices={livePrices}
        supabaseReady={isSupabaseConfigured()}
        onEnter={handleEnterNeighborhood}
      />
    );
  }

  return (
    <div className="min-h-screen pb-14 text-zinc-100">
      {/* 0.5-Second Blood-Red Whale Alert Flash Overlay */}
      {whaleFlashKey > 0 && (
        <div
          key={whaleFlashKey}
          className="whale-flash pointer-events-none fixed inset-0 z-50 border-[12px] border-red-500 bg-red-700/65"
        />
      )}

      {/* Crimson Liquidation Flash Overlay */}
      {liqFlashKey > 0 && (
        <div
          key={liqFlashKey}
          className="liq-flash pointer-events-none fixed inset-0 z-50 border-8 border-red-600 bg-red-600/20"
        />
      )}

      {/* Floating Dopamine Toast Stack */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-3.5 py-2.5 shadow-2xl backdrop-blur-md ${
              toast.tone === "danger"
                ? "border-red-500/70 bg-red-950/90 text-red-100"
                : toast.tone === "gold"
                ? "border-amber-500/60 bg-amber-950/90 text-amber-100"
                : toast.tone === "success"
                ? "border-emerald-500/60 bg-emerald-950/90 text-emerald-100"
                : "border-zinc-700 bg-zinc-900/95 text-zinc-100"
            }`}
          >
            <div className="flex items-center gap-1.5 font-display text-xs font-black uppercase">
              {toast.tone === "danger" ? (
                <Skull className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              )}
              {toast.title}
            </div>
            <p className="mt-0.5 text-[11px] opacity-90">{toast.message}</p>
          </div>
        ))}
      </div>

      <TerminalHeader
        ticks={ticks}
        binanceConnected={binanceConnected}
        supabaseConnected={supabaseConnected}
        workerHealthy={workerHealthy}
        sfxOn={sfxOn}
        ttsOn={ttsOn}
        onToggleSfx={() => {
          const next = !sfxOn;
          setSfxOn(next);
          setSfxEnabled(next);
          if (next) playClick();
        }}
        onToggleTts={() => {
          const next = !ttsOn;
          setTtsOn(next);
          setTtsEnabled(next);
          playClick();
        }}
        onOpenLoanModal={() => {
          playClick();
          setLoanModalOpen(true);
        }}
        onTriggerPulse={() => handleTriggerPulse()}
        onSimulateWhale={handleSimulateWhale}
        triggerBusy={triggerBusy}
      />

      <main className="mx-auto max-w-[1440px] space-y-6 px-4 pt-5 sm:px-6">
        {/* Top 4 KPI Cards */}
        <KpiBar
          tefeciProfit={tefeciProfit}
          totalOwed={totalOwed}
          overdueCount={overdueCount}
          liveUnrealizedPnl={totalUnrealizedPnl}
          openPositionCount={openPositions.length}
          totalLiquidations={totalLiquidations}
          totalCollected={totalCollected}
        />

        {/* Equity Curve + Live Notification Center */}
        <section className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <LiveEquityChart
              snapshots={snapshots}
              livePoint={{
                tefeci_profit: tefeciProfit,
                total_debt_owed: totalOwed,
                total_trader_equity: totalTraderEquity,
                total_unrealized_pnl: totalUnrealizedPnl,
              }}
            />
          </div>
          <div className="lg:col-span-4">
            <NotificationFeed events={events} />
          </div>
        </section>

        {/* Urgent Debt / Dark Pattern Collection Desk */}
        <DarkPatternAlerts
          debts={urgentDebts}
          whalePanicActive={whalePanicActive}
          whaleBannerText={whaleBannerText}
          onDoubleInterest={(debt) => {
            pushCommand(
              "DOUBLE_INTEREST",
              debt.traderId,
              `${debt.nickname} senet faizi 2'ye katlandı!`,
              { debt_id: debt.debtId }
            );
            addToast("Faiz Katlandı!", `${debt.nickname} artık 2 katı faiz ödeyecek.`, "danger");
          }}
          onSendEnforcer={(debt) => {
            pushCommand(
              "SEND_ENFORCER",
              debt.traderId,
              `Çırak ${debt.nickname}'in kapısına gönderildi!`,
              { debt_id: debt.debtId, trader_id: debt.traderId }
            );
            addToast("Çırak Yola Çıktı", `${debt.nickname} korku moduna girdi (3 işlem 1/2 kaldıraç).`, "gold");
          }}
          onCollectDebt={(debt) => {
            const amount = Math.round(Math.min(debt.traderBalance * 0.5, debt.owedUsdt) * 100) / 100;
            pushCommand(
              "COLLECT_DEBT",
              debt.traderId,
              `${debt.nickname} hesabından $${amount.toFixed(2)} tahsilat emri!`,
              { debt_id: debt.debtId, amount }
            );
            addToast("Tahsilat Emri", `${debt.nickname} kasasından $${amount.toFixed(2)} çekiliyor.`, "success");
          }}
        />

        {/* 5 Live Trader Cards */}
        <TraderRoster
          traders={traders}
          debts={debtRows}
          openPnlByTrader={openPnlByTrader}
          openCountByTrader={openCountByTrader}
          onOpenLoanFor={(tid) => {
            playClick();
            setLoanModalTrader(tid);
            setLoanModalOpen(true);
          }}
          onSendEnforcerTo={(tid, nickname) => {
            playEnforcerKnock();
            speakAs("tefeci", `Çırağı ${nickname}'in kapısına saldım!`);
            pushCommand(
              "SEND_ENFORCER",
              tid,
              `Çırak ${nickname}'in kapısına gönderildi!`,
              { trader_id: tid }
            );
            addToast("Çırak Gönderildi", `${nickname} korku moduna geçiyor!`, "gold");
          }}
          onTriggerTradeFor={(tid, nickname) => handleTriggerPulse(tid, nickname)}
        />

        {/* Millisecond Live Open Positions */}
        <LivePnL
          positions={openPositions}
          livePrices={livePrices}
          onForceClose={(pos) => {
            playClick();
            pushCommand(
              "FORCE_CLOSE",
              pos.traderId,
              `${pos.nickname} ${pos.symbol} pozisyonu Tefeci emriyle kapatılıyor!`,
              { position_id: pos.positionId }
            );
            addToast("Zorla Kapatma", `${pos.nickname} · ${pos.symbol} piyasa fiyatından kapatılıyor.`, "gold");
          }}
          onTriggerPulse={() => handleTriggerPulse()}
        />

        {/* Filterable Revenge Ledger */}
        <DebtLedger
          entries={closedLedger}
          onExportJson={(rows) => {
            playClick();
            downloadFile(
              "tefeci-intikam-defteri.json",
              JSON.stringify(rows, null, 2),
              "application/json"
            );
          }}
          onExportMarkdown={(rows) => {
            playClick();
            const md = [
              "# TEFECİ İNTİKAM DEFTERİ — FAZ 2 RAPORU",
              "",
              `Toplam Kayıt: **${rows.length}**`,
              "",
              "| Trader | Coin | Giriş → Çıkış | Net PnL | Giriş Nedeni | Çıkış / Batış Nedeni |",
              "|---|---|---|---:|---|---|",
              ...rows.map(
                (l) =>
                  `| ${l.nickname} | ${l.symbol} ${l.side} ${l.leverage}x | $${l.entryPrice.toFixed(2)} → ${l.exitPrice ? `$${l.exitPrice.toFixed(2)}` : "-"} | ${l.netPnl >= 0 ? "+" : ""}${l.netPnl.toFixed(2)}$ | ${l.reasonEntry} | ${l.reasonExit} |`
              ),
            ].join("\n");
            downloadFile("tefeci-zarar-raporu.md", md, "text/markdown");
          }}
        />
      </main>

      <LoanModal
        open={loanModalOpen}
        traders={traders}
        initialTraderId={loanModalTrader}
        onClose={() => setLoanModalOpen(false)}
        onSubmit={({ traderId, nickname, principal, interestRate, durationSec }) => {
          playCashRegister();
          speakAs(
            "tefeci",
            `${nickname}'e ${principal} dolar verdim. Vadesinde ödeyemezsen sonunu sen düşün.`
          );
          pushCommand(
            "ISSUE_DEBT",
            traderId,
            `${nickname}'e $${principal} yeni senet kesildi (%${Math.round(interestRate * 100)} faiz)`,
            {
              trader_id: traderId,
              principal,
              interest_rate: interestRate,
              duration_s: durationSec,
            }
          );
          addToast(
            "Yeni Senet İmzalandı!",
            `${nickname} hesabına $${principal} aktarılıyor.`,
            "gold"
          );
        }}
      />
    </div>
  );
}
