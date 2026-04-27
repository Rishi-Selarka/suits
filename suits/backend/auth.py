"""Supabase JWT verification for FastAPI.

This module exposes two FastAPI dependencies:

    get_current_user_id      — hard requirement. Raises 401 if the caller is
                               not authenticated. Use on any endpoint that
                               reads or mutates per-user data.

    get_optional_user_id     — soft requirement. Returns the user_id if a
                               valid JWT is present, otherwise None. Use
                               during the migration window when an endpoint
                               must still work without auth.

When `settings.auth_enabled` is False (i.e. SUPABASE_JWT_SECRET not set),
`get_current_user_id` returns a stable development user id so the app keeps
working locally without Supabase. The moment you add the JWT secret, every
protected endpoint starts enforcing real authentication.
"""

from __future__ import annotations

import jwt
from fastapi import Header, HTTPException, status

from config import get_settings
from logging_config import get_logger

logger = get_logger("auth")

# Stable id used when auth is disabled (local dev without Supabase).
# Any write path that will later migrate to Postgres should be fine with
# this — it is a valid string, just not a real UUID.
DEV_USER_ID = "00000000-0000-0000-0000-000000000000"


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1].strip()


def _decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidAudienceError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token audience is not 'authenticated'.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        logger.warning(f"Invalid JWT: {exc}", extra={"status": "invalid_token"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    """Require a valid Supabase JWT. Returns the Supabase user uuid (string).

    In dev mode (no Supabase configured at all) returns a fixed placeholder
    user id so endpoints remain usable locally without setting up auth.

    A "production-looking" config — i.e. SUPABASE_URL set — but missing
    SUPABASE_JWT_SECRET is rejected here as 503 instead of silently falling
    back to the dev user. Without that check, an operator who forgets to set
    the JWT secret would deploy with every request mapping to one shared
    placeholder identity, which is worse than failing closed.
    """
    settings = get_settings()
    if settings.supabase_configured and not settings.auth_enabled:
        # URL/service-role key present, JWT secret missing — refuse rather than
        # decay to dev mode in a deployed environment.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth is misconfigured: SUPABASE_JWT_SECRET is not set.",
        )
    if not settings.auth_enabled:
        return DEV_USER_ID

    token = _extract_bearer(authorization)
    payload = _decode_token(token)
    user_id = payload.get("sub")
    if not user_id or not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no subject (sub) claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


def get_optional_user_id(
    authorization: str | None = Header(default=None),
) -> str | None:
    """Return the user_id when a valid JWT is supplied, else None. Never raises."""
    settings = get_settings()
    if not settings.auth_enabled:
        # Dev mode: treat unauthenticated callers as the dev user so existing
        # quota logic keyed on user_id keeps working without auth.
        return DEV_USER_ID
    if not authorization:
        return None
    try:
        return get_current_user_id(authorization)
    except HTTPException:
        return None
