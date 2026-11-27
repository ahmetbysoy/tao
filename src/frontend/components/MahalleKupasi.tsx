import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  Check,
  Clock,
  Copy,
  Link2,
  LogOut,
  PlusCircle,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { formatDurationCompact } from "../utils/debtEndurance";
import { FitilStats } from "../utils/fitilScoring";
import { hapticMedium, hapticShort } from "../utils/haptics";
import {
  ActiveCupSession,
  buildCupInviteUrl,
  createMahalleCup,
  CUP_DURATION_OPTIONS,
  CupParticipantRow,
  CupRow,
  fetchCupByCode,
  getOrCreateClientId,
  joinMahalleCup,
  loadSavedNickname,
  normalizeInviteCode,
  rankCupParticipants,
  saveCupSession,
  subscribeCupParticipants,
} from "../utils/mahalleKupasi";
import { playCashRegister, playClick } from "../utils/sfx";
import { isSupabaseConfigured } from "../utils/supabase";

interface MahalleKupasiProps {
  activeSession: ActiveCupSession | null;
  initialInviteCode: string | null;
  currentFitilStats: FitilStats;
  onSessionChange: (session: ActiveCupSession | null) => void;
  onNotify: (title: string, message: string, tone?: "danger" | "gold" | "success" | "info") => void;
}

export const MahalleKupasi: React.FC<MahalleKupasiProps> = ({
  activeSession,
  initialInviteCode,
  currentFitilStats,
  onSessionChange,
  onNotify,
}) => {
  const [mode, setMode] = useState<"join" | "create">(initialInviteCode ? "join" : "create");
  const [cupTitle, setCupTitle] = useState("Mahalle Akşam Kupası");
  const [nickname, setNickname] = useState(() => activeSession?.nickname || loadSavedNickname() || "");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [joinCode, setJoinCode] = useState<string>(() => initialInviteCode ?? "");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cupMeta, setCupMeta] = useState<CupRow | null>(null);
  const [participants, setParticipants] = useState<CupParticipantRow[]>([]);
  const [copiedType, setCopiedType] = useState<"code" | "link" | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const myClientId = useMemo(() => getOrCreateClientId(), []);

  useEffect(() => {
    if (initialInviteCode && !activeSession) {
      setMode("join");
      setJoinCode(initialInviteCode);
    }
  }, [initialInviteCode, activeSession]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load cup metadata & subscribe live to cup_participants
  useEffect(() => {
    if (!activeSession) {
      setCupMeta(null);
      setParticipants([]);
      return;
    }

    let cancelled = false;
    fetchCupByCode(activeSession.code).then((row) => {
      if (!cancelled) setCupMeta(row);
    });

    const unsub = subscribeCupParticipants(activeSession.code, setParticipants);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeSession]);

  const ranked = useMemo(() => rankCupParticipants(participants), [participants]);

  const remainingMs = cupMeta ? Math.max(0, Number(cupMeta.ends_at_ms) - nowMs) : 0;
  const cupEnded = cupMeta ? cupMeta.status !== "active" || remainingMs <= 0 : false;

  const handleCopy = async (kind: "code" | "link") => {
    if (!activeSession) return;
    const text = kind === "code" ? activeSession.code : buildCupInviteUrl(activeSession.code);
    hapticShort();
    playClick();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(kind);
      onNotify(
        kind === "code" ? "Davet Kodu Kopyalandı" : "Davet Linki Kopyalandı",
        kind === "code"
          ? `Arkadaşlarına gönder: ${activeSession.code}`
          : "Link panoya alındı — arkadaşların üyelik açmadan katılabilir!",
        "success"
      );
      window.setTimeout(() => setCopiedType(null), 2000);
    } catch {
      onNotify("Kopyalanamadı", text, "info");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    hapticMedium();

    const res = await createMahalleCup({
      title: cupTitle,
      hostName: nickname,
      durationMinutes,
      initialStats: currentFitilStats,
    });
    setBusy(false);

    if (res.error || !res.cup) {
      setErrorMsg(res.error ?? "Kupa oluşturulamadı.");
      return;
    }

    playCashRegister();
    setCupMeta(res.cup);
    const nextSession: ActiveCupSession = {
      code: res.cup.code,
      nickname: nickname.trim().slice(0, 24),
    };
    onSessionChange(nextSession);
    onNotify(
      `Mahalle Kupası Açıldı (${res.cup.code})`,
      "Davet kodunu paylaş — arkadaşların üye olmadan anında katılabilir!",
      "gold"
    );
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const norm = normalizeInviteCode(joinCode);
    if (!norm) {
      setErrorMsg("Davet kodu 6-10 harf/rakam olmalı (ör. KUPA7X).");
      return;
    }
    setBusy(true);
    hapticMedium();

    const res = await joinMahalleCup({
      code: norm,
      nickname,
      initialStats: currentFitilStats,
    });
    setBusy(false);

    if (res.error || !res.cup) {
      setErrorMsg(res.error ?? "Kupaya katılınamadı.");
      return;
    }

    playCashRegister();
    setCupMeta(res.cup);
    const nextSession: ActiveCupSession = {
      code: res.cup.code,
      nickname: nickname.trim().slice(0, 24),
    };
    onSessionChange(nextSession);
    onNotify("Kupaya Katıldın!", `${res.cup.title} (${res.cup.code}) masasına oturdun.`, "success");
  };

  const handleLeave = () => {
    hapticShort();
    playClick();
    saveCupSession(null);
    onSessionChange(null);
    onNotify("Kupadan Ayrıldın", "İstediğin zaman davet koduyla tekrar girebilirsin.", "info");
  };

  if (!isSupabaseConfigured()) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-xs text-zinc-400">
        Mahalle Kupası için Supabase bağlantısı gerekir.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-500/35 bg-gradient-to-br from-[#141008] via-zinc-950 to-zinc-950 p-3.5 shadow-xl sm:p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-amber-300 uppercase sm:text-base">
            <Trophy className="h-4 w-4 text-amber-400" />
            Mahalle Kupası
            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
              ÜYELİKSİZ · DAVET KODU
            </span>
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Aynı linkte arkadaşlarınla yarış — sıralama ham kârla değil{" "}
            <strong className="text-amber-300">İstikrar Skoru (İsabet × Disiplin)</strong> ile belirlenir.
          </p>
        </div>

        {activeSession && (
          <button
            type="button"
            onClick={handleLeave}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 active:scale-95"
          >
            <LogOut className="h-3.5 w-3.5" />
            Ayrıl
          </button>
        )}
      </div>

      {/* LOBBY VIEW (Not currently in a cup) */}
      {!activeSession ? (
        <div className="space-y-3">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-zinc-800 bg-black/60 p-1">
            <button
              type="button"
              onClick={() => {
                hapticShort();
                setErrorMsg(null);
                setMode("create");
              }}
              className={`min-h-[44px] cursor-pointer rounded-lg text-xs font-black tracking-wider uppercase transition ${
                mode === "create"
                  ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/60"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <PlusCircle className="h-4 w-4" />
                Yeni Kupa Kur
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                hapticShort();
                setErrorMsg(null);
                setMode("join");
              }}
              className={`min-h-[44px] cursor-pointer rounded-lg text-xs font-black tracking-wider uppercase transition ${
                mode === "join"
                  ? "bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-500/60"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Kodla Katıl
              </span>
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-500/50 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {mode === "create" ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] font-bold text-zinc-400 uppercase">
                    Kupa Adı
                  </span>
                  <input
                    value={cupTitle}
                    onChange={(e) => setCupTitle(e.target.value)}
                    maxLength={48}
                    required
                    placeholder="Kadıköy Akşam Kupası"
                    className="min-h-[44px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] font-bold text-zinc-400 uppercase">
                    Takma Adın
                  </span>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={24}
                    required
                    placeholder="Örn: Beşiktaşlı Mert"
                    className="min-h-[44px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              </div>

              <div>
                <span className="mb-1.5 block font-mono text-[10px] font-bold text-zinc-400 uppercase">
                  Kupa Süresi
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {CUP_DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.minutes}
                      type="button"
                      onClick={() => {
                        hapticShort();
                        setDurationMinutes(opt.minutes);
                      }}
                      className={`min-h-[44px] cursor-pointer rounded-xl border font-mono text-xs font-bold transition ${
                        durationMinutes === opt.minutes
                          ? "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="min-h-[48px] w-full cursor-pointer rounded-xl border border-amber-400/70 bg-gradient-to-r from-amber-600 to-orange-600 px-4 text-sm font-black tracking-wider text-white uppercase shadow-lg transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? "Kupa Açılıyor..." : "Davet Kodu Oluştur & Başlat"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] font-bold text-zinc-400 uppercase">
                    Davet Kodu
                  </span>
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={12}
                    required
                    placeholder="Örn: KUPA7X"
                    className="min-h-[44px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 font-mono text-base font-black tracking-[0.2em] text-cyan-300 uppercase placeholder:tracking-normal placeholder:font-normal placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] font-bold text-zinc-400 uppercase">
                    Takma Adın
                  </span>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={24}
                    required
                    placeholder="Örn: Kadıköylü Deniz"
                    className="min-h-[44px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="min-h-[48px] w-full cursor-pointer rounded-xl border border-cyan-400/70 bg-gradient-to-r from-cyan-600 to-blue-600 px-4 text-sm font-black tracking-wider text-white uppercase shadow-lg transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
              >
                {busy ? "Masaya Giriliyor..." : "Davet Koduyla Kupaya Katıl"}
              </button>
            </form>
          )}
        </div>
      ) : (
        /* ACTIVE CUP ROOM */
        <div className="space-y-3">
          {/* Room Banner + Invite Share Actions */}
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-black/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-black text-white uppercase">
                  {cupMeta?.title ?? "Mahalle Kupası"}
                </span>
                <span className="rounded-md border border-amber-400/60 bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-black tracking-[0.18em] text-amber-200">
                  {activeSession.code}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5 text-cyan-400" />
                  {ranked.length} yarışmacı
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    cupEnded ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  {cupEnded ? "SÜRE DOLDU" : `Kalan: ${formatDurationCompact(remainingMs)}`}
                </span>
                <span>
                  Sen: <strong className="text-white">{activeSession.nickname}</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => handleCopy("code")}
                className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
              >
                {copiedType === "code" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Kodu Kopyala
              </button>
              <button
                type="button"
                onClick={() => handleCopy("link")}
                className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-amber-500/60 bg-amber-500/20 px-3 text-xs font-black text-amber-200 transition hover:bg-amber-500/30 active:scale-95"
              >
                {copiedType === "link" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Davet Linki
              </button>
            </div>
          </div>

          {/* Sync rule note */}
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-200">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              Aşağıdaki Fitil Avı&apos;nda tamamladığın her gerçek 10 sn tur bu tabloya canlı işlenir.
              Sıralama yalnızca <strong>İstikrar Skoru (İsabet × Disiplin)</strong> iledir.
            </span>
          </div>

          {/* Live Realtime Cup Leaderboard */}
          <div className="space-y-1.5">
            {ranked.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-black/40 p-4 text-center text-xs text-zinc-500">
                Yarışmacılar yükleniyor...
              </div>
            ) : (
              ranked.map((row, index) => {
                const isMe = row.client_id === myClientId;
                return (
                  <div
                    key={row.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                      isMe
                        ? "border-amber-500/60 bg-amber-950/25"
                        : "border-zinc-800/90 bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-black ${
                          index === 0
                            ? "bg-amber-500 text-black"
                            : index === 1
                            ? "bg-zinc-300 text-black"
                            : index === 2
                            ? "bg-orange-700 text-white"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        #{index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-xs font-black text-white uppercase">
                            {row.nickname}
                          </span>
                          {isMe && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300">
                              SEN
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                          {row.rounds} tur · İsabet %{row.accuracyPct.toFixed(0)} · Disiplin{" "}
                          {Number(row.discipline_multiplier).toFixed(2)}x · En iyi seri{" "}
                          {row.best_streak}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="flex items-center justify-end gap-1 text-sm font-black text-amber-300">
                        <Award className="h-3.5 w-3.5 text-amber-400" />
                        {row.recomputedConsistencyScore}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {Math.round(Number(row.points)).toLocaleString("en-US")} puan
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
};
