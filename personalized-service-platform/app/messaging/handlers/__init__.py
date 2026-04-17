"""Built-in message handlers for the messaging pipeline."""

from app.messaging.handlers.command_handler import CommandHandler
from app.messaging.handlers.echo_handler import EchoFallbackHandler
from app.messaging.handlers.plugin_dispatcher import (
    NullConfigProvider,
    PluginDispatcherHandler,
    UserConfigProvider,
)

__all__ = [
    "CommandHandler",
    "EchoFallbackHandler",
    "NullConfigProvider",
    "PluginDispatcherHandler",
    "UserConfigProvider",
]
