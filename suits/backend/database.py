"""SQLite database layer for Suits AI — users, payments, usage tracking."""

from __future__ import annotations

import os
import time
import uuid
from typing import Any

import aiosqlite

from logging_config import get_logger

logger = get_logger("database")

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "suits.db")

# ── Schema ──────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT UNIQUE,
    role            TEXT NOT NULL DEFAULT 'individual',
    organization    TEXT DEFAULT '',
    use_case        TEXT DEFAULT '',
    jurisdiction    TEXT DEFAULT 'India',
    plan            TEXT NOT NULL DEFAULT 'free',
    documents_used  INTEGER NOT NULL DEFAULT 0,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    amount_paise        INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'INR',
    plan                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'created',
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    document_id     TEXT NOT NULL,
    action          TEXT NOT NULL DEFAULT 'analyze',
    created_at      REAL NOT NULL
);
"""

# ── Plan limits ─────────────────────────────────────────────────────────────

PLAN_LIMITS: dict[str, int] = {
    "free": 3,
    "starter": 25,
    "pro": 100,
    "unlimited": 999999,
}

PLAN_PRICES_PAISE: dict[str, int] = {
    "starter": 49900,     # ₹499
    "pro": 149900,        # ₹1,499
    "unlimited": 499900,  # ₹4,999
}


# ── Database class ──────────────────────────────────────────────────────────

class Database:
    """Async SQLite wrapper for user, payment, and usage data."""

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self.db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_SCHEMA)
        await self._db.commit()
        logger.info("Database connected", extra={"status": "db_ready", "path": self.db_path})

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "Database not connected — call connect() first"
        return self._db

    # ── Users ───────────────────────────────────────────────────────────

    async def create_user(
        self,
        name: str,
        email: str | None = None,
        role: str = "individual",
        organization: str = "",
        use_case: str = "",
        jurisdiction: str = "India",
    ) -> dict[str, Any]:
        user_id = uuid.uuid4().hex[:16]
        now = time.time()

        # Check email uniqueness if provided
        if email:
            existing = await self.get_user_by_email(email)
            if existing:
                return existing

        await self.db.execute(
            """INSERT INTO users (id, name, email, role, organization, use_case, jurisdiction, plan, documents_used, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'free', 0, ?, ?)""",
            (user_id, name, email, role, organization, use_case, jurisdiction, now, now),
        )
        await self.db.commit()
        logger.info("User created", extra={"user_id": user_id, "role": role, "status": "created"})
        return await self.get_user(user_id)  # type: ignore[return-value]

    async def get_user(self, user_id: str) -> dict[str, Any] | None:
        cursor = await self.db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        cursor = await self.db.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def update_user(self, user_id: str, **fields: Any) -> dict[str, Any] | None:
        allowed = {"name", "email", "role", "organization", "use_case", "jurisdiction", "plan", "documents_used"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return await self.get_user(user_id)

        updates["updated_at"] = time.time()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [user_id]

        await self.db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
        await self.db.commit()
        return await self.get_user(user_id)

    # ── Usage tracking ──────────────────────────────────────────────────

    async def record_usage(self, user_id: str, document_id: str, action: str = "analyze") -> None:
        usage_id = uuid.uuid4().hex[:16]
        await self.db.execute(
            "INSERT INTO usage (id, user_id, document_id, action, created_at) VALUES (?, ?, ?, ?, ?)",
            (usage_id, user_id, document_id, action, time.time()),
        )
        await self.db.execute(
            "UPDATE users SET documents_used = documents_used + 1, updated_at = ? WHERE id = ?",
            (time.time(), user_id),
        )
        await self.db.commit()

    async def get_usage(self, user_id: str) -> list[dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM usage WHERE user_id = ? ORDER BY created_at DESC", (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def check_quota(self, user_id: str) -> dict[str, Any]:
        user = await self.get_user(user_id)
        if not user:
            return {"allowed": False, "reason": "User not found"}

        limit = PLAN_LIMITS.get(user["plan"], 3)
        used = user["documents_used"]
        return {
            "allowed": used < limit,
            "used": used,
            "limit": limit,
            "plan": user["plan"],
            "remaining": max(0, limit - used),
        }

    # ── Payments ────────────────────────────────────────────────────────

    async def create_payment(
        self,
        user_id: str,
        plan: str,
        razorpay_order_id: str | None = None,
    ) -> dict[str, Any]:
        payment_id = uuid.uuid4().hex[:16]
        amount = PLAN_PRICES_PAISE.get(plan, 0)
        now = time.time()

        await self.db.execute(
            """INSERT INTO payments (id, user_id, razorpay_order_id, amount_paise, plan, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'created', ?, ?)""",
            (payment_id, user_id, razorpay_order_id, amount, plan, now, now),
        )
        await self.db.commit()
        return {"id": payment_id, "user_id": user_id, "plan": plan, "amount_paise": amount, "status": "created"}

    async def complete_payment(
        self,
        payment_id: str,
        razorpay_payment_id: str,
    ) -> dict[str, Any] | None:
        now = time.time()
        await self.db.execute(
            "UPDATE payments SET razorpay_payment_id = ?, status = 'paid', updated_at = ? WHERE id = ?",
            (razorpay_payment_id, now, payment_id),
        )

        # Fetch payment to upgrade user plan
        cursor = await self.db.execute("SELECT * FROM payments WHERE id = ?", (payment_id,))
        payment = await cursor.fetchone()
        if payment:
            payment = dict(payment)
            await self.db.execute(
                "UPDATE users SET plan = ?, updated_at = ? WHERE id = ?",
                (payment["plan"], now, payment["user_id"]),
            )
            await self.db.commit()
            return payment
        return None

    async def get_user_payments(self, user_id: str) -> list[dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
