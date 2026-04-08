"""File-based JSON storage with SHA-256 dedup for Suits AI."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from models import AnalysisResult, DocumentMetadata
from logging_config import get_logger

logger = get_logger("storage")


class Storage:
    """Simple file-based storage: uploads, results, metadata."""

    def __init__(self, upload_dir: str, results_dir: str, metadata_dir: str) -> None:
        self.upload_dir = Path(upload_dir)
        self.results_dir = Path(results_dir)
        self.metadata_dir = Path(metadata_dir)
        for d in (self.upload_dir, self.results_dir, self.metadata_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ── Hashing ──────────────────────────────────────────────────────────

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    # ── Document metadata ────────────────────────────────────────────────

    def save_metadata(self, meta: DocumentMetadata) -> None:
        path = self.metadata_dir / f"{meta.document_id}.json"
        path.write_text(meta.model_dump_json(indent=2))

    def get_metadata(self, document_id: str) -> DocumentMetadata | None:
        path = self.metadata_dir / f"{document_id}.json"
        if not path.exists():
            return None
        return DocumentMetadata.model_validate_json(path.read_text())

    def find_by_hash(self, sha256: str) -> DocumentMetadata | None:
        """Dedup check — return existing doc metadata if hash matches."""
        for f in self.metadata_dir.glob("*.json"):
            try:
                meta = DocumentMetadata.model_validate_json(f.read_text())
                if meta.sha256 == sha256:
                    return meta
            except Exception:
                continue
        return None

    def update_status(
        self, document_id: str, status: str, clause_count: int | None = None
    ) -> None:
        meta = self.get_metadata(document_id)
        if meta:
            meta.status = status  # type: ignore[assignment]
            if clause_count is not None:
                meta.clause_count = clause_count
            self.save_metadata(meta)

    # ── File storage ─────────────────────────────────────────────────────

    def save_upload(self, document_id: str, filename: str, data: bytes) -> Path:
        safe_name = f"{document_id}_{filename.replace(os.sep, '_')}"
        path = self.upload_dir / safe_name
        path.write_bytes(data)
        return path

    def get_upload_path(self, document_id: str) -> Path | None:
        for f in self.upload_dir.iterdir():
            if f.name.startswith(document_id):
                return f
        return None

    # ── Analysis results ─────────────────────────────────────────────────

    def save_result(self, result: AnalysisResult) -> None:
        path = self.results_dir / f"{result.document_id}.json"
        path.write_text(result.model_dump_json(indent=2))
        logger.info(
            "Result saved",
            extra={"agent": "storage", "status": "saved"},
        )

    def get_result(self, document_id: str) -> AnalysisResult | None:
        path = self.results_dir / f"{document_id}.json"
        if not path.exists():
            return None
        return AnalysisResult.model_validate_json(path.read_text())

    # ── Clauses (intermediate) ───────────────────────────────────────────

    def save_clauses(self, document_id: str, clauses: list[dict[str, Any]]) -> None:
        path = self.results_dir / f"{document_id}_clauses.json"
        path.write_text(json.dumps(clauses, indent=2))

    def get_clauses(self, document_id: str) -> list[dict[str, Any]] | None:
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
        for d in (self.metadata_dir, self.results_dir):
            for f in d.glob(f"{document_id}*"):
                f.unlink(missing_ok=True)
        for f in self.upload_dir.iterdir():
            if f.name.startswith(document_id):
                f.unlink(missing_ok=True)
