"""Multi-turn conversation memory for RAG chat sessions.

Stores per-document conversation history in memory so follow-up
questions can reference prior context.
"""

from __future__ import annotations

from logging_config import get_logger

logger = get_logger("rag.conversation")


class ConversationMemory:
    """In-memory, per-document conversation history."""

    MAX_DOCUMENTS = 100  # max conversations kept in memory
    MAX_MESSAGES_PER_DOC = 50  # max messages stored per document

    def __init__(self) -> None:
        self._histories: dict[str, list[dict]] = {}

    def add_message(self, document_id: str, role: str, content: str) -> None:
        """Append a message to the conversation for *document_id*.

        Parameters
        ----------
        document_id:
            The document this conversation is about.
        role:
            ``"user"`` or ``"assistant"``.
        content:
            The message text.
        """
        if role not in ("user", "assistant"):
            logger.warning(
                "Invalid conversation role — ignoring message",
                extra={"agent": "conversation", "status": "skip"},
            )
            return

        if document_id not in self._histories:
            # Evict oldest conversation if at capacity
            if len(self._histories) >= self.MAX_DOCUMENTS:
                oldest_key = next(iter(self._histories))
                del self._histories[oldest_key]
            self._histories[document_id] = []

        self._histories[document_id].append({"role": role, "content": content})

        # Trim per-document history if over limit
        if len(self._histories[document_id]) > self.MAX_MESSAGES_PER_DOC:
            self._histories[document_id] = self._histories[document_id][-self.MAX_MESSAGES_PER_DOC:]

        logger.debug(
            "Message added to conversation",
            extra={
                "agent": "conversation",
                "status": "success",
                "document_id": document_id,
                "role": role,
                "turn_count": len(self._histories[document_id]),
            },
        )

    def get_history(
        self,
        document_id: str,
        max_turns: int = 10,
    ) -> list[dict]:
        """Return the last *max_turns* messages for *document_id*.

        Parameters
        ----------
        document_id:
            The document whose history to retrieve.
        max_turns:
            Maximum number of messages to return (most recent).

        Returns
        -------
        list[dict]
            Each dict has ``role`` and ``content`` keys.
        """
        history = self._histories.get(document_id, [])
        if not history:
            return []
        return history[-max_turns:]

    def clear(self, document_id: str) -> None:
        """Wipe conversation history for *document_id*."""
        if document_id in self._histories:
            del self._histories[document_id]
            logger.info(
                "Conversation history cleared",
                extra={
                    "agent": "conversation",
                    "status": "success",
                    "document_id": document_id,
                },
            )
