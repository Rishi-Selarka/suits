"""Lazy service-role Supabase client factory.

The service-role key bypasses Row Level Security and must never touch the
browser. Always filter by user_id in backend code, even though RLS would
catch anything slipping through with a user-scoped anon key — defense in
depth.

Usage:
    from supabase_client import get_supabase

    sb = get_supabase()
    if sb is None:
        # Supabase not configured — fall back to local file storage.
        ...
    else:
        sb.table("documents").select("*").eq("user_id", user_id).execute()
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, Optional

from config import get_settings
from logging_config import get_logger

if TYPE_CHECKING:
    from supabase import Client  # pragma: no cover

logger = get_logger("supabase_client")


@lru_cache(maxsize=1)
def get_supabase() -> Optional["Client"]:
    """Return a cached service-role Supabase client, or None if not configured."""
    settings = get_settings()
    if not settings.supabase_configured:
        return None
    try:
        from supabase import create_client
    except ImportError:
        logger.warning(
            "supabase package not installed — run `pip install supabase` to enable "
            "Supabase-backed storage.",
            extra={"status": "supabase_missing"},
        )
        return None
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    logger.info("Supabase client initialised", extra={"status": "supabase_ready"})
    return client
