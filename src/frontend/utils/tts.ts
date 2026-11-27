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
  selo: { pitch: 1.5, rate: 1.3 },   // Panicked & fast
  kemal: { pitch: 0.7, rate: 0.8 },  // Threatening & slow
  mehmet: { pitch: 1.0, rate: 1.1 }, // Sharp & opportunistic
  nuri: { pitch: 0.9, rate: 0.95 },  // Calculating
  sevil: { pitch: 1.15, rate: 0.9 }, // Cold-blooded
  tefeci: { pitch: 0.75, rate: 1.05 },
};

let audioUnlocked = false;

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

export function speakAs(character: TraderVoiceId, text: string): void {
  if (!audioUnlocked || typeof window === "undefined" || !("speechSynthesis" in window)) {
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
