import React, { useEffect, useState } from "react";
import { AlertTriangle, Banknote, Flame, ShieldAlert, Skull } from "lucide-react";
import { hapticLong, hapticMedium } from "../utils/haptics";
import { speakAs, TraderVoiceId } from "../utils/tts";
import { playCashRegister, playEnforcerKnock, playWarningAlarm } from "../utils/sfx";

export interface UrgentDebt {
  debtId: string;
  traderId: TraderVoiceId;
  nickname: string;
  owedUsdt: number;
  interestRate: number;
  dueDateMs: number;
  status: string;
  enforcerCount: number;
  traderBalance: number;
}

interface DarkPatternAlertsProps {
  debts: UrgentDebt[];
  whalePanicActive: boolean;
  whaleBannerText: string | null;
  onDoubleInterest: (debt: UrgentDebt) => void;
  onSendEnforcer: (debt: UrgentDebt) => void;
  onCollectDebt: (debt: UrgentDebt) => void;
}

export const DarkPatternAlerts: React.FC<DarkPatternAlertsProps> = ({
  debts,
  whalePanicActive,
  whaleBannerText,
  onDoubleInterest,
  onSendEnforcer,
  onCollectDebt,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const urgent = [...debts]
    .filter((d) => d.status === "aktif" || d.status === "gecikti")
    .sort((a, b) => a.dueDateMs - b.dueDateMs);

  if (urgent.length === 0) return null;

  return (
    <section className="space-y-2.5">
      {whalePanicActive && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-red-500 bg-gradient-to-r from-red-950 via-red-900/70 to-amber-950/80 px-4 py-3 shadow-[0_0_40px_rgba(220,38,38,0.65)]">
          <div className="flex items-center gap-2.5">
            <Skull className="h-5 w-5 shrink-0 animate-bounce text-red-400" />
            <div>
              <div className="font-display text-xs font-black tracking-[0.2em] text-red-300 uppercase">
                BALİNA PATLADI // FOMO PANİK MODU AKTİF
              </div>
              <div className="text-xs font-semibold text-white">
                {whaleBannerText ||
                  "Selo Roket kan kokusunu aldı, borç faizi otomatik %50 artırıldı! Fırsatı kaçırmadan FAİZİ KATLA!"}
              </div>
            </div>
          </div>
          <span className="rounded bg-red-600 px-2.5 py-1 font-mono text-[10px] font-black text-white uppercase animate-pulse">
            $1M+ LİKİDASYON
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-red-400 uppercase">
          <AlertTriangle className="h-4 w-4 animate-pulse text-red-500" />
          Aktif Senetler &amp; Acil Tahsilat Masası ({urgent.length})
        </h2>
        <span className="font-mono text-[11px] text-zinc-500">
          Vade dolduğunda ceza faizi x1.5 otomatik işler
        </span>
      </div>

      <div className="grid gap-2.5 lg:grid-cols-2">
        {urgent.map((debt) => {
          const remainingSec = Math.max(0, Math.floor((debt.dueDateMs - nowMs) / 1000));
          const mins = Math.floor(remainingSec / 60);
          const secs = remainingSec % 60;
          const overdue = remainingSec === 0 || debt.status === "gecikti";
          const isCritical = overdue || remainingSec <= 180;
          const canCollect = debt.traderBalance >= 20 && debt.owedUsdt > 1;

          return (
            <div
              key={debt.debtId}
              className={`relative overflow-hidden rounded-xl border p-3.5 transition-all ${
                overdue
                  ? "border-red-500 bg-gradient-to-r from-red-950/80 via-zinc-950 to-red-950/40 shadow-[0_0_28px_rgba(220,38,38,0.35)]"
                  : isCritical
                  ? "border-amber-500/60 bg-gradient-to-r from-amber-950/40 via-zinc-950 to-zinc-950"
                  : "border-zinc-800/90 bg-zinc-950/90"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-black uppercase ${
                        overdue
                          ? "bg-red-600 text-white animate-pulse"
                          : isCritical
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {overdue ? (
                        <>
                          <Skull className="h-3 w-3" /> VADE DOLDU · CEZA MODU
                        </>
                      ) : (
                        <>
                          <Flame className="h-3 w-3" /> AKTİF SENET
                        </>
                      )}
                    </span>
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      FAİZ %{(debt.interestRate * 100).toFixed(1)}
                    </span>
                    {debt.enforcerCount > 0 && (
                      <span className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-fuchsia-300">
                        Çırak x{debt.enforcerCount}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="font-display text-base font-bold text-white">
                      {debt.nickname}
                    </span>
                    <span className="font-mono text-lg font-black text-amber-300">
                      ${debt.owedUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="font-mono text-xs text-zinc-400">
                      Kalan:{" "}
                      <strong className={overdue ? "text-red-400" : "text-zinc-200"}>
                        {overdue
                          ? "00:00"
                          : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Tactical Action Buttons (>= 44px touch targets) */}
                <div className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      hapticLong();
                      playWarningAlarm();
                      speakAs(
                        debt.traderId,
                        "Abi yapma, pozisyonum açık! Faizi katlarsan likide olacağım!"
                      );
                      onDoubleInterest(debt);
                    }}
                    className={`min-h-[44px] cursor-pointer rounded-xl border px-2.5 text-[11px] font-black tracking-wider text-white uppercase shadow-sm transition active:scale-95 ${
                      whalePanicActive
                        ? "whale-panic-btn border-amber-300 bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:brightness-110"
                        : "border-red-500/70 bg-red-600/90 hover:bg-red-500"
                    }`}
                  >
                    FAİZİ KATLA
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hapticMedium();
                      playEnforcerKnock();
                      speakAs(
                        "tefeci",
                        `Çırağı ${debt.nickname}'in kapısına yolladım, eli ayağı titresin!`
                      );
                      onSendEnforcer(debt);
                    }}
                    className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-xl border border-fuchsia-500/50 bg-fuchsia-950/60 px-2.5 text-[11px] font-bold text-fuchsia-200 uppercase transition hover:bg-fuchsia-900/60 active:scale-95"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Çırak
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hapticMedium();
                      playCashRegister();
                      speakAs("tefeci", `${debt.nickname}'den tahsilatı yaptım. Kasa büyür.`);
                      onCollectDebt(debt);
                    }}
                    disabled={!canCollect}
                    title={
                      canCollect
                        ? `Kasasından (Bakiye $${debt.traderBalance.toFixed(0)}) anlık tahsilat yap`
                        : "Trader bakiyesi tahsilat için yetersiz"
                    }
                    className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-xl border border-emerald-500/50 bg-emerald-950/60 px-2.5 text-[11px] font-bold text-emerald-200 uppercase transition hover:bg-emerald-900/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Banknote className="h-3.5 w-3.5" />
                    Tahsil Et
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
