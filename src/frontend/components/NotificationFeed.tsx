import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bell,
  Flame,
  Radio,
  ShieldAlert,
  Skull,
  TrendingUp,
} from "lucide-react";
import { EventRow } from "../utils/supabase";

interface NotificationFeedProps {
  events: EventRow[];
}

type FeedFilter = "ALL" | "TRADES" | "COLLECTIONS" | "LIQUIDATION";

function eventStyle(type: string) {
  switch (type) {
    case "WHALE_ALERT":
      return {
        icon: Skull,
        badge: "bg-red-600 text-white border-amber-400 animate-pulse",
        label: "BALİNA $1M+",
      };
    case "LIQUIDATION":
      return {
        icon: Skull,
        badge: "bg-red-600/25 text-red-300 border-red-500/50",
        label: "LİKİDASYON",
      };
    case "DOUBLE_INTEREST":
    case "COMPOUND":
      return {
        icon: Flame,
        badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
        label: type === "DOUBLE_INTEREST" ? "FAİZ x2" : "BİLEŞİK",
      };
    case "SEND_ENFORCER":
      return {
        icon: ShieldAlert,
        badge: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
        label: "ÇIRAK",
      };
    case "COLLECT_DEBT":
    case "ISSUE_DEBT":
      return {
        icon: Banknote,
        badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
        label: type === "COLLECT_DEBT" ? "TAHSİLAT" : "YENİ BORÇ",
      };
    case "OPEN_POSITION":
    case "CLOSE_POSITION":
    case "FORCE_CLOSE":
      return {
        icon: TrendingUp,
        badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
        label: type === "OPEN_POSITION" ? "POZİSYON" : "KAPANIŞ",
      };
    default:
      return {
        icon: Radio,
        badge: "bg-zinc-800 text-zinc-300 border-zinc-700",
        label: "SİSTEM",
      };
  }
}

export const NotificationFeed: React.FC<NotificationFeedProps> = ({ events }) => {
  const [filter, setFilter] = useState<FeedFilter>("ALL");

  const filtered = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.id - a.id);
    return sorted.filter((ev) => {
      if (filter === "ALL") return true;
      if (filter === "LIQUIDATION") {
        return ev.type === "LIQUIDATION" || ev.type === "WHALE_ALERT";
      }
      if (filter === "TRADES") {
        return ["OPEN_POSITION", "CLOSE_POSITION", "FORCE_CLOSE", "TRIGGER_TEST_TRADE"].includes(
          ev.type
        );
      }
      if (filter === "COLLECTIONS") {
        return ["DOUBLE_INTEREST", "SEND_ENFORCER", "COLLECT_DEBT", "ISSUE_DEBT", "COMPOUND"].includes(
          ev.type
        );
      }
      return true;
    });
  }, [events, filter]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800/90 bg-zinc-950/90 p-4 shadow-xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-sm font-black tracking-wider text-zinc-100 uppercase">
          <Bell className="h-4 w-4 text-amber-400" />
          Canlı Bildirim Merkezi
        </h2>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["ALL", "Tümü"],
              ["TRADES", "İşlem"],
              ["COLLECTIONS", "Tahsilat"],
              ["LIQUIDATION", "Liq"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`cursor-pointer rounded border px-2 py-0.5 text-[10px] font-bold transition ${
                filter === id
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-60 flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-black/40 p-3 text-xs text-zinc-500">
            <AlertTriangle className="h-4 w-4 text-zinc-600" />
            Bu filtrede henüz olay yok.
          </div>
        ) : (
          filtered.slice(0, 40).map((ev) => {
            const st = eventStyle(ev.type);
            const Icon = st.icon;
            const timeStr = ev.created_at
              ? new Date(ev.created_at).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "";
            return (
              <div
                key={ev.id}
                className="flex items-start gap-2.5 rounded-lg border border-zinc-900 bg-black/50 px-2.5 py-2 text-xs transition hover:border-zinc-800"
              >
                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-black ${st.badge}`}
                >
                  <Icon className="h-3 w-3" />
                  {st.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="leading-snug text-zinc-200">{ev.message}</p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {timeStr}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
