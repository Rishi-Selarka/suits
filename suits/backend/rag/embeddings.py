"""Embedding manager using sentence-transformers + ChromaDB.

Provides document-level vector collections for semantic search over
chunked legal clauses.
"""

from __future__ import annotations

from sentence_transformers import SentenceTransformer
import chromadb

from logging_config import get_logger

logger = get_logger("rag.embeddings")

_MODEL_NAME = "all-MiniLM-L6-v2"


class EmbeddingManager:
    """Manages per-document ChromaDB collections backed by sentence-transformers."""

    def __init__(self) -> None:
        logger.info(
            "Loading sentence-transformer model",
            extra={"model": _MODEL_NAME, "status": "loading"},
        )
        self._model = SentenceTransformer(_MODEL_NAME)
        self._chroma_client = chromadb.Client()  # in-memory
        logger.info(
            "EmbeddingManager ready",
            extra={"model": _MODEL_NAME, "status": "success"},
        )

    # ------------------------------------------------------------------
    # Collection helpers
    # ------------------------------------------------------------------

    def _collection_name(self, document_id: str) -> str:
        """Derive a ChromaDB-safe collection name from *document_id*.

        ChromaDB collection names must be 3-63 chars, start/end with
        alphanumeric, and contain only alphanumerics, underscores, or
        hyphens.
        """
        name = f"doc_{document_id.replace('-', '_')}"
        # Truncate to 63 chars keeping the prefix informative
        return name[:63]

    def _get_or_create_collection(self, document_id: str) -> chromadb.Collection:
        return self._chroma_client.get_or_create_collection(
            name=self._collection_name(document_id),
            metadata={"hnsw:space": "cosine"},
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def index_chunks(self, document_id: str, chunks: list[dict]) -> None:
        """Create / update a ChromaDB collection for *document_id*.

        Parameters
        ----------
        document_id:
            Unique document identifier used as the collection key.
        chunks:
            Output of ``chunk_clauses()`` — each dict must have at least
            ``chunk_id`` and ``text``.
        """
        if not chunks:
            logger.warning(
                "No chunks to index",
                extra={"agent": "embeddings", "status": "skip"},
            )
            return

        collection = self._get_or_create_collection(document_id)

        ids: list[str] = []
        texts: list[str] = []
        metadatas: list[dict] = []

        for chunk in chunks:
            chunk_id = chunk["chunk_id"]
            text = chunk["text"]
            ids.append(chunk_id)
            texts.append(text)
            metadatas.append(
                {
                    "clause_id": chunk.get("clause_id", 0),
                    "title": chunk.get("title", ""),
                    "page": chunk.get("page", 1),
                }
            )

        # Encode all texts in a single batch
        embeddings = self._model.encode(texts, show_progress_bar=False).tolist()

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
        )

        logger.info(
            "Indexed chunks into ChromaDB",
            extra={
                "agent": "embeddings",
                "status": "success",
                "document_id": document_id,
                "chunk_count": len(ids),
            },
        )

    def query(
        self,
        document_id: str,
        query_text: str,
        top_k: int = 10,
    ) -> list[dict]:
        """Retrieve the *top_k* most relevant chunks for *query_text*.

        Returns
        -------
        list[dict]
            Each dict has: ``chunk_id``, ``text``, ``clause_id``,
            ``title``, ``page``, ``distance``.
        """
        collection = self._get_or_create_collection(document_id)

        if collection.count() == 0:
            logger.warning(
                "Empty collection — nothing to query",
                extra={"agent": "embeddings", "status": "skip"},
            )
            return []

        # Clamp top_k to actual collection size
        effective_k = min(top_k, collection.count())

        query_embedding = self._model.encode([query_text], show_progress_bar=False).tolist()

        results = collection.query(
            query_embeddings=query_embedding,
            n_results=effective_k,
            include=["documents", "metadatas", "distances"],
        )

        hits: list[dict] = []
        ids = results.get("ids", [[]])[0]
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for i, chunk_id in enumerate(ids):
            hits.append(
                {
                    "chunk_id": chunk_id,
                    "text": documents[i] if i < len(documents) else "",
                    "clause_id": metadatas[i].get("clause_id", 0) if i < len(metadatas) else 0,
                    "title": metadatas[i].get("title", "") if i < len(metadatas) else "",
                    "page": metadatas[i].get("page", 1) if i < len(metadatas) else 1,
                    "distance": distances[i] if i < len(distances) else 1.0,
                }
            )

        logger.info(
            "Semantic query complete",
            extra={
                "agent": "embeddings",
                "status": "success",
                "document_id": document_id,
                "query_length": len(query_text),
                "results": len(hits),
            },
        )
        return hits

    def delete_collection(self, document_id: str) -> None:
        """Remove the ChromaDB collection for *document_id*."""
        name = self._collection_name(document_id)
        try:
            self._chroma_client.delete_collection(name=name)
            logger.info(
                "Deleted collection",
                extra={
                    "agent": "embeddings",
                    "status": "success",
                    "document_id": document_id,
                },
            )
        except Exception:
            # Collection may not exist — that's fine
            logger.debug(
                "Collection not found for deletion",
                extra={
                    "agent": "embeddings",
                    "status": "skip",
                    "document_id": document_id,
                },
            )
