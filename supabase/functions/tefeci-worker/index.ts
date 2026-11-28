// TEFECİ 24/7 Cloud Backend Worker (Zero-Dependency Supabase Edge Function)
// Runs autonomously via pg_cron (every 15s) + instant Postgres pg_net command trigger.
// Live market prices from Binance Futures (with OKX Swap fallback), exact isolated
// liquidation math, 5 autonomous trader personas, Faz 2 Fear Mode & Faz 3 Whale Alert.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const TAKER_FEE_RATE = 0.0004;
const MAINT_MARGIN_RATE = 0.005;

interface TraderProfile {
  id: string;
  nickname: string;
  archetype: string;
  baseLeverage: number;
  preferredSymbols: string[];
  marginFraction: number;
  slPct: number;
  tpPct: number;
}

const TRADER_PROFILES: Record<string, TraderProfile> = {
  mehmet: {
    id: "mehmet",
    nickname: "Fitilci Mehmet",
    archetype: "Sniper · Fitil Avcısı",
    baseLeverage: 25,
    preferredSymbols: ["BTCUSDT", "ETHUSDT"],
    marginFraction: 0.22,
    slPct: 0.0055,
    tpPct: 0.011,
  },
  kemal: {
    id: "kemal",
    nickname: "Tahta Kemal",
    archetype: "Orderbook · Tahta Okuyucu",
    baseLeverage: 20,
    preferredSymbols: ["BTCUSDT", "ETHUSDT"],
    marginFraction: 0.25,
    slPct: 0.006,
    tpPct: 0.012,
  },
  nuri: {
    id: "nuri",
    nickname: "Fonlama Nuri",
    archetype: "Contrarian · Funding Avcısı",
    baseLeverage: 15,
    preferredSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    marginFraction: 0.2,
    slPct: 0.007,
    tpPct: 0.014,
  },
  selo: {
    id: "selo",
    nickname: "Selo Roket",
    archetype: "Degen · 75x Hacim Kovalayıcı",
    baseLeverage: 75,
    preferredSymbols: ["SOLUSDT", "BTCUSDT", "ETHUSDT"],
    marginFraction: 0.28,
    slPct: 0.0045,
    tpPct: 0.0095,
  },
  sevil: {
    id: "sevil",
    nickname: "Madam Sevil",
    archetype: "Sakin · Ortalamaya Dönüş",
    baseLeverage: 10,
    preferredSymbols: ["ETHUSDT", "BTCUSDT"],
    marginFraction: 0.18,
    slPct: 0.008,
    tpPct: 0.015,
  },
};

interface MarketTicker {
  symbol: string;
  price: number;
  fundingRate: number;
  nextFundingMs: number;
  changePct24h: number;
  bidQty: number;
  askQty: number;
  imbalance: number;
  source: string;
}

function calcImbalance(bidQty: number, askQty: number): number {
  const total = bidQty + askQty;
  return total > 0 ? Number(((bidQty - askQty) / total).toFixed(4)) : 0;
}

function determineOrderbookSide(tk: MarketTicker | undefined): "LONG" | "SHORT" {
  if (!tk) return "LONG";
  return tk.imbalance >= 0 ? "LONG" : "SHORT";
}

class RestDb {
  constructor(private url: string, private key: string) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async select(table: string, query = "select=*"): Promise<Array<Record<string, any>>> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      headers: this.headers(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async insert(table: string, row: Record<string, any>): Promise<void> {
    await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  }

  async upsert(table: string, row: Record<string, any> | Array<Record<string, any>>): Promise<void> {
    await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(row),
    });
  }

  async patch(
    table: string,
    filter: string,
    fields: Record<string, any>,
    returnRep = false
  ): Promise<Array<Record<string, any>>> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: this.headers({
        Prefer: returnRep ? "return=representation" : "return=minimal",
      }),
      body: JSON.stringify(fields),
    });
    if (!returnRep || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  async del(table: string, filter: string): Promise<void> {
    await fetch(`${this.url}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: this.headers({ Prefer: "return=minimal" }),
    });
  }
}

async function fetchLiveMarket(): Promise<{
  tickers: Record<string, MarketTicker>;
  source: string;
}> {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const tickers: Record<string, MarketTicker> = {};

  // 1. Primary: Binance Futures (fast timeout; works directly from Frankfurt eu-central-1)
  try {
    const [premRes, tickRes, bookRes] = await Promise.all([
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex", {
        signal: AbortSignal.timeout(2200),
      }),
      fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
        signal: AbortSignal.timeout(2200),
      }),
      fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker", {
        signal: AbortSignal.timeout(2200),
      }),
    ]);

    if (premRes.ok && tickRes.ok) {
      const premArr = (await premRes.json()) as Array<Record<string, string>>;
      const tickArr = (await tickRes.json()) as Array<Record<string, string>>;
      const bookArr = bookRes.ok
        ? ((await bookRes.json()) as Array<Record<string, string>>)
        : [];
      const tickMap = new Map(tickArr.map((t) => [t.symbol, t]));
      const bookMap = new Map(bookArr.map((b) => [b.symbol, b]));

      for (const p of premArr) {
        if (symbols.includes(p.symbol)) {
          const t24 = tickMap.get(p.symbol);
          const bk = bookMap.get(p.symbol);
          const bidQty = Number(bk?.bidQty || 0);
          const askQty = Number(bk?.askQty || 0);
          tickers[p.symbol] = {
            symbol: p.symbol,
            price: Number(p.markPrice || t24?.lastPrice || 0),
            fundingRate: Number(p.lastFundingRate || 0),
            nextFundingMs: Number(p.nextFundingTime || 0),
            changePct24h: Number(t24?.priceChangePercent || 0),
            bidQty,
            askQty,
            imbalance: calcImbalance(bidQty, askQty),
            source: "binance_futures",
          };
        }
      }
      if (Object.keys(tickers).length === 3 && tickers.BTCUSDT.price > 0) {
        return { tickers, source: "binance_futures" };
      }
    }
  } catch {
    // Fall through to OKX Swap fallback
  }

  // 2. Fallback: OKX Perpetual Swaps + REAL live OKX Funding Rates (zero hardcoded funding!)
  const okxMap: Record<string, string> = {
    "BTC-USDT-SWAP": "BTCUSDT",
    "ETH-USDT-SWAP": "ETHUSDT",
    "SOL-USDT-SWAP": "SOLUSDT",
  };
  try {
    const [tickRes, ...fundResList] = await Promise.all([
      fetch("https://www.okx.com/api/v5/market/tickers?instType=SWAP", {
        signal: AbortSignal.timeout(3000),
      }),
      ...Object.keys(okxMap).map((inst) =>
        fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${inst}`, {
          signal: AbortSignal.timeout(2500),
        }).catch(() => null)
      ),
    ]);

    const realFundingMap: Record<string, { rate: number; nextMs: number }> = {};
    for (const fRes of fundResList) {
      if (!fRes || !fRes.ok) continue;
      try {
        const fBody = (await fRes.json()) as {
          code?: string;
          data?: Array<{ instId?: string; fundingRate?: string; nextFundingTime?: string }>;
        };
        const row = fBody.data?.[0];
        if (fBody.code === "0" && row?.instId && okxMap[row.instId]) {
          const parsedRate = Number(row.fundingRate);
          if (Number.isFinite(parsedRate)) {
            realFundingMap[okxMap[row.instId]] = {
              rate: parsedRate,
              nextMs: Number(row.nextFundingTime || 0),
            };
          }
        }
      } catch {
        // Ignore single funding parse error
      }
    }

    if (tickRes.ok) {
      const body = (await tickRes.json()) as { data?: Array<Record<string, string>> };
      for (const row of body.data ?? []) {
        const sym = okxMap[row.instId];
        if (!sym) continue;
        const last = Number(row.last || 0);
        const open24h = Number(row.open24h || last);
        const pct = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
        const bidQty = Number(row.bidSz || 0);
        const askQty = Number(row.askSz || 0);
        const fundInfo = realFundingMap[sym];
        tickers[sym] = {
          symbol: sym,
          price: last,
          fundingRate: fundInfo ? fundInfo.rate : 0,
          nextFundingMs: fundInfo ? fundInfo.nextMs : 0,
          changePct24h: Number(pct.toFixed(3)),
          bidQty,
          askQty,
          imbalance: calcImbalance(bidQty, askQty),
          source: "okx_swap",
        };
      }
    }
  } catch {
    // Ignore
  }

  return { tickers, source: tickers.BTCUSDT?.source ?? "unavailable" };
}

function calcIsolatedLiquidation(
  side: "LONG" | "SHORT",
  entryPrice: number,
  qty: number,
  isolatedMargin: number
): number {
  const notional = entryPrice * qty;
  const maint = notional * MAINT_MARGIN_RATE;
  const usable = Math.max(0, isolatedMargin - maint);
  if (side === "LONG") {
    return Math.max(0.0001, entryPrice - usable / qty);
  }
  return entryPrice + usable / qty;
}

function calcUnrealizedPnl(
  side: string,
  entryPrice: number,
  markPrice: number,
  qty: number
): number {
  const diff = side === "LONG" ? markPrice - entryPrice : entryPrice - markPrice;
  return diff * qty;
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function openPosition(
  db: RestDb,
  trader: Record<string, any>,
  symbol: string,
  side: "LONG" | "SHORT",
  price: number,
  reason: string,
  leverageOverride?: number
): Promise<boolean> {
  const bal = Number(trader.balance ?? 0);
  if (bal < 50 || price <= 0) return false;

  const prof = TRADER_PROFILES[trader.id] ?? TRADER_PROFILES.kemal;
  const fearLeft = Number(trader.fear_trades_remaining ?? 0);
  const defaultLev =
    fearLeft > 0 ? Math.max(2, Math.floor(prof.baseLeverage / 2)) : prof.baseLeverage;
  const leverage =
    typeof leverageOverride === "number" && leverageOverride >= 2
      ? Math.min(75, Math.trunc(leverageOverride))
      : defaultLev;
  const nextFear = Math.max(0, fearLeft - 1);

  const slippage = side === "LONG" ? 1.00018 : 0.99982;
  const decimals = symbol === "SOLUSDT" ? 4 : 2;
  const fillPrice = Number((price * slippage).toFixed(decimals));
  const margin = Number((bal * prof.marginFraction).toFixed(2));
  const notional = margin * leverage;
  const qty = Number((notional / fillPrice).toFixed(8));
  const entryFee = Number((fillPrice * qty * TAKER_FEE_RATE).toFixed(4));
  const isolatedMargin = Number((margin - entryFee).toFixed(4));
  if (isolatedMargin <= 0) return false;

  const liqPrice = Number(
    calcIsolatedLiquidation(side, fillPrice, qty, isolatedMargin).toFixed(decimals)
  );
  const sl = Number(
    (fillPrice * (side === "LONG" ? 1 - prof.slPct : 1 + prof.slPct)).toFixed(decimals)
  );
  const tp = Number(
    (fillPrice * (side === "LONG" ? 1 + prof.tpPct : 1 - prof.tpPct)).toFixed(decimals)
  );

  const posId = randomId("pos");
  const nowMs = Date.now();
  const nextEffectiveLev =
    nextFear > 0 ? Math.max(2, Math.floor(prof.baseLeverage / 2)) : prof.baseLeverage;

  await db.upsert("positions", {
    id: posId,
    trader_id: trader.id,
    symbol,
    side,
    leverage,
    entry_price: fillPrice,
    exit_price: null,
    qty,
    isolated_margin: isolatedMargin,
    liquidation_price: liqPrice,
    stop_loss: sl,
    take_profit: tp,
    entry_fee: entryFee,
    funding_paid: 0,
    pnl: 0,
    status: "open",
    reason_entry: reason,
    log_reason: "",
    mood: trader.mood || "focused",
    opened_at_ms: nowMs,
    closed_at_ms: null,
  });

  await db.patch("traders", `id=eq.${encodeURIComponent(trader.id)}`, {
    balance: Number((bal - margin).toFixed(4)),
    fear_trades_remaining: nextFear,
    max_leverage: nextEffectiveLev,
    last_signal: `${symbol} ${side} ${leverage}x — ${reason}`,
    updated_at: new Date().toISOString(),
  });

  await db.insert("events", {
    type: "OPEN_POSITION",
    trader_id: trader.id,
    message: `${trader.nickname} ${symbol} ${side} ${leverage}x açtı @ $${fillPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    payload: { position_id: posId, symbol, side, leverage, entry_price: fillPrice },
    processed: true,
  });

  trader.balance = Number((bal - margin).toFixed(4));
  trader.fear_trades_remaining = nextFear;
  return true;
}

async function closePosition(
  db: RestDb,
  pos: Record<string, any>,
  trader: Record<string, any> | undefined,
  exitPrice: number,
  reason: string,
  liquidated = false
): Promise<void> {
  const grossPnl = calcUnrealizedPnl(pos.side, Number(pos.entry_price), exitPrice, Number(pos.qty));
  const exitFee = exitPrice * Number(pos.qty) * TAKER_FEE_RATE;
  const netPnl = liquidated
    ? -(Number(pos.isolated_margin) + Number(pos.entry_fee || 0))
    : Number((grossPnl - exitFee).toFixed(4));
  const returned = liquidated ? 0 : Math.max(0, Number(pos.isolated_margin) + netPnl);
  const decimals = pos.symbol === "SOLUSDT" ? 4 : 2;

  await db.patch("positions", `id=eq.${encodeURIComponent(pos.id)}`, {
    status: "closed",
    exit_price: Number(exitPrice.toFixed(decimals)),
    pnl: Number(netPnl.toFixed(4)),
    log_reason: reason,
    closed_at_ms: Date.now(),
  });

  if (trader) {
    const newBal = Number((Number(trader.balance || 0) + returned).toFixed(4));
    const newRealized = Number((Number(trader.realized_pnl || 0) + netPnl).toFixed(4));
    const winCount = Number(trader.win_count || 0) + (!liquidated && netPnl >= 0 ? 1 : 0);
    const lossCount = Number(trader.loss_count || 0) + (liquidated || netPnl < 0 ? 1 : 0);
    const liqCount = Number(trader.liquidation_count || 0) + (liquidated ? 1 : 0);
    let mood = trader.mood || "focused";
    if (liquidated) {
      mood = newBal < 100 ? "busted" : "panicked";
    } else if (netPnl >= 0 && Number(trader.fear_trades_remaining || 0) === 0) {
      mood = winCount >= 2 ? "greedy" : "focused";
    } else if (newBal < 300) {
      mood = "panicked";
    }

    await db.patch("traders", `id=eq.${encodeURIComponent(trader.id)}`, {
      balance: newBal,
      realized_pnl: newRealized,
      win_count: winCount,
      loss_count: lossCount,
      liquidation_count: liqCount,
      mood,
      last_signal: liquidated
        ? `LİKİDE OLDU @ $${exitPrice.toFixed(2)}!`
        : `Kapatıldı (${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}$): ${reason}`,
      updated_at: new Date().toISOString(),
    });

    trader.balance = newBal;
    trader.realized_pnl = newRealized;
    trader.mood = mood;
  }

  if (liquidated) {
    await db.patch(
      "debts",
      `trader_id=eq.${encodeURIComponent(pos.trader_id)}&status=in.(aktif,gecikti)`,
      { status: "patladı", updated_at: new Date().toISOString() }
    );
  }

  await db.insert("events", {
    type: liquidated ? "LIQUIDATION" : "CLOSE_POSITION",
    trader_id: pos.trader_id,
    message: liquidated
      ? `${trader?.nickname ?? pos.trader_id} ${pos.symbol} ${pos.leverage}x pozisyonunda LİKİDE OLDU! ($${Math.abs(netPnl).toFixed(2)} yandı)`
      : `${trader?.nickname ?? pos.trader_id} ${pos.symbol} kapattı (${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USDT) — ${reason}`,
    payload: { position_id: pos.id, symbol: pos.symbol, pnl: Number(netPnl.toFixed(2)), reason },
    processed: true,
  });
}

async function processPendingCommands(
  db: RestDb,
  tickers: Record<string, MarketTicker>
): Promise<number> {
  const pending = await db.select("events", "select=*&processed=eq.false&order=id.asc&limit=25");
  if (pending.length === 0) return 0;

  let processedCount = 0;

  for (const cmd of pending) {
    // Atomic claim so concurrent triggers never double-execute
    const claimed = await db.patch(
      "events",
      `id=eq.${cmd.id}&processed=eq.false`,
      { processed: true },
      true
    );
    if (claimed.length === 0) continue;
    processedCount++;

    const evType = String(cmd.type || "");
    const traderId = String(cmd.trader_id || "");
    const payload = (cmd.payload && typeof cmd.payload === "object" ? cmd.payload : {}) as Record<
      string,
      any
    >;

    const findDebt = async (debtId?: string, tid?: string) => {
      if (debtId) {
        const rows = await db.select("debts", `select=*&id=eq.${encodeURIComponent(debtId)}&limit=1`);
        if (rows[0]) return rows[0];
      }
      if (tid) {
        const rows = await db.select(
          "debts",
          `select=*&trader_id=eq.${encodeURIComponent(tid)}&status=in.(aktif,gecikti)&order=created_at.desc&limit=1`
        );
        if (rows[0]) return rows[0];
      }
      return null;
    };

    if (evType === "DOUBLE_INTEREST") {
      const debt = await findDebt(payload.debt_id, traderId);
      if (debt) {
        const newRate = Number(Math.min(Number(debt.interest_rate) * 2.0, 3.0).toFixed(4));
        await db.patch("debts", `id=eq.${encodeURIComponent(debt.id)}`, {
          interest_rate: newRate,
          updated_at: new Date().toISOString(),
        });
        await db.patch("traders", `id=eq.${encodeURIComponent(debt.trader_id)}`, {
          mood: "panicked",
          last_signal: `Faiz %${(newRate * 100).toFixed(1)}'e katlandı!`,
          updated_at: new Date().toISOString(),
        });
        await db.insert("events", {
          type: "SYSTEM",
          trader_id: debt.trader_id,
          message: `Tefeci faizi 2'ye katladı! Yeni faiz oranı: %${(newRate * 100).toFixed(1)}`,
          payload: { debt_id: debt.id, interest_rate: newRate },
          processed: true,
        });
      }
    } else if (evType === "SEND_ENFORCER") {
      const tid = traderId || String(payload.trader_id || "");
      const debt = await findDebt(payload.debt_id, tid);
      if (debt) {
        await db.patch("debts", `id=eq.${encodeURIComponent(debt.id)}`, {
          enforcer_count: Number(debt.enforcer_count || 0) + 1,
          updated_at: new Date().toISOString(),
        });
      }
      const prof = TRADER_PROFILES[tid];
      if (prof) {
        await db.patch("traders", `id=eq.${encodeURIComponent(tid)}`, {
          mood: "panicked",
          fear_trades_remaining: 3,
          max_leverage: Math.max(2, Math.floor(prof.baseLeverage / 2)),
          last_signal: "Çırak kapıya dayandı! Kaldıraç 3 işlem yarıya düştü.",
          updated_at: new Date().toISOString(),
        });
        await db.insert("events", {
          type: "SYSTEM",
          trader_id: tid,
          message: `Çırak ${prof.nickname}'in kapısına dayandı! Korku modu aktif (3 işlem 1/2 kaldıraç).`,
          payload: { fear_trades_remaining: 3 },
          processed: true,
        });
      }
    } else if (evType === "COLLECT_DEBT") {
      const debt = await findDebt(payload.debt_id, traderId);
      if (debt) {
        const trRows = await db.select(
          "traders",
          `select=*&id=eq.${encodeURIComponent(debt.trader_id)}&limit=1`
        );
        const tr = trRows[0];
        if (tr) {
          const bal = Number(tr.balance || 0);
          const owed = Math.max(0, Number(debt.principal) - Number(debt.total_repaid || 0));
          const reqAmt = Number(payload.amount || Math.min(bal * 0.5, owed));
          const collectAmt = Number(Math.min(bal, owed, Math.max(0, reqAmt)).toFixed(2));
          if (collectAmt > 0) {
            const newRepaid = Number((Number(debt.total_repaid || 0) + collectAmt).toFixed(4));
            const remaining = Math.max(0, Number(debt.principal) - newRepaid);
            const newStatus = remaining <= 0.01 ? "ödendi" : debt.status;
            await db.patch("debts", `id=eq.${encodeURIComponent(debt.id)}`, {
              total_repaid: newRepaid,
              status: newStatus,
              updated_at: new Date().toISOString(),
            });
            await db.patch("traders", `id=eq.${encodeURIComponent(tr.id)}`, {
              balance: Number((bal - collectAmt).toFixed(4)),
              last_signal: `Tefeci $${collectAmt.toFixed(2)} tahsilat yaptı!`,
              updated_at: new Date().toISOString(),
            });
            await db.insert("events", {
              type: "SYSTEM",
              trader_id: tr.id,
              message: `${tr.nickname} kasasından $${collectAmt.toFixed(2)} tahsil edildi! Kalan borç: $${remaining.toFixed(2)}`,
              payload: { collected: collectAmt, remaining: Number(remaining.toFixed(2)) },
              processed: true,
            });
          }
        }
      }
    } else if (evType === "ISSUE_DEBT") {
      const tid = traderId || String(payload.trader_id || "");
      const prof = TRADER_PROFILES[tid];
      if (prof) {
        const principal = Math.max(100, Math.min(25000, Number(payload.principal || 1000)));
        const rate = Math.max(0.02, Math.min(0.5, Number(payload.interest_rate || 0.1)));
        const durationS = Math.max(60, Math.min(7200, Number(payload.duration_s || 600)));
        const debtId = randomId("debt");
        await db.insert("debts", {
          id: debtId,
          trader_id: tid,
          principal,
          initial_principal: principal,
          interest_rate: rate,
          compounding_period_s: 120,
          due_date_ms: Date.now() + durationS * 1000,
          status: "aktif",
          total_repaid: 0,
          enforcer_count: 0,
        });
        const trRows = await db.select(
          "traders",
          `select=*&id=eq.${encodeURIComponent(tid)}&limit=1`
        );
        const tr = trRows[0];
        await db.patch("traders", `id=eq.${encodeURIComponent(tid)}`, {
          balance: Number((Number(tr?.balance || 0) + principal).toFixed(4)),
          mood: tr?.mood === "busted" ? "greedy" : tr?.mood || "focused",
          last_signal: `Yeni tefeci borcu: $${principal.toFixed(0)} (%${(rate * 100).toFixed(0)} faiz)`,
          updated_at: new Date().toISOString(),
        });
        await db.insert("events", {
          type: "SYSTEM",
          trader_id: tid,
          message: `${prof.nickname}'e $${principal.toFixed(0)} yeni borç verildi (%${(rate * 100).toFixed(0)} bileşik faiz).`,
          payload: { debt_id: debtId, principal, rate },
          processed: true,
        });
      }
    } else if (evType === "FORCE_CLOSE") {
      const posId = String(payload.position_id || "");
      let pos: Record<string, any> | undefined;
      if (posId) {
        const rows = await db.select(
          "positions",
          `select=*&id=eq.${encodeURIComponent(posId)}&status=eq.open&limit=1`
        );
        pos = rows[0];
      } else if (traderId) {
        const rows = await db.select(
          "positions",
          `select=*&trader_id=eq.${encodeURIComponent(traderId)}&status=eq.open&limit=1`
        );
        pos = rows[0];
      }
      if (pos) {
        const trRows = await db.select(
          "traders",
          `select=*&id=eq.${encodeURIComponent(pos.trader_id)}&limit=1`
        );
        const px = tickers[pos.symbol]?.price || Number(pos.entry_price);
        await closePosition(db, pos, trRows[0], px, "Tefeci emriyle zorla kapatıldı", false);
      }
    } else if (evType === "TRIGGER_TEST_TRADE") {
      const tid = traderId || String(payload.trader_id || "");
      const [allTraders, openPos] = await Promise.all([
        db.select("traders"),
        db.select("positions", "select=*&status=eq.open"),
      ]);
      const openSet = new Set(openPos.map((p) => `${p.trader_id}:${p.symbol}`));
      const availSyms = Object.keys(tickers).filter((s) => (tickers[s]?.price ?? 0) > 0);
      const reqSym = String(payload.symbol || "").toUpperCase();
      // Deterministic symbol pick: requested symbol, else strongest live orderbook imbalance
      const sym = availSyms.includes(reqSym)
        ? reqSym
        : availSyms.sort(
            (a, b) => Math.abs(tickers[b]?.imbalance ?? 0) - Math.abs(tickers[a]?.imbalance ?? 0)
          )[0] || "BTCUSDT";
      const tk = tickers[sym];
      const px = tk?.price || 0;
      const liveSide = determineOrderbookSide(tk);

      const list = allTraders
        .filter((t) => (!tid ? true : t.id === tid))
        .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
      for (const tr of list) {
        if (openSet.has(`${tr.id}:${sym}`) || Number(tr.balance) < 50) continue;
        const sideRaw = String(payload.side || "").toUpperCase();
        const side: "LONG" | "SHORT" =
          sideRaw === "LONG" || sideRaw === "SHORT" ? sideRaw : liveSide;
        await openPosition(
          db,
          tr,
          sym,
          side,
          px,
          `Canlı emir defteri dengesi (OBI=${(tk?.imbalance ?? 0).toFixed(2)}) — ${sym} girişi`
        );
        break;
      }
    }
  }

  return processedCount;
}

async function runAutonomousTick(
  db: RestDb,
  tickers: Record<string, MarketTicker>
): Promise<Record<string, unknown>> {
  const [traders, openPositions, debts] = await Promise.all([
    db.select("traders"),
    db.select("positions", "select=*&status=eq.open"),
    db.select("debts"),
  ]);
  const traderMap = new Map(traders.map((t) => [t.id, t]));

  let closedCount = 0;
  let openedCount = 0;
  let compoundedCount = 0;

  const stillOpen: Array<Record<string, any>> = [];
  const pnlPatchPromises: Array<Promise<unknown>> = [];
  for (const pos of openPositions) {
    const px = tickers[pos.symbol]?.price;
    if (!px) {
      stillOpen.push(pos);
      continue;
    }
    const tr = traderMap.get(pos.trader_id);
    const liqPx = Number(pos.liquidation_price);
    const isLiq = pos.side === "LONG" ? px <= liqPx : px >= liqPx;
    if (isLiq) {
      await closePosition(
        db,
        pos,
        tr,
        px,
        `LİKİDASYON @ $${px.toFixed(2)} (Liq: $${liqPx.toFixed(2)})`,
        true
      );
      closedCount++;
      continue;
    }

    const sl = pos.stop_loss != null ? Number(pos.stop_loss) : null;
    const tp = pos.take_profit != null ? Number(pos.take_profit) : null;
    const hitSl = sl != null && (pos.side === "LONG" ? px <= sl : px >= sl);
    const hitTp = tp != null && (pos.side === "LONG" ? px >= tp : px <= tp);

    if (hitSl) {
      await closePosition(db, pos, tr, px, "Stop-Loss tetiklendi", false);
      closedCount++;
      continue;
    }
    if (hitTp) {
      await closePosition(db, pos, tr, px, "Take-Profit alındı", false);
      closedCount++;
      continue;
    }

    const unrealized = Number(
      calcUnrealizedPnl(pos.side, Number(pos.entry_price), px, Number(pos.qty)).toFixed(4)
    );
    pnlPatchPromises.push(
      db.patch("positions", `id=eq.${encodeURIComponent(pos.id)}`, { pnl: unrealized })
    );
    pos.pnl = unrealized;
    stillOpen.push(pos);
  }
  if (pnlPatchPromises.length > 0) {
    await Promise.all(pnlPatchPromises);
  }

  // Autonomous trader entries
  const openByTraderSym = new Set(stillOpen.map((p) => `${p.trader_id}:${p.symbol}`));
  const openCountByTrader = new Map<string, number>();
  for (const p of stillOpen) {
    openCountByTrader.set(p.trader_id, (openCountByTrader.get(p.trader_id) || 0) + 1);
  }

  for (const tr of traders) {
    const prof = TRADER_PROFILES[tr.id];
    if (!prof) continue;
    const curOpen = openCountByTrader.get(tr.id) || 0;
    if (curOpen >= 2 || Number(tr.balance) < 80) continue;

    const sym = prof.preferredSymbols.find(
      (s) => tickers[s]?.price > 0 && !openByTraderSym.has(`${tr.id}:${s}`)
    );
    if (!sym) continue;

    const tk = tickers[sym];
    const absChg = Math.abs(tk.changePct24h);
    const absObi = Math.abs(tk.imbalance);
    const absFund = Math.abs(tk.fundingRate);
    const fearLeft = Number(tr.fear_trades_remaining ?? 0);
    const baseLev =
      fearLeft > 0 ? Math.max(2, Math.floor(prof.baseLeverage / 2)) : prof.baseLeverage;
    const wins = Number(tr.win_count ?? 0);
    const losses = Number(tr.loss_count ?? 0);
    const mood = String(tr.mood ?? "focused");
    let side: "LONG" | "SHORT" | null = null;
    let levOverride: number | undefined = undefined;
    let reason = "";

    // Nuri FONLAMA: 100% real-market deterministic triggers + realistic human mistakes/tilt (zero Math.random)
    if (tr.id === "selo" && (absChg >= 0.45 || absObi >= 0.32)) {
      side = absObi >= 0.32 ? determineOrderbookSide(tk) : tk.changePct24h >= 0 ? "LONG" : "SHORT";
      if (mood === "tilted" || mood === "panicked" || losses > wins) {
        levOverride = fearLeft === 0 ? Math.min(75, baseLev + 15) : baseLev;
        reason = `Tilt intikam hatası! FOMO ile ${levOverride}x daldı (${tk.changePct24h >= 0 ? "+" : ""}${tk.changePct24h.toFixed(2)}%, OBI=${tk.imbalance.toFixed(2)})`;
      } else {
        reason = `Hacim/OBI patlaması (${tk.changePct24h >= 0 ? "+" : ""}${tk.changePct24h.toFixed(2)}%, OBI=${tk.imbalance.toFixed(2)})`;
      }
    } else if (tr.id === "kemal" && absObi >= 0.18) {
      side = determineOrderbookSide(tk);
      const stubborn = losses > wins && absObi >= 0.35;
      reason = stubborn
        ? `Tahta inadı — derinlik tersine dönse de yüklendi (OBI=${tk.imbalance.toFixed(2)})`
        : `Gerçek tahta dengesizliği (OBI=${tk.imbalance.toFixed(2)} @ $${tk.price.toFixed(2)})`;
    } else if (tr.id === "nuri" && absFund >= 0.00004) {
      side = tk.fundingRate > 0 ? "SHORT" : "LONG";
      const againstTrend =
        (side === "SHORT" && tk.changePct24h >= 1.5) ||
        (side === "LONG" && tk.changePct24h <= -1.5);
      reason = againstTrend
        ? `İnatçı funding tersi — squeeze riski! (Funding ${(tk.fundingRate * 100).toFixed(4)}%)`
        : `Canlı funding arbitrajı (Funding ${(tk.fundingRate * 100).toFixed(4)}%)`;
    } else if (tr.id === "mehmet" && (absChg >= 0.9 || absObi >= 0.28)) {
      side = tk.changePct24h < 0 ? "LONG" : "SHORT";
      if (absChg >= 2.2) {
        levOverride = fearLeft === 0 ? Math.min(50, baseLev + 5) : baseLev;
        reason = `Erken fitil avı hatası — düşen bıçağa atladı (${sym}, 24s ${tk.changePct24h.toFixed(2)}%)`;
      } else {
        reason = `Fitil tepki taraması (${sym}, 24s ${tk.changePct24h.toFixed(2)}%)`;
      }
    } else if (tr.id === "sevil" && (absChg >= 1.3 || (absObi >= 0.25 && absFund >= 0.00003))) {
      side = tk.changePct24h > 1.0 ? "SHORT" : "LONG";
      if (absFund >= 0.00012 && fearLeft === 0) {
        levOverride = Math.min(15, baseLev + 3);
        reason = `Nadir hırs anı — kademeyi ${levOverride}x yaptı (Funding ${(tk.fundingRate * 100).toFixed(4)}%)`;
      } else {
        reason = `Soğukkanlı ortalamaya dönüş (${sym}, 24s ${tk.changePct24h.toFixed(2)}%)`;
      }
    }

    if (side) {
      const ok = await openPosition(db, tr, sym, side, tk.price, reason, levOverride);
      if (ok) {
        openedCount++;
        openByTraderSym.add(`${tr.id}:${sym}`);
        openCountByTrader.set(tr.id, curOpen + 1);
      }
    }
  }

  // Debt compounding
  const nowMs = Date.now();
  for (const d of debts) {
    if (d.status !== "aktif" && d.status !== "gecikti") continue;
    const periodMs = Math.max(30, Number(d.compounding_period_s || 120)) * 1000;
    const lastUpdMs = d.updated_at ? Date.parse(d.updated_at) : nowMs;
    const overdue = nowMs > Number(d.due_date_ms);
    let nextStatus = d.status;
    let principal = Number(d.principal);
    let changed = false;

    if (overdue && nextStatus === "aktif") {
      nextStatus = "gecikti";
      changed = true;
    }
    const maxPrincipal = Number(d.initial_principal || 1000) * 15;
    if (nowMs - lastUpdMs >= periodMs && principal < maxPrincipal) {
      const rate = nextStatus === "gecikti" ? Number(d.interest_rate) * 1.5 : Number(d.interest_rate);
      principal = Number(Math.min(maxPrincipal, principal * (1 + rate)).toFixed(4));
      changed = true;
    }

    if (changed) {
      compoundedCount++;
      await db.patch("debts", `id=eq.${encodeURIComponent(d.id)}`, {
        principal,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      });
      d.principal = principal;
      d.status = nextStatus;

      const tr = traderMap.get(d.trader_id);
      if (nextStatus === "gecikti" && tr && tr.mood !== "panicked") {
        await db.patch("traders", `id=eq.${encodeURIComponent(tr.id)}`, {
          mood: "panicked",
          updated_at: new Date().toISOString(),
        });
      }
      await db.insert("events", {
        type: "COMPOUND",
        trader_id: d.trader_id,
        message: `${tr?.nickname ?? d.trader_id} borcu bileşik faizle $${principal.toFixed(2)} oldu (${nextStatus})`,
        payload: { debt_id: d.id, principal: Number(principal.toFixed(2)), status: nextStatus },
        processed: true,
      });
    }
  }

  // Equity snapshot + compact retention
  const btcPrice = tickers.BTCUSDT?.price ?? 0;
  const ethPrice = tickers.ETHUSDT?.price ?? 0;
  if (btcPrice > 0) {
    const totalUnrealized = stillOpen.reduce((acc, p) => acc + Number(p.pnl || 0), 0);
    const lockedMargin = stillOpen.reduce((acc, p) => acc + Number(p.isolated_margin || 0), 0);
    const totalBal = traders.reduce((acc, t) => acc + Number(t.balance || 0), 0);
    const totalTraderEquity = totalBal + lockedMargin + totalUnrealized;
    const totalDebtOwed = debts
      .filter((d) => d.status === "aktif" || d.status === "gecikti")
      .reduce((acc, d) => acc + Math.max(0, Number(d.principal) - Number(d.total_repaid || 0)), 0);
    const totalAccrued = debts.reduce(
      (acc, d) => acc + Math.max(0, Number(d.principal) - Number(d.initial_principal || d.principal)),
      0
    );
    const totalRepaid = debts.reduce((acc, d) => acc + Number(d.total_repaid || 0), 0);
    const tefeciProfit = totalAccrued + totalRepaid * 0.25;

    await db.insert("equity_snapshots", {
      ts_ms: nowMs,
      tefeci_profit: Number(tefeciProfit.toFixed(2)),
      total_debt_owed: Number(totalDebtOwed.toFixed(2)),
      total_trader_equity: Number(totalTraderEquity.toFixed(2)),
      total_unrealized_pnl: Number(totalUnrealized.toFixed(2)),
      btc_price: Number(btcPrice.toFixed(2)),
      eth_price: Number(ethPrice.toFixed(2)),
    });

    if (Math.floor(nowMs / 15000) % 10 === 0) {
      const [oldSnaps, oldEvents] = await Promise.all([
        db.select("equity_snapshots", "select=id&order=id.desc&offset=180&limit=100"),
        db.select("events", "select=id&processed=eq.true&order=id.desc&offset=250&limit=150"),
      ]);
      const delOps: Array<Promise<void>> = [];
      if (oldSnaps.length > 0) {
        delOps.push(db.del("equity_snapshots", `id=in.(${oldSnaps.map((r) => r.id).join(",")})`));
      }
      if (oldEvents.length > 0) {
        delOps.push(db.del("events", `id=in.(${oldEvents.map((r) => r.id).join(",")})`));
      }
      if (delOps.length > 0) await Promise.all(delOps);
    }
  }

  return {
    open_positions: stillOpen.length,
    opened: openedCount,
    closed: closedCount,
    compounded_debts: compoundedCount,
    btc_price: btcPrice,
    eth_price: ethPrice,
    sol_price: tickers.SOLUSDT?.price ?? 0,
  };
}

interface HistoricalCandleRow {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const ALLOWED_CANDLE_SYMBOLS: Record<string, string> = {
  BTCUSDT: "BTC-USDT-SWAP",
  ETHUSDT: "ETH-USDT-SWAP",
  SOLUSDT: "SOL-USDT-SWAP",
};

const ALLOWED_CANDLE_INTERVALS: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
};

function sanitizeCandles(rows: HistoricalCandleRow[]): HistoricalCandleRow[] {
  const byTs = new Map<number, HistoricalCandleRow>();
  for (const c of rows) {
    if (
      !Number.isFinite(c.ts) ||
      c.ts <= 0 ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      c.open <= 0 ||
      c.high <= 0 ||
      c.low <= 0 ||
      c.close <= 0
    ) {
      continue;
    }
    byTs.set(c.ts, {
      ts: Math.trunc(c.ts),
      open: c.open,
      high: Math.max(c.high, c.open, c.close),
      low: Math.min(c.low, c.open, c.close),
      close: c.close,
      volume: Number.isFinite(c.volume) ? Math.max(0, c.volume) : 0,
    });
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

async function fetchRealHistoricalCandles(
  symbol: string,
  interval: string,
  limit: number
): Promise<{ source: "binance_fapi" | "okx_swap"; candles: HistoricalCandleRow[] }> {
  // 1. Primary: Binance USD-M Futures REST
  try {
    const binanceUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(
      symbol
    )}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetch(binanceUrl, { signal: AbortSignal.timeout(4500) });
    if (res.ok) {
      const raw = (await res.json()) as unknown[];
      if (Array.isArray(raw) && raw.length > 0) {
        const parsed: HistoricalCandleRow[] = [];
        for (const item of raw) {
          if (!Array.isArray(item) || item.length < 6) continue;
          parsed.push({
            ts: Number(item[0]),
            open: parseFloat(String(item[1])),
            high: parseFloat(String(item[2])),
            low: parseFloat(String(item[3])),
            close: parseFloat(String(item[4])),
            volume: parseFloat(String(item[5])),
          });
        }
        const cleaned = sanitizeCandles(parsed);
        if (cleaned.length >= 10) {
          return { source: "binance_fapi", candles: cleaned };
        }
      }
    }
  } catch {
    // Fall through to OKX geo-block fallback
  }

  // 2. Approved Geo-Block Fallback: OKX Perpetual Swap REST
  const okxInst = ALLOWED_CANDLE_SYMBOLS[symbol];
  const okxBar = ALLOWED_CANDLE_INTERVALS[interval];
  const okxUrl = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(
    okxInst
  )}&bar=${encodeURIComponent(okxBar)}&limit=${Math.min(limit, 300)}`;
  const okxRes = await fetch(okxUrl, { signal: AbortSignal.timeout(5000) });
  if (!okxRes.ok) {
    throw new Error(`OKX candles HTTP ${okxRes.status}`);
  }
  const okxJson = (await okxRes.json()) as { code?: string; data?: unknown[] };
  if (okxJson.code !== "0" || !Array.isArray(okxJson.data) || okxJson.data.length === 0) {
    throw new Error("OKX candles empty response");
  }
  const parsed: HistoricalCandleRow[] = [];
  for (const item of okxJson.data) {
    if (!Array.isArray(item) || item.length < 6) continue;
    parsed.push({
      ts: Number(item[0]),
      open: parseFloat(String(item[1])),
      high: parseFloat(String(item[2])),
      low: parseFloat(String(item[3])),
      close: parseFloat(String(item[4])),
      volume: parseFloat(String(item[5])),
    });
  }
  const cleaned = sanitizeCandles(parsed);
  if (cleaned.length < 10) {
    throw new Error("Yetersiz gerçek mum verisi");
  }
  return { source: "okx_swap", candles: cleaned };
}

const lastCandleSyncMs = new Map<string, number>();

async function persistLiveFundingSnapshots(
  db: RestDb,
  tickers: Record<string, MarketTicker>
): Promise<void> {
  const rows = Object.values(tickers)
    .filter((tk) => tk.price > 0 && (tk.source === "binance_futures" || tk.source === "okx_swap"))
    .map((tk) => ({
      symbol: tk.symbol,
      mark_price: tk.price,
      funding_rate: tk.fundingRate,
      next_funding_ms: tk.nextFundingMs,
      imbalance: tk.imbalance,
      change_pct_24h: tk.changePct24h,
      source: tk.source,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    await db.upsert("market_funding_snapshots", rows).catch(() => {});
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = new RestDb(supabaseUrl, serviceKey);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  // Tur 3+4 (Sinan + Kemal): Real Historical Candles endpoint + rate-limited DB vault persistence
  if (action === "candles" || url.pathname.endsWith("/candles")) {
    const rawSym = (url.searchParams.get("symbol") || "BTCUSDT").trim().toUpperCase();
    const rawIv = (url.searchParams.get("interval") || "1m").trim().toLowerCase();
    const rawLimit = Number(url.searchParams.get("limit") || "120");
    if (!ALLOWED_CANDLE_SYMBOLS[rawSym]) {
      return new Response(
        JSON.stringify({ status: "error", error: `Desteklenmeyen sembol: ${rawSym}` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (!ALLOWED_CANDLE_INTERVALS[rawIv]) {
      return new Response(
        JSON.stringify({ status: "error", error: `Desteklenmeyen aralık: ${rawIv}` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const clampedLimit = Math.max(30, Math.min(200, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 120));
    try {
      const { source, candles } = await fetchRealHistoricalCandles(rawSym, rawIv, clampedLimit);
      // Kemal TAHTA: Rate-limited candle archive (max once per 30s per symbol+interval, latest 60 bars)
      const cacheKey = `${rawSym}:${rawIv}`;
      const nowMs = Date.now();
      const prevSync = lastCandleSyncMs.get(cacheKey) ?? 0;
      let persisted = false;
      if (supabaseUrl && serviceKey && nowMs - prevSync >= 30_000) {
        lastCandleSyncMs.set(cacheKey, nowMs);
        const batch = candles.slice(-60).map((c) => ({
          symbol: rawSym,
          interval: rawIv,
          ts: c.ts,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          source,
        }));
        await db.upsert("market_candles", batch).catch(() => {});
        persisted = true;
      }
      return new Response(
        JSON.stringify({
          status: "ok",
          symbol: rawSym,
          interval: rawIv,
          source,
          count: candles.length,
          vault_persisted: persisted,
          candles,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          status: "error",
          error:
            err instanceof Error
              ? `Gerçek mum verisi alınamadı: ${err.message}`
              : "Gerçek mum verisi alınamadı",
        }),
        { status: 502, headers: CORS_HEADERS }
      );
    }
  }

  try {
    const { tickers, source } = await fetchLiveMarket();
    if (supabaseUrl && serviceKey) {
      await persistLiveFundingSnapshots(db, tickers);
    }

    if (req.method === "GET" || action === "health" || url.pathname.endsWith("/health")) {
      const [openPos, activeDebts, traders] = await Promise.all([
        db.select("positions", "select=id&status=eq.open"),
        db.select("debts", "select=id&status=in.(aktif,gecikti)"),
        db.select("traders", "select=id"),
      ]);

      return new Response(
        JSON.stringify({
          status: "ok",
          engine: "tefeci-cloud-worker",
          region: "eu-central-1",
          feed_source: source,
          prices: {
            BTCUSDT: tickers.BTCUSDT?.price ?? 0,
            ETHUSDT: tickers.ETHUSDT?.price ?? 0,
            SOLUSDT: tickers.SOLUSDT?.price ?? 0,
          },
          funding_rates: {
            BTCUSDT: tickers.BTCUSDT?.fundingRate ?? 0,
            ETHUSDT: tickers.ETHUSDT?.fundingRate ?? 0,
            SOLUSDT: tickers.SOLUSDT?.fundingRate ?? 0,
          },
          next_funding_ms: {
            BTCUSDT: tickers.BTCUSDT?.nextFundingMs ?? 0,
            ETHUSDT: tickers.ETHUSDT?.nextFundingMs ?? 0,
            SOLUSDT: tickers.SOLUSDT?.nextFundingMs ?? 0,
          },
          open_positions: openPos.length,
          active_debts: activeDebts.length,
          traders: traders.length,
          supabase_connected: Boolean(supabaseUrl && serviceKey),
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    let mode = url.searchParams.get("mode") || "tick";
    try {
      const body = await req.json();
      if (body && typeof body.mode === "string") {
        mode = body.mode;
      }
    } catch {
      // default tick
    }

    const commandsProcessed = await processPendingCommands(db, tickers);
    const tickStats =
      mode === "command" ? { mode: "command_only" } : await runAutonomousTick(db, tickers);

    return new Response(
      JSON.stringify({
        status: "ok",
        mode,
        feed_source: source,
        commands_processed: commandsProcessed,
        ...tickStats,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
