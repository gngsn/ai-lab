"""Command handler — routes bot commands (e.g. /start, /help, /preferences).

Bridges the existing :class:`PreferenceCommandHandler` with the new
:class:`MessageHandler` interface.  Also handles built-in commands like
``/start`` and ``/help``.
"""

from __future__ import annotations

from typing import Any, Callable, Awaitable

from app.bot.preference_commands import PreferenceCommandHandler
from app.messaging.handler import MessageHandler
from app.messaging.models import InboundMessage, MessageResponse, MessageType


class CommandHandler(MessageHandler):
    """Routes slash-commands to the appropriate sub-handler.

    Parameters
    ----------
    preference_handler:
        Optional :class:`PreferenceCommandHandler` for preference commands.
    """

    def __init__(
        self,
        preference_handler: PreferenceCommandHandler | None = None,
    ) -> None:
        self._preference_handler = preference_handler
        self._custom_commands: dict[
            str, Callable[[InboundMessage], Awaitable[MessageResponse]]
        ] = {}

    @property
    def name(self) -> str:
        return "command_handler"

    @property
    def priority(self) -> int:
        return 10  # commands take highest priority

    @property
    def supported_types(self) -> set[MessageType]:
        return {MessageType.COMMAND}

    def register_command(
        self,
        command: str,
        handler: Callable[[InboundMessage], Awaitable[MessageResponse]],
    ) -> None:
        """Register a custom command handler.

        Parameters
        ----------
        command:
            Command name without the leading slash (e.g. ``"quiz"``).
        handler:
            Async callable that takes an ``InboundMessage`` and returns a ``MessageResponse``.
        """
        self._custom_commands[command.lower()] = handler

    async def can_handle(self, message: InboundMessage) -> bool:
        if not message.is_command or not message.command:
            return False
        # Built-in commands
        if message.command.lower() in ("start", "help"):
            return True
        # Custom registered commands
        if message.command.lower() in self._custom_commands:
            return True
        # Preference commands (they use the full text with /)
        if self._preference_handler and PreferenceCommandHandler.is_preference_command(
            message.full_command_text
        ):
            return True
        return False

    async def handle(self, message: InboundMessage) -> MessageResponse:
        cmd = message.command.lower() if message.command else ""

        # Built-in /start
        if cmd == "start":
            return MessageResponse(
                text=(
                    "👋 Welcome! I'm your personalized service assistant.\n\n"
                    "Available commands:\n"
                    "  /help — Show available commands\n"
                    "  /preferences — View your preferences\n"
                    "  /help_preferences — Preference management help\n"
                ),
                handled=True,
            )

        # Built-in /help
        if cmd == "help":
            lines = [
                "Available commands:",
                "  /start — Welcome message",
                "  /help — Show this help",
                "  /preferences — View your preferences",
                "  /help_preferences — Preference management help",
            ]
            if self._custom_commands:
                lines.append("\nPlugin commands:")
                for name in sorted(self._custom_commands):
                    lines.append(f"  /{name}")
            return MessageResponse(text="\n".join(lines), handled=True)

        # Custom commands
        if cmd in self._custom_commands:
            return await self._custom_commands[cmd](message)

        # Preference commands — delegate to the existing handler
        if self._preference_handler:
            result = await self._preference_handler.handle(
                message.source.sender_id,
                message.full_command_text,
            )
            return MessageResponse(
                text=result.text,
                handled=True,
                metadata={"data": result.data} if result.data else {},
            )

        return MessageResponse(handled=False)
