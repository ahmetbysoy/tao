// Ece: Screen-shake toggle persisted locally, honoring prefers-reduced-motion.

const STORAGE_KEY = "tefeci_shake_enabled";

let shakeEnabled = (() => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "1";
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
})();

export function isShakeEnabled(): boolean {
  return shakeEnabled;
}

export function setShakeEnabled(enabled: boolean): void {
  shakeEnabled = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore
  }
}
