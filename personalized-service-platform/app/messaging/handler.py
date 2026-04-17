"""Message handler interface.

Handlers are registered with the :class:`MessagePipeline` and are tried in
priority order.  Each handler declares which message types it can handle and
a priority (lower = tried first).

The pipeline calls :meth:`can_handle` first — if it returns ``True``, the
handler's :meth:`handle` method is invoked.  If the response has
``handled=True``, the pipeline stops; otherwise it continues to the next
handler.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.messaging.models import InboundMessage, MessageResponse, MessageType


class MessageHandler(ABC):
    """Abstract interface for message handlers.

    Subclasses implement domain-specific logic (preference commands,
    plugin routing, onboarding flows, etc.) while staying completely
    decoupled from any specific messenger platform.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable handler name (for logging / debugging)."""
        ...

    @property
    def priority(self) -> int:
        """Handler priority — lower values are tried first.

        Default is 100. Use lower values for command handlers that should
        take precedence (e.g. 10 for /help), and higher values for
        catch-all / fallback handlers (e.g. 999).
        """
        return 100

    @property
    def supported_types(self) -> set[MessageType]:
        """Message types this handler can process.

        Return an empty set to indicate the handler accepts all types.
        """
        return set()

    @abstractmethod
    async def can_handle(self, message: InboundMessage) -> bool:
        """Quick check whether this handler wants to process *message*.

        Called before :meth:`handle`. Should be fast (no I/O) and is used
        to short-circuit the handler chain.
        """
        ...

    @abstractmethod
    async def handle(self, message: InboundMessage) -> MessageResponse:
        """Process the message and return a response.

        This is only called if :meth:`can_handle` returned ``True``.
        Return a :class:`MessageResponse` with ``handled=True`` to stop
        the pipeline, or ``handled=False`` to let the next handler try.
        """
        ...
