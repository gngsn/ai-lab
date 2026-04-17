"""Tests for the message receiving pipeline.

Covers:
- InboundMessage / MessageSource model creation
- MessagePipeline normalization (WebhookPayload → InboundMessage)
- Handler registration and priority ordering
- Message routing through the handler chain
- Full pipeline integration (normalize + process)
- Webhook endpoint integration with pipeline
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock

from app.delivery.messenger import WebhookEvent, WebhookPayload
from app.messaging.models import (
    InboundMessage,
    MessageResponse,
    MessageSource,
    MessageType,
)
from app.messaging.handler import MessageHandler
from app.messaging.pipeline import MessagePipeline, _extract_command
from app.messaging.handlers.command_handler import CommandHandler
from app.messaging.handlers.echo_handler import EchoFallbackHandler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class StubHandler(MessageHandler):
    """Configurable stub handler for testing."""

    def __init__(
        self,
        name: str = "stub",
        priority: int = 100,
        can: bool = True,
        response: MessageResponse | None = None,
        types: set[MessageType] | None = None,
    ):
        self._name = name
        self._priority = priority
        self._can = can
        self._response = response or MessageResponse(text="stub response", handled=True)
        self._types = types or set()

    @property
    def name(self) -> str:
        return self._name

    @property
    def priority(self) -> int:
        return self._priority

    @property
    def supported_types(self) -> set[MessageType]:
        return self._types

    async def can_handle(self, message: InboundMessage) -> bool:
        return self._can

    async def handle(self, message: InboundMessage) -> MessageResponse:
        return self._response


def _make_webhook_payload(
    event_type: WebhookEvent = WebhookEvent.MESSAGE,
    text: str = "hello",
    sender_id: str = "42",
    chat_id: str = "42",
    **kwargs,
) -> WebhookPayload:
    return WebhookPayload(
        event_type=event_type,
        sender_id=sender_id,
        chat_id=chat_id,
        text=text,
        **kwargs,
    )


def _make_inbound(
    text: str = "hello",
    message_type: MessageType = MessageType.TEXT,
    platform: str = "telegram",
    sender_id: str = "42",
    chat_id: str = "42",
    command: str | None = None,
    command_args: list[str] | None = None,
    callback_data: str | None = None,
) -> InboundMessage:
    return InboundMessage(
        source=MessageSource(platform=platform, sender_id=sender_id, chat_id=chat_id),
        message_type=message_type,
        text=text,
        command=command,
        command_args=command_args or [],
        callback_data=callback_data,
    )


# ===========================================================================
# Model tests
# ===========================================================================


class TestMessageModels:
    def test_message_source(self):
        src = MessageSource(platform="telegram", sender_id="123", chat_id="456")
        assert src.platform == "telegram"
        assert src.sender_id == "123"
        assert src.chat_id == "456"

    def test_inbound_message_properties(self):
        msg = _make_inbound(message_type=MessageType.COMMAND, command="help")
        assert msg.is_command is True
        assert msg.is_text is False
        assert msg.is_callback is False

    def test_inbound_text_message(self):
        msg = _make_inbound(text="hello world")
        assert msg.is_text is True
        assert msg.is_command is False

    def test_inbound_callback(self):
        msg = _make_inbound(
            message_type=MessageType.CALLBACK,
            callback_data="btn_quiz",
        )
        assert msg.is_callback is True

    def test_full_command_text(self):
        msg = _make_inbound(
            message_type=MessageType.COMMAND,
            command="set_pref",
            command_args=["key", "value"],
        )
        assert msg.full_command_text == "/set_pref key value"

    def test_full_command_text_no_command(self):
        msg = _make_inbound()
        assert msg.full_command_text == ""

    def test_message_response_error(self):
        resp = MessageResponse(error="something broke")
        assert resp.is_error is True

    def test_message_response_ok(self):
        resp = MessageResponse(text="ok")
        assert resp.is_error is False


# ===========================================================================
# Command extraction
# ===========================================================================


class TestExtractCommand:
    def test_simple_command(self):
        cmd, args = _extract_command("/start")
        assert cmd == "start"
        assert args == []

    def test_command_with_args(self):
        cmd, args = _extract_command("/set_pref key value")
        assert cmd == "set_pref"
        assert args == ["key", "value"]

    def test_command_with_bot_mention(self):
        cmd, args = _extract_command("/start@mybot")
        assert cmd == "start"
        assert args == []

    def test_non_command(self):
        cmd, args = _extract_command("hello world")
        assert cmd is None
        assert args == []

    def test_empty_string(self):
        cmd, args = _extract_command("")
        assert cmd is None
        assert args == []


# ===========================================================================
# Pipeline normalization
# ===========================================================================


class TestPipelineNormalize:
    def test_normalize_text_message(self):
        payload = _make_webhook_payload(text="hello")
        msg = MessagePipeline.normalize(payload, platform="telegram")

        assert msg.source.platform == "telegram"
        assert msg.source.sender_id == "42"
        assert msg.source.chat_id == "42"
        assert msg.message_type == MessageType.TEXT
        assert msg.text == "hello"
        assert msg.command is None

    def test_normalize_command(self):
        payload = _make_webhook_payload(
            event_type=WebhookEvent.COMMAND,
            text="/help arg1",
        )
        msg = MessagePipeline.normalize(payload, platform="telegram")

        assert msg.message_type == MessageType.COMMAND
        assert msg.command == "help"
        assert msg.command_args == ["arg1"]

    def test_normalize_command_with_bot_mention(self):
        payload = _make_webhook_payload(
            event_type=WebhookEvent.COMMAND,
            text="/start@vocabbot",
        )
        msg = MessagePipeline.normalize(payload, platform="telegram")
        assert msg.command == "start"

    def test_normalize_callback(self):
        payload = _make_webhook_payload(
            event_type=WebhookEvent.CALLBACK,
            text="",
            callback_data="quiz_answer_1",
        )
        msg = MessagePipeline.normalize(payload, platform="telegram")

        assert msg.message_type == MessageType.CALLBACK
        assert msg.callback_data == "quiz_answer_1"

    def test_normalize_member_join(self):
        payload = _make_webhook_payload(event_type=WebhookEvent.MEMBER_JOIN, text="")
        msg = MessagePipeline.normalize(payload, platform="slack")

        assert msg.source.platform == "slack"
        assert msg.message_type == MessageType.EVENT

    def test_normalize_preserves_raw(self):
        raw = {"update_id": 999, "message": {"text": "hi"}}
        payload = _make_webhook_payload(raw=raw)
        msg = MessagePipeline.normalize(payload, platform="telegram")
        assert msg.raw == raw


# ===========================================================================
# Handler registration and ordering
# ===========================================================================


class TestHandlerRegistration:
    def test_register_handler(self):
        pipeline = MessagePipeline()
        handler = StubHandler(name="test")
        pipeline.register_handler(handler)

        handlers = pipeline.list_handlers()
        assert len(handlers) == 1
        assert handlers[0]["name"] == "test"

    def test_handlers_sorted_by_priority(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(StubHandler(name="low", priority=999))
        pipeline.register_handler(StubHandler(name="high", priority=1))
        pipeline.register_handler(StubHandler(name="mid", priority=50))

        handlers = pipeline.list_handlers()
        assert [h["name"] for h in handlers] == ["high", "mid", "low"]

    def test_unregister_handler(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(StubHandler(name="to_remove"))
        assert pipeline.unregister_handler("to_remove") is True
        assert pipeline.list_handlers() == []

    def test_unregister_nonexistent(self):
        pipeline = MessagePipeline()
        assert pipeline.unregister_handler("nope") is False


# ===========================================================================
# Message processing
# ===========================================================================


class TestMessageProcessing:
    @pytest.mark.asyncio
    async def test_process_routes_to_matching_handler(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(
            StubHandler(name="matcher", response=MessageResponse(text="matched!", handled=True))
        )

        msg = _make_inbound(text="hello")
        resp = await pipeline.process(msg)

        assert resp.handled is True
        assert resp.text == "matched!"

    @pytest.mark.asyncio
    async def test_process_skips_non_matching(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(
            StubHandler(name="skip", can=False, priority=1)
        )
        pipeline.register_handler(
            StubHandler(
                name="catch",
                can=True,
                priority=2,
                response=MessageResponse(text="caught", handled=True),
            )
        )

        msg = _make_inbound()
        resp = await pipeline.process(msg)
        assert resp.text == "caught"

    @pytest.mark.asyncio
    async def test_process_skips_wrong_type(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(
            StubHandler(
                name="cmd_only",
                types={MessageType.COMMAND},
                response=MessageResponse(text="cmd", handled=True),
            )
        )
        pipeline.register_handler(
            StubHandler(
                name="text_handler",
                types={MessageType.TEXT},
                response=MessageResponse(text="text", handled=True),
            )
        )

        msg = _make_inbound(message_type=MessageType.TEXT)
        resp = await pipeline.process(msg)
        assert resp.text == "text"

    @pytest.mark.asyncio
    async def test_process_handler_not_handled_continues(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(
            StubHandler(
                name="first",
                priority=1,
                response=MessageResponse(text="pass", handled=False),
            )
        )
        pipeline.register_handler(
            StubHandler(
                name="second",
                priority=2,
                response=MessageResponse(text="final", handled=True),
            )
        )

        msg = _make_inbound()
        resp = await pipeline.process(msg)
        assert resp.text == "final"

    @pytest.mark.asyncio
    async def test_process_no_handler_returns_default(self):
        pipeline = MessagePipeline()
        msg = _make_inbound()
        resp = await pipeline.process(msg)

        assert resp.handled is False
        assert "not sure" in resp.text.lower() or "help" in resp.text.lower()

    @pytest.mark.asyncio
    async def test_process_handler_exception_continues(self):
        """A handler that raises should not crash the pipeline."""

        class CrashingHandler(MessageHandler):
            @property
            def name(self) -> str:
                return "crasher"

            @property
            def priority(self) -> int:
                return 1

            async def can_handle(self, message):
                return True

            async def handle(self, message):
                raise RuntimeError("boom")

        pipeline = MessagePipeline()
        pipeline.register_handler(CrashingHandler())
        pipeline.register_handler(
            StubHandler(name="safe", priority=2, response=MessageResponse(text="ok", handled=True))
        )

        msg = _make_inbound()
        resp = await pipeline.process(msg)
        assert resp.text == "ok"

    @pytest.mark.asyncio
    async def test_process_can_handle_exception_continues(self):
        """A handler whose can_handle() raises should be skipped."""

        class BadCanHandle(MessageHandler):
            @property
            def name(self):
                return "bad_can"

            async def can_handle(self, message):
                raise ValueError("oops")

            async def handle(self, message):
                return MessageResponse(text="should not reach")

        pipeline = MessagePipeline()
        pipeline.register_handler(BadCanHandle())
        pipeline.register_handler(
            StubHandler(name="fallback", priority=200, response=MessageResponse(text="fell through", handled=True))
        )

        msg = _make_inbound()
        resp = await pipeline.process(msg)
        assert resp.text == "fell through"


# ===========================================================================
# Full pipeline (normalize + process)
# ===========================================================================


class TestHandleWebhook:
    @pytest.mark.asyncio
    async def test_handle_webhook_end_to_end(self):
        pipeline = MessagePipeline()
        pipeline.register_handler(
            StubHandler(
                name="greeter",
                response=MessageResponse(text="hi there!", handled=True),
            )
        )

        payload = _make_webhook_payload(text="hello")
        inbound, response = await pipeline.handle_webhook(payload, platform="telegram")

        assert inbound.source.platform == "telegram"
        assert inbound.text == "hello"
        assert response.text == "hi there!"
        assert response.handled is True


# ===========================================================================
# Built-in handlers
# ===========================================================================


class TestCommandHandler:
    @pytest.mark.asyncio
    async def test_start_command(self):
        handler = CommandHandler()
        msg = _make_inbound(
            message_type=MessageType.COMMAND,
            text="/start",
            command="start",
        )
        assert await handler.can_handle(msg) is True
        resp = await handler.handle(msg)
        assert resp.handled is True
        assert "welcome" in resp.text.lower()

    @pytest.mark.asyncio
    async def test_help_command(self):
        handler = CommandHandler()
        msg = _make_inbound(
            message_type=MessageType.COMMAND,
            text="/help",
            command="help",
        )
        assert await handler.can_handle(msg) is True
        resp = await handler.handle(msg)
        assert resp.handled is True
        assert "/start" in resp.text
        assert "/help" in resp.text

    @pytest.mark.asyncio
    async def test_unknown_command_not_handled(self):
        handler = CommandHandler()
        msg = _make_inbound(
            message_type=MessageType.COMMAND,
            text="/unknown_xyz",
            command="unknown_xyz",
        )
        assert await handler.can_handle(msg) is False

    @pytest.mark.asyncio
    async def test_custom_command(self):
        handler = CommandHandler()

        async def quiz_handler(msg: InboundMessage) -> MessageResponse:
            return MessageResponse(text="Quiz time!", handled=True)

        handler.register_command("quiz", quiz_handler)

        msg = _make_inbound(
            message_type=MessageType.COMMAND,
            text="/quiz",
            command="quiz",
        )
        assert await handler.can_handle(msg) is True
        resp = await handler.handle(msg)
        assert resp.text == "Quiz time!"

    @pytest.mark.asyncio
    async def test_text_message_not_handled(self):
        handler = CommandHandler()
        msg = _make_inbound(text="just text")
        assert await handler.can_handle(msg) is False


class TestEchoFallbackHandler:
    @pytest.mark.asyncio
    async def test_echoes_text(self):
        handler = EchoFallbackHandler()
        msg = _make_inbound(text="what is this?")
        assert await handler.can_handle(msg) is True
        resp = await handler.handle(msg)
        assert resp.handled is True
        assert "what is this?" in resp.text

    @pytest.mark.asyncio
    async def test_ignores_empty_text(self):
        handler = EchoFallbackHandler()
        msg = _make_inbound(text="   ")
        assert await handler.can_handle(msg) is False

    @pytest.mark.asyncio
    async def test_ignores_commands(self):
        handler = EchoFallbackHandler()
        msg = _make_inbound(message_type=MessageType.COMMAND, text="/start", command="start")
        # supported_types is TEXT only, so the pipeline would skip this
        assert handler.supported_types == {MessageType.TEXT}


# ===========================================================================
# Integration: Pipeline with built-in handlers
# ===========================================================================


class TestPipelineIntegration:
    @pytest.mark.asyncio
    async def test_command_then_fallback(self):
        """Commands go to CommandHandler; text goes to EchoFallback."""
        pipeline = MessagePipeline()
        pipeline.register_handler(CommandHandler())
        pipeline.register_handler(EchoFallbackHandler())

        # Command
        cmd_payload = _make_webhook_payload(
            event_type=WebhookEvent.COMMAND, text="/start"
        )
        inbound, resp = await pipeline.handle_webhook(cmd_payload, platform="telegram")
        assert resp.handled is True
        assert "welcome" in resp.text.lower()

        # Text
        txt_payload = _make_webhook_payload(text="random message")
        inbound, resp = await pipeline.handle_webhook(txt_payload, platform="telegram")
        assert resp.handled is True
        assert "random message" in resp.text

    @pytest.mark.asyncio
    async def test_unknown_command_falls_to_echo(self):
        """An unknown command: CommandHandler skips it, then no TEXT handler picks it either."""
        pipeline = MessagePipeline()
        pipeline.register_handler(CommandHandler())
        pipeline.register_handler(EchoFallbackHandler())

        payload = _make_webhook_payload(
            event_type=WebhookEvent.COMMAND, text="/nonexistent_cmd"
        )
        # Command type → CommandHandler can't handle, EchoFallback only handles TEXT
        inbound, resp = await pipeline.handle_webhook(payload, platform="telegram")
        # Neither handler claims it → default unhandled response
        assert resp.handled is False

    @pytest.mark.asyncio
    async def test_callback_no_handler(self):
        """Callbacks without a handler get default response."""
        pipeline = MessagePipeline()
        pipeline.register_handler(CommandHandler())
        pipeline.register_handler(EchoFallbackHandler())

        payload = _make_webhook_payload(
            event_type=WebhookEvent.CALLBACK,
            text="",
            callback_data="btn_1",
        )
        inbound, resp = await pipeline.handle_webhook(payload, platform="telegram")
        assert resp.handled is False
