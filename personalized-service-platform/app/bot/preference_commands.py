"""Bot command handlers for reading and writing user preferences.

These handlers are **channel-agnostic** — they accept a
:class:`PreferencesRepository` and a response callback, so they work
identically whether invoked from Telegram, Slack, Discord, or any future
messenger integration.

Usage::

    from app.bot.preference_commands import PreferenceCommandHandler

    handler = PreferenceCommandHandler(repo)
    response_text = await handler.handle("/set_preference vocab.difficulty_level hard")

The handler parses slash-style commands from incoming message text and
returns a plain-text response suitable for any messenger channel.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.services.preferences_repository_protocol import (
    PreferencesRepository,
    PreferenceRecord,
)


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------

def _format_preference(rec: PreferenceRecord) -> str:
    """Format a single preference for display."""
    value = rec.preference_value
    if isinstance(value, (dict, list)):
        value_str = json.dumps(value, ensure_ascii=False)
    else:
        value_str = str(value)
    return f"  {rec.preference_key} = {value_str}"


def _format_preference_list(prefs: list[PreferenceRecord]) -> str:
    """Format a list of preferences as a readable block."""
    if not prefs:
        return "No preferences found."
    lines = [_format_preference(p) for p in prefs]
    return "\n".join(lines)


def _parse_json_value(raw: str) -> Any:
    """Try to parse *raw* as JSON; fall back to plain string."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw


# ---------------------------------------------------------------------------
# Command handler
# ---------------------------------------------------------------------------

# Recognised commands and their aliases
_COMMANDS: dict[str, str] = {
    "/get_preference": "get",
    "/get_pref": "get",
    "/set_preference": "set",
    "/set_pref": "set",
    "/delete_preference": "delete",
    "/delete_pref": "delete",
    "/preferences": "list",
    "/prefs": "list",
    "/set_preferences_bulk": "bulk",
    "/set_prefs_bulk": "bulk",
    "/help_preferences": "help",
    "/help_prefs": "help",
}


@dataclass
class CommandResult:
    """Structured result from a command handler invocation.

    Attributes
    ----------
    text:
        Human-readable response text to send back to the user.
    success:
        ``True`` if the command executed without errors.
    data:
        Optional machine-readable payload (e.g. for callback buttons).
    """

    text: str
    success: bool = True
    data: dict[str, Any] | None = None


class PreferenceCommandHandler:
    """Channel-agnostic bot command handler for user preferences.

    Parameters
    ----------
    repo:
        Any object satisfying :class:`PreferencesRepository`.
    """

    def __init__(self, repo: PreferencesRepository) -> None:
        self._repo = repo

    # -- Public entry point -------------------------------------------------

    async def handle(self, user_id: str, text: str) -> CommandResult:
        """Parse *text* as a bot command and execute it.

        Parameters
        ----------
        user_id:
            The platform user ID of the sender.
        text:
            The raw message text (e.g. ``"/set_preference vocab.level hard"``).

        Returns
        -------
        CommandResult
            Contains the response text, success flag, and optional data.
        """
        parts = text.strip().split()
        if not parts:
            return CommandResult(text="Empty command.", success=False)

        command_word = parts[0].lower()
        action = _COMMANDS.get(command_word)
        if action is None:
            return CommandResult(
                text=f"Unknown command: {command_word}\nType /help_preferences for available commands.",
                success=False,
            )

        args = parts[1:]

        dispatch = {
            "get": self._handle_get,
            "set": self._handle_set,
            "delete": self._handle_delete,
            "list": self._handle_list,
            "bulk": self._handle_bulk,
            "help": self._handle_help,
        }

        handler_fn = dispatch[action]
        return await handler_fn(user_id, args)

    # -- Individual command implementations ---------------------------------

    async def _handle_get(self, user_id: str, args: list[str]) -> CommandResult:
        if not args:
            return CommandResult(
                text="Usage: /get_preference <key>\nExample: /get_preference vocab.difficulty_level",
                success=False,
            )
        key = args[0]
        rec = await self._repo.get(user_id, key)
        if rec is None:
            return CommandResult(
                text=f"Preference '{key}' not found.",
                success=False,
            )
        return CommandResult(
            text=f"Preference:\n{_format_preference(rec)}",
            success=True,
            data={"preference_key": rec.preference_key, "preference_value": rec.preference_value},
        )

    async def _handle_set(self, user_id: str, args: list[str]) -> CommandResult:
        if len(args) < 2:
            return CommandResult(
                text='Usage: /set_preference <key> <value>\nExample: /set_preference vocab.difficulty_level "hard"',
                success=False,
            )
        key = args[0]
        raw_value = " ".join(args[1:])
        value = _parse_json_value(raw_value)

        rec = await self._repo.set(user_id, key, value)
        return CommandResult(
            text=f"Preference set:\n{_format_preference(rec)}",
            success=True,
            data={"preference_key": rec.preference_key, "preference_value": rec.preference_value},
        )

    async def _handle_delete(self, user_id: str, args: list[str]) -> CommandResult:
        if not args:
            return CommandResult(
                text="Usage: /delete_preference <key>\nExample: /delete_preference vocab.difficulty_level",
                success=False,
            )
        key = args[0]
        deleted = await self._repo.delete(user_id, key)
        if not deleted:
            return CommandResult(
                text=f"Preference '{key}' not found.",
                success=False,
            )
        return CommandResult(
            text=f"Deleted preference: {key}",
            success=True,
            data={"deleted": key},
        )

    async def _handle_list(self, user_id: str, args: list[str]) -> CommandResult:
        prefix = args[0] if args else None
        prefs = await self._repo.get_all(user_id, prefix=prefix)
        header = f"Preferences (prefix={prefix}):" if prefix else "All preferences:"
        body = _format_preference_list(prefs)
        return CommandResult(
            text=f"{header}\n{body}",
            success=True,
            data={"count": len(prefs), "prefix": prefix},
        )

    async def _handle_bulk(self, user_id: str, args: list[str]) -> CommandResult:
        if not args:
            return CommandResult(
                text='Usage: /set_preferences_bulk <json>\nExample: /set_preferences_bulk {"vocab.level": "hard", "vocab.daily_count": 10}',
                success=False,
            )
        raw = " ".join(args)
        try:
            prefs_dict = json.loads(raw)
        except json.JSONDecodeError:
            return CommandResult(
                text="Invalid JSON. Provide preferences as a JSON object.",
                success=False,
            )
        if not isinstance(prefs_dict, dict):
            return CommandResult(
                text="Expected a JSON object mapping keys to values.",
                success=False,
            )

        records = await self._repo.set_bulk(user_id, prefs_dict)
        body = _format_preference_list(records)
        return CommandResult(
            text=f"Set {len(records)} preference(s):\n{body}",
            success=True,
            data={"count": len(records)},
        )

    async def _handle_help(self, _user_id: str, _args: list[str]) -> CommandResult:
        help_text = (
            "Preference commands:\n"
            "  /preferences [prefix]        — List your preferences\n"
            "  /get_preference <key>        — Get a single preference\n"
            "  /set_preference <key> <val>  — Set a preference\n"
            "  /delete_preference <key>     — Delete a preference\n"
            "  /set_preferences_bulk <json> — Set multiple at once\n"
            "  /help_preferences            — Show this help\n"
            "\n"
            "Keys use dot-notation (e.g. vocab.difficulty_level).\n"
            "Values can be strings, numbers, JSON arrays, or objects."
        )
        return CommandResult(text=help_text, success=True)

    # -- Utility: check if text is a preference command ---------------------

    @staticmethod
    def is_preference_command(text: str) -> bool:
        """Return ``True`` if *text* starts with a recognised preference command."""
        if not text:
            return False
        word = text.strip().split()[0].lower()
        return word in _COMMANDS
