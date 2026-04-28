"""Per-user storage layer for Suits AI.

Two backends behind one async interface:

- **SupabaseStorage** — used when Supabase is configured. File bytes live in the
  `documents` bucket; metadata/results/clauses live in Postgres tables.
  Bucket path layout: `<user_id>/<document_id>_<safe_filename>` — matches the
  RLS policies in supabase_schema.sql.

- **LocalStorage** — dev fallback. Files under `data/uploads/<user_id>/`,
  metadata/results JSON under `data/{metadata,results}/<user_id>/`.

Every method takes `user_id` as the first arg so the backend can scope its
queries / paths to that user. The wrapper class `Storage` picks a backend at
construction time. Methods are async because the Supabase Python client is
synchronous and we offload its calls to a thread.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from config import get_settings
from logging_config import get_logger
from models import AnalysisResult, DocumentMetadata

logger = get_logger("storage")

_VALID_DOC_ID = re.compile(r"^[a-f0-9]{1,64}$")
# Supabase auth.users.id is always a UUID. The all-zero UUID is the
# DEV_USER_ID local-dev placeholder. Restricting to UUID-only stops `..`,
# `.`, and other path-walking shapes from ever reaching `LocalStorage`'s
# filesystem layout.
_VALID_USER_ID = re.compile(
    r"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$"
)


def _validate_document_id(document_id: str) -> None:
    if not _VALID_DOC_ID.match(document_id):
        raise ValueError(f"Invalid document_id: {document_id!r}")


def _validate_user_id(user_id: str) -> None:
    if not _VALID_USER_ID.match(user_id):
        raise ValueError(f"Invalid user_id: {user_id!r}")


def _safe_filename(filename: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", filename)[:255] or "document"


# ── Supabase backend ────────────────────────────────────────────────────────

class SupabaseStorage:
    """Supabase Storage + Postgres-backed implementation."""

    def __init__(self, client: Any, bucket: str = "documents") -> None:
        self.client = client
        self.bucket = bucket

    @staticmethod
    def _bucket_path(user_id: str, document_id: str, filename: str) -> str:
        return f"{user_id}/{document_id}_{_safe_filename(filename)}"

    # ── Files ──────────────────────────────────────────────────────────

    async def save_upload(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        data: bytes,
        content_type: str | None = None,
    ) -> str:
        _validate_user_id(user_id)
        _validate_document_id(document_id)
        path = self._bucket_path(user_id, document_id, filename)
        # Pass the real MIME through so signed-URL downloads / future public
        # access serve PDFs as application/pdf rather than octet-stream.
        file_options: dict[str, str] = {"upsert": "true"}
        if content_type:
            file_options["content-type"] = content_type

        def _run() -> None:
            self.client.storage.from_(self.bucket).upload(
                path=path,
                file=data,
                file_options=file_options,
            )
        await asyncio.to_thread(_run)
        return path

    async def get_upload_path(
        self, user_id: str, document_id: str
    ) -> Path | None:
        """Download bytes to a tempfile and return its Path.

        The ingestor needs a real filesystem path to hand to PyMuPDF / Tesseract.
        We download to the OS temp dir on demand. The caller may delete the
        file after use; if not, the OS will reap it.
        """
        meta = await self.get_metadata(user_id, document_id)
        if not meta or not meta.storage_path:
            return None

        def _run() -> bytes:
            return self.client.storage.from_(self.bucket).download(meta.storage_path)
        try:
            data = await asyncio.to_thread(_run)
        except Exception as exc:
            logger.warning(
                f"Storage download failed for {document_id}: {exc}",
                extra={"status": "storage_download_error"},
            )
            return None

        # Write to a tempfile preserving the original extension so PyMuPDF can
        # detect the format from the path. If the write itself fails (disk
        # full, permission, …) we unlink the partial file before re-raising
        # so /tmp doesn't accumulate orphans across retries.
        suffix = Path(meta.filename).suffix or ".bin"
        fd, tmp_path = tempfile.mkstemp(prefix=f"{document_id}_", suffix=suffix)
        try:
            try:
                os.write(fd, data)
            finally:
                os.close(fd)
        except BaseException:
            Path(tmp_path).unlink(missing_ok=True)
            raise
        return Path(tmp_path)

    # ── Document metadata ─────────────────────────────────────────────

    @staticmethod
    def _row_to_meta(row: dict[str, Any]) -> DocumentMetadata:
        return DocumentMetadata(
            document_id=row["id"],
            filename=row.get("filename", ""),
            sha256=row.get("sha256", ""),
            page_count=int(row.get("page_count") or 0),
            clause_count=int(row.get("clause_count") or 0),
            file_size_bytes=int(row.get("file_size_bytes") or 0),
            content_type=row.get("content_type") or "",
            status=row.get("status") or "uploaded",
            storage_path=row.get("storage_path") or "",
        )

    async def save_metadata(
        self, user_id: str, meta: DocumentMetadata
    ) -> None:
        _validate_user_id(user_id)
        _validate_document_id(meta.document_id)
        payload = {
            "id": meta.document_id,
            "user_id": user_id,
            "filename": meta.filename,
            "sha256": meta.sha256,
            "page_count": meta.page_count,
            "clause_count": meta.clause_count,
            "file_size_bytes": meta.file_size_bytes,
            "content_type": meta.content_type,
            "status": meta.status,
            "storage_path": meta.storage_path,
        }

        def _run() -> None:
            self.client.table("documents").upsert(payload, on_conflict="id").execute()
        await asyncio.to_thread(_run)

    async def get_metadata(
        self, user_id: str, document_id: str
    ) -> DocumentMetadata | None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)

        def _run() -> dict[str, Any] | None:
            res = (
                self.client.table("documents")
                .select("*")
                .eq("user_id", user_id)
                .eq("id", document_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None
        row = await asyncio.to_thread(_run)
        return self._row_to_meta(row) if row else None

    async def find_by_hash(
        self, user_id: str, sha256: str
    ) -> DocumentMetadata | None:
        _validate_user_id(user_id)

        def _run() -> dict[str, Any] | None:
            res = (
                self.client.table("documents")
                .select("*")
                .eq("user_id", user_id)
                .eq("sha256", sha256)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None
        row = await asyncio.to_thread(_run)
        return self._row_to_meta(row) if row else None

    async def update_status(
        self,
        user_id: str,
        document_id: str,
        status: str,
        clause_count: int | None = None,
    ) -> None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)
        updates: dict[str, Any] = {"status": status}
        if clause_count is not None:
            updates["clause_count"] = clause_count

        def _run() -> None:
            self.client.table("documents").update(updates).eq(
                "user_id", user_id
            ).eq("id", document_id).execute()
        await asyncio.to_thread(_run)

    # ── Analysis results ──────────────────────────────────────────────

    async def save_result(
        self, user_id: str, result: AnalysisResult
    ) -> None:
        _validate_user_id(user_id)
        _validate_document_id(result.document_id)
        payload = {
            "document_id": result.document_id,
            "user_id": user_id,
            "result": json.loads(result.model_dump_json()),
        }

        def _run() -> None:
            self.client.table("analysis_results").upsert(
                payload, on_conflict="document_id"
            ).execute()
        await asyncio.to_thread(_run)

    async def get_result(
        self, user_id: str, document_id: str
    ) -> AnalysisResult | None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)

        def _run() -> dict[str, Any] | None:
            res = (
                self.client.table("analysis_results")
                .select("*")
                .eq("user_id", user_id)
                .eq("document_id", document_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None
        row = await asyncio.to_thread(_run)
        if not row:
            return None
        return AnalysisResult.model_validate(row["result"])

    # ── Clauses ───────────────────────────────────────────────────────

    async def save_clauses(
        self, user_id: str, document_id: str, clauses: list[dict[str, Any]]
    ) -> None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)
        payload = {
            "document_id": document_id,
            "user_id": user_id,
            "clauses": clauses,
        }

        def _run() -> None:
            self.client.table("document_clauses").upsert(
                payload, on_conflict="document_id"
            ).execute()
        await asyncio.to_thread(_run)

    async def get_clauses(
        self, user_id: str, document_id: str
    ) -> list[dict[str, Any]] | None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)

        def _run() -> dict[str, Any] | None:
            res = (
                self.client.table("document_clauses")
                .select("*")
                .eq("user_id", user_id)
                .eq("document_id", document_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None
        row = await asyncio.to_thread(_run)
        if not row:
            return None
        return row.get("clauses") or []

    # ── Listing ──────────────────────────────────────────────────────

    async def list_documents(self, user_id: str) -> list[DocumentMetadata]:
        _validate_user_id(user_id)

        def _run() -> list[dict[str, Any]]:
            res = (
                self.client.table("documents")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return res.data or []
        rows = await asyncio.to_thread(_run)
        return [self._row_to_meta(r) for r in rows]

    # ── Cleanup ──────────────────────────────────────────────────────

    async def delete_document(self, user_id: str, document_id: str) -> None:
        _validate_user_id(user_id)
        _validate_document_id(document_id)
        meta = await self.get_metadata(user_id, document_id)

        def _run_db() -> None:
            self.client.table("documents").delete().eq(
                "user_id", user_id
            ).eq("id", document_id).execute()
            # analysis_results / document_clauses cascade via FK on delete.
        await asyncio.to_thread(_run_db)

        if meta and meta.storage_path:
            def _run_storage() -> None:
                try:
                    self.client.storage.from_(self.bucket).remove([meta.storage_path])
                except Exception as exc:
                    logger.warning(
                        f"Storage delete failed for {document_id}: {exc}",
                        extra={"status": "storage_delete_error"},
                    )
            await asyncio.to_thread(_run_storage)


# ── Local fallback ──────────────────────────────────────────────────────────

def _atomic_write_text(path: Path, content: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class LocalStorage:
    """Per-user file-based storage. Used when Supabase is not configured."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        (self.root / "uploads").mkdir(parents=True, exist_ok=True)
        (self.root / "metadata").mkdir(parents=True, exist_ok=True)
        (self.root / "results").mkdir(parents=True, exist_ok=True)

    def _user_dir(self, user_id: str, kind: str) -> Path:
        _validate_user_id(user_id)
        d = self.root / kind / user_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ── Files ──────────────────────────────────────────────────────────

    async def save_upload(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        data: bytes,
        content_type: str | None = None,  # noqa: ARG002 — local fs has no MIME concept
    ) -> str:
        _validate_document_id(document_id)
        upload_dir = self._user_dir(user_id, "uploads")
        path = upload_dir / f"{document_id}_{_safe_filename(filename)}"

        def _write() -> None:
            path.write_bytes(data)
        await asyncio.to_thread(_write)
        return str(path)

    async def get_upload_path(
        self, user_id: str, document_id: str
    ) -> Path | None:
        _validate_document_id(document_id)
        upload_dir = self._user_dir(user_id, "uploads")
        for f in upload_dir.iterdir():
            if f.name.startswith(document_id):
                return f
        return None

    # ── Metadata ──────────────────────────────────────────────────────

    async def save_metadata(
        self, user_id: str, meta: DocumentMetadata
    ) -> None:
        _validate_document_id(meta.document_id)
        path = self._user_dir(user_id, "metadata") / f"{meta.document_id}.json"
        await asyncio.to_thread(_atomic_write_text, path, meta.model_dump_json(indent=2))

    async def get_metadata(
        self, user_id: str, document_id: str
    ) -> DocumentMetadata | None:
        _validate_document_id(document_id)
        path = self._user_dir(user_id, "metadata") / f"{document_id}.json"
        if not path.exists():
            return None
        return DocumentMetadata.model_validate_json(path.read_text())

    async def find_by_hash(
        self, user_id: str, sha256: str
    ) -> DocumentMetadata | None:
        # Linear scan within this user's metadata dir — fine at hackathon scale.
        meta_dir = self._user_dir(user_id, "metadata")
        for f in meta_dir.glob("*.json"):
            try:
                m = DocumentMetadata.model_validate_json(f.read_text())
                if m.sha256 == sha256:
                    return m
            except Exception:
                continue
        return None

    async def update_status(
        self,
        user_id: str,
        document_id: str,
        status: str,
        clause_count: int | None = None,
    ) -> None:
        meta = await self.get_metadata(user_id, document_id)
        if not meta:
            return
        meta.status = status  # type: ignore[assignment]
        if clause_count is not None:
            meta.clause_count = clause_count
        await self.save_metadata(user_id, meta)

    # ── Results ──────────────────────────────────────────────────────

    async def save_result(
        self, user_id: str, result: AnalysisResult
    ) -> None:
        _validate_document_id(result.document_id)
        path = self._user_dir(user_id, "results") / f"{result.document_id}.json"
        await asyncio.to_thread(_atomic_write_text, path, result.model_dump_json(indent=2))

    async def get_result(
        self, user_id: str, document_id: str
    ) -> AnalysisResult | None:
        _validate_document_id(document_id)
        path = self._user_dir(user_id, "results") / f"{document_id}.json"
        if not path.exists():
            return None
        return AnalysisResult.model_validate_json(path.read_text())

    # ── Clauses ───────────────────────────────────────────────────────

    async def save_clauses(
        self, user_id: str, document_id: str, clauses: list[dict[str, Any]]
    ) -> None:
        _validate_document_id(document_id)
        path = self._user_dir(user_id, "results") / f"{document_id}_clauses.json"
        await asyncio.to_thread(_atomic_write_text, path, json.dumps(clauses, indent=2))

    async def get_clauses(
        self, user_id: str, document_id: str
    ) -> list[dict[str, Any]] | None:
        _validate_document_id(document_id)
        path = self._user_dir(user_id, "results") / f"{document_id}_clauses.json"
        if not path.exists():
            return None
        return json.loads(path.read_text())

    # ── Listing ──────────────────────────────────────────────────────

    async def list_documents(self, user_id: str) -> list[DocumentMetadata]:
        meta_dir = self._user_dir(user_id, "metadata")
        docs: list[DocumentMetadata] = []
        for f in meta_dir.glob("*.json"):
            try:
                docs.append(DocumentMetadata.model_validate_json(f.read_text()))
            except Exception:
                continue
        return sorted(docs, key=lambda d: d.document_id, reverse=True)

    async def delete_document(self, user_id: str, document_id: str) -> None:
        _validate_document_id(document_id)
        for kind in ("metadata", "results"):
            d = self._user_dir(user_id, kind)
            for f in d.glob(f"{document_id}*"):
                f.unlink(missing_ok=True)
        upload_dir = self._user_dir(user_id, "uploads")
        for f in upload_dir.iterdir():
            if f.name.startswith(document_id):
                f.unlink(missing_ok=True)


# ── Public Storage wrapper ─────────────────────────────────────────────────

class Storage:
    """Async per-user storage; picks Supabase backend when configured."""

    def __init__(
        self,
        upload_dir: str,
        results_dir: str,
        metadata_dir: str,
    ) -> None:
        # We only need *one* root dir for the local backend; keep the existing
        # constructor signature for compatibility but compute a parent root.
        local_root = Path(upload_dir).parent

        settings = get_settings()
        backend: SupabaseStorage | LocalStorage
        if settings.supabase_configured:
            from supabase_client import get_supabase

            client = get_supabase()
            if client is not None:
                backend = SupabaseStorage(client, bucket=settings.supabase_storage_bucket)
                logger.info(
                    "Storage backend: Supabase",
                    extra={"status": "storage_ready", "backend": "supabase"},
                )
                self.backend = backend
                return
            logger.warning(
                "Supabase configured but client unavailable — using local storage",
                extra={"status": "storage_fallback"},
            )
        backend = LocalStorage(local_root)
        logger.info(
            "Storage backend: local",
            extra={"status": "storage_ready", "backend": "local", "root": str(local_root)},
        )
        self.backend = backend

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    # ── Delegated methods ─────────────────────────────────────────────

    async def save_upload(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        data: bytes,
        content_type: str | None = None,
    ) -> str:
        return await self.backend.save_upload(
            user_id, document_id, filename, data, content_type=content_type
        )

    async def get_upload_path(
        self, user_id: str, document_id: str
    ) -> Path | None:
        return await self.backend.get_upload_path(user_id, document_id)

    async def save_metadata(
        self, user_id: str, meta: DocumentMetadata
    ) -> None:
        await self.backend.save_metadata(user_id, meta)

    async def get_metadata(
        self, user_id: str, document_id: str
    ) -> DocumentMetadata | None:
        return await self.backend.get_metadata(user_id, document_id)

    async def find_by_hash(
        self, user_id: str, sha256: str
    ) -> DocumentMetadata | None:
        return await self.backend.find_by_hash(user_id, sha256)

    async def update_status(
        self,
        user_id: str,
        document_id: str,
        status: str,
        clause_count: int | None = None,
    ) -> None:
        await self.backend.update_status(user_id, document_id, status, clause_count=clause_count)

    async def save_result(
        self, user_id: str, result: AnalysisResult
    ) -> None:
        await self.backend.save_result(user_id, result)

    async def get_result(
        self, user_id: str, document_id: str
    ) -> AnalysisResult | None:
        return await self.backend.get_result(user_id, document_id)

    async def save_clauses(
        self, user_id: str, document_id: str, clauses: list[dict[str, Any]]
    ) -> None:
        await self.backend.save_clauses(user_id, document_id, clauses)

    async def get_clauses(
        self, user_id: str, document_id: str
    ) -> list[dict[str, Any]] | None:
        return await self.backend.get_clauses(user_id, document_id)

    async def list_documents(self, user_id: str) -> list[DocumentMetadata]:
        return await self.backend.list_documents(user_id)

    async def delete_document(self, user_id: str, document_id: str) -> None:
        await self.backend.delete_document(user_id, document_id)
