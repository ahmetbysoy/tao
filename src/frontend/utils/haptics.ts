// Hayri: Lightweight mobile haptics helper with graceful silent fallback on iOS/unsupported browsers.

const STORAGE_KEY = "tefeci_haptics_enabled";

let hapticsEnabled = (() => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null ? true : saved === "1";
  } catch {
    return true;
  }
})();

export function isHapticsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage quota / private mode
  }
}

export type HapticPattern = "short" | "medium" | "long";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  short: 18,
  medium: [35, 30, 35],
  long: [75, 40, 110],
};

export function triggerHaptic(pattern: HapticPattern): boolean {
  if (!hapticsEnabled) return false;
  if (!isHapticsSupported()) return false;
  try {
    return navigator.vibrate(PATTERNS[pattern]);
  } catch {
    return false;
  }
}

export const hapticShort = () => triggerHaptic("short");
export const hapticMedium = () => triggerHaptic("medium");
export const hapticLong = () => triggerHaptic("long");
