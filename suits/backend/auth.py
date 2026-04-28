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

from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from config import get_settings
from logging_config import get_logger

logger = get_logger("auth")

# Stable id used when auth is disabled (local dev without Supabase).
# Any write path that will later migrate to Postgres should be fine with
# this — it is a valid string, just not a real UUID.
DEV_USER_ID = "00000000-0000-0000-0000-000000000000"

# Asymmetric algorithms Supabase may use for new projects.
_ASYMMETRIC_ALGS = ("ES256", "RS256")


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient | None:
    """Cached JWKS client pointed at the Supabase project's JWKS endpoint.

    Returns None if no SUPABASE_URL is configured, or if the JWKS URL can't
    be constructed. The client itself caches signing keys in memory and only
    re-fetches when an unknown `kid` shows up.
    """
    settings = get_settings()
    if not settings.supabase_url:
        return None
    base = settings.supabase_url.rstrip("/")
    return PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_jwk_set=True)


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
    """Verify a Supabase access token under either signing scheme.

    Supabase issues two flavours of JWT depending on project age / settings:

      • Legacy projects sign with the symmetric `JWT Secret` (HS256).
      • Newer / re-keyed projects sign with an asymmetric key (ES256 / RS256)
        and publish the public key at `/auth/v1/.well-known/jwks.json`.

    A single deployment may receive *either* shape (a project mid-rotation
    still emits both for a window). We detect the algorithm from the JWT
    header and dispatch accordingly. HS256 keeps using `SUPABASE_JWT_SECRET`;
    asymmetric algs fetch the matching public key from JWKS.
    """
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    alg = (header.get("alg") or "").upper()

    try:
        if alg in _ASYMMETRIC_ALGS:
            client = _jwks_client()
            if client is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Asymmetric JWT received but SUPABASE_URL is not configured.",
                )
            signing_key = client.get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                signing_key,
                algorithms=[alg],
                audience="authenticated",
            )
        # Default + legacy: HS256 with the shared JWT secret.
        if not settings.supabase_jwt_secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="HS256 JWT received but SUPABASE_JWT_SECRET is not set.",
            )
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
        logger.warning(
            f"Invalid JWT (alg={alg}): {exc}", extra={"status": "invalid_token"}
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.PyJWKClientError as exc:
        logger.error(
            f"JWKS lookup failed for kid={header.get('kid')!r}: {exc}",
            extra={"status": "jwks_error"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify token signing key.",
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
