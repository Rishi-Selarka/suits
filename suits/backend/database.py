"""Database layer for Suits AI.

Two backends behind one async interface:

- **SupabaseBackend** — used when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
  Talks to Postgres tables defined in supabase_schema.sql via the service-role
  client (bypasses RLS — every method must filter by `user_id`).

- **SqliteBackend** — local-dev fallback. Same interface, file-backed SQLite.
  Used so `uvicorn main:app` keeps working without Supabase configured.

`Database` picks the backend at `connect()` time. main.py is unchanged: it
still calls `db.get_profile(...)`, `db.check_quota(...)`, etc.

The Supabase Python client is synchronous; we wrap calls in `asyncio.to_thread`
to keep the FastAPI event loop responsive.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any

import aiosqlite

from config import get_settings
from logging_config import get_logger

logger = get_logger("database")

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "suits.db")

# ── Plan limits ─────────────────────────────────────────────────────────────

PLAN_LIMITS: dict[str, int] = {
    "free": 3,
    "starter": 25,
    "pro": 100,
    "unlimited": 999999,
}

PLAN_PRICES_PAISE: dict[str, int] = {
    "starter": 49900,
    "pro": 149900,
    "unlimited": 499900,
}


# ── Profile editable fields ────────────────────────────────────────────────
# Single source of truth for which profile columns the user can change. Plan
# and `documents_used` are intentionally absent — those move only via payment
# verification and the usage RPC.
_EDITABLE_PROFILE_FIELDS: frozenset[str] = frozenset(
    {"name", "role", "organization", "use_case", "jurisdiction"}
)


# ── Supabase backend ────────────────────────────────────────────────────────

class SupabaseBackend:
    """Supabase-backed implementation. All methods are sync-in-thread."""

    def __init__(self, client: Any) -> None:
        self.client = client

    # ── Profiles ───────────────────────────────────────────────────────

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        def _run() -> dict[str, Any] | None:
            res = self.client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
            rows = res.data or []
            return rows[0] if rows else None
        return await asyncio.to_thread(_run)

    async def get_or_create_profile(self, user_id: str, name: str = "") -> dict[str, Any]:
        existing = await self.get_profile(user_id)
        if existing:
            return existing

        # The `on_auth_user_created` trigger normally creates this row. We
        # upsert defensively in case it didn't fire (older user, trigger
        # disabled). If the upsert + read still returns nothing we raise —
        # synthesising a fake row would silently desync from the DB.
        def _run() -> dict[str, Any]:
            payload = {"id": user_id, "name": name or "New User"}
            self.client.table("profiles").upsert(payload, on_conflict="id").execute()
            res = self.client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
            rows = res.data or []
            if not rows:
                raise RuntimeError(
                    f"Profile upsert succeeded but row not found for user_id={user_id!r}"
                )
            return rows[0]
        return await asyncio.to_thread(_run)

    async def update_profile(self, user_id: str, **fields: Any) -> dict[str, Any] | None:
        updates = {
            k: v for k, v in fields.items()
            if k in _EDITABLE_PROFILE_FIELDS and v is not None
        }
        if not updates:
            return await self.get_profile(user_id)

        def _run() -> dict[str, Any] | None:
            self.client.table("profiles").update(updates).eq("id", user_id).execute()
            res = self.client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
            rows = res.data or []
            return rows[0] if rows else None
        return await asyncio.to_thread(_run)

    async def upsert_profile(
        self, user_id: str, name: str, **fields: Any
    ) -> dict[str, Any]:
        """Atomic onboarding write: create profile if missing AND set fields.

        Replaces the two-call `get_or_create_profile` + `update_profile`
        pattern at /api/onboard with a single `INSERT … ON CONFLICT DO
        UPDATE`. If the network drops between calls, we never end up with a
        half-onboarded profile.
        """
        payload: dict[str, Any] = {"id": user_id, "name": (name or "New User").strip()}
        for k, v in fields.items():
            if k in _EDITABLE_PROFILE_FIELDS and v is not None:
                payload[k] = v

        def _run() -> dict[str, Any]:
            self.client.table("profiles").upsert(payload, on_conflict="id").execute()
            res = self.client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
            rows = res.data or []
            if not rows:
                raise RuntimeError(
                    f"Profile upsert succeeded but row not found for user_id={user_id!r}"
                )
            return rows[0]
        return await asyncio.to_thread(_run)

    # ── Usage / quota ─────────────────────────────────────────────────

    async def record_usage(
        self, user_id: str, document_id: str, action: str = "analyze"
    ) -> None:
        """Record an analysis event and atomically bump `documents_used`.

        The increment is delegated to the `increment_documents_used` RPC
        defined in `supabase_schema.sql` so it runs as a single UPDATE under
        Postgres MVCC. The previous read-modify-write fallback was removed:
        under concurrent analyses it could silently *decrement* the counter
        if the SELECT raced an unrelated update. If the RPC is unavailable
        we now raise, and the calling SSE handler in main.py logs and
        carries on without corrupting quota.
        """
        def _run() -> None:
            self.client.table("usage").insert({
                "user_id": user_id,
                "document_id": document_id,
                "action": action,
            }).execute()
            self.client.rpc("increment_documents_used", {"uid": user_id}).execute()
        await asyncio.to_thread(_run)

    async def get_usage(self, user_id: str) -> list[dict[str, Any]]:
        def _run() -> list[dict[str, Any]]:
            res = (
                self.client.table("usage")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return res.data or []
        return await asyncio.to_thread(_run)

    async def check_quota(self, user_id: str) -> dict[str, Any]:
        profile = await self.get_or_create_profile(user_id)
        plan = profile.get("plan", "free")
        used = int(profile.get("documents_used", 0) or 0)
        limit = PLAN_LIMITS.get(plan, 3)
        return {
            "allowed": used < limit,
            "used": used,
            "limit": limit,
            "plan": plan,
            "remaining": max(0, limit - used),
        }

    # ── Payments ──────────────────────────────────────────────────────

    async def create_payment(
        self,
        user_id: str,
        plan: str,
        razorpay_order_id: str | None = None,
    ) -> dict[str, Any]:
        amount = PLAN_PRICES_PAISE.get(plan, 0)
        def _run() -> dict[str, Any]:
            payload = {
                "user_id": user_id,
                "plan": plan,
                "amount_paise": amount,
                "razorpay_order_id": razorpay_order_id,
                "status": "created",
            }
            res = self.client.table("payments").insert(payload).execute()
            return (res.data or [payload])[0]
        return await asyncio.to_thread(_run)

    async def complete_payment(
        self,
        payment_id: str,
        razorpay_payment_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        """Mark a payment paid and upgrade the plan.

        Caller-scoped: lookup and update both filter on `(payment_id, user_id)`,
        so a caller who knows another user's payment id cannot trigger a plan
        upgrade on that other account.
        """
        def _run() -> dict[str, Any] | None:
            res = (
                self.client.table("payments")
                .select("*")
                .eq("id", payment_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if not rows:
                return None
            payment = rows[0]
            if payment["status"] != "created":
                return payment

            self.client.table("payments").update({
                "razorpay_payment_id": razorpay_payment_id,
                "status": "paid",
            }).eq("id", payment_id).eq("user_id", user_id).execute()
            self.client.table("profiles").update({
                "plan": payment["plan"],
            }).eq("id", user_id).execute()

            payment["status"] = "paid"
            payment["razorpay_payment_id"] = razorpay_payment_id
            return payment
        return await asyncio.to_thread(_run)

    async def get_user_payments(self, user_id: str) -> list[dict[str, Any]]:
        def _run() -> list[dict[str, Any]]:
            res = (
                self.client.table("payments")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return res.data or []
        return await asyncio.to_thread(_run)


# ── SQLite fallback backend ─────────────────────────────────────────────────

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL DEFAULT '',
    email           TEXT,
    role            TEXT NOT NULL DEFAULT 'individual',
    organization    TEXT NOT NULL DEFAULT '',
    use_case        TEXT NOT NULL DEFAULT '',
    jurisdiction    TEXT NOT NULL DEFAULT 'India',
    plan            TEXT NOT NULL DEFAULT 'free',
    documents_used  INTEGER NOT NULL DEFAULT 0,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES profiles(id),
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
    user_id         TEXT NOT NULL REFERENCES profiles(id),
    document_id     TEXT NOT NULL,
    action          TEXT NOT NULL DEFAULT 'analyze',
    created_at      REAL NOT NULL
);
"""


class SqliteBackend:
    """Local-dev fallback. Same interface as SupabaseBackend."""

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self.db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA foreign_keys = ON")
        await self._db.execute("PRAGMA journal_mode = WAL")
        await self._db.executescript(_SQLITE_SCHEMA)
        # Idempotent migration for older dev DBs created before `email` was
        # added. SQLite has no `IF NOT EXISTS` for ADD COLUMN, so we attempt
        # the alter and swallow the duplicate-column error.
        try:
            await self._db.execute("ALTER TABLE profiles ADD COLUMN email TEXT")
        except Exception:
            pass
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("SQLite backend not connected")
        return self._db

    # ── Profiles ───────────────────────────────────────────────────────

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        cursor = await self.db.execute("SELECT * FROM profiles WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_or_create_profile(self, user_id: str, name: str = "") -> dict[str, Any]:
        existing = await self.get_profile(user_id)
        if existing:
            return existing

        now = time.time()
        await self.db.execute(
            """INSERT INTO profiles (id, name, role, organization, use_case, jurisdiction, plan, documents_used, created_at, updated_at)
               VALUES (?, ?, 'individual', '', '', 'India', 'free', 0, ?, ?)""",
            (user_id, name or "New User", now, now),
        )
        await self.db.commit()
        return await self.get_profile(user_id)  # type: ignore[return-value]

    async def update_profile(self, user_id: str, **fields: Any) -> dict[str, Any] | None:
        updates = {
            k: v for k, v in fields.items()
            if k in _EDITABLE_PROFILE_FIELDS and v is not None
        }
        if not updates:
            return await self.get_profile(user_id)

        # Ensure the profile exists (in dev we may have fresh users). We do
        # *not* feed the new name into get_or_create — that would clobber an
        # already-set name with "New User" if the caller passed only role
        # or jurisdiction.
        await self.get_or_create_profile(user_id)

        updates["updated_at"] = time.time()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [user_id]
        await self.db.execute(f"UPDATE profiles SET {set_clause} WHERE id = ?", values)
        await self.db.commit()
        return await self.get_profile(user_id)

    async def upsert_profile(
        self, user_id: str, name: str, **fields: Any
    ) -> dict[str, Any]:
        """Single-shot create-or-update; SQLite mirror of SupabaseBackend's."""
        await self.get_or_create_profile(user_id, name=name or "New User")
        await self.update_profile(user_id, name=name, **fields)
        profile = await self.get_profile(user_id)
        if profile is None:
            raise RuntimeError(
                f"Profile upsert succeeded but row not found for user_id={user_id!r}"
            )
        return profile

    # ── Usage / quota ─────────────────────────────────────────────────

    async def record_usage(
        self, user_id: str, document_id: str, action: str = "analyze"
    ) -> None:
        await self.get_or_create_profile(user_id)
        usage_id = uuid.uuid4().hex[:16]
        now = time.time()
        await self.db.execute(
            "INSERT INTO usage (id, user_id, document_id, action, created_at) VALUES (?, ?, ?, ?, ?)",
            (usage_id, user_id, document_id, action, now),
        )
        await self.db.execute(
            "UPDATE profiles SET documents_used = documents_used + 1, updated_at = ? WHERE id = ?",
            (now, user_id),
        )
        await self.db.commit()

    async def get_usage(self, user_id: str) -> list[dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM usage WHERE user_id = ? ORDER BY created_at DESC", (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def check_quota(self, user_id: str) -> dict[str, Any]:
        profile = await self.get_or_create_profile(user_id)
        plan = profile.get("plan", "free")
        used = int(profile.get("documents_used", 0) or 0)
        limit = PLAN_LIMITS.get(plan, 3)
        return {
            "allowed": used < limit,
            "used": used,
            "limit": limit,
            "plan": plan,
            "remaining": max(0, limit - used),
        }

    # ── Payments ──────────────────────────────────────────────────────

    async def create_payment(
        self,
        user_id: str,
        plan: str,
        razorpay_order_id: str | None = None,
    ) -> dict[str, Any]:
        await self.get_or_create_profile(user_id)
        payment_id = uuid.uuid4().hex[:16]
        amount = PLAN_PRICES_PAISE.get(plan, 0)
        now = time.time()
        await self.db.execute(
            """INSERT INTO payments (id, user_id, razorpay_order_id, amount_paise, plan, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'created', ?, ?)""",
            (payment_id, user_id, razorpay_order_id, amount, plan, now, now),
        )
        await self.db.commit()
        return {
            "id": payment_id,
            "user_id": user_id,
            "plan": plan,
            "amount_paise": amount,
            "status": "created",
        }

    async def complete_payment(
        self,
        payment_id: str,
        razorpay_payment_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        cursor = await self.db.execute(
            "SELECT * FROM payments WHERE id = ? AND user_id = ?",
            (payment_id, user_id),
        )
        payment = await cursor.fetchone()
        if not payment:
            return None
        payment = dict(payment)
        if payment["status"] != "created":
            return payment

        now = time.time()
        await self.db.execute(
            "UPDATE payments SET razorpay_payment_id = ?, status = 'paid', updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (razorpay_payment_id, now, payment_id, user_id),
        )
        await self.db.execute(
            "UPDATE profiles SET plan = ?, updated_at = ? WHERE id = ?",
            (payment["plan"], now, user_id),
        )
        await self.db.commit()
        payment["status"] = "paid"
        payment["razorpay_payment_id"] = razorpay_payment_id
        return payment

    async def get_user_payments(self, user_id: str) -> list[dict[str, Any]]:
        cursor = await self.db.execute(
            "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ── Public Database wrapper ─────────────────────────────────────────────────

class Database:
    """Async database wrapper that picks Supabase if configured, else SQLite."""

    def __init__(self) -> None:
        self._backend: SupabaseBackend | SqliteBackend | None = None
        self._sqlite: SqliteBackend | None = None  # held for shutdown

    async def connect(self) -> None:
        settings = get_settings()
        if settings.supabase_configured:
            from supabase_client import get_supabase

            client = get_supabase()
            if client is not None:
                self._backend = SupabaseBackend(client)
                logger.info(
                    "Database backend: Supabase",
                    extra={"status": "db_ready", "backend": "supabase"},
                )
                return
            logger.warning(
                "Supabase configured but client unavailable — falling back to SQLite",
                extra={"status": "db_fallback"},
            )

        self._sqlite = SqliteBackend()
        await self._sqlite.connect()
        self._backend = self._sqlite
        logger.info(
            "Database backend: SQLite (dev fallback)",
            extra={"status": "db_ready", "backend": "sqlite", "path": self._sqlite.db_path},
        )

    async def close(self) -> None:
        if self._sqlite is not None:
            await self._sqlite.close()
            self._sqlite = None
        self._backend = None

    @property
    def backend(self) -> SupabaseBackend | SqliteBackend:
        if self._backend is None:
            raise RuntimeError("Database not connected — call connect() first")
        return self._backend

    # ── Delegated methods ─────────────────────────────────────────────

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return await self.backend.get_profile(user_id)

    async def get_or_create_profile(
        self, user_id: str, name: str = ""
    ) -> dict[str, Any]:
        return await self.backend.get_or_create_profile(user_id, name=name)

    async def update_profile(
        self, user_id: str, **fields: Any
    ) -> dict[str, Any] | None:
        return await self.backend.update_profile(user_id, **fields)

    async def upsert_profile(
        self, user_id: str, name: str, **fields: Any
    ) -> dict[str, Any]:
        return await self.backend.upsert_profile(user_id, name, **fields)

    async def record_usage(
        self, user_id: str, document_id: str, action: str = "analyze"
    ) -> None:
        await self.backend.record_usage(user_id, document_id, action=action)

    async def get_usage(self, user_id: str) -> list[dict[str, Any]]:
        return await self.backend.get_usage(user_id)

    async def check_quota(self, user_id: str) -> dict[str, Any]:
        return await self.backend.check_quota(user_id)

    async def create_payment(
        self,
        user_id: str,
        plan: str,
        razorpay_order_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.backend.create_payment(
            user_id, plan, razorpay_order_id=razorpay_order_id
        )

    async def complete_payment(
        self,
        payment_id: str,
        razorpay_payment_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        return await self.backend.complete_payment(
            payment_id, razorpay_payment_id, user_id
        )

    async def get_user_payments(self, user_id: str) -> list[dict[str, Any]]:
        return await self.backend.get_user_payments(user_id)
