import { TraderRow } from "./supabase";

const FEAR_SUPPORTED_IDS = new Set(["selo", "mehmet", "nuri", "kemal", "sevil"]);

export const CIRAK_AVATAR_SRC = "/avatars/cirak.webp";
export const TEFECI_AVATAR_SRC = "/avatars/tefeci.webp";

/**
 * Returns true when a trader is in active Fear Mode (Çırak dispatched), panicked, or busted.
 */
export function isTraderInFearVisualState(
  trader?: Pick<TraderRow, "mood" | "fear_trades_remaining"> | null
): boolean {
  if (!trader) return false;
  return (
    Number(trader.fear_trades_remaining ?? 0) > 0 ||
    trader.mood === "panicked" ||
    trader.mood === "busted"
  );
}

/**
 * Dynamically swaps a trader's cyberpunk WebP portrait between normal and panicked/fear expression.
 */
export function getTraderAvatarSrc(
  traderId: string,
  fearOrPanicked: boolean
): string {
  if (traderId === "tefeci") return TEFECI_AVATAR_SRC;
  if (traderId === "cirak") return CIRAK_AVATAR_SRC;
  if (fearOrPanicked && FEAR_SUPPORTED_IDS.has(traderId)) {
    return `/avatars/${traderId}_fear.webp`;
  }
  if (FEAR_SUPPORTED_IDS.has(traderId)) {
    return `/avatars/${traderId}.webp`;
  }
  return TEFECI_AVATAR_SRC;
}
