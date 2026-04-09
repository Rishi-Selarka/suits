"""File-based JSON storage with SHA-256 dedup for Suits AI."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from models import AnalysisResult, DocumentMetadata
from logging_config import get_logger

logger = get_logger("storage")

_VALID_DOC_ID = re.compile(r"^[a-f0-9]{1,64}$")


def _validate_document_id(document_id: str) -> None:
    """Reject document_ids that could cause path traversal."""
    if not _VALID_DOC_ID.match(document_id):
        raise ValueError(f"Invalid document_id: {document_id!r}")


def _atomic_write_text(path: Path, content: str) -> None:
    """Write text atomically: write to temp file then rename."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        os.replace(tmp, path)
    except BaseException:
        os.close(fd) if not os.get_inheritable(fd) else None
        Path(tmp).unlink(missing_ok=True)
        raise


class Storage:
    """Simple file-based storage: uploads, results, metadata."""

    def __init__(self, upload_dir: str, results_dir: str, metadata_dir: str) -> None:
        self.upload_dir = Path(upload_dir)
        self.results_dir = Path(results_dir)
        self.metadata_dir = Path(metadata_dir)
        for d in (self.upload_dir, self.results_dir, self.metadata_dir):
            d.mkdir(parents=True, exist_ok=True)
        # In-memory hash -> document_id index for O(1) dedup
        self._hash_index: dict[str, str] = self._build_hash_index()

    def _build_hash_index(self) -> dict[str, str]:
        """Build hash index from existing metadata at startup."""
        index: dict[str, str] = {}
        for f in self.metadata_dir.glob("*.json"):
            try:
                meta = DocumentMetadata.model_validate_json(f.read_text())
                if meta.sha256:
                    index[meta.sha256] = meta.document_id
            except Exception:
                continue
        return index

    # ── Hashing ──────────────────────────────────────────────────────────

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    # ── Document metadata ────────────────────────────────────────────────

    def save_metadata(self, meta: DocumentMetadata) -> None:
        path = self.metadata_dir / f"{meta.document_id}.json"
        _atomic_write_text(path, meta.model_dump_json(indent=2))
        if meta.sha256:
            self._hash_index[meta.sha256] = meta.document_id

    def get_metadata(self, document_id: str) -> DocumentMetadata | None:
        _validate_document_id(document_id)
        path = self.metadata_dir / f"{document_id}.json"
        if not path.exists():
            return None
        return DocumentMetadata.model_validate_json(path.read_text())

    def find_by_hash(self, sha256: str) -> DocumentMetadata | None:
        """O(1) dedup check using in-memory hash index."""
        doc_id = self._hash_index.get(sha256)
        if doc_id:
            return self.get_metadata(doc_id)
        return None

    def update_status(
        self, document_id: str, status: str, clause_count: int | None = None
    ) -> None:
        _validate_document_id(document_id)
        meta = self.get_metadata(document_id)
        if meta:
            meta.status = status  # type: ignore[assignment]
            if clause_count is not None:
                meta.clause_count = clause_count
            self.save_metadata(meta)

    # ── File storage ─────────────────────────────────────────────────────

    def save_upload(self, document_id: str, filename: str, data: bytes) -> Path:
        _validate_document_id(document_id)
        safe_name = f"{document_id}_{re.sub(r'[^a-zA-Z0-9._-]', '_', filename)}"
        path = self.upload_dir / safe_name
        path.write_bytes(data)
        return path

    def get_upload_path(self, document_id: str) -> Path | None:
        _validate_document_id(document_id)
        for f in self.upload_dir.iterdir():
            if f.name.startswith(document_id):
                return f
        return None

    # ── Analysis results ─────────────────────────────────────────────────

    def save_result(self, result: AnalysisResult) -> None:
        _validate_document_id(result.document_id)
        path = self.results_dir / f"{result.document_id}.json"
        _atomic_write_text(path, result.model_dump_json(indent=2))
        logger.info(
            "Result saved",
            extra={"agent": "storage", "status": "saved"},
        )

    def get_result(self, document_id: str) -> AnalysisResult | None:
        _validate_document_id(document_id)
        path = self.results_dir / f"{document_id}.json"
        if not path.exists():
            return None
        return AnalysisResult.model_validate_json(path.read_text())

    # ── Clauses (intermediate) ───────────────────────────────────────────

    def save_clauses(self, document_id: str, clauses: list[dict[str, Any]]) -> None:
        _validate_document_id(document_id)
        path = self.results_dir / f"{document_id}_clauses.json"
        _atomic_write_text(path, json.dumps(clauses, indent=2))

    def get_clauses(self, document_id: str) -> list[dict[str, Any]] | None:
        _validate_document_id(document_id)
        path = self.results_dir / f"{document_id}_clauses.json"
        if not path.exists():
            return None
        return json.loads(path.read_text())

    # ── List all documents ───────────────────────────────────────────────

    def list_documents(self) -> list[DocumentMetadata]:
        docs = []
        for f in self.metadata_dir.glob("*.json"):
            try:
                docs.append(DocumentMetadata.model_validate_json(f.read_text()))
            except Exception:
                continue
        return sorted(docs, key=lambda d: d.document_id, reverse=True)

    # ── Cleanup ──────────────────────────────────────────────────────────

    def delete_document(self, document_id: str) -> None:
        _validate_document_id(document_id)
        # Remove from hash index
        meta = self.get_metadata(document_id)
        if meta and meta.sha256 and meta.sha256 in self._hash_index:
            del self._hash_index[meta.sha256]
        for d in (self.metadata_dir, self.results_dir):
            for f in d.glob(f"{document_id}*"):
                f.unlink(missing_ok=True)
        for f in self.upload_dir.iterdir():
            if f.name.startswith(document_id):
                f.unlink(missing_ok=True)
