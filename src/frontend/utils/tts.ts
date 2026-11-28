/**
 * Selo ROKET — Anti-Repetition Male/Female Web Speech API (TTS) Engine.
 * Zero Math.random(), distinct masculine (Selo/Mehmet/Nuri/Kemal/Tefeci) and
 * feminine (Madam Sevil) voice selection + deterministic intonation shifts.
 * Requires user gesture via unlockAudio() ("Yeraltı Kahvehanesine Gir").
 */

import {
  pickNonRepeatingStreetDelivery,
  SPEAKER_GENDERS,
  StreetEventKind,
  StreetVoiceDelivery,
  TraderVoiceId,
  VoiceGender,
} from "./streetDialogue";

export type { StreetEventKind, StreetVoiceDelivery, TraderVoiceId, VoiceGender };

interface VoiceProfile {
  pitch: number;
  rate: number;
}

const VOICE_PROFILES: Record<TraderVoiceId, VoiceProfile> = {
  selo: { pitch: 1.08, rate: 1.16 },   // Energetic & fast masculine
  kemal: { pitch: 0.74, rate: 0.85 },  // Deep & gravelly masculine
  mehmet: { pitch: 0.96, rate: 1.08 }, // Sharp & opportunistic masculine
  nuri: { pitch: 0.88, rate: 0.95 },   // Calculating masculine
  sevil: { pitch: 1.24, rate: 0.95 },  // Confident & cold-blooded feminine
  tefeci: { pitch: 0.72, rate: 0.96 }, // Authoritative boss masculine
};

const FEMININE_VOICE_HINTS = ["yelda", "emel", "seda", "filiz", "ayse", "zeynep", "female", "kadın"];
const MASCULINE_VOICE_HINTS = ["cem", "ahmet", "tolga", "murat", "mehmet", "male", "erkek"];

let audioUnlocked = false;
let ttsEnabled = true;
let lastSpokenText = "";
let lastSpokenAtMs = 0;

function pickBestTurkishVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const trVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("tr"));
  if (trVoices.length === 0) return null;

  const hints = gender === "feminine" ? FEMININE_VOICE_HINTS : MASCULINE_VOICE_HINTS;
  const matched = trVoices.find((v) =>
    hints.some((h) => v.name.toLowerCase().includes(h))
  );
  if (matched) return matched;

  // Deterministic fallback when OS exposes multiple Turkish voices without gender labels
  if (trVoices.length >= 2) {
    return gender === "feminine" ? trVoices[0] : trVoices[1];
  }
  return trVoices[0];
}

export function unlockAudio(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }
  audioUnlocked = true;
  // Trigger voice list population in Chromium/Safari
  window.speechSynthesis.getVoices();
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

export function speakAs(
  character: TraderVoiceId,
  text: string,
  overrideProsody?: { pitch?: number; rate?: number }
): void {
  if (
    !audioUnlocked ||
    !ttsEnabled ||
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) return;

  // Hard anti-repetition guard: never repeat identical string back-to-back within 25s
  const now = Date.now();
  if (trimmed === lastSpokenText && now - lastSpokenAtMs < 25_000) {
    return;
  }
  lastSpokenText = trimmed;
  lastSpokenAtMs = now;

  const profile = VOICE_PROFILES[character] ?? VOICE_PROFILES.tefeci;
  const gender = SPEAKER_GENDERS[character] ?? "masculine";
  const voice = pickBestTurkishVoice(gender);

  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = "tr-TR";
  if (voice) {
    utterance.voice = voice;
  }
  utterance.pitch = overrideProsody?.pitch ?? profile.pitch;
  utterance.rate = overrideProsody?.rate ?? profile.rate;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

/**
 * Selo ROKET: Speak a guaranteed non-repeating aggressive street-slang dialogue
 * tailored to the event type & speaker gender with dynamic prosody modulation.
 */
export function speakStreetEvent(
  speaker: TraderVoiceId,
  eventKind: StreetEventKind,
  seedNumber: number,
  includeSpeakerPrefix = false
): StreetVoiceDelivery {
  const delivery = pickNonRepeatingStreetDelivery(
    speaker,
    eventKind,
    seedNumber,
    includeSpeakerPrefix
  );
  speakAs(speaker, delivery.text, { pitch: delivery.pitch, rate: delivery.rate });
  return delivery;
}
