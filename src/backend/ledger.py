"""Tefeci Debt Ledger & Supabase PostgreSQL state synchronizer."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
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
    initial_principal: float = 0.0
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    last_compounded_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    total_repaid: float = 0.0
    enforcer_count: int = 0
    penalty_multiplier: float = 1.5

    def __post_init__(self) -> None:
        if self.initial_principal <= 0:
            self.initial_principal = self.principal

    def current_owed(self) -> float:
        return max(0.0, self.principal - self.total_repaid)

    def accrued_interest(self) -> float:
        return max(0.0, self.principal - self.initial_principal)

    def to_db_row(self) -> Dict[str, Any]:
        return {
            "id": self.debt_id,
            "trader_id": self.trader_id,
            "principal": round(self.principal, 4),
            "initial_principal": round(self.initial_principal, 4),
            "interest_rate": round(self.interest_rate, 6),
            "compounding_period_s": int(self.compounding_period_s),
            "due_date_ms": int(self.due_date_ms),
            "status": self.status,
            "total_repaid": round(self.total_repaid, 4),
            "enforcer_count": int(self.enforcer_count),
        }

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
    """Authoritative Supabase PostgreSQL synchronizer for traders, debts, positions, events, and equity."""

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
                logger.info("Connected SupabaseSync to %s", self.url)
            except Exception:
                logger.exception("Failed to initialize Supabase client")

    @property
    def connected(self) -> bool:
        return self._client is not None

    async def upsert_table(self, table: str, payload: dict) -> None:
        if self._client is None:
            logger.debug("Supabase upsert [%s]: %s", table, payload)
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table(table).upsert(payload).execute()
            )
        except Exception:
            logger.exception("Supabase upsert failed on %s", table)

    async def update_table(self, table: str, row_id: str, fields: dict) -> None:
        if self._client is None:
            logger.debug("Supabase update [%s/%s]: %s", table, row_id, fields)
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table(table)
                .update(fields)
                .eq("id", row_id)
                .execute()
            )
        except Exception:
            logger.exception("Supabase update failed on %s/%s", table, row_id)

    async def insert_row(self, table: str, payload: dict) -> None:
        if self._client is None:
            logger.debug("Supabase insert [%s]: %s", table, payload)
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table(table).insert(payload).execute()
            )
        except Exception:
            logger.exception("Supabase insert failed on %s", table)

    async def insert_event(
        self,
        event_type: str,
        trader_id: str,
        message: str,
        payload: Optional[dict] = None,
        processed: bool = True,
    ) -> None:
        row = {
            "type": event_type,
            "trader_id": trader_id,
            "message": message,
            "payload": payload or {},
            "processed": processed,
        }
        await self.insert_row("events", row)

    async def fetch_pending_commands(self) -> List[Dict[str, Any]]:
        if self._client is None:
            return []
        try:
            res = await asyncio.to_thread(
                lambda: self._client.table("events")
                .select("*")
                .eq("processed", False)
                .order("id", desc=False)
                .limit(25)
                .execute()
            )
            return list(res.data or [])
        except Exception:
            logger.exception("Failed fetching pending commands")
            return []

    async def mark_event_processed(self, event_id: int) -> None:
        if self._client is None:
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table("events")
                .update({"processed": True})
                .eq("id", event_id)
                .execute()
            )
        except Exception:
            logger.exception("Failed marking event %s processed", event_id)

    async def delete_stale_rows(self, table: str, column: str, value: str) -> None:
        if self._client is None:
            return
        try:
            await asyncio.to_thread(
                lambda: self._client.table(table).delete().eq(column, value).execute()
            )
        except Exception:
            logger.exception("Failed deleting stale rows on %s", table)

    async def fetch_all(self, table: str, limit: int = 200) -> List[Dict[str, Any]]:
        if self._client is None:
            return []
        try:
            res = await asyncio.to_thread(
                lambda: self._client.table(table).select("*").limit(limit).execute()
            )
            return list(res.data or [])
        except Exception:
            logger.exception("Failed fetching rows from %s", table)
            return []

    async def prune_equity_snapshots(self, keep_last: int = 180) -> None:
        if self._client is None:
            return
        try:
            res = await asyncio.to_thread(
                lambda: self._client.table("equity_snapshots")
                .select("id")
                .order("id", desc=True)
                .range(keep_last, keep_last + 100)
                .execute()
            )
            old_ids = [r["id"] for r in (res.data or [])]
            if old_ids:
                await asyncio.to_thread(
                    lambda: self._client.table("equity_snapshots")
                    .delete()
                    .in_("id", old_ids)
                    .execute()
                )
        except Exception:
            logger.debug("Snapshot prune skipped")

    async def push_state(self, path: str, payload: dict) -> None:
        """Route legacy path ('debts/id', 'positions/id', 'events/id') safely to Supabase tables."""
        parts = path.strip("/").split("/", 1)
        table = parts[0]
        record_id = parts[1] if len(parts) > 1 else None
        if table == "events":
            await self.insert_event(
                str(payload.get("event", payload.get("type", "INFO"))),
                str(payload.get("trader_id", "")),
                str(payload.get("message", payload)),
                payload=payload,
                processed=True,
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
        self.sync = sync or SupabaseSync()
        self.firebase = self.sync  # Backward-compatible alias

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
            initial_principal=principal,
            interest_rate=interest_rate,
            compounding_period_s=compounding_period_s,
            due_date_ms=now_ms + duration_s * 1000,
            status=status,
            created_at_ms=now_ms,
            last_compounded_ms=now_ms,
        )
        self.debts[debt.debt_id] = debt
        await self.sync.upsert_table("debts", debt.to_db_row())
        return debt

    async def double_interest(self, debt_id: str) -> DebtRecord:
        return await self.boost_interest(debt_id, factor=2.0)

    async def boost_interest(self, debt_id: str, factor: float = 1.5) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.interest_rate = round(min(debt.interest_rate * factor, 3.0), 4)
        await self.sync.update_table(
            "debts", debt.debt_id, {"interest_rate": debt.interest_rate}
        )
        return debt

    async def record_enforcer(self, debt_id: str) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.enforcer_count += 1
        await self.sync.update_table(
            "debts", debt.debt_id, {"enforcer_count": debt.enforcer_count}
        )
        return debt

    async def repay(self, debt_id: str, amount: float) -> DebtRecord:
        debt = self.debts[debt_id]
        actual = min(max(0.0, amount), debt.current_owed())
        debt.total_repaid = round(debt.total_repaid + actual, 4)
        if debt.current_owed() <= 0.01:
            debt.status = "ödendi"
        await self.sync.update_table(
            "debts",
            debt.debt_id,
            {
                "total_repaid": debt.total_repaid,
                "status": debt.status,
            },
        )
        return debt

    async def mark_busted(self, debt_id: str) -> DebtRecord:
        debt = self.debts[debt_id]
        debt.status = "patladı"
        await self.sync.update_table("debts", debt.debt_id, {"status": "patladı"})
        return debt

    async def tick_compounding(self, now_ms: Optional[int] = None) -> List[DebtRecord]:
        updated: List[DebtRecord] = []
        for debt in self.debts.values():
            if debt.compound_if_due(now_ms):
                updated.append(debt)
                await self.sync.update_table(
                    "debts",
                    debt.debt_id,
                    {
                        "principal": round(debt.principal, 4),
                        "status": debt.status,
                    },
                )
        return updated
