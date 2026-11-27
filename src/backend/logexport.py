"""Trade & Loss Ledger Exporter (JSON & Markdown) for 'Logları İndir'."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Dict, List


@dataclass
class ClosedTradeLog:
    position_id: str
    trader_id: str
    nickname: str
    symbol: str
    side: str
    leverage: int
    entry_price: float
    exit_price: float
    stop_loss: float | None
    take_profit: float | None
    net_pnl: float
    reason_entry: str
    reason_exit: str
    mood: str
    signal_snapshot: Dict[str, Any]
    closed_at_ms: int


def export_losses_json(logs: List[ClosedTradeLog]) -> str:
    losses = [asdict(item) for item in logs if item.net_pnl < 0]
    return json.dumps(losses, ensure_ascii=False, indent=2)


def export_losses_markdown(logs: List[ClosedTradeLog]) -> str:
    losses = [item for item in logs if item.net_pnl < 0]
    lines = [
        "# TEFECİ İNTİKAM DEFTERİ — ZARAR RAPORU",
        "",
        f"Toplam Zarar Eden İşlem: **{len(losses)}**",
        "",
        "| Trader | Coin | Yön | Kaldıraç | Net PnL | Ruh Hali | Neden Açıldı | Neden Battı |",
        "|---|---|---|---:|---:|---|---|---|",
    ]
    for item in losses:
        lines.append(
            f"| {item.nickname} | {item.symbol} | {item.side} | {item.leverage}x | "
            f"${item.net_pnl:,.2f} | {item.mood} | {item.reason_entry} | {item.reason_exit} |"
        )
    return "\n".join(lines)
