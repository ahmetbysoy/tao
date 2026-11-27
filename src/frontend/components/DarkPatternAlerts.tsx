import React, { useEffect, useState } from "react";
import { speakAs, TraderVoiceId } from "../utils/tts";

export interface UrgentDebt {
  debtId: string;
  traderId: TraderVoiceId;
  nickname: string;
  owedUsdt: number;
  dueDateMs: number;
}

interface DarkPatternAlertsProps {
  debts: UrgentDebt[];
  onDoubleInterest: (debtId: string) => void;
  onSendEnforcer: (traderId: TraderVoiceId) => void;
}

export const DarkPatternAlerts: React.FC<DarkPatternAlertsProps> = ({
  debts,
  onDoubleInterest,
  onSendEnforcer,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const urgent = debts.filter((d) => d.dueDateMs - nowMs <= 3600_000);
  if (urgent.length === 0) return null;

  return (
    <div className="space-y-2">
      {urgent.map((debt) => {
        const remainingSec = Math.max(0, Math.floor((debt.dueDateMs - nowMs) / 1000));
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        const overdue = remainingSec === 0;

        return (
          <div
            key={debt.debtId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-red-600 bg-red-950/70 p-4 shadow-[0_0_25px_rgba(220,38,38,0.4)]"
          >
            <div>
              <div className="text-xs font-black tracking-widest text-red-400 uppercase">
                {overdue ? "VADE DOLDU — TAHSiLAT ZAMANI!" : "KRİTİK VADE YAKLAŞIYOR"}
              </div>
              <div className="text-base font-bold text-white">
                {debt.nickname} — Borç:{" "}
                <span className="font-mono text-amber-300">
                  ${debt.owedUsdt.toFixed(2)}
                </span>{" "}
                · Kalan:{" "}
                <span className="font-mono text-red-300">
                  {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  speakAs(debt.traderId, "Abi yapma, pozisyonum açık, likide olacağım!");
                  onDoubleInterest(debt.debtId);
                }}
                className="animate-pulse rounded bg-red-600 px-4 py-2 text-xs font-black tracking-wider text-white uppercase hover:bg-red-500"
              >
                FAİZİ KATLA
              </button>
              <button
                onClick={() => {
                  speakAs("tefeci", "Çırağı yolladım, elin ayağın titresin!");
                  onSendEnforcer(debt.traderId);
                }}
                className="rounded border border-amber-500 bg-amber-950/60 px-3 py-2 text-xs font-bold text-amber-300 uppercase hover:bg-amber-900/60"
              >
                Çırağı Gönder
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
