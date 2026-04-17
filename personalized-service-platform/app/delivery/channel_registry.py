"""DeliveryChannelRegistry — manages channel registration, lookup, and routing.

The registry is the central component for delivery channel management:
1. **Registers** channel instances by unique name.
2. **Looks up** channels by name or by channel type (e.g. "email", "chat").
3. **Provides a unified send** method that routes to the appropriate channel.
4. **Lists** registered channels and their capabilities.

Design principles:
- Channel agnosticism: the registry treats all channels uniformly through the
  :class:`DeliveryChannel` interface.
- Thread-safe mutations: registration/unregistration are synchronous and safe to
  call from any context.
- Fail-fast: sending to an unknown channel raises immediately rather than
  silently dropping messages.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.delivery.base import (
    ChannelInfo,
    DeliveryChannel,
    DeliveryResult,
    DeliveryStatus,
    RichContent,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ChannelNotFoundError(KeyError):
    """Raised when a channel lookup fails."""

    def __init__(self, name: str) -> None:
        self.channel_name = name
        super().__init__(f"No channel registered with name '{name}'")


class ChannelAlreadyRegisteredError(ValueError):
    """Raised when trying to register a channel with a name already in use."""

    def __init__(self, name: str) -> None:
        self.channel_name = name
        super().__init__(f"Channel '{name}' is already registered")


# ---------------------------------------------------------------------------
# Send result for multi-channel delivery
# ---------------------------------------------------------------------------


@dataclass
class MultiDeliveryResult:
    """Aggregated result from sending to multiple channels."""

    results: list[DeliveryResult] = field(default_factory=list)
    errors: list[DeliveryResult] = field(default_factory=list)

    @property
    def all_succeeded(self) -> bool:
        """True when every channel delivery succeeded (no errors)."""
        return len(self.errors) == 0 and len(self.results) > 0

    @property
    def total_sent(self) -> int:
        return len(self.results)

    @property
    def total_failed(self) -> int:
        return len(self.errors)

    def to_dict(self) -> dict[str, Any]:
        """Serializable summary."""
        return {
            "total_sent": self.total_sent,
            "total_failed": self.total_failed,
            "all_succeeded": self.all_succeeded,
            "results": [
                {
                    "channel": r.channel_name,
                    "status": r.status.value,
                    "message_id": r.message_id,
                    **r.raw,
                }
                for r in self.results
            ],
            "errors": [
                {
                    "channel": r.channel_name,
                    "status": r.status.value,
                    "error": r.error,
                }
                for r in self.errors
            ],
        }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class DeliveryChannelRegistry:
    """Central registry for delivery channel instances.

    Channels are registered under a unique *name* (e.g. ``"telegram"``,
    ``"email"``, ``"push"``).  The registry supports lookup by exact name
    or by *channel type* (from :attr:`ChannelInfo.channel_type`) which may
    return multiple channels of the same type.

    Example
    -------
    >>> registry = DeliveryChannelRegistry()
    >>> registry.register("chat", ChatChannel())
    >>> registry.register("email", EmailChannel())
    >>> result = await registry.send("chat", "user-1", "Hello!")
    """

    def __init__(self) -> None:
        self._channels: dict[str, DeliveryChannel] = {}
        # Index: channel_type → list of registered names
        self._type_index: dict[str, list[str]] = {}

    # -- Registration -------------------------------------------------------

    def register(
        self,
        name: str,
        channel: DeliveryChannel,
        *,
        replace: bool = False,
    ) -> None:
        """Register a channel instance under *name*.

        Parameters
        ----------
        name:
            Unique identifier for this channel (e.g. ``"telegram"``).
        channel:
            A concrete :class:`DeliveryChannel` instance.
        replace:
            If ``True``, silently replace an existing registration.
            If ``False`` (default), raises :class:`ChannelAlreadyRegisteredError`.
        """
        if not isinstance(channel, DeliveryChannel):
            raise TypeError(
                f"Expected a DeliveryChannel instance, got {type(channel).__name__}"
            )

        if name in self._channels and not replace:
            raise ChannelAlreadyRegisteredError(name)

        # If replacing, clean up old type index entry first
        if name in self._channels:
            self._remove_from_type_index(name)

        self._channels[name] = channel

        # Update type index
        channel_type = channel.get_channel_info().channel_type
        self._type_index.setdefault(channel_type, [])
        if name not in self._type_index[channel_type]:
            self._type_index[channel_type].append(name)

        logger.info(
            "Registered delivery channel '%s' (type=%s)", name, channel_type
        )

    def unregister(self, name: str) -> DeliveryChannel:
        """Remove and return the channel registered under *name*.

        Raises :class:`ChannelNotFoundError` if not found.
        """
        if name not in self._channels:
            raise ChannelNotFoundError(name)

        channel = self._channels.pop(name)
        self._remove_from_type_index(name)
        logger.info("Unregistered delivery channel '%s'", name)
        return channel

    # -- Lookup -------------------------------------------------------------

    def get(self, name: str) -> DeliveryChannel:
        """Return the channel registered under *name*.

        Raises :class:`ChannelNotFoundError` if not found.
        """
        try:
            return self._channels[name]
        except KeyError:
            raise ChannelNotFoundError(name) from None

    def get_or_none(self, name: str) -> DeliveryChannel | None:
        """Return the channel registered under *name*, or ``None``."""
        return self._channels.get(name)

    def get_by_type(self, channel_type: str) -> list[DeliveryChannel]:
        """Return all channels whose :attr:`ChannelInfo.channel_type` matches.

        Returns an empty list if no channels match.
        """
        names = self._type_index.get(channel_type, [])
        return [self._channels[n] for n in names if n in self._channels]

    def get_first_by_type(self, channel_type: str) -> DeliveryChannel | None:
        """Return the first channel matching *channel_type*, or ``None``."""
        channels = self.get_by_type(channel_type)
        return channels[0] if channels else None

    def has(self, name: str) -> bool:
        """Check whether a channel is registered under *name*."""
        return name in self._channels

    # -- Listing / introspection --------------------------------------------

    def list_names(self) -> list[str]:
        """Return sorted list of all registered channel names."""
        return sorted(self._channels.keys())

    def list_channel_types(self) -> list[str]:
        """Return sorted list of distinct channel types."""
        return sorted(self._type_index.keys())

    def list_channel_info(self) -> dict[str, ChannelInfo]:
        """Return a mapping of channel name → :class:`ChannelInfo`."""
        return {
            name: ch.get_channel_info()
            for name, ch in self._channels.items()
        }

    def summary(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of the registry state."""
        channels_info = []
        for name, ch in self._channels.items():
            info = ch.get_channel_info()
            channels_info.append({
                "name": name,
                "channel_type": info.channel_type,
                "supports_rich_content": info.supports_rich_content,
                "supports_buttons": info.supports_buttons,
                "supports_images": info.supports_images,
                "supports_files": info.supports_files,
                "max_message_length": info.max_message_length,
            })
        return {
            "total_channels": len(self._channels),
            "channel_types": self.list_channel_types(),
            "channels": channels_info,
        }

    @property
    def size(self) -> int:
        """Number of registered channels."""
        return len(self._channels)

    # -- Unified send -------------------------------------------------------

    async def send(
        self,
        channel_name: str,
        recipient_id: str,
        content: str | RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> DeliveryResult:
        """Send content through the named channel.

        Routes to :meth:`send_rich_content` or :meth:`send_message` based on
        the *content* type.

        Parameters
        ----------
        channel_name:
            Name of a registered channel.
        recipient_id:
            Platform-specific user/chat identifier.
        content:
            Either a plain ``str`` or a :class:`RichContent` instance.
        metadata:
            Optional transport-level overrides forwarded to the channel.

        Raises
        ------
        ChannelNotFoundError
            If *channel_name* is not registered.
        """
        channel = self.get(channel_name)

        if isinstance(content, RichContent):
            return await channel.send_rich_content(
                recipient_id, content, metadata=metadata
            )
        else:
            text = content if isinstance(content, str) else str(content)
            return await channel.send_message(
                recipient_id, text, metadata=metadata
            )

    async def send_to_multiple(
        self,
        channel_names: list[str],
        recipient_id: str,
        content: str | RichContent,
        *,
        metadata: dict[str, Any] | None = None,
        skip_unknown: bool = False,
    ) -> MultiDeliveryResult:
        """Send content through multiple channels for the same recipient.

        Parameters
        ----------
        channel_names:
            List of registered channel names to deliver through.
        recipient_id:
            Platform-specific user/chat identifier.
        content:
            Either a plain ``str`` or a :class:`RichContent` instance.
        metadata:
            Optional transport-level overrides forwarded to each channel.
        skip_unknown:
            If ``True``, silently skip channel names that are not registered.
            If ``False`` (default), raises :class:`ChannelNotFoundError`.

        Returns
        -------
        MultiDeliveryResult
            Aggregated results from all channel deliveries.
        """
        multi = MultiDeliveryResult()

        for name in channel_names:
            if not self.has(name):
                if skip_unknown:
                    logger.warning(
                        "Skipping unknown channel '%s' during multi-send", name
                    )
                    continue
                raise ChannelNotFoundError(name)

            try:
                result = await self.send(
                    name, recipient_id, content, metadata=metadata
                )
                if result.status == DeliveryStatus.FAILED:
                    multi.errors.append(result)
                else:
                    multi.results.append(result)
            except Exception as exc:
                logger.error(
                    "Failed to deliver via channel '%s': %s", name, exc
                )
                multi.errors.append(
                    DeliveryResult(
                        channel_name=name,
                        status=DeliveryStatus.FAILED,
                        error=str(exc),
                    )
                )

        return multi

    async def send_by_type(
        self,
        channel_type: str,
        recipient_id: str,
        content: str | RichContent,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> MultiDeliveryResult:
        """Send content through all channels of a given type.

        Parameters
        ----------
        channel_type:
            The channel type to target (e.g. ``"chat"``, ``"email"``).
        recipient_id:
            Platform-specific user/chat identifier.
        content:
            Either a plain ``str`` or a :class:`RichContent` instance.
        metadata:
            Optional transport-level overrides forwarded to each channel.
        """
        names = self._type_index.get(channel_type, [])
        return await self.send_to_multiple(
            names, recipient_id, content, metadata=metadata
        )

    # -- Internal helpers ---------------------------------------------------

    def _remove_from_type_index(self, name: str) -> None:
        """Remove *name* from the type index."""
        for channel_type, names in self._type_index.items():
            if name in names:
                names.remove(name)
                if not names:
                    del self._type_index[channel_type]
                break
