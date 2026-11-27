// Ece: Real Binance Futures !forceOrder@arr tiered liquidation classifier.
// Thresholds:
//   - >= $10,000   : "event"  (live ticker ribbon + cumulative counter)
//   - >= $100,000  : "impact" (0.18s throttled micro-shake + short haptic + matching trader red flash)
//   - >= $1,000,000: "whale"  (existing DarkPatternAlerts panic mode + TTS + siren + long haptic)

export const LIQ_EVENT_THRESHOLD_USDT = 10_000;
export const LIQ_IMPACT_THRESHOLD_USDT = 100_000;
export const LIQ_WHALE_THRESHOLD_USDT = 1_000_000;
export const SHAKE_COOLDOWN_MS = 2_200;

export type LiquidationTier = "ignore" | "event" | "impact" | "whale";

export interface LiveLiquidationItem {
  id: string;
  symbol: string;
  /** Which side got liquidated: Binance forceOrder S="SELL" means a LONG position was liquidated. */
  liquidatedSide: "LONG" | "SHORT";
  notionalUsdt: number;
  price: number;
  tier: Exclude<LiquidationTier, "ignore">;
  timestampMs: number;
}

export function classifyLiquidationTier(notionalUsdt: number): LiquidationTier {
  if (!Number.isFinite(notionalUsdt) || notionalUsdt < LIQ_EVENT_THRESHOLD_USDT) {
    return "ignore";
  }
  if (notionalUsdt >= LIQ_WHALE_THRESHOLD_USDT) return "whale";
  if (notionalUsdt >= LIQ_IMPACT_THRESHOLD_USDT) return "impact";
  return "event";
}

let liqSeq = 0;

export function parseForceOrderFrame(
  orderObj: Record<string, unknown> | undefined
): LiveLiquidationItem | null {
  if (!orderObj) return null;
  const symbol = String(orderObj.s ?? "").toUpperCase();
  const orderSide = String(orderObj.S ?? "").toUpperCase();
  const avgPx = parseFloat(String(orderObj.ap ?? orderObj.p ?? "0"));
  const qty = parseFloat(String(orderObj.z ?? orderObj.l ?? orderObj.q ?? "0"));
  if (!symbol || !Number.isFinite(avgPx) || !Number.isFinite(qty) || avgPx <= 0 || qty <= 0) {
    return null;
  }

  const notionalUsdt = avgPx * qty;
  const tier = classifyLiquidationTier(notionalUsdt);
  if (tier === "ignore") return null;

  const ts = Number(orderObj.T ?? Date.now()) || Date.now();
  liqSeq += 1;

  return {
    id: `${ts}_${liqSeq}`,
    symbol,
    liquidatedSide: orderSide === "SELL" ? "LONG" : "SHORT",
    notionalUsdt,
    price: avgPx,
    tier,
    timestampMs: ts,
  };
}

export function formatCompactUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}
