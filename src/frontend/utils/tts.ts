/**
 * Web Speech API (TTS) engine with character-specific voice profiles.
 * Requires user gesture via unlockAudio() ("Mahalleye Gir" button).
 */

export type TraderVoiceId = "selo" | "kemal" | "mehmet" | "nuri" | "sevil" | "tefeci";

interface VoiceProfile {
  pitch: number;
  rate: number;
}

const VOICE_PROFILES: Record<TraderVoiceId, VoiceProfile> = {
  selo: { pitch: 1.45, rate: 1.25 },   // Panicked & fast
  kemal: { pitch: 0.72, rate: 0.82 },  // Threatening & slow
  mehmet: { pitch: 1.0, rate: 1.1 },   // Sharp & opportunistic
  nuri: { pitch: 0.9, rate: 0.95 },    // Calculating
  sevil: { pitch: 1.15, rate: 0.9 },   // Cold-blooded
  tefeci: { pitch: 0.75, rate: 1.05 }, // Boss
};

let audioUnlocked = false;
let ttsEnabled = true;

export function unlockAudio(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }
  audioUnlocked = true;
  const utter = new SpeechSynthesisUtterance("");
  utter.volume = 0;
  window.speechSynthesis.speak(utter);
  return true;
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

export function setTtsEnabled(enabled: boolean): void {
  ttsEnabled = enabled;
  if (!enabled && typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function isTtsEnabled(): boolean {
  return ttsEnabled;
}

export function speakAs(character: TraderVoiceId, text: string): void {
  if (
    !audioUnlocked ||
    !ttsEnabled ||
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  ) {
    return;
  }
  const profile = VOICE_PROFILES[character] ?? VOICE_PROFILES.tefeci;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "tr-TR";
  utterance.pitch = profile.pitch;
  utterance.rate = profile.rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
