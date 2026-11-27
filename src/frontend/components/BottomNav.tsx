import React from "react";
import { Activity, Flame, ScrollText, Users } from "lucide-react";
import { hapticShort } from "../utils/haptics";

export type NavTab = "market" | "traders" | "fitil" | "debts";

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  openPositionCount: number;
  overdueDebtCount: number;
  whalePanicActive: boolean;
}

const TABS: Array<{
  id: NavTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "market", label: "Piyasa", Icon: Activity },
  { id: "traders", label: "Traderlar", Icon: Users },
  { id: "fitil", label: "Fitil Avı", Icon: Flame },
  { id: "debts", label: "Senetler", Icon: ScrollText },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  openPositionCount,
  overdueDebtCount,
  whalePanicActive,
}) => {
  return (
    <nav
      aria-label="Ana gezinme"
      className="fixed right-0 bottom-0 left-0 z-40 border-t border-zinc-800/90 bg-[#07080c]/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 px-1.5 py-1.5">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          const badge =
            id === "market" && openPositionCount > 0
              ? openPositionCount
              : id === "debts" && overdueDebtCount > 0
              ? overdueDebtCount
              : null;

          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                hapticShort();
                onSelectTab(id);
              }}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-bold transition active:scale-95 ${
                active
                  ? "bg-amber-500/15 text-amber-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <div className="relative">
                <Icon
                  className={`h-5 w-5 ${
                    active
                      ? "text-amber-400"
                      : id === "debts" && whalePanicActive
                      ? "animate-pulse text-red-400"
                      : "text-zinc-400"
                  }`}
                />
                {badge !== null && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9px] font-black text-white ${
                      id === "debts"
                        ? "bg-red-600 animate-pulse"
                        : "bg-emerald-600"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </div>
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
