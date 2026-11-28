import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { BookOpen, Flame, Skull, Sparkles } from "lucide-react";
import { HeroGate } from "./components/HeroGate";
import { PriceTick, TerminalHeader } from "./components/TerminalHeader";
import { BottomNav, NavTab } from "./components/BottomNav";
import { BottomSheet } from "./components/BottomSheet";
import { LiquidationShow } from "./components/LiquidationShow";
import { LiveQuotesTicker } from "./components/LiveQuotesTicker";
import { DebtEndurancePanel } from "./components/DebtEndurancePanel";
import { MahalleKupasi } from "./components/MahalleKupasi";
import { CandleReplay } from "./components/CandleReplay";
import { SimulationDisclaimerBanner } from "./components/SimulationDisclaimerBanner";
import { YeraltiKahvehaneMap } from "./components/YeraltiKahvehaneMap";
import { FitilAvi } from "./components/FitilAvi";
import { KpiBar } from "./components/KpiBar";
import { LiveEquityChart } from "./components/LiveEquityChart";
import { DarkPatternAlerts, UrgentDebt } from "./components/DarkPatternAlerts";
import { TraderRoster } from "./components/TraderRoster";
import { LivePnL, OpenPosition } from "./components/LivePnL";
import { NotificationFeed } from "./components/NotificationFeed";
import { DebtLedger, LedgerEntry } from "./components/DebtLedger";
import { LoanModal } from "./components/LoanModal";
import { computeDebtEndurance } from "./utils/debtEndurance";
import { FitilStats, loadFitilStats } from "./utils/fitilScoring";
import {
  evaluateDebtPressureQuote,
  evaluateLiquidationQuote,
  evaluateMomentumQuote,
  LiveMarketQuote,
} from "./utils/liveQuotes";
import {
  ActiveCupSession,
  loadSavedCupSession,
  readCupCodeFromUrl,
  syncCupParticipantStats,
} from "./utils/mahalleKupasi";
import {
  DebtRow,
  EquitySnapshotRow,
  EventRow,
  getCloudWorkerHealthUrl,
  isSupabaseConfigured,
  MarketFundingRow,
  PositionRow,
  pushCommand,
  subscribeTable,
  TraderRow,
} from "./utils/supabase";
import {
  hapticLong,
  hapticMedium,
  hapticShort,
  isHapticsEnabled,
  setHapticsEnabled,
} from "./utils/haptics";
import { isShakeEnabled, setShakeEnabled } from "./utils/motion";
import {
  formatCompactUsd,
  LiveLiquidationItem,
  parseForceOrderFrame,
  SHAKE_COOLDOWN_MS,
} from "./utils/liquidation";
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
  speakStreetEvent,
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

interface LiqStats {
  cumulativeUsdt: number;
  eventCount: number;
  impactCount: number;
  whaleCount: number;
}

const BINANCE_PUBLIC_WSS =
  "wss://fstream.binance.com/public/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/solusdt@bookTicker";
const BINANCE_MARKET_WSS =
  "wss://fstream.binance.com/market/stream?streams=!forceOrder@arr";

export default function App() {
  const initialInviteCupCode = useMemo(() => readCupCodeFromUrl(), []);
  const [entered, setEntered] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    initialInviteCupCode ? "fitil" : "market"
  );

  const [ticks, setTicks] = useState<Record<string, PriceTick>>({});
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [workerHealthy, setWorkerHealthy] = useState<boolean | null>(null);

  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [debtRows, setDebtRows] = useState<DebtRow[]>([]);
  const [positionRows, setPositionRows] = useState<PositionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [snapshots, setSnapshots] = useState<EquitySnapshotRow[]>([]);
  const [fundingSnapshots, setFundingSnapshots] = useState<MarketFundingRow[]>([]);

  // Real Binance !forceOrder@arr Liquidation Show state (Ece)
  const [liquidations, setLiquidations] = useState<LiveLiquidationItem[]>([]);
  const [liqStats, setLiqStats] = useState<LiqStats>({
    cumulativeUsdt: 0,
    eventCount: 0,
    impactCount: 0,
    whaleCount: 0,
  });
  const [microShakeActive, setMicroShakeActive] = useState(false);
  const [flashingTraderIds, setFlashingTraderIds] = useState<Record<string, number>>({});

  // Tur 2: Tuncay Live Quotes + Bülent Mahalle Kupası state
  const [liveQuotes, setLiveQuotes] = useState<LiveMarketQuote[]>([]);
  const [cupSession, setCupSession] = useState<ActiveCupSession | null>(() =>
    loadSavedCupSession()
  );
  const [fitilStats, setFitilStats] = useState<FitilStats>(() => loadFitilStats());
  const cancelledRoundsRef = useRef<number>(0);

  // Controls & settings (Hayri + Ece)
  const [sfxOn, setSfxOn] = useState<boolean>(() => isSfxEnabled());
  const [ttsOn, setTtsOn] = useState<boolean>(() => isTtsEnabled());
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => isHapticsEnabled());
  const [shakeOn, setShakeOn] = useState<boolean>(() => isShakeEnabled());

  // Drawers & overlays
  const [loanModalOpen, setLoanModalOpen] = useState(false);
  const [loanModalTrader, setLoanModalTrader] = useState<TraderVoiceId>("selo");
  const [ledgerSheetOpen, setLedgerSheetOpen] = useState(false);

  const [triggerBusy, setTriggerBusy] = useState(false);
  const [liqFlashKey, setLiqFlashKey] = useState<number>(0);
  const [whaleFlashKey, setWhaleFlashKey] = useState<number>(0);
  const [whalePanicActive, setWhalePanicActive] = useState<boolean>(false);
  const [whaleBannerText, setWhaleBannerText] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Refs that prevent WebSocket teardown on state updates & eliminate Math.random()
  const toastIdRef = useRef<number>(0);
  const enteredRef = useRef<boolean>(entered);
  enteredRef.current = entered;
  const shakeOnRef = useRef<boolean>(shakeOn);
  shakeOnRef.current = shakeOn;
  const openPositionsRef = useRef<OpenPosition[]>([]);
  const lastQuoteMsRef = useRef<number>(0);
  const lastDebtQuoteByTraderRef = useRef<Record<string, number>>({});
  const momentumAnchorRef = useRef<Record<string, { price: number; tsMs: number }>>({});
  const cupSessionRef = useRef<ActiveCupSession | null>(cupSession);
  cupSessionRef.current = cupSession;

  const lastSeenEventIdRef = useRef<number>(0);
  const initializedEventsRef = useRef<boolean>(false);
  const lastWhaleAlertMsRef = useRef<number>(0);
  const lastShakeMsRef = useRef<number>(0);
  const lastImpactToastMsRef = useRef<number>(0);
  const whalePanicTimerRef = useRef<number | null>(null);
  const microShakeTimerRef = useRef<number | null>(null);

  const addToast = useCallback(
    (title: string, message: string, tone: ToastItem["tone"] = "info") => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      setToasts((prev) => [...prev.slice(-2), { id, title, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  // Real $1M+ Whale Liquidation Manipulator (only triggered by real !forceOrder@arr or backend WHALE_ALERT)
  const triggerWhaleManipulator = useCallback(
    (symbol: string, notionalUsdt: number, customMsg?: string) => {
      const now = Date.now();
      if (now - lastWhaleAlertMsRef.current < 8000) return;
      lastWhaleAlertMsRef.current = now;

      const notionalM = (notionalUsdt / 1_000_000).toFixed(2);
      const banner =
        customMsg ||
        `${symbol} üzerinde $${notionalM}M tek seferde likide oldu! Selo Roket kan kokusunu aldı, faiz baskısı zirvede!`;

      setWhaleFlashKey(now);
      hapticLong();
      playWhaleAlertSiren();
      speakAs(
        "tefeci",
        "BALİNA PATLADI! Selo Roket kan kokusunu aldı, borç faizini sıkılaştır!"
      );

      setWhaleBannerText(banner);
      setWhalePanicActive(true);
      if (whalePanicTimerRef.current) {
        window.clearTimeout(whalePanicTimerRef.current);
      }
      whalePanicTimerRef.current = window.setTimeout(() => {
        setWhalePanicActive(false);
      }, 15_000);

      confetti({
        particleCount: 110,
        spread: 100,
        origin: { y: 0.45 },
        colors: ["#dc2626", "#ef4444", "#f59e0b"],
      });
      addToast(`BALİNA PATLADI! ($${notionalM}M ${symbol})`, banner, "danger");
    },
    [addToast]
  );

  // Real Binance Futures WebSockets (2026 split endpoints):
  //   1) /public/stream -> live bookTicker (BTC/ETH/SOL)
  //   2) /market/stream -> live all-market !forceOrder@arr liquidations
  useEffect(() => {
    let closed = false;
    let publicWs: WebSocket | null = null;
    let marketWs: WebSocket | null = null;
    let publicRetryTimer: number | null = null;
    let marketRetryTimer: number | null = null;

    const connectPublic = () => {
      if (closed) return;
      publicWs = new WebSocket(BINANCE_PUBLIC_WSS);

      publicWs.onopen = () => setBinanceConnected(true);
      publicWs.onclose = () => {
        setBinanceConnected(false);
        if (!closed) {
          publicRetryTimer = window.setTimeout(connectPublic, 2500);
        }
      };
      publicWs.onerror = () => {
        setBinanceConnected(false);
      };

      publicWs.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const stream: string = msg.stream ?? "";
          const d = msg.data;

          if (stream.endsWith("@bookTicker") && d?.s && d?.b && d?.a) {
            const bid = parseFloat(d.b);
            const ask = parseFloat(d.a);
            if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
              return;
            }
            const mid = (bid + ask) / 2;
            const now = Date.now();
            setTicks((prev) => ({
              ...prev,
              [d.s]: {
                price: mid,
                prevPrice: prev[d.s]?.price ?? mid,
                updatedAtMs: now,
              },
            }));

            // Tuncay: 15-second live bookTicker momentum quote detector (zero randomness)
            const anchor = momentumAnchorRef.current[d.s];
            if (!anchor) {
              momentumAnchorRef.current[d.s] = { price: mid, tsMs: now };
            } else {
              const pctChange = ((mid - anchor.price) / anchor.price) * 100;
              if (Math.abs(pctChange) >= 0.12) {
                const quote = evaluateMomentumQuote({
                  symbol: d.s,
                  livePrice: mid,
                  pctChange15s: pctChange,
                  connected: true,
                  lastTickAgeMs: 0,
                  nowMs: now,
                  lastQuoteMs: lastQuoteMsRef.current,
                });
                if (quote) {
                  lastQuoteMsRef.current = now;
                  setLiveQuotes((prev) => [quote, ...prev].slice(0, 15));
                }
                momentumAnchorRef.current[d.s] = { price: mid, tsMs: now };
              } else if (now - anchor.tsMs >= 15_000) {
                momentumAnchorRef.current[d.s] = { price: mid, tsMs: now };
              }
            }
          }
        } catch {
          // Ignore malformed WS frame
        }
      };
    };

    const connectMarket = () => {
      if (closed) return;
      marketWs = new WebSocket(BINANCE_MARKET_WSS);

      marketWs.onclose = () => {
        if (!closed) {
          marketRetryTimer = window.setTimeout(connectMarket, 2500);
        }
      };

      marketWs.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const stream: string = msg.stream ?? "";
          const d = msg.data ?? msg;

          if (
            stream === "!forceOrder@arr" ||
            stream.endsWith("@forceOrder") ||
            d?.e === "forceOrder"
          ) {
            const item = parseForceOrderFrame(d?.o);
            if (!item) return;

            setLiquidations((prev) => [item, ...prev].slice(0, 32));
            setLiqStats((prev) => ({
              cumulativeUsdt: prev.cumulativeUsdt + item.notionalUsdt,
              eventCount: prev.eventCount + 1,
              impactCount:
                prev.impactCount + (item.tier === "impact" || item.tier === "whale" ? 1 : 0),
              whaleCount: prev.whaleCount + (item.tier === "whale" ? 1 : 0),
            }));

            // Tuncay: Real !forceOrder@arr liquidation quote trigger
            const liqNow = Date.now();
            const liqQuote = evaluateLiquidationQuote({
              symbol: item.symbol,
              liquidatedSide: item.liquidatedSide,
              notionalUsdt: item.notionalUsdt,
              price: item.price,
              nowMs: liqNow,
              lastQuoteMs: lastQuoteMsRef.current,
            });
            if (liqQuote) {
              lastQuoteMsRef.current = liqNow;
              setLiveQuotes((prev) => [liqQuote, ...prev].slice(0, 15));
            }

            if (!enteredRef.current) return;

            const now = Date.now();

            // Tier 2 ($100K+) & Tier 3 ($1M+): micro-shake + affected trader red flash + haptic
            if (item.tier === "impact" || item.tier === "whale") {
              if (shakeOnRef.current && now - lastShakeMsRef.current >= SHAKE_COOLDOWN_MS) {
                lastShakeMsRef.current = now;
                setMicroShakeActive(true);
                if (microShakeTimerRef.current) {
                  window.clearTimeout(microShakeTimerRef.current);
                }
                microShakeTimerRef.current = window.setTimeout(() => {
                  setMicroShakeActive(false);
                }, 220);
              }

              // Flash trader cards currently holding an open position on this liquidated symbol
              const affectedTraderIds = Array.from(
                new Set(
                  openPositionsRef.current
                    .filter((p) => p.symbol.toUpperCase() === item.symbol)
                    .map((p) => p.traderId)
                )
              );
              if (affectedTraderIds.length > 0) {
                setFlashingTraderIds((prev) => {
                  const next = { ...prev };
                  affectedTraderIds.forEach((tid) => {
                    next[tid] = now;
                  });
                  return next;
                });
                window.setTimeout(() => {
                  setFlashingTraderIds((prev) => {
                    const next = { ...prev };
                    affectedTraderIds.forEach((tid) => {
                      if (next[tid] === now) delete next[tid];
                    });
                    return next;
                  });
                }, 950);
              }

              if (item.tier === "impact") {
                hapticShort();
                if (now - lastImpactToastMsRef.current >= 4500) {
                  lastImpactToastMsRef.current = now;
                  addToast(
                    `Sert Likidasyon (${formatCompactUsd(item.notionalUsdt)})`,
                    `${item.symbol} ${item.liquidatedSide} pozisyonu $${item.price.toFixed(item.price < 10 ? 4 : 2)} seviyesinde patladı.`,
                    "danger"
                  );
                }
              } else {
                triggerWhaleManipulator(item.symbol, item.notionalUsdt);
              }
            }
          }
        } catch {
          // Ignore malformed WS frame
        }
      };
    };

    connectPublic();
    connectMarket();
    return () => {
      closed = true;
      if (publicRetryTimer) window.clearTimeout(publicRetryTimer);
      if (marketRetryTimer) window.clearTimeout(marketRetryTimer);
      if (microShakeTimerRef.current) window.clearTimeout(microShakeTimerRef.current);
      if (whalePanicTimerRef.current) window.clearTimeout(whalePanicTimerRef.current);
      publicWs?.close();
      marketWs?.close();
    };
  }, [addToast, triggerWhaleManipulator]);

  // Sinan: Poll real Frankfurt Cloud Worker /health (fallback to relative /health in local dev)
  useEffect(() => {
    if (!entered) return;
    let active = true;
    const healthUrl = getCloudWorkerHealthUrl() ?? "/health";

    const pollHealth = async () => {
      try {
        const res = await fetch(healthUrl, { cache: "no-store" });
        if (!active) return;
        if (!res.ok) {
          setWorkerHealthy(false);
          return;
        }
        const payload = await res.json().catch(() => null);
        if (!active) return;
        setWorkerHealthy(payload?.status === "ok" || res.ok);
      } catch {
        if (active) setWorkerHealthy(false);
      }
    };

    pollHealth();
    const timer = window.setInterval(pollHealth, 12_000);
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

    const unsubFunding = subscribeTable<MarketFundingRow>(
      "market_funding_snapshots",
      setFundingSnapshots,
      {
        orderBy: { column: "symbol", ascending: true },
        pollMs: 10_000,
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
          const speakerId = (
            ["selo", "mehmet", "nuri", "kemal", "sevil"].includes(ev.trader_id ?? "")
              ? ev.trader_id
              : "tefeci"
          ) as TraderVoiceId;

          if (ev.type === "WHALE_ALERT") {
            const sym = String(ev.payload?.symbol ?? "BTCUSDT");
            const notional = Number(ev.payload?.notional_usdt ?? 1_000_000);
            triggerWhaleManipulator(sym, notional, ev.message);
          } else if (ev.type === "LIQUIDATION") {
            setLiqFlashKey(Date.now());
            hapticLong();
            playLiquidationSiren();
            confetti({
              particleCount: 100,
              spread: 90,
              origin: { y: 0.55 },
              colors: ["#ef4444", "#f59e0b", "#10b981"],
            });
            speakStreetEvent(
              speakerId,
              "liquidation",
              Math.abs(Number(ev.payload?.pnl ?? ev.id)),
              true
            );
            addToast("LİKİDASYON!", ev.message, "danger");
          } else if (ev.type === "OPEN_POSITION") {
            playTradeOpen();
            if (ev.message.toLowerCase().includes("tilt") || ev.message.toLowerCase().includes("hata")) {
              speakStreetEvent(speakerId, "tilt_revenge", ev.id + Number(ev.payload?.entry_price ?? 0));
            }
            addToast("Yeni Canlı Pozisyon", ev.message, "info");
          } else if (ev.type === "CLOSE_POSITION") {
            const pnl = Number(ev.payload?.pnl ?? 0);
            if (pnl >= 0) {
              playCashRegister();
              if (pnl >= 15) {
                speakStreetEvent(speakerId, "big_profit", ev.id + pnl, true);
              }
            } else if (pnl <= -15) {
              speakStreetEvent(speakerId, "big_loss", ev.id + Math.abs(pnl), true);
            }
            addToast("Pozisyon Kapandı", ev.message, pnl >= 0 ? "success" : "danger");
          } else if (ev.type === "COMPOUND") {
            speakStreetEvent("tefeci", "debt_pressure", ev.id + Number(ev.payload?.principal ?? 0));
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
      unsubFunding();
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

  const {
    openPositions,
    closedLedger,
    openPnlByTrader,
    openCountByTrader,
    totalUnrealizedPnl,
    lockedMargin,
  } = useMemo(() => {
    const openList: OpenPosition[] = [];
    const closedList: LedgerEntry[] = [];
    const pnlMap: Record<string, number> = {};
    const countMap: Record<string, number> = {};
    let sumUnrealized = 0;
    let sumLocked = 0;

    positionRows.forEach((row) => {
      const nickname =
        traderMap[row.trader_id]?.nickname ?? TRADER_NAMES[row.trader_id] ?? row.trader_id;
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

  openPositionsRef.current = openPositions;

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
    (acc, d) =>
      acc + Math.max(0, Number(d.principal) - Number(d.initial_principal ?? d.principal)),
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
    hapticMedium();
    playCashRegister();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore denial
      }
    }
    setEntered(true);
    speakStreetEvent("tefeci", "enter_neighborhood", Date.now());
  };

  const handleTriggerPulse = async (traderId?: TraderVoiceId, nickname?: string) => {
    if (triggerBusy) return;
    setTriggerBusy(true);
    hapticShort();
    playClick();
    await pushCommand(
      "TRIGGER_TEST_TRADE",
      traderId ?? "",
      nickname
        ? `${nickname} için canlı orderbook piyasa girişi kışkırtıldı!`
        : "Mahalle piyasası kışkırtıldı — canlı orderbook sinyaliyle işlem açılıyor!",
      traderId ? { trader_id: traderId } : {}
    );
    addToast(
      "Kışkırtma Emri Gönderildi",
      nickname
        ? `${nickname} canlı orderbook yönüyle tahtaya sürülüyor...`
        : "Bir bot canlı Binance orderbook dengesiyle işleme giriyor...",
      "info"
    );
    window.setTimeout(() => setTriggerBusy(false), 1400);
  };

  const handleCollectFromTrader = (trader: TraderRow, debt: DebtRow) => {
    const owed = Math.max(0, Number(debt.principal) - Number(debt.total_repaid ?? 0));
    const bal = Number(trader.balance ?? 0);
    const amount = Math.round(Math.min(bal * 0.5, owed) * 100) / 100;
    if (amount <= 0) {
      addToast("Bakiye Yetersiz", `${trader.nickname} kasasında tahsil edilecek nakit yok.`, "danger");
      return;
    }
    hapticMedium();
    playCashRegister();
    speakStreetEvent("tefeci", "debt_pressure", amount + bal);
    pushCommand(
      "COLLECT_DEBT",
      trader.id,
      `${trader.nickname} hesabından $${amount.toFixed(2)} hızlı tahsilat emri!`,
      { debt_id: debt.id, amount }
    );
    addToast(
      "Tahsilat Emri Gönderildi",
      `${trader.nickname} kasasından $${amount.toFixed(2)} çekiliyor.`,
      "success"
    );
  };

  const handleToggleSfx = () => {
    const next = !sfxOn;
    setSfxOn(next);
    setSfxEnabled(next);
    hapticShort();
    if (next) playClick();
  };

  const handleToggleTts = () => {
    const next = !ttsOn;
    setTtsOn(next);
    setTtsEnabled(next);
    hapticShort();
    playClick();
  };

  const handleToggleHaptics = () => {
    const next = !hapticsOn;
    setHapticsOn(next);
    setHapticsEnabled(next);
    if (next) hapticShort();
    playClick();
  };

  const handleToggleShake = () => {
    const next = !shakeOn;
    setShakeOn(next);
    setShakeEnabled(next);
    hapticShort();
    playClick();
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

  const handleExportLedgerJson = (rows: LedgerEntry[]) => {
    playClick();
    downloadFile(
      "tefeci-intikam-defteri.json",
      JSON.stringify(rows, null, 2),
      "application/json"
    );
  };

  const handleExportLedgerMd = (rows: LedgerEntry[]) => {
    playClick();
    const md = [
      "# TEFECİ İNTİKAM DEFTERİ — CANLI RAPOR",
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
  };

  // Tuncay + Rıza: Real active debt-pressure quote check every 20s (zero randomness)
  useEffect(() => {
    if (!entered) return;
    const checkDebtQuotes = () => {
      const now = Date.now();
      for (const d of debtRows) {
        if (d.status !== "aktif" && d.status !== "gecikti") continue;
        const lastForTrader = lastDebtQuoteByTraderRef.current[d.trader_id] ?? 0;
        if (now - lastForTrader < 60_000) continue;

        const trader = traderMap[d.trader_id];
        const createdAtMs = d.created_at
          ? Date.parse(d.created_at) || d.due_date_ms - 600_000
          : d.due_date_ms - 600_000;
        const traderEquity = Math.max(
          0,
          Number(trader?.balance ?? 0) + Number(openPnlByTrader[d.trader_id] ?? 0)
        );
        const endurance = computeDebtEndurance({
          principal: Number(d.principal),
          totalRepaid: Number(d.total_repaid ?? 0),
          interestRate: Number(d.interest_rate ?? 0.08),
          compoundingPeriodS: Number(d.compounding_period_s ?? 300),
          createdAtMs,
          dueDateMs: Number(d.due_date_ms),
          nowMs: now,
          traderEquity,
          enforcerCount: Number(d.enforcer_count ?? 0),
          status: d.status,
        });
        const q = evaluateDebtPressureQuote({
          nickname: trader?.nickname ?? TRADER_NAMES[d.trader_id] ?? d.trader_id,
          endurance,
          nowMs: now,
          lastQuoteMs: lastQuoteMsRef.current,
        });
        if (q) {
          lastQuoteMsRef.current = now;
          lastDebtQuoteByTraderRef.current[d.trader_id] = now;
          setLiveQuotes((prev) => [q, ...prev].slice(0, 15));
          break;
        }
      }
    };
    const timer = window.setInterval(checkDebtQuotes, 20_000);
    return () => window.clearInterval(timer);
  }, [entered, debtRows, traderMap, openPnlByTrader]);

  // Bülent: Automatically sync Fitil Avı settled stats into active Mahalle Kupası
  const handleFitilStatsChange = useCallback((nextStats: FitilStats) => {
    setFitilStats(nextStats);
    const activeCup = cupSessionRef.current;
    if (activeCup) {
      syncCupParticipantStats({
        cupCode: activeCup.code,
        nickname: activeCup.nickname,
        stats: nextStats,
        cancelledCount: cancelledRoundsRef.current,
      });
    }
  }, []);

  const handleFitilRoundCancelled = useCallback(() => {
    cancelledRoundsRef.current += 1;
  }, []);

  if (!entered) {
    return (
      <HeroGate
        livePrices={livePrices}
        binanceConnected={binanceConnected}
        supabaseReady={isSupabaseConfigured()}
        inviteCupCode={initialInviteCupCode}
        onEnter={handleEnterNeighborhood}
      />
    );
  }

  const darkPatternDesk = (
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
        addToast(
          "Çırak Yola Çıktı",
          `${debt.nickname} korku moduna girdi (3 işlem 1/2 kaldıraç).`,
          "gold"
        );
      }}
      onCollectDebt={(debt) => {
        const amount =
          Math.round(Math.min(debt.traderBalance * 0.5, debt.owedUsdt) * 100) / 100;
        pushCommand(
          "COLLECT_DEBT",
          debt.traderId,
          `${debt.nickname} hesabından $${amount.toFixed(2)} tahsilat emri!`,
          { debt_id: debt.debtId, amount }
        );
        addToast(
          "Tahsilat Emri",
          `${debt.nickname} kasasından $${amount.toFixed(2)} çekiliyor.`,
          "success"
        );
      }}
    />
  );

  const liquidationBanner = (
    <LiquidationShow
      items={liquidations}
      cumulativeUsdt={liqStats.cumulativeUsdt}
      eventCount={liqStats.eventCount}
      impactCount={liqStats.impactCount}
      whaleCount={liqStats.whaleCount}
      binanceConnected={binanceConnected}
      shakeOn={shakeOn}
      sfxOn={sfxOn}
      onToggleShake={handleToggleShake}
      onToggleSfx={handleToggleSfx}
    />
  );

  const livePnlSection = (
    <LivePnL
      positions={openPositions}
      livePrices={livePrices}
      binanceConnected={binanceConnected}
      onForceClose={(pos) => {
        playClick();
        pushCommand(
          "FORCE_CLOSE",
          pos.traderId,
          `${pos.nickname} ${pos.symbol} pozisyonu Tefeci emriyle kapatılıyor!`,
          { position_id: pos.positionId }
        );
        addToast(
          "Zorla Kapatma",
          `${pos.nickname} · ${pos.symbol} canlı piyasa fiyatından kapatılıyor.`,
          "gold"
        );
      }}
      onTriggerPulse={() => handleTriggerPulse()}
    />
  );

  const traderRosterSection = (
    <TraderRoster
      traders={traders}
      debts={debtRows}
      openPnlByTrader={openPnlByTrader}
      openCountByTrader={openCountByTrader}
      flashingTraderIds={flashingTraderIds}
      onOpenLoanFor={(tid) => {
        playClick();
        setLoanModalTrader(tid);
        setLoanModalOpen(true);
      }}
      onSendEnforcerTo={(tid, nickname) => {
        playEnforcerKnock();
        speakAs("tefeci", `Çırağı ${nickname}'in kapısına saldım!`);
        pushCommand("SEND_ENFORCER", tid, `Çırak ${nickname}'in kapısına gönderildi!`, {
          trader_id: tid,
        });
        addToast("Çırak Gönderildi", `${nickname} korku moduna geçiyor!`, "gold");
      }}
      onTriggerTradeFor={(tid, nickname) => handleTriggerPulse(tid, nickname)}
      onCollectFromTrader={handleCollectFromTrader}
    />
  );

  return (
    <div
      className={`min-h-screen overflow-x-clip pb-24 text-zinc-100 lg:pb-12 ${
        microShakeActive ? "liq-micro-shake" : ""
      }`}
    >
      {/* 0.5-Second Blood-Red Whale Alert Flash Overlay */}
      {whaleFlashKey > 0 && (
        <div
          key={whaleFlashKey}
          className="whale-flash pointer-events-none fixed inset-0 z-50 border-[10px] border-red-500 bg-red-700/60"
        />
      )}

      {/* Crimson Liquidation Flash Overlay */}
      {liqFlashKey > 0 && (
        <div
          key={liqFlashKey}
          className="liq-flash pointer-events-none fixed inset-0 z-50 border-8 border-red-600 bg-red-600/20"
        />
      )}

      {/* Floating Dopamine Toast Stack (positioned above mobile bottom nav) */}
      <div className="pointer-events-none fixed right-3 bottom-20 z-40 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 lg:right-4 lg:bottom-4">
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
            <div className="font-display flex items-center gap-1.5 text-xs font-black uppercase">
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
        hapticsOn={hapticsOn}
        shakeOn={shakeOn}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onToggleSfx={handleToggleSfx}
        onToggleTts={handleToggleTts}
        onToggleHaptics={handleToggleHaptics}
        onToggleShake={handleToggleShake}
        onOpenLoanModal={() => {
          playClick();
          setLoanModalOpen(true);
        }}
        onTriggerPulse={() => handleTriggerPulse()}
        triggerBusy={triggerBusy}
      />

      <SimulationDisclaimerBanner />

      <main className="mx-auto max-w-[1440px] space-y-5 px-3 pt-4 sm:px-6 sm:pt-5">
        {/* Global Whale Panic shortcut banner if user is on Traders tab */}
        {whalePanicActive && activeTab === "traders" && darkPatternDesk}

        {/* TAB 1: PİYASA (Market) */}
        {activeTab === "market" && (
          <>
            {liquidationBanner}

            {/* Sevil DOPAMİN + Rıza RADAR: Yeraltı Kahvehanesi & Döviz Bürosu Canlı Haritası */}
            <YeraltiKahvehaneMap
              traders={traders}
              openPositions={openPositions}
              debts={debtRows}
              livePrices={livePrices}
              fundingSnapshots={fundingSnapshots}
              binanceConnected={binanceConnected}
              openPnlByTrader={openPnlByTrader}
              recentLiqTraders={flashingTraderIds}
            />

            <LiveQuotesTicker
              quotes={liveQuotes}
              binanceConnected={binanceConnected}
              ttsOn={ttsOn}
            />

            <KpiBar
              tefeciProfit={tefeciProfit}
              totalOwed={totalOwed}
              overdueCount={overdueCount}
              liveUnrealizedPnl={totalUnrealizedPnl}
              openPositionCount={openPositions.length}
              totalLiquidations={totalLiquidations}
              totalCollected={totalCollected}
            />

            {/* Keep DarkPatternAlerts prominent on Market */}
            {darkPatternDesk}

            {/* Rıza: Live Debt Endurance Timers */}
            <DebtEndurancePanel
              debts={debtRows}
              traders={traders}
              openPnlByTrader={openPnlByTrader}
            />

            {/* Equity Curve + Notification Feed */}
            <section className="grid gap-4 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
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
              <div className="min-w-0 lg:col-span-4">
                <NotificationFeed events={events} />
              </div>
            </section>

            {livePnlSection}

            {/* Quick CTA to Fitil Avı & Mahalle Kupası on Market */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-gradient-to-r from-amber-950/35 via-zinc-950 to-zinc-950 p-3.5 sm:p-4">
              <div className="min-w-0">
                <div className="font-display flex items-center gap-2 text-xs font-black tracking-wider text-amber-300 uppercase sm:text-sm">
                  <Flame className="h-4 w-4 text-amber-400" />
                  Fitil Avı &amp; Mahalle Kupası · Davet Koduyla Yarış
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  1.000 sanal puanla canlı Binance fiyatında istikrar skoru kas, davet koduyla arkadaşlarını kupaya çağır.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  hapticShort();
                  playClick();
                  setActiveTab("fitil");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="min-h-[44px] cursor-pointer rounded-xl border border-amber-500/60 bg-amber-500/20 px-4 text-xs font-black tracking-wider text-amber-200 uppercase transition hover:bg-amber-500/30 active:scale-95"
              >
                Kupaya &amp; Fitil Avına Geç
              </button>
            </div>
          </>
        )}

        {/* TAB 2: TRADERLAR (Traders) */}
        {activeTab === "traders" && (
          <>
            <YeraltiKahvehaneMap
              traders={traders}
              openPositions={openPositions}
              debts={debtRows}
              livePrices={livePrices}
              fundingSnapshots={fundingSnapshots}
              binanceConnected={binanceConnected}
              openPnlByTrader={openPnlByTrader}
              recentLiqTraders={flashingTraderIds}
            />
            <LiveQuotesTicker
              quotes={liveQuotes}
              binanceConnected={binanceConnected}
              ttsOn={ttsOn}
            />
            {traderRosterSection}
            {livePnlSection}
          </>
        )}

        {/* TAB 3: FİTİL AVI & MAHALLE KUPASI */}
        {activeTab === "fitil" && (
          <>
            <MahalleKupasi
              activeSession={cupSession}
              initialInviteCode={initialInviteCupCode}
              currentFitilStats={fitilStats}
              onSessionChange={setCupSession}
              onNotify={addToast}
            />
            <FitilAvi
              ticks={ticks}
              binanceConnected={binanceConnected}
              traders={traders}
              onStatsChange={handleFitilStatsChange}
              onRoundCancelled={handleFitilRoundCancelled}
            />
            {darkPatternDesk}
            {liquidationBanner}
          </>
        )}

        {/* TAB 4: SENETLER (DarkPatternAlerts + DebtEndurance + BottomSheet DebtLedger) */}
        {activeTab === "debts" && (
          <>
            {darkPatternDesk}

            <DebtEndurancePanel
              debts={debtRows}
              traders={traders}
              openPnlByTrader={openPnlByTrader}
            />

            {/* Mobile Bottom-Sheet Drawer Trigger for DebtLedger */}
            <section className="rounded-xl border border-rose-500/30 bg-zinc-950/90 p-4 shadow-xl lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-rose-400 uppercase">
                    <BookOpen className="h-4 w-4 text-rose-500" />
                    İntikam Defteri ({closedLedger.length})
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Tüm kapanan pozisyonları, likidasyon kayıtlarını ve JSON/MD dışa aktarımını alt çekmecede aç.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    hapticShort();
                    playClick();
                    setLedgerSheetOpen(true);
                  }}
                  className="min-h-[48px] shrink-0 cursor-pointer rounded-xl border border-rose-500/60 bg-rose-950/60 px-4 text-xs font-black tracking-wider text-rose-100 uppercase transition hover:bg-rose-900/70 active:scale-95"
                >
                  Defteri Aç
                </button>
              </div>
            </section>

            {/* Full inline DebtLedger on Desktop */}
            <div className="hidden lg:block">
              <DebtLedger
                entries={closedLedger}
                onExportJson={handleExportLedgerJson}
                onExportMarkdown={handleExportLedgerMd}
              />
            </div>

            <NotificationFeed events={events} />
          </>
        )}

        {/* TAB 5: GEÇMİŞ MUM TEKRARI (Sinan — Historical Candle Replay via Binance REST / OKX Fallback) */}
        {activeTab === "replay" && (
          <>
            <CandleReplay />
            {darkPatternDesk}
            {liquidationBanner}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation (Hayri) */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        openPositionCount={openPositions.length}
        overdueDebtCount={overdueCount}
        whalePanicActive={whalePanicActive}
      />

      {/* Mobile Bottom-Sheet DebtLedger Drawer (Hayri) */}
      <BottomSheet
        open={ledgerSheetOpen}
        title="İntikam Defteri (The Ledger)"
        subtitle={`${closedLedger.length} kapanan işlem kaydı`}
        icon={<BookOpen className="h-5 w-5 text-rose-400" />}
        accentClass="border-rose-500/40"
        maxWidthClass="sm:max-w-3xl"
        onClose={() => setLedgerSheetOpen(false)}
      >
        <DebtLedger
          embedded
          entries={closedLedger}
          onExportJson={handleExportLedgerJson}
          onExportMarkdown={handleExportLedgerMd}
        />
      </BottomSheet>

      {/* Bottom-Sheet Loan Modal (Hayri) */}
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
