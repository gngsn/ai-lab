"""Tests for the Feature & Channel Registry.

Validates:
- Feature and channel registration / unregistration
- Building descriptors from plugin manifests and channel info
- Listing and querying features and channels
- Validation of user selections (features, channels, feature settings)
- Validation of feature settings against config schemas
- Integration with API endpoints
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.feature_channel_registry import (
    ChannelDescriptor,
    FeatureChannelRegistry,
    FeatureConfigOption,
    FeatureDescriptor,
    ValidationResult,
    get_feature_channel_registry,
    reset_feature_channel_registry,
    set_feature_channel_registry,
)
from app.main import app
from app.models.database import get_db
from app.models.schemas import Base


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def registry() -> FeatureChannelRegistry:
    """Fresh registry for unit tests."""
    return FeatureChannelRegistry()


@pytest.fixture
def vocab_feature() -> FeatureDescriptor:
    """Sample vocab learning feature descriptor."""
    return FeatureDescriptor(
        name="vocab_learning",
        display_name="Vocabulary Learning",
        description="Learn new words daily",
        capabilities=["vocab", "quiz", "flashcard", "daily_word"],
        config_options=[
            FeatureConfigOption(
                key="difficulty_level",
                label="Difficulty Level",
                type="select",
                default="medium",
                choices=["easy", "medium", "hard"],
            ),
            FeatureConfigOption(
                key="words_per_day",
                label="Words Per Day",
                type="integer",
                default=5,
            ),
            FeatureConfigOption(
                key="include_examples",
                label="Include Examples",
                type="boolean",
                default=True,
            ),
            FeatureConfigOption(
                key="content_categories",
                label="Content Categories",
                type="multi_select",
                default=["words", "phrases"],
                choices=["words", "phrases", "idioms", "collocations"],
            ),
        ],
        version="0.1.0",
    )


@pytest.fixture
def telegram_channel() -> ChannelDescriptor:
    return ChannelDescriptor(
        name="telegram",
        channel_type="chat",
        supports_rich_content=True,
        supports_buttons=True,
        supports_images=True,
        max_message_length=4096,
    )


@pytest.fixture
def email_channel() -> ChannelDescriptor:
    return ChannelDescriptor(
        name="email",
        channel_type="email",
        supports_rich_content=True,
        supports_files=True,
    )


# ---------------------------------------------------------------------------
# Unit tests — Feature registration
# ---------------------------------------------------------------------------


class TestFeatureRegistration:
    def test_register_feature(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        assert registry.has_feature("vocab_learning")
        assert registry.feature_count == 1

    def test_get_feature(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        f = registry.get_feature("vocab_learning")
        assert f is not None
        assert f.name == "vocab_learning"
        assert f.display_name == "Vocabulary Learning"
        assert len(f.config_options) == 4

    def test_get_nonexistent_feature(self, registry):
        assert registry.get_feature("nope") is None

    def test_list_features(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        registry.register_feature(FeatureDescriptor(name="another_feature"))
        features = registry.list_features()
        assert len(features) == 2
        # Sorted by name
        assert features[0].name == "another_feature"
        assert features[1].name == "vocab_learning"

    def test_list_feature_names(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        assert registry.list_feature_names() == ["vocab_learning"]

    def test_unregister_feature(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        removed = registry.unregister_feature("vocab_learning")
        assert removed is not None
        assert removed.name == "vocab_learning"
        assert not registry.has_feature("vocab_learning")
        assert registry.feature_count == 0

    def test_unregister_nonexistent(self, registry):
        assert registry.unregister_feature("nope") is None

    def test_replace_feature(self, registry, vocab_feature):
        """Re-registering same name replaces the descriptor."""
        registry.register_feature(vocab_feature)
        updated = FeatureDescriptor(name="vocab_learning", display_name="Updated")
        registry.register_feature(updated)
        f = registry.get_feature("vocab_learning")
        assert f.display_name == "Updated"
        assert registry.feature_count == 1


# ---------------------------------------------------------------------------
# Unit tests — Channel registration
# ---------------------------------------------------------------------------


class TestChannelRegistration:
    def test_register_channel(self, registry, telegram_channel):
        registry.register_channel(telegram_channel)
        assert registry.has_channel("telegram")
        assert registry.channel_count == 1

    def test_get_channel(self, registry, telegram_channel):
        registry.register_channel(telegram_channel)
        c = registry.get_channel("telegram")
        assert c is not None
        assert c.channel_type == "chat"
        assert c.supports_buttons is True

    def test_list_channels(self, registry, telegram_channel, email_channel):
        registry.register_channel(telegram_channel)
        registry.register_channel(email_channel)
        channels = registry.list_channels()
        assert len(channels) == 2
        assert channels[0].name == "email"  # sorted
        assert channels[1].name == "telegram"

    def test_unregister_channel(self, registry, telegram_channel):
        registry.register_channel(telegram_channel)
        removed = registry.unregister_channel("telegram")
        assert removed is not None
        assert not registry.has_channel("telegram")


# ---------------------------------------------------------------------------
# Unit tests — From plugin manifest
# ---------------------------------------------------------------------------


class TestFromPluginManifest:
    def test_register_from_manifest(self, registry):
        from app.plugins.vocab_learning import VOCAB_LEARNING_MANIFEST

        descriptor = registry.register_feature_from_plugin_manifest(
            VOCAB_LEARNING_MANIFEST
        )
        assert descriptor.name == "vocab_learning"
        assert descriptor.display_name == "Vocabulary Learning"
        assert len(descriptor.config_options) == 9  # All config options from manifest
        assert descriptor.version == "0.1.0"
        assert "vocab" in descriptor.capabilities
        assert registry.has_feature("vocab_learning")

    def test_config_options_match_manifest(self, registry):
        from app.plugins.vocab_learning import VOCAB_LEARNING_MANIFEST

        descriptor = registry.register_feature_from_plugin_manifest(
            VOCAB_LEARNING_MANIFEST
        )
        opt_map = {o.key: o for o in descriptor.config_options}
        assert "difficulty_level" in opt_map
        assert opt_map["difficulty_level"].type == "select"
        assert opt_map["difficulty_level"].choices == ["easy", "medium", "hard"]
        assert opt_map["words_per_day"].type == "integer"
        assert opt_map["words_per_day"].default == 5
        assert opt_map["include_examples"].type == "boolean"
        assert opt_map["content_categories"].type == "multi_select"


# ---------------------------------------------------------------------------
# Unit tests — From channel info
# ---------------------------------------------------------------------------


class TestFromChannelInfo:
    def test_register_from_channel_info(self, registry):
        from app.delivery.base import ChannelInfo

        info = ChannelInfo(
            name="telegram",
            channel_type="chat",
            supports_rich_content=True,
            supports_buttons=True,
            supports_images=True,
            max_message_length=4096,
        )
        descriptor = registry.register_channel_from_info("telegram", info)
        assert descriptor.name == "telegram"
        assert descriptor.channel_type == "chat"
        assert descriptor.supports_buttons is True
        assert descriptor.max_message_length == 4096
        assert registry.has_channel("telegram")


# ---------------------------------------------------------------------------
# Unit tests — Validation: features
# ---------------------------------------------------------------------------


class TestValidateFeatures:
    def test_valid_features(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_selected_features(["vocab_learning"])
        assert result.valid
        assert result.errors == []

    def test_unknown_feature(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_selected_features(["vocab_learning", "nonexistent"])
        assert not result.valid
        assert len(result.errors) == 1
        assert "nonexistent" in result.errors[0]
        assert "vocab_learning" in result.errors[0]  # shows available

    def test_all_unknown_features(self, registry):
        result = registry.validate_selected_features(["a", "b"])
        assert not result.valid
        assert len(result.errors) == 2

    def test_empty_selection_is_valid(self, registry):
        result = registry.validate_selected_features([])
        assert result.valid


# ---------------------------------------------------------------------------
# Unit tests — Validation: channels
# ---------------------------------------------------------------------------


class TestValidateChannels:
    def test_valid_channels(self, registry, telegram_channel, email_channel):
        registry.register_channel(telegram_channel)
        registry.register_channel(email_channel)
        result = registry.validate_selected_channels(["telegram", "email"])
        assert result.valid

    def test_unknown_channel(self, registry, telegram_channel):
        registry.register_channel(telegram_channel)
        result = registry.validate_selected_channels(["telegram", "sms"])
        assert not result.valid
        assert "sms" in result.errors[0]

    def test_empty_channels_valid(self, registry):
        result = registry.validate_selected_channels([])
        assert result.valid


# ---------------------------------------------------------------------------
# Unit tests — Validation: feature settings
# ---------------------------------------------------------------------------


class TestValidateFeatureSettings:
    def test_valid_settings(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"difficulty_level": "hard", "words_per_day": 10},
        )
        assert result.valid
        assert result.errors == []

    def test_invalid_select_value(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"difficulty_level": "impossible"},
        )
        assert not result.valid
        assert "difficulty_level" in result.errors[0]

    def test_invalid_type(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"words_per_day": "not_a_number"},
        )
        assert not result.valid
        assert "words_per_day" in result.errors[0]

    def test_invalid_boolean(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"include_examples": "yes"},
        )
        assert not result.valid

    def test_invalid_multi_select(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"content_categories": ["words", "haiku"]},  # "haiku" not in choices
        )
        assert not result.valid

    def test_valid_multi_select(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"content_categories": ["words", "idioms"]},
        )
        assert result.valid

    def test_unknown_setting_key_gives_warning(self, registry, vocab_feature):
        registry.register_feature(vocab_feature)
        result = registry.validate_feature_settings(
            "vocab_learning",
            {"difficulty_level": "easy", "unknown_key": "value"},
        )
        assert result.valid  # warnings don't fail validation
        assert len(result.warnings) == 1
        assert "unknown_key" in result.warnings[0]

    def test_unknown_feature_fails(self, registry):
        result = registry.validate_feature_settings(
            "nonexistent",
            {"key": "value"},
        )
        assert not result.valid
        assert "nonexistent" in result.errors[0]


# ---------------------------------------------------------------------------
# Unit tests — Full preference validation
# ---------------------------------------------------------------------------


class TestValidatePreferences:
    def test_all_valid(self, registry, vocab_feature, telegram_channel):
        registry.register_feature(vocab_feature)
        registry.register_channel(telegram_channel)
        result = registry.validate_preferences(
            selected_features=["vocab_learning"],
            channels=["telegram"],
            feature_settings={
                "vocab_learning": {"difficulty_level": "hard", "words_per_day": 10}
            },
        )
        assert result.valid
        assert result.errors == []

    def test_multiple_errors(self, registry):
        result = registry.validate_preferences(
            selected_features=["bad_feature"],
            channels=["bad_channel"],
        )
        assert not result.valid
        assert len(result.errors) == 2

    def test_none_fields_skip_validation(self, registry):
        result = registry.validate_preferences(
            selected_features=None,
            channels=None,
            feature_settings=None,
        )
        assert result.valid

    def test_mixed_valid_and_invalid(self, registry, vocab_feature, telegram_channel):
        registry.register_feature(vocab_feature)
        registry.register_channel(telegram_channel)
        result = registry.validate_preferences(
            selected_features=["vocab_learning"],  # valid
            channels=["telegram", "pigeon"],  # pigeon invalid
            feature_settings={
                "vocab_learning": {"difficulty_level": "impossible"}  # invalid value
            },
        )
        assert not result.valid
        assert len(result.errors) == 2  # pigeon + impossible


# ---------------------------------------------------------------------------
# Unit tests — ValidationResult merging
# ---------------------------------------------------------------------------


class TestValidationResult:
    def test_merge(self):
        a = ValidationResult()
        a.add_error("error1")
        b = ValidationResult()
        b.add_warning("warning1")
        a.merge(b)
        assert not a.valid
        assert a.errors == ["error1"]
        assert a.warnings == ["warning1"]

    def test_to_dict(self):
        r = ValidationResult()
        r.add_error("e1")
        r.add_warning("w1")
        d = r.to_dict()
        assert d["valid"] is False
        assert d["errors"] == ["e1"]
        assert d["warnings"] == ["w1"]


# ---------------------------------------------------------------------------
# Unit tests — Summary
# ---------------------------------------------------------------------------


class TestSummary:
    def test_summary(self, registry, vocab_feature, telegram_channel):
        registry.register_feature(vocab_feature)
        registry.register_channel(telegram_channel)
        s = registry.summary()
        assert s["feature_count"] == 1
        assert s["channel_count"] == 1
        assert len(s["features"]) == 1
        assert len(s["channels"]) == 1
        assert s["features"][0]["name"] == "vocab_learning"
        assert s["channels"][0]["name"] == "telegram"


# ---------------------------------------------------------------------------
# Singleton management
# ---------------------------------------------------------------------------


class TestSingleton:
    def test_get_creates_singleton(self):
        reset_feature_channel_registry()
        r1 = get_feature_channel_registry()
        r2 = get_feature_channel_registry()
        assert r1 is r2
        reset_feature_channel_registry()

    def test_set_replaces_singleton(self):
        reset_feature_channel_registry()
        custom = FeatureChannelRegistry()
        set_feature_channel_registry(custom)
        assert get_feature_channel_registry() is custom
        reset_feature_channel_registry()


# ---------------------------------------------------------------------------
# API integration tests
# ---------------------------------------------------------------------------


@pytest.fixture
async def api_client():
    """Test client with database and pre-populated registry."""
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    # Set up a registry with test data
    registry = FeatureChannelRegistry()
    from app.plugins.vocab_learning import VOCAB_LEARNING_MANIFEST

    registry.register_feature_from_plugin_manifest(VOCAB_LEARNING_MANIFEST)
    registry.register_channel(
        ChannelDescriptor(
            name="telegram", channel_type="chat",
            supports_buttons=True, supports_images=True, max_message_length=4096,
        )
    )
    registry.register_channel(
        ChannelDescriptor(name="email", channel_type="email", supports_files=True)
    )
    set_feature_channel_registry(registry)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c

    app.dependency_overrides.clear()
    reset_feature_channel_registry()
    await engine.dispose()


async def _create_user(client: AsyncClient, name: str = "Alice") -> str:
    resp = await client.post("/api/v1/users", json={"name": name})
    assert resp.status_code == 200
    return resp.json()["id"]


class TestRegistryAPI:
    async def test_list_features(self, api_client):
        resp = await api_client.get("/api/v1/registry/features")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        f = body["features"][0]
        assert f["name"] == "vocab_learning"
        assert f["display_name"] == "Vocabulary Learning"
        assert len(f["config_options"]) == 9
        # Verify config option schema is exposed
        opt_map = {o["key"]: o for o in f["config_options"]}
        assert opt_map["difficulty_level"]["type"] == "select"
        assert opt_map["difficulty_level"]["choices"] == ["easy", "medium", "hard"]
        assert opt_map["words_per_day"]["type"] == "integer"

    async def test_list_channels(self, api_client):
        resp = await api_client.get("/api/v1/registry/channels")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        names = {c["name"] for c in body["channels"]}
        assert names == {"telegram", "email"}

    async def test_registry_summary(self, api_client):
        resp = await api_client.get("/api/v1/registry/summary")
        assert resp.status_code == 200
        body = resp.json()
        assert body["feature_count"] == 1
        assert body["channel_count"] == 2

    async def test_validate_valid_selections(self, api_client):
        resp = await api_client.post(
            "/api/v1/registry/validate",
            json={
                "selected_features": ["vocab_learning"],
                "channels": ["telegram"],
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {"difficulty_level": "hard"},
                    }
                },
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is True
        assert body["errors"] == []

    async def test_validate_invalid_feature(self, api_client):
        resp = await api_client.post(
            "/api/v1/registry/validate",
            json={"selected_features": ["nonexistent"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert any("nonexistent" in e for e in body["errors"])

    async def test_validate_invalid_channel(self, api_client):
        resp = await api_client.post(
            "/api/v1/registry/validate",
            json={"channels": ["pigeon"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert any("pigeon" in e for e in body["errors"])

    async def test_validate_invalid_setting_value(self, api_client):
        resp = await api_client.post(
            "/api/v1/registry/validate",
            json={
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {"difficulty_level": "nightmare"},
                    }
                },
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert any("difficulty_level" in e for e in body["errors"])


class TestValidatedPreferencesAPI:
    async def test_valid_update_succeeds(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "selected_features": ["vocab_learning"],
                "channels": ["telegram", "email"],
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {"difficulty_level": "hard", "words_per_day": 10},
                    }
                },
                "validate": True,
            },
        )
        assert resp.status_code == 200
        prefs = resp.json()["preferences"]
        assert prefs["selected_features"] == ["vocab_learning"]
        assert prefs["channels"] == ["telegram", "email"]
        assert prefs["feature_settings"]["vocab_learning"]["settings"]["difficulty_level"] == "hard"

    async def test_invalid_feature_rejected(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "selected_features": ["vocab_learning", "nonexistent_plugin"],
                "validate": True,
            },
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["message"] == "Preference validation failed"
        assert any("nonexistent_plugin" in e for e in detail["errors"])

    async def test_invalid_channel_rejected(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "channels": ["telegram", "carrier_pigeon"],
                "validate": True,
            },
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert any("carrier_pigeon" in e for e in detail["errors"])

    async def test_invalid_setting_value_rejected(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {"difficulty_level": "godmode"},
                    }
                },
                "validate": True,
            },
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert any("difficulty_level" in e for e in detail["errors"])

    async def test_skip_validation(self, api_client):
        """When validate=False, unknown features/channels are allowed."""
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "selected_features": ["anything_goes"],
                "channels": ["carrier_pigeon"],
                "validate": False,
            },
        )
        assert resp.status_code == 200
        prefs = resp.json()["preferences"]
        assert prefs["selected_features"] == ["anything_goes"]
        assert prefs["channels"] == ["carrier_pigeon"]

    async def test_valid_multi_select_setting(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {
                            "content_categories": ["words", "idioms"],
                            "difficulty_level": "easy",
                        },
                    }
                },
                "validate": True,
            },
        )
        assert resp.status_code == 200

    async def test_invalid_multi_select_setting(self, api_client):
        user_id = await _create_user(api_client)
        resp = await api_client.put(
            f"/api/v1/users/{user_id}/preferences/structured/validated",
            json={
                "feature_settings": {
                    "vocab_learning": {
                        "enabled": True,
                        "settings": {
                            "content_categories": ["words", "haiku"],
                        },
                    }
                },
                "validate": True,
            },
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert any("content_categories" in e for e in detail["errors"])
