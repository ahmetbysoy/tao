import React, { useEffect, useRef, useState } from "react";
import { Flame, ShieldAlert, Sparkles, Volume2 } from "lucide-react";
import { DebtRow, TraderRow } from "../utils/supabase";
import { hapticShort } from "../utils/haptics";
import { playClick } from "../utils/sfx";
import { speakStreetEvent, StreetEventKind, TraderVoiceId } from "../utils/tts";

interface IsometricKahvehaneCanvasProps {
  traders: TraderRow[];
  openPositions: Array<{
    traderId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    leverage: number;
  }>;
  debts: DebtRow[];
  openPnlByTrader: Record<string, number>;
  recentLiqTraders: Record<string, number>;
  livePrices: Record<string, number>;
  tefeciProfit: number;
}

interface SeatConfig {
  id: TraderVoiceId;
  label: string;
  // Normalized coordinates (0..1) around isometric kahvehane table
  nx: number;
  ny: number;
  color: string;
  glow: string;
}

const SEATS: SeatConfig[] = [
  { id: "selo", label: "Selo Roket", nx: 0.2, ny: 0.32, color: "#fb7185", glow: "rgba(251,113,133,0.6)" },
  { id: "mehmet", label: "Fitilci Mehmet", nx: 0.8, ny: 0.32, color: "#fbbf24", glow: "rgba(251,191,36,0.6)" },
  { id: "nuri", label: "Fonlama Nuri", nx: 0.16, ny: 0.72, color: "#22d3ee", glow: "rgba(34,211,238,0.6)" },
  { id: "kemal", label: "Tahta Kemal", nx: 0.84, ny: 0.72, color: "#34d399", glow: "rgba(52,211,153,0.6)" },
  { id: "sevil", label: "Madam Sevil", nx: 0.5, ny: 0.84, color: "#c084fc", glow: "rgba(192,132,252,0.65)" },
];

/**
 * Faz 1 (Sevil DOPAMİN): 2.5D Isometric HTML5 Canvas Underground Kahvehane Live Map.
 * High-FPS GPU canvas: animated chip stacks scaled by real equity/PnL, burning flames on liquidation,
 * yellow/black hazard ring in "Çırağı Gönder" fear mode, and clickable cyberpunk character portraits.
 */
export const IsometricKahvehaneCanvas: React.FC<IsometricKahvehaneCanvasProps> = ({
  traders,
  openPositions,
  debts,
  openPnlByTrader,
  recentLiqTraders,
  livePrices,
  tefeciProfit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarImagesRef = useRef<Record<string, HTMLImageElement>>({});
  const stateRef = useRef({
    traders,
    openPositions,
    debts,
    openPnlByTrader,
    recentLiqTraders,
    tefeciProfit,
  });
  stateRef.current = {
    traders,
    openPositions,
    debts,
    openPnlByTrader,
    recentLiqTraders,
    tefeciProfit,
  };

  const [selectedTrader, setSelectedTrader] = useState<{
    id: TraderVoiceId;
    name: string;
    quote: string;
  } | null>(null);

  const anyFearMode = traders.some((t) => Number(t.fear_trades_remaining ?? 0) > 0);

  // Preload optimized WebP cyberpunk portraits into HTMLImageElement cache
  useEffect(() => {
    const ids: TraderVoiceId[] = ["selo", "mehmet", "nuri", "kemal", "sevil", "tefeci"];
    ids.forEach((id) => {
      if (avatarImagesRef.current[id]) return;
      const img = new Image();
      img.src = `/avatars/${id}.webp`;
      avatarImagesRef.current[id] = img;
    });
  }, []);

  // 60 FPS Canvas animation loop (respects prefers-reduced-motion by stepping gently)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let tick = 0;

    const render = () => {
      tick += prefersReduced ? 0.008 : 0.035;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(260, Math.round(rect.height));

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // 1. Dark Cyberpunk Istanbul Underground Floor
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.48,
        20,
        width * 0.5,
        height * 0.5,
        width * 0.7
      );
      bgGrad.addColorStop(0, "#19120b");
      bgGrad.addColorStop(0.55, "#0b0910");
      bgGrad.addColorStop(1, "#05060a");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Isometric Perspective Floor Grid
      ctx.strokeStyle = "rgba(245, 158, 11, 0.07)";
      ctx.lineWidth = 1;
      const step = 36;
      for (let x = -height; x < width + height; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + height * 0.65, height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x + height * 0.65, 0);
        ctx.stroke();
      }

      const cx = width * 0.5;
      const cy = height * 0.51;
      const rx = Math.min(width * 0.33, 250);
      const ry = Math.min(height * 0.27, 94);

      // 2. 2.5D Isometric Kahvehane Table Shadow + Beveled Wood Rim + Neon Green Baize Felt
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy + 16, rx + 14, ry + 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.fill();

      // Table 3D wood side
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, rx + 10, ry + 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#2b190d";
      ctx.fill();
      ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Top felt surface
      const feltGrad = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, rx);
      feltGrad.addColorStop(0, "#10392c");
      feltGrad.addColorStop(0.75, "#09211b");
      feltGrad.addColorStop(1, "#061513");
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = feltGrad;
      ctx.fill();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner neon betting ring
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.72, ry * 0.68, 0, 0, Math.PI * 2);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.28)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 3. Central Tefeci Kasa Boss Medallion + Live Profit Chip Stack
      const { traders: liveTraders, openPositions: livePos, debts: liveDebts, openPnlByTrader: pnlMap, recentLiqTraders: liqMap, tefeciProfit: bossProfit } =
        stateRef.current;

      const bossY = cy - 4;
      const bossImg = avatarImagesRef.current.tefeci;
      const bossRadius = width < 460 ? 22 : 28;

      // Pulsing golden halo behind Tefeci Kasa
      const pulse = 0.5 + 0.5 * Math.sin(tick * 2.2);
      ctx.beginPath();
      ctx.arc(cx, bossY, bossRadius + 6 + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.28 + pulse * 0.35})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (bossImg && bossImg.complete && bossImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, bossY, bossRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(bossImg, cx - bossRadius, bossY - bossRadius, bossRadius * 2, bossRadius * 2);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(cx, bossY, bossRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Central Kasa Label
      ctx.font = "bold 10px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fde68a";
      ctx.fillText(`TEFECİ KASA · $${bossProfit.toFixed(0)}`, cx, bossY + bossRadius + 14);

      // 4. Render 5 Seated Traders + Dynamic 2.5D Chip Stacks + Dopamine FX
      const now = Date.now();
      const traderById = new Map(liveTraders.map((t) => [t.id, t]));
      const avatarR = width < 480 ? 20 : 25;

      SEATS.forEach((seat, seatIdx) => {
        const sx = seat.nx * width;
        const sy = seat.ny * height;
        const tr = traderById.get(seat.id);
        const trPos = livePos.filter((p) => p.traderId === seat.id);
        const pnl = pnlMap[seat.id] ?? 0;
        const bal = Number(tr?.balance ?? 1000);
        const fearLeft = Number(tr?.fear_trades_remaining ?? 0);
        const isPanicked =
          tr?.mood === "panicked" ||
          tr?.mood === "busted" ||
          (liqMap[seat.id] ?? 0) > now - 90_000;
        const overdue = liveDebts.some(
          (d) =>
            d.trader_id === seat.id &&
            (d.status === "gecikti" || (d.status === "aktif" && Number(d.due_date_ms) <= now))
        );

        // Laser debt tether from center Tefeci Kasa to trader if overdue or has open position
        if (overdue || trPos.length > 0) {
          ctx.beginPath();
          ctx.moveTo(cx, bossY);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = overdue
            ? `rgba(239, 68, 68, ${0.35 + pulse * 0.45})`
            : pnl >= 0
            ? "rgba(16, 185, 129, 0.22)"
            : "rgba(251, 113, 133, 0.25)";
          ctx.lineWidth = overdue ? 2.2 : 1.2;
          ctx.setLineDash(overdue ? [5, 4] : [3, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 2.5D Chip Stack right on the table edge in front of each trader
        const chipX = sx + (cx - sx) * 0.34;
        const chipY = sy + (cy - sy) * 0.34;
        const chipCount = Math.max(2, Math.min(11, Math.round((bal + Math.max(0, pnl)) / 220)));
        const chipColor =
          isPanicked ? "#ef4444" : pnl > 5 ? "#10b981" : pnl < -5 ? "#f43f5e" : "#f59e0b";
        for (let c = 0; c < chipCount; c++) {
          const yOff = chipY - c * 3.5;
          ctx.beginPath();
          ctx.ellipse(chipX, yOff, 11, 5, 0, 0, Math.PI * 2);
          ctx.fillStyle = c % 2 === 0 ? chipColor : "#18181b";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Character-Specific Dopamine Effects!
        if (isPanicked) {
          // Animated Liquidation Flame Sparks rising behind seat
          for (let f = 0; f < 5; f++) {
            const angle = tick * 3 + f * 1.25 + seatIdx;
            const fx = sx + Math.cos(angle) * (avatarR + 6);
            const fy = sy - ((tick * 18 + f * 9) % 28);
            ctx.beginPath();
            ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = f % 2 === 0 ? "rgba(239,68,68,0.85)" : "rgba(251,146,60,0.85)";
            ctx.fill();
          }
        } else if (seat.id === "sevil") {
          // Madam Sevil calm pulsing violet Bollinger neon wave ring
          const waveR = avatarR + 5 + Math.sin(tick * 1.8) * 3.5;
          ctx.beginPath();
          ctx.arc(sx, sy, waveR, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(192, 132, 252, 0.55)";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (seat.id === "kemal" && trPos.length > 0) {
          // Tahta Kemal X-Ray emerald rotating radar arc
          ctx.beginPath();
          ctx.arc(sx, sy, avatarR + 6, tick * 2, tick * 2 + 1.4);
          ctx.strokeStyle = "#34d399";
          ctx.lineWidth = 2.5;
          ctx.stroke();
        } else if (seat.id === "selo" && trPos.length > 0) {
          // Selo Roket twin rocket flame streaks when in position
          for (let k = -1; k <= 1; k += 2) {
            const flameLen = 10 + Math.abs(Math.sin(tick * 6 + k)) * 12;
            ctx.beginPath();
            ctx.moveTo(sx + k * (avatarR * 0.7), sy + avatarR * 0.5);
            ctx.lineTo(sx + k * (avatarR + flameLen * 0.5), sy + avatarR + flameLen);
            ctx.strokeStyle = "#fb7185";
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }

        // Yellow/Black Hazard Ring when "Çırağı Gönder" Fear Mode active
        if (fearLeft > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, avatarR + 5, 0, Math.PI * 2);
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = -tick * 24;
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 3.2;
          ctx.stroke();
          ctx.restore();
        }

        // Circular Cyberpunk Character Avatar Portrait
        const img = avatarImagesRef.current[seat.id];
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, avatarR, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, sx - avatarR, sy - avatarR, avatarR * 2, avatarR * 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, avatarR, 0, Math.PI * 2);
          ctx.fillStyle = "#18181b";
          ctx.fill();
        }

        // Neon Rim around Avatar
        ctx.beginPath();
        ctx.arc(sx, sy, avatarR, 0, Math.PI * 2);
        ctx.strokeStyle = isPanicked ? "#ef4444" : seat.color;
        ctx.lineWidth = isPanicked ? 3 : 2.2;
        ctx.stroke();

        // Nameplate & Live PnL / Position Tag below Avatar
        const pillText =
          trPos.length > 0
            ? `${seat.label.split(" ")[0]} · ${trPos[0].side[0]} ${trPos[0].leverage}x ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`
            : `${seat.label.split(" ")[0]} · $${bal.toFixed(0)}`;
        ctx.font = "bold 10px ui-monospace, SFMono-Regular, monospace";
        const tw = ctx.measureText(pillText).width + 12;
        const py = sy + avatarR + 5;
        ctx.fillStyle = "rgba(9, 9, 11, 0.88)";
        ctx.beginPath();
        ctx.roundRect(sx - tw / 2, py, tw, 17, 5);
        ctx.fill();
        ctx.strokeStyle = isPanicked ? "rgba(239,68,68,0.75)" : "rgba(63,63,70,0.85)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isPanicked
          ? "#fca5a5"
          : pnl > 0
          ? "#6ee7b7"
          : pnl < 0
          ? "#fda4af"
          : "#e4e4e7";
        ctx.textAlign = "center";
        ctx.fillText(pillText, sx, py + 12);
      });

      ctx.restore();
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const seat of SEATS) {
      const sx = seat.nx * rect.width;
      const sy = seat.ny * rect.height;
      if (Math.hypot(x - sx, y - sy) <= 38) {
        hapticShort();
        playClick();
        const tr = traders.find((t) => t.id === seat.id);
        const pnl = openPnlByTrader[seat.id] ?? 0;
        let kind: StreetEventKind = "wick_catch";
        if (tr?.mood === "panicked" || tr?.mood === "busted") kind = "liquidation";
        else if (pnl >= 10) kind = "big_profit";
        else if (pnl <= -10) kind = "big_loss";
        else if (seat.id === "nuri") kind = "funding_squeeze";

        const delivery = speakStreetEvent(
          seat.id,
          kind,
          (livePrices.BTCUSDT || 60000) + Math.abs(pnl) * 10 + Number(tr?.balance || 0)
        );
        setSelectedTrader({
          id: seat.id,
          name: tr?.nickname ?? seat.label,
          quote: delivery.text,
        });
        return;
      }
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-500/40 bg-zinc-950 shadow-2xl">
      {/* Yellow/Black Hazard Tape when "Çırağı Gönder" Fear Mode is active on any trader */}
      {anyFearMode && (
        <div className="hazard-tape-banner flex items-center justify-center gap-2 px-3 py-1.5 text-center font-mono text-[11px] font-black tracking-wider text-black uppercase shadow">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          ÇIRAK KAHVEHANEDE! KORKU MODU AKTİF — HEDEF TRADER KALDIRACI YARIYA İNDİ
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 bg-zinc-950/90 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="font-display text-xs font-black tracking-wider text-amber-300 uppercase sm:text-sm">
            2.5D İzometrik Yeraltı Kahvehanesi Masası (Canlı Canvas)
          </h3>
        </div>
        <span className="font-mono text-[10px] text-zinc-400">
          Çip yığınları = Canlı bakiye · Konuşturmak için avatara dokun
        </span>
      </div>

      <div className="relative w-full">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="block h-[290px] w-full cursor-pointer sm:h-[340px]"
          aria-label="Yeraltı Kahvehanesi 2.5D canlı masa haritası"
        />

        {selectedTrader && (
          <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-2 rounded-xl border border-amber-500/50 bg-black/85 px-3 py-2 text-xs backdrop-blur-md sm:left-auto sm:max-w-md">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={`/avatars/${selectedTrader.id}.webp`}
                alt={selectedTrader.name}
                className="h-8 w-8 shrink-0 rounded-full border border-amber-400 object-cover"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-amber-300 uppercase">
                  <Volume2 className="h-3 w-3" />
                  {selectedTrader.name}
                </div>
                <p className="truncate text-amber-50">&ldquo;{selectedTrader.quote}&rdquo;</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTrader(null)}
              className="min-h-[36px] shrink-0 cursor-pointer rounded-lg border border-zinc-700 px-2 font-mono text-[10px] text-zinc-400 hover:text-white"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Quick Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 bg-black/60 px-3.5 py-2 font-mono text-[10px] text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Kâr Çip Yığını
          </span>
          <span className="inline-flex items-center gap-1 text-red-400">
            <Flame className="h-3 w-3" /> Likidasyon / Panik Alevi
          </span>
          <span className="inline-flex items-center gap-1 text-yellow-300">
            <span className="h-2 w-2 rounded-full bg-yellow-400" /> Çırak Korku Halkası
          </span>
        </div>
        <span className="text-zinc-500">60 FPS HTML5 Canvas · %100 Gerçek Veri</span>
      </div>
    </section>
  );
};
