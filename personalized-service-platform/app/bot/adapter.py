"""Base BotAdapter — abstract interface for messenger bot adapters.

Provides connection lifecycle management (connect, disconnect, webhook
registration) on top of :class:`MessengerBotChannel`.  Concrete adapters
(Telegram, Slack, Discord, …) subclass this and implement the platform-
specific API calls.

Connection state is tracked so the platform can introspect which bots are
active without making external API calls.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.delivery.messenger import MessengerBotChannel


# ---------------------------------------------------------------------------
# Connection state
# ---------------------------------------------------------------------------

class ConnectionState(str, Enum):
    """Lifecycle state of a bot adapter."""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    ERROR = "error"


@dataclass
class ConnectionInfo:
    """Snapshot of a bot adapter's connection status."""
    state: ConnectionState = ConnectionState.DISCONNECTED
    bot_id: str | None = None
    bot_username: str | None = None
    webhook_url: str | None = None
    webhook_active: bool = False
    last_error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_connected(self) -> bool:
        return self.state == ConnectionState.CONNECTED

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "bot_id": self.bot_id,
            "bot_username": self.bot_username,
            "webhook_url": self.webhook_url,
            "webhook_active": self.webhook_active,
            "last_error": self.last_error,
            **self.extra,
        }


# ---------------------------------------------------------------------------
# Abstract BotAdapter
# ---------------------------------------------------------------------------

class BotAdapter(MessengerBotChannel):
    """Abstract bot adapter with connection lifecycle management.

    Subclasses must implement:

    * All :class:`MessengerBotChannel` / :class:`DeliveryChannel` methods.
    * :meth:`connect` — authenticate with the platform, verify the token.
    * :meth:`disconnect` — clean up resources, remove webhook.
    * :meth:`register_webhook` — set the webhook URL on the platform.
    * :meth:`unregister_webhook` — remove the webhook URL.
    * :meth:`get_connection_info` — return a :class:`ConnectionInfo` snapshot.

    The adapter tracks its own :attr:`_connection` state internally.
    """

    def __init__(self) -> None:
        self._connection = ConnectionInfo()

    # -- Connection lifecycle ------------------------------------------------

    @abstractmethod
    async def connect(self) -> ConnectionInfo:
        """Authenticate with the platform and verify the bot token.

        Should set :attr:`_connection.state` to ``CONNECTED`` on success
        or ``ERROR`` on failure.

        Returns
        -------
        ConnectionInfo
            Updated connection state after the connect attempt.
        """
        ...

    @abstractmethod
    async def disconnect(self) -> ConnectionInfo:
        """Gracefully disconnect from the platform.

        Should clean up any resources (e.g. remove the webhook) and set
        :attr:`_connection.state` to ``DISCONNECTED``.

        Returns
        -------
        ConnectionInfo
            Updated connection state after disconnecting.
        """
        ...

    @abstractmethod
    async def register_webhook(self, webhook_url: str) -> bool:
        """Register (or update) the webhook URL on the platform.

        Parameters
        ----------
        webhook_url:
            The publicly-reachable URL that the platform should POST events to.

        Returns
        -------
        bool
            ``True`` if the webhook was registered successfully.
        """
        ...

    @abstractmethod
    async def unregister_webhook(self) -> bool:
        """Remove the webhook URL from the platform.

        Returns
        -------
        bool
            ``True`` if the webhook was removed successfully.
        """
        ...

    # -- Introspection ------------------------------------------------------

    def get_connection_info(self) -> ConnectionInfo:
        """Return a snapshot of the current connection state."""
        return self._connection

    @property
    def is_connected(self) -> bool:
        """Convenience: ``True`` when the adapter is connected and ready."""
        return self._connection.is_connected
