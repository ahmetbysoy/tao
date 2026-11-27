import React, { useEffect } from "react";
import { X } from "lucide-react";
import { hapticShort } from "../utils/haptics";

interface BottomSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accentClass?: string;
  maxWidthClass?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  title,
  subtitle,
  icon,
  accentClass = "border-amber-500/40",
  maxWidthClass = "sm:max-w-lg",
  onClose,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticShort();
          onClose();
        }
      }}
    >
      <div
        className={`sheet-slide-up flex max-h-[90dvh] w-full flex-col rounded-t-2xl border-t border-x sm:rounded-2xl sm:border ${accentClass} bg-[#0b0c10] shadow-[0_-10px_50px_rgba(0,0,0,0.75)] ${maxWidthClass}`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* Mobile grab handle */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <span className="h-1.5 w-12 rounded-full bg-zinc-700/90" />
        </div>

        {/* Sheet Header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/90 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon}
            <div className="min-w-0">
              <h3 className="truncate font-display text-sm font-black tracking-wider text-white uppercase sm:text-base">
                {title}
              </h3>
              {subtitle && (
                <p className="truncate font-mono text-[10px] text-zinc-400">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              hapticShort();
              onClose();
            }}
            aria-label="Paneli kapat"
            className="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/90 text-zinc-300 transition hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Sheet Content */}
        <div className="overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
};
