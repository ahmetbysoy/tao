import React from "react";
import { ShieldAlert } from "lucide-react";

interface SimulationDisclaimerBannerProps {
  compact?: boolean;
}

/**
 * Efe BANNER: Permanent in-game risk & compliance disclaimer strip.
 * Guarantees all aggressive street slang stays unambiguously inside the simulation universe.
 */
export const SimulationDisclaimerBanner: React.FC<SimulationDisclaimerBannerProps> = ({
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-950/30 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200/90">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>
          <strong>OYUN &amp; SİMÜLASYON:</strong> Gerçek emir gönderilmez, yatırım tavsiyesi değildir.
          Diyaloglar kurgusal oyun evrenine aittir.
        </span>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Simülasyon ve risk uyarısı"
      className="border-b border-amber-500/30 bg-gradient-to-r from-amber-950/55 via-zinc-950 to-red-950/45 px-3 py-1.5 text-center text-[10px] font-medium tracking-wide text-amber-200/95 sm:text-[11px]"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1 font-black text-amber-400 uppercase">
          <ShieldAlert className="h-3.5 w-3.5" />
          OYUN &amp; SİMÜLASYON
        </span>
        <span className="text-zinc-600">•</span>
        <span>Gerçek hesaba emir gönderilmez, gerçek para riski yoktur, yatırım tavsiyesi değildir.</span>
        <span className="hidden text-zinc-600 md:inline">•</span>
        <span className="hidden text-zinc-300 md:inline">
          Fiyat, mum ve fonlama verileri gerçek borsa kayıtlarıdır; kazanç garantisi vermez.
        </span>
      </div>
    </div>
  );
};
