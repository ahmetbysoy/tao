/**
 * Procedural Web Audio API sound effects engine for TEFECİ Dopamin UI.
 * Zero external audio assets required; unlocks on user gesture ("Mahalleye Gir").
 */

let audioCtx: AudioContext | null = null;
let sfxEnabled = true;

function getCtx(): AudioContext | null {
  if (!sfxEnabled || typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function unlockSfx(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export function setSfxEnabled(enabled: boolean): void {
  sfxEnabled = enabled;
}

export function isSfxEnabled(): boolean {
  return sfxEnabled;
}

export function playClick(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(320, now + 0.045);
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

export function playTradeOpen(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 783.99].forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const start = now + idx * 0.07;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.07, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.15);
  });
}

export function playCashRegister(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [1318.5, 1760, 2637].forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    const start = now + idx * 0.055;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.11, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

export function playWarningAlarm(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    const start = now + i * 0.14;
    osc.frequency.setValueAtTime(440, start);
    osc.frequency.linearRampToValueAtTime(620, start + 0.1);
    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.13);
  }
}

export function playEnforcerKnock(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [0, 0.16, 0.32].forEach((offset) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const start = now + offset;
    osc.frequency.setValueAtTime(140, start);
    osc.frequency.exponentialRampToValueAtTime(38, start + 0.13);
    gain.gain.setValueAtTime(0.24, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.15);
  });
}

export function playLiquidationSiren(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Dramatic descending alarm
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(860, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.75);
  gain.gain.setValueAtTime(0.14, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.82);

  // Sub-bass impact drop
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(95, now + 0.1);
  sub.frequency.exponentialRampToValueAtTime(30, now + 0.65);
  subGain.gain.setValueAtTime(0.26, now + 0.1);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  sub.connect(subGain).connect(ctx.destination);
  sub.start(now + 0.1);
  sub.stop(now + 0.72);
}

export function playWhaleAlertSiren(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Deep whale-foghorn bass boom
  const horn = ctx.createOscillator();
  const hornGain = ctx.createGain();
  horn.type = "sawtooth";
  horn.frequency.setValueAtTime(110, now);
  horn.frequency.exponentialRampToValueAtTime(52, now + 0.65);
  hornGain.gain.setValueAtTime(0.22, now);
  hornGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  horn.connect(hornGain).connect(ctx.destination);
  horn.start(now);
  horn.stop(now + 0.72);

  // Urgent triple-pulse siren
  [0, 0.16, 0.32].forEach((offset) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    const t = now + offset;
    osc.frequency.setValueAtTime(920, t);
    osc.frequency.linearRampToValueAtTime(1320, t + 0.11);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  });
}
