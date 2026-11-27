// Bülent: Mahalle Kupası — Invite-Code Multiplayer Rooms without User Login.
// Backed by live Supabase `cups` & `cup_participants` tables + Realtime subscriptions.
// Ranks strictly by Consistency Score (accuracy x discipline), NEVER raw profit/points.

import { calcConsistencyScore, FITIL_START_POINTS, FitilStats } from "./fitilScoring";
import { getSupabase } from "./supabase";

const CLIENT_ID_KEY = "tefeci_cup_client_id_v1";
const ACTIVE_CUP_KEY = "tefeci_active_cup_v1";
const NICKNAME_KEY = "tefeci_cup_nickname_v1";
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excludes ambiguous 0/O/1/I
const INVITE_CODE_RE = /^[A-Z0-9]{6,10}$/;

export const CUP_DURATION_OPTIONS = [
  { minutes: 15, label: "15 dk" },
  { minutes: 30, label: "30 dk" },
  { minutes: 60, label: "1 saat" },
  { minutes: 1440, label: "24 saat" },
] as const;

export interface CupRow {
  code: string;
  title: string;
  host_name: string;
  duration_minutes: number;
  ends_at_ms: number;
  status: "active" | "ended" | string;
  created_at?: string;
}

export interface CupParticipantRow {
  id: string;
  cup_code: string;
  client_id: string;
  nickname: string;
  points: number;
  wins: number;
  losses: number;
  streak: number;
  best_streak: number;
  discipline_multiplier: number;
  consistency_score: number;
  cancelled_rounds: number;
  joined_at?: string;
  updated_at?: string;
}

export interface RankedCupParticipant extends CupParticipantRow {
  rounds: number;
  accuracyPct: number;
  recomputedConsistencyScore: number;
}

export interface ActiveCupSession {
  code: string;
  nickname: string;
}

let cupChannelSeq = 0;

function cryptoRandomChars(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = (Date.now() + i * 31) & 0xff;
    }
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function getOrCreateClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = `u_${cryptoRandomChars("abcdefghijklmnopqrstuvwxyz0123456789", 14)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return `u_${cryptoRandomChars("abcdefghijklmnopqrstuvwxyz0123456789", 14)}`;
  }
}

export function generateInviteCode(): string {
  return cryptoRandomChars(INVITE_ALPHABET, 6);
}

export function normalizeInviteCode(raw: string): string | null {
  const stripped = (raw || "").trim().replace(/-/g, "").toUpperCase();
  if (!INVITE_CODE_RE.test(stripped)) return null;
  return stripped;
}

export function readCupCodeFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("cup");
    return raw ? normalizeInviteCode(raw) : null;
  } catch {
    return null;
  }
}

export function buildCupInviteUrl(code: string): string {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("cup", code);
    return url.toString();
  } catch {
    return `https://tao-mocha-eight.vercel.app/?cup=${code}`;
  }
}

export function loadSavedCupSession(): ActiveCupSession | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_CUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveCupSession>;
    const code = normalizeInviteCode(String(parsed.code ?? ""));
    const nickname = String(parsed.nickname ?? "").trim();
    if (!code || nickname.length < 2) return null;
    return { code, nickname };
  } catch {
    return null;
  }
}

export function saveCupSession(session: ActiveCupSession | null): void {
  try {
    if (!session) {
      window.localStorage.removeItem(ACTIVE_CUP_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_CUP_KEY, JSON.stringify(session));
    window.localStorage.setItem(NICKNAME_KEY, session.nickname);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function canJoinCup(params: {
  status: string;
  endsAtMs: number;
  nowMs: number;
  participantCount: number;
  maxParticipants?: number;
}): { ok: boolean; reason: string } {
  const maxP = params.maxParticipants ?? 32;
  if (params.status !== "active" || params.nowMs >= params.endsAtMs) {
    return { ok: false, reason: "Bu Mahalle Kupası sona ermiş." };
  }
  if (params.participantCount >= maxP) {
    return { ok: false, reason: "Kupa odası dolu." };
  }
  return { ok: true, reason: "Katılıma açık" };
}

/** Rank participants strictly by Consistency Score (never raw points/profit). */
export function rankCupParticipants(rows: CupParticipantRow[]): RankedCupParticipant[] {
  return rows
    .map((row) => {
      const wins = Math.max(0, Number(row.wins || 0));
      const losses = Math.max(0, Number(row.losses || 0));
      const rounds = wins + losses;
      const discipline = Number(row.discipline_multiplier ?? 1.0);
      const recomputed = calcConsistencyScore(wins, losses, discipline);
      const accuracyPct = rounds > 0 ? Math.round((wins / rounds) * 1000) / 10 : 0;
      return {
        ...row,
        wins,
        losses,
        rounds,
        accuracyPct,
        recomputedConsistencyScore: recomputed,
      };
    })
    .sort((a, b) => {
      if (b.recomputedConsistencyScore !== a.recomputedConsistencyScore) {
        return b.recomputedConsistencyScore - a.recomputedConsistencyScore;
      }
      if (b.accuracyPct !== a.accuracyPct) return b.accuracyPct - a.accuracyPct;
      if (b.best_streak !== a.best_streak) return b.best_streak - a.best_streak;
      if (b.rounds !== a.rounds) return b.rounds - a.rounds;
      return a.nickname.localeCompare(b.nickname, "tr");
    });
}

export async function fetchCupByCode(code: string): Promise<CupRow | null> {
  const sb = getSupabase();
  const normalized = normalizeInviteCode(code);
  if (!sb || !normalized) return null;

  const { data, error } = await sb
    .from("cups")
    .select("*")
    .eq("code", normalized)
    .maybeSingle();

  if (error || !data) return null;
  return data as CupRow;
}

export async function createMahalleCup(params: {
  title: string;
  hostName: string;
  durationMinutes: number;
  initialStats: FitilStats;
}): Promise<{ cup?: CupRow; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase bağlantısı yapılandırılmadı." };

  const cleanTitle = params.title.trim().slice(0, 48);
  const cleanHost = params.hostName.trim().slice(0, 24);
  if (cleanTitle.length < 2) return { error: "Kupa adı en az 2 karakter olmalı." };
  if (cleanHost.length < 2) return { error: "Takma adın en az 2 karakter olmalı." };

  const code = generateInviteCode();
  const endsAtMs = Date.now() + params.durationMinutes * 60_000;

  const { data, error } = await sb
    .from("cups")
    .insert({
      code,
      title: cleanTitle,
      host_name: cleanHost,
      duration_minutes: params.durationMinutes,
      ends_at_ms: endsAtMs,
      status: "active",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Kupa oluşturulamadı." };
  }

  const joinRes = await joinMahalleCup({
    code,
    nickname: cleanHost,
    initialStats: params.initialStats,
  });
  if (joinRes.error) {
    return { error: joinRes.error };
  }

  return { cup: data as CupRow };
}

export async function joinMahalleCup(params: {
  code: string;
  nickname: string;
  initialStats?: FitilStats;
}): Promise<{ cup?: CupRow; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: "Supabase bağlantısı yapılandırılmadı." };

  const normalized = normalizeInviteCode(params.code);
  if (!normalized) {
    return { error: "Geçersiz davet kodu (6-10 harf/rakam olmalı)." };
  }

  const cleanNick = params.nickname.trim().slice(0, 24);
  if (cleanNick.length < 2) {
    return { error: "Takma adın en az 2 karakter olmalı." };
  }

  const cup = await fetchCupByCode(normalized);
  if (!cup) {
    return { error: `"${normalized}" kodlu Mahalle Kupası bulunamadı.` };
  }

  const { count } = await sb
    .from("cup_participants")
    .select("id", { count: "exact", head: true })
    .eq("cup_code", normalized);

  const clientId = getOrCreateClientId();
  const rowId = `${normalized}_${clientId}`;

  // Allow existing participant to reconnect even if room is at cap
  const { data: existingSelf } = await sb
    .from("cup_participants")
    .select("id")
    .eq("id", rowId)
    .maybeSingle();

  if (!existingSelf) {
    const check = canJoinCup({
      status: cup.status,
      endsAtMs: Number(cup.ends_at_ms),
      nowMs: Date.now(),
      participantCount: count ?? 0,
    });
    if (!check.ok) return { error: check.reason };
  }

  const stats = params.initialStats;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const discipline = stats?.disciplineMultiplier ?? 1.0;
  const score = calcConsistencyScore(wins, losses, discipline);

  const { error: upsertErr } = await sb.from("cup_participants").upsert(
    {
      id: rowId,
      cup_code: normalized,
      client_id: clientId,
      nickname: cleanNick,
      points: Number((stats?.points ?? FITIL_START_POINTS).toFixed(2)),
      wins,
      losses,
      streak: stats?.streak ?? 0,
      best_streak: stats?.bestStreak ?? 0,
      discipline_multiplier: discipline,
      consistency_score: score,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (upsertErr) {
    return { error: upsertErr.message };
  }

  saveCupSession({ code: normalized, nickname: cleanNick });
  return { cup };
}

export async function syncCupParticipantStats(params: {
  cupCode: string;
  nickname: string;
  stats: FitilStats;
  cancelledCount?: number;
}): Promise<boolean> {
  const sb = getSupabase();
  const normalized = normalizeInviteCode(params.cupCode);
  if (!sb || !normalized) return false;

  const clientId = getOrCreateClientId();
  const rowId = `${normalized}_${clientId}`;
  const score = calcConsistencyScore(
    params.stats.wins,
    params.stats.losses,
    params.stats.disciplineMultiplier
  );

  const payload: Record<string, unknown> = {
    id: rowId,
    cup_code: normalized,
    client_id: clientId,
    nickname: params.nickname.trim().slice(0, 24),
    points: Number(Math.max(0, params.stats.points).toFixed(2)),
    wins: params.stats.wins,
    losses: params.stats.losses,
    streak: params.stats.streak,
    best_streak: params.stats.bestStreak,
    discipline_multiplier: params.stats.disciplineMultiplier,
    consistency_score: score,
    updated_at: new Date().toISOString(),
  };

  if (typeof params.cancelledCount === "number") {
    payload.cancelled_rounds = Math.max(0, params.cancelledCount);
  }

  const { error } = await sb
    .from("cup_participants")
    .upsert(payload, { onConflict: "id" });

  return !error;
}

export function subscribeCupParticipants(
  cupCode: string,
  onData: (rows: CupParticipantRow[]) => void
): () => void {
  const sb = getSupabase();
  const normalized = normalizeInviteCode(cupCode);
  if (!sb || !normalized) {
    onData([]);
    return () => {};
  }

  let active = true;

  const fetchLatest = async () => {
    const { data, error } = await sb
      .from("cup_participants")
      .select("*")
      .eq("cup_code", normalized)
      .order("consistency_score", { ascending: false })
      .limit(50);

    if (!error && data && active) {
      onData(data as CupParticipantRow[]);
    }
  };

  fetchLatest();

  cupChannelSeq += 1;
  const channel = sb
    .channel(`cup_${normalized}_${cupChannelSeq}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cup_participants",
        filter: `cup_code=eq.${normalized}`,
      },
      () => {
        fetchLatest();
      }
    )
    .subscribe();

  const pollId = window.setInterval(fetchLatest, 5000);

  return () => {
    active = false;
    window.clearInterval(pollId);
    sb.removeChannel(channel);
  };
}
