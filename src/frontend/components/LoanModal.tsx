import React, { useState } from "react";
import { BadgePlus, Flame } from "lucide-react";
import { hapticMedium, hapticShort } from "../utils/haptics";
import { TraderRow } from "../utils/supabase";
import { TraderVoiceId } from "../utils/tts";
import { BottomSheet } from "./BottomSheet";

interface LoanModalProps {
  open: boolean;
  traders: TraderRow[];
  initialTraderId: TraderVoiceId;
  onClose: () => void;
  onSubmit: (params: {
    traderId: TraderVoiceId;
    nickname: string;
    principal: number;
    interestRate: number;
    durationSec: number;
  }) => void;
}

export const LoanModal: React.FC<LoanModalProps> = ({
  open,
  traders,
  initialTraderId,
  onClose,
  onSubmit,
}) => {
  const [traderId, setTraderId] = useState<TraderVoiceId>(initialTraderId);
  const [principal, setPrincipal] = useState<number>(1500);
  const [ratePct, setRatePct] = useState<number>(12);
  const [durationMin, setDurationMin] = useState<number>(8);

  React.useEffect(() => {
    setTraderId(initialTraderId);
  }, [initialTraderId, open]);

  const selected = traders.find((t) => t.id === traderId);
  const periods = Math.max(1, Math.floor((durationMin * 60) / 120));
  const projected = principal * Math.pow(1 + ratePct / 100, periods);

  return (
    <BottomSheet
      open={open}
      title="Yeni Tefeci Senedi Kes"
      subtitle="Bileşik faiz canlı motor üzerinden anında işler"
      icon={<BadgePlus className="h-5 w-5 shrink-0 text-amber-400" />}
      accentClass="border-amber-500/45"
      maxWidthClass="sm:max-w-md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
            Borçlu Trader
          </label>
          <select
            value={traderId}
            onChange={(e) => setTraderId(e.target.value as TraderVoiceId)}
            className="min-h-[44px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold text-white focus:border-amber-500 focus:outline-none"
          >
            {traders.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nickname} (Bakiye: ${t.balance.toFixed(0)} · {t.mood})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-bold text-zinc-400 uppercase">Anapara (USDT)</span>
            <span className="font-mono font-black text-amber-300">
              ${principal.toLocaleString("en-US")}
            </span>
          </div>
          <input
            type="range"
            min={500}
            max={10000}
            step={250}
            value={principal}
            onChange={(e) => setPrincipal(Number(e.target.value))}
            className="h-9 w-full accent-amber-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-bold text-zinc-400 uppercase">Faiz / Periyot</span>
              <span className="font-mono font-black text-red-400">%{ratePct}</span>
            </div>
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={ratePct}
              onChange={(e) => setRatePct(Number(e.target.value))}
              className="h-9 w-full accent-red-500"
            />
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-bold text-zinc-400 uppercase">Vade Süresi</span>
              <span className="font-mono font-black text-zinc-200">{durationMin} dk</span>
            </div>
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="h-9 w-full accent-amber-500"
            />
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 font-mono text-xs">
          <div className="flex items-center justify-between gap-2 text-zinc-400">
            <span>Vade Sonu Tahmini ({periods} bileşik):</span>
            <span className="text-sm font-black text-amber-300">
              ${projected.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400/80">
            <Flame className="h-3 w-3 shrink-0" />
            Para anında {selected?.nickname ?? traderId} hesabına geçer.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onClose();
            }}
            className="min-h-[48px] cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-xs font-bold text-zinc-300 hover:bg-zinc-800 active:scale-95"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => {
              hapticMedium();
              onSubmit({
                traderId,
                nickname: selected?.nickname ?? traderId,
                principal,
                interestRate: ratePct / 100,
                durationSec: durationMin * 60,
              });
              onClose();
            }}
            className="min-h-[48px] cursor-pointer rounded-xl border border-amber-400 bg-gradient-to-r from-amber-500 to-orange-600 px-4 text-xs font-black tracking-wider text-black uppercase shadow-lg transition hover:brightness-110 active:scale-95"
          >
            SENEDİ İMZALAT
          </button>
        </div>
      </div>
    </BottomSheet>
  );
};
