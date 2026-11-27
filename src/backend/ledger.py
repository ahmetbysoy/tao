"""Tefeci Debt Ledger & Supabase PostgreSQL state-change-only synchronizer."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional

logger = logging.getLogger("tefeci.ledger")

DebtStatus = Literal["teklif", "aktif", "gecikti", "patladı", "ödendi"]


@dataclass
class DebtRecord:
    debt_id: str
    trader_id: str
    principal: float
    interest_rate: float
    compounding_period_s: int
    due_date_ms: int
    status: DebtStatus = "aktif"
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    last_compounded_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    total_repaid: float = 0.0
    penalty_multiplier: float = 1.5

    def current_owed(self) -> float:
        return max(0.0, self.principal - self.total_repaid)

    def compound_if_due(self, now_ms: Optional[int] = None) -> bool:
        if self.status in ("patladı", "ödendi", "teklif"):
            return False

        now = now_ms if now_ms is not None else int(time.time() * 1000)
        period_ms = self.compounding_period_s * 1000
        changed = False

        if now > self.due_date_ms and self.status == "aktif":
            self.status = "gecikti"
            changed = True

        while now - self.last_compounded_ms >= period_ms:
            rate = (
                self.interest_rate * self.penalty_multiplier
                if self.status == "gecikti"
                else self.interest_rate
            )
            self.principal = round(self.principal * (1.0 + rate), 4)
            self.last_compounded_ms += period_ms
            changed = True

        return changed


class SupabaseSync:
    """Writes only state transitions to Supabase PostgreSQL (debts, positions, events)."""

    def __init__(
        self,
        url: Optional[str] = None,
        key: Optional[str] = None,
    ) -> None:
        self.url = url or os.getenv("SUPABASE_URL", "")
        self.key = key or os.getenv("SUPABASE_KEY", "")
        self._client: Any = None
        if self.url and self.key:
            try:
                from supabase import create_client

                self._client = create_client(self.url, self.key)
            except Exception:
                logger.exception("Failed to initialize Supabase client")

    async def upsert_table(self, table: str, payload: dict) -> None:
        if self._client is None:
            logger.debug("Supabase state [%s]: %s", table, payload)
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table(table).upsert(payload).execute()
            )
        except Exception:
            logger.exception("Supabase upsert failed on %s", table)

    async def insert_event(self, event_type: str, trader_id: str, message: str) -> None:
        if self._client is None:
            logger.debug("Supabase event [%s] %s: %s", event_type, trader_id, message)
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table("events")
                .insert({"type": event_type, "trader_id": trader_id, "message": message})
                .execute()
            )
        except Exception:
            logger.exception("Supabase event insert failed")

    async def push_state(self, path: str, payload: dict) -> None:
        """Route legacy path ('debts/id', 'positions/id', 'events/id') to Supabase tables."""
        parts = path.strip("/").split("/", 1)
        table = parts[0]
        record_id = parts[1] if len(parts) > 1 else None
        if table == "events":
            await self.insert_event(
                str(payload.get("event", "INFO")),
                str(payload.get("trader_id", "")),
                str(payload.get("message", payload)),
            )
            return
        row = dict(payload)
        if record_id and "id" not in row:
            row["id"] = record_id
        await self.upsert_table(table, row)

    async def close(self) -> None:
        self._client = None


class DebtLedger:
    """Manages all active, overdue, defaulted, and repaid loans."""

    def __init__(self, sync: Optional[SupabaseSync] = None) -> None:
        self.debts: Dict[str, DebtRecord] = {}
        self.firebase = sync or SupabaseSync()  # Keep attribute name for worker compatibility

    async def issue_debt(
        self,
        trader_id: str,
        principal: float,
        interest_rate: float,
        compounding_period_s: int = 300,
        duration_s: int = 1800,
        status: DebtStatus = "aktif",
    ) -> DebtRecord:
        now_ms = int(time.time() * 1000)
        debt = DebtRecord(
            debt_id=f"debt_{uuid.uuid4().hex[:10]}",
            trader_id=trader_id,
            principal=principal,
            interest_rate=interest_rate,
            compounding_period_s=compounding_period_s,
            due_date_ms=now_ms + duration_s * 1000,
            status=status,
            created_at_ms=now_ms,
            last_compounded_ms=now_ms,
        )
        self.debts[debt.debt_id] = debt
        await self.firebase.upsert_table(
            "debts",
            {
                "id": debt.debt_id,
                "trader_id": debt.trader_id,
                "principal": debt.principal,
                "interest_rate": debt.interest_rate,
                "compounding_period_s": debt.compounding_period_s,
                "due_date_ms": debt.due_date_ms,
                "status": debt.status,
                "total_repaid": debt.total_repaid,
            },
        )
        return debt

    async def double_interest(self, debt_id: str) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.interest_rate = round(debt.interest_rate * 2.0, 4)
        await self.firebase.upsert_table(
            "debts", {"id": debt.debt_id, "interest_rate": debt.interest_rate}
        )
        return debt

    async def repay(self, debt_id: str, amount: float) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.total_repaid = round(debt.total_repaid + amount, 4)
        if debt.current_owed() <= 0.01:
            debt.status = "ödendi"
        await self.firebase.upsert_table(
            "debts",
            {
                "id": debt.debt_id,
                "total_repaid": debt.total_repaid,
                "status": debt.status,
            },
        )
        return debt

    async def mark_busted(self, debt_id: str) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.status = "patladı"
        await self.firebase.upsert_table(
            "debts", {"id": debt.debt_id, "status": "patladı"}
        )
        return debt

    async def tick_compounding(self, now_ms: Optional[int] = None) -> List[DebtRecord]:
        updated: List[DebtRecord] = []
        for debt in self.debts.values():
            if debt.compound_if_due(now_ms):
                updated.append(debt)
                await self.firebase.upsert_table(
                    "debts",
                    {
                        "id": debt.debt_id,
                        "principal": debt.principal,
                        "status": debt.status,
                    },
                )
        return updated
