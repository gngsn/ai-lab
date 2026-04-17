"""Plugin registry — discovers, loads, validates, and manages plugin modules.

The registry is the central component that:
1. **Discovers** plugin classes from Python packages/modules on disk.
2. **Validates** plugin manifests (required fields, config coherence, dependency presence).
3. **Loads** plugins through their ``initialize()`` lifecycle hook.
4. **Manages** the live plugin set (register, unregister, query by name or capability).
5. **Checks dependencies** — ensures all declared dependencies are satisfied before loading.

Design principles:
- Plugin isolation: plugins don't reference each other or platform internals.
- Channel agnosticism: the registry is unaware of delivery channels.
- Deterministic ordering: plugins are initialized in dependency-topological order.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from types import ModuleType
from typing import Any

from app.services.plugin import BasePlugin, PluginManifest

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLATFORM_VERSION = "0.1.0"

_SEMVER_RE = re.compile(
    r"^(?P<op>>=|<=|==|!=|>|<)?\s*"
    r"(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$"
)

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


# ---------------------------------------------------------------------------
# Plugin state tracking
# ---------------------------------------------------------------------------


class PluginState(str, Enum):
    """Lifecycle state of a registered plugin."""

    REGISTERED = "registered"  # manifest validated, not yet initialized
    INITIALIZING = "initializing"
    ACTIVE = "active"  # initialize() completed successfully
    FAILED = "failed"  # initialize() raised
    SHUTTING_DOWN = "shutting_down"
    STOPPED = "stopped"  # shutdown() completed


@dataclass
class PluginEntry:
    """Internal bookkeeping for a single plugin inside the registry."""

    plugin: BasePlugin
    state: PluginState = PluginState.REGISTERED
    error: str | None = None

    @property
    def manifest(self) -> PluginManifest:
        return self.plugin.manifest

    @property
    def name(self) -> str:
        return self.manifest.name


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


class PluginValidationError(Exception):
    """Raised when a plugin fails manifest validation."""

    def __init__(self, plugin_name: str, errors: list[str]) -> None:
        self.plugin_name = plugin_name
        self.errors = errors
        super().__init__(f"Plugin '{plugin_name}' validation failed: {'; '.join(errors)}")


class PluginDependencyError(Exception):
    """Raised when a plugin's dependencies are not satisfiable."""

    def __init__(self, plugin_name: str, missing: list[str]) -> None:
        self.plugin_name = plugin_name
        self.missing = missing
        super().__init__(
            f"Plugin '{plugin_name}' has unsatisfied dependencies: {', '.join(missing)}"
        )


class PluginLoadError(Exception):
    """Raised when a plugin fails during initialization."""

    def __init__(self, plugin_name: str, cause: Exception) -> None:
        self.plugin_name = plugin_name
        self.cause = cause
        super().__init__(f"Plugin '{plugin_name}' failed to initialize: {cause}")


def _parse_version(version_str: str) -> tuple[int, int, int]:
    """Parse a ``major.minor.patch`` version string into a tuple."""
    parts = version_str.strip().split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid version: {version_str!r}")
    return int(parts[0]), int(parts[1]), int(parts[2])


def _check_version_constraint(constraint: str, platform_version: str) -> bool:
    """Return True if *platform_version* satisfies *constraint*.

    Supports: ``>=``, ``<=``, ``==``, ``!=``, ``>``, ``<``, or bare version (== implied).
    """
    m = _SEMVER_RE.match(constraint.strip())
    if not m:
        return False
    op = m.group("op") or "=="
    required = (int(m.group("major")), int(m.group("minor")), int(m.group("patch")))
    actual = _parse_version(platform_version)
    ops = {
        ">=": actual >= required,
        "<=": actual <= required,
        "==": actual == required,
        "!=": actual != required,
        ">": actual > required,
        "<": actual < required,
    }
    return ops.get(op, False)


def validate_manifest(manifest: PluginManifest) -> list[str]:
    """Validate a manifest and return a list of error strings (empty = valid)."""
    errors: list[str] = []

    # Name format
    if not _NAME_RE.match(manifest.name):
        errors.append(
            f"Invalid plugin name '{manifest.name}': must match [a-z][a-z0-9_]{{1,63}}"
        )

    # Version
    try:
        _parse_version(manifest.version)
    except (ValueError, IndexError):
        errors.append(f"Invalid version '{manifest.version}': expected 'major.minor.patch'")

    # Platform version constraint
    if not _check_version_constraint(manifest.platform_version, PLATFORM_VERSION):
        errors.append(
            f"Platform version {PLATFORM_VERSION} does not satisfy "
            f"constraint '{manifest.platform_version}'"
        )

    # Config-option sanity
    seen_keys: set[str] = set()
    for opt in manifest.config_options:
        if opt.key in seen_keys:
            errors.append(f"Duplicate config key: '{opt.key}'")
        seen_keys.add(opt.key)

        if opt.type in ("select", "multi_select") and not opt.choices:
            errors.append(
                f"Config option '{opt.key}' is type {opt.type.value} but has no choices"
            )

        # Validate the default against its own type
        if opt.default is not None and not opt.validate_value(opt.default):
            errors.append(
                f"Config option '{opt.key}' has an invalid default: {opt.default!r}"
            )

    # Dependencies format
    for dep in manifest.dependencies:
        if not _NAME_RE.match(dep):
            errors.append(f"Invalid dependency name '{dep}'")

    return errors


# ---------------------------------------------------------------------------
# Discovery — find BasePlugin subclasses in Python packages
# ---------------------------------------------------------------------------


def discover_plugins_in_module(module: ModuleType) -> list[type[BasePlugin]]:
    """Return all concrete ``BasePlugin`` subclasses defined in *module*."""
    found: list[type[BasePlugin]] = []
    for _name, obj in inspect.getmembers(module, inspect.isclass):
        if (
            issubclass(obj, BasePlugin)
            and obj is not BasePlugin
            and not inspect.isabstract(obj)
            and hasattr(obj, "manifest")
        ):
            found.append(obj)
    return found


def discover_plugins_in_package(package_path: str) -> list[type[BasePlugin]]:
    """Walk a Python package path and return all concrete ``BasePlugin`` subclasses.

    Parameters
    ----------
    package_path:
        A dotted Python import path (e.g. ``"plugins"`` or ``"app.plugins"``).
    """
    found: list[type[BasePlugin]] = []
    try:
        package = importlib.import_module(package_path)
    except ImportError as exc:
        logger.warning("Cannot import plugin package %r: %s", package_path, exc)
        return found

    # If the package has a __path__ (i.e. it's a package, not a single module),
    # walk its submodules.
    if hasattr(package, "__path__"):
        for importer, modname, _ispkg in pkgutil.walk_packages(
            package.__path__, prefix=package.__name__ + "."
        ):
            try:
                mod = importlib.import_module(modname)
                found.extend(discover_plugins_in_module(mod))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to import plugin module %r: %s", modname, exc)
    else:
        found.extend(discover_plugins_in_module(package))

    return found


# ---------------------------------------------------------------------------
# Topological sort for dependency ordering
# ---------------------------------------------------------------------------


def _topological_sort(entries: dict[str, PluginEntry]) -> list[str]:
    """Return plugin names in an order that respects dependencies.

    Raises ``PluginDependencyError`` if a cycle is detected.
    """
    # Build adjacency
    in_degree: dict[str, int] = {name: 0 for name in entries}
    dependents: dict[str, list[str]] = {name: [] for name in entries}

    for name, entry in entries.items():
        for dep in entry.manifest.dependencies:
            if dep in entries:
                in_degree[name] += 1
                dependents[dep].append(name)

    queue: list[str] = [n for n, d in in_degree.items() if d == 0]
    order: list[str] = []

    while queue:
        # Sort for determinism
        queue.sort()
        node = queue.pop(0)
        order.append(node)
        for dependent in dependents[node]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(order) != len(entries):
        # Cycle detected — find the offending plugins
        remaining = set(entries) - set(order)
        raise PluginDependencyError(
            plugin_name=", ".join(sorted(remaining)),
            missing=[f"circular dependency among: {', '.join(sorted(remaining))}"],
        )

    return order


# ---------------------------------------------------------------------------
# Plugin Registry
# ---------------------------------------------------------------------------


class PluginRegistry:
    """Central registry that manages the full plugin lifecycle.

    Usage::

        registry = PluginRegistry()

        # Register individual plugins
        registry.register(MyPlugin())

        # Or discover from a package
        registry.discover_and_register("app.plugins")

        # Initialize all registered plugins (respects dependency order)
        await registry.initialize_all()

        # Query
        plugin = registry.get("vocab_learning")
        quiz_plugins = registry.find_by_capability("quiz")

        # Shutdown
        await registry.shutdown_all()
    """

    def __init__(self) -> None:
        self._plugins: dict[str, PluginEntry] = {}
        self._capability_index: dict[str, list[str]] = {}  # capability -> [plugin names]

    # -- Registration -------------------------------------------------------

    def register(self, plugin: BasePlugin, *, skip_validation: bool = False) -> PluginEntry:
        """Register a plugin instance.

        Validates the manifest and checks for name conflicts.
        Does **not** call ``initialize()`` — use :meth:`initialize_all` or
        :meth:`initialize_plugin` for that.

        Parameters
        ----------
        plugin:
            An instance of a ``BasePlugin`` subclass.
        skip_validation:
            If True, skip manifest validation (useful for testing).

        Returns
        -------
        The :class:`PluginEntry` bookkeeping object.

        Raises
        ------
        PluginValidationError
            If the manifest is invalid.
        ValueError
            If a plugin with the same name is already registered.
        """
        manifest = plugin.manifest

        # Validate manifest
        if not skip_validation:
            errors = validate_manifest(manifest)
            if errors:
                raise PluginValidationError(manifest.name, errors)

        # Check for duplicate names
        if manifest.name in self._plugins:
            raise ValueError(
                f"Plugin '{manifest.name}' is already registered. "
                "Unregister it first or use a different name."
            )

        entry = PluginEntry(plugin=plugin)
        self._plugins[manifest.name] = entry

        # Update capability index
        for cap in manifest.capabilities:
            self._capability_index.setdefault(cap, []).append(manifest.name)

        logger.info(
            "Registered plugin '%s' v%s (capabilities: %s)",
            manifest.name,
            manifest.version,
            ", ".join(manifest.capabilities) or "none",
        )
        return entry

    def register_class(
        self, plugin_cls: type[BasePlugin], *, skip_validation: bool = False
    ) -> PluginEntry:
        """Instantiate a plugin class and register the instance."""
        instance = plugin_cls()
        return self.register(instance, skip_validation=skip_validation)

    def unregister(self, name: str) -> PluginEntry | None:
        """Remove a plugin from the registry.

        Returns the removed :class:`PluginEntry`, or ``None`` if not found.
        Does **not** call ``shutdown()`` — the caller should do that first
        if the plugin is active.
        """
        entry = self._plugins.pop(name, None)
        if entry is None:
            return None

        # Clean capability index
        for cap in entry.manifest.capabilities:
            names = self._capability_index.get(cap, [])
            if name in names:
                names.remove(name)
                if not names:
                    del self._capability_index[cap]

        logger.info("Unregistered plugin '%s'", name)
        return entry

    # -- Discovery ----------------------------------------------------------

    def discover_and_register(
        self, package_path: str, *, skip_validation: bool = False
    ) -> list[PluginEntry]:
        """Discover all plugins in a Python package and register them.

        Parameters
        ----------
        package_path:
            Dotted import path (e.g. ``"app.plugins"``).

        Returns
        -------
        List of newly registered :class:`PluginEntry` objects.
        """
        classes = discover_plugins_in_package(package_path)
        entries: list[PluginEntry] = []
        for cls in classes:
            try:
                entry = self.register_class(cls, skip_validation=skip_validation)
                entries.append(entry)
            except (PluginValidationError, ValueError) as exc:
                logger.warning("Skipping plugin class %s: %s", cls.__name__, exc)
        return entries

    # -- Dependency checking ------------------------------------------------

    def check_dependencies(self, name: str | None = None) -> dict[str, list[str]]:
        """Check dependency satisfaction for one or all plugins.

        Parameters
        ----------
        name:
            If provided, check only the named plugin. Otherwise check all.

        Returns
        -------
        A dict mapping plugin names to their list of missing dependencies.
        Empty dict means all dependencies are satisfied.
        """
        targets = (
            {name: self._plugins[name]} if name and name in self._plugins else self._plugins
        )
        missing_map: dict[str, list[str]] = {}
        for pname, entry in targets.items():
            missing = [dep for dep in entry.manifest.dependencies if dep not in self._plugins]
            if missing:
                missing_map[pname] = missing
        return missing_map

    # -- Initialization -----------------------------------------------------

    async def initialize_plugin(self, name: str) -> None:
        """Initialize a single plugin by name.

        Raises
        ------
        KeyError
            If the plugin is not registered.
        PluginDependencyError
            If any declared dependency is not registered.
        PluginLoadError
            If ``initialize()`` raises.
        """
        entry = self._plugins.get(name)
        if entry is None:
            raise KeyError(f"Plugin '{name}' is not registered")

        if entry.state == PluginState.ACTIVE:
            return  # already initialized

        # Check dependencies
        missing = [dep for dep in entry.manifest.dependencies if dep not in self._plugins]
        if missing:
            raise PluginDependencyError(name, missing)

        # Ensure dependencies are active
        for dep in entry.manifest.dependencies:
            dep_entry = self._plugins[dep]
            if dep_entry.state != PluginState.ACTIVE:
                await self.initialize_plugin(dep)

        entry.state = PluginState.INITIALIZING
        try:
            await entry.plugin.initialize()
            entry.state = PluginState.ACTIVE
            logger.info("Initialized plugin '%s'", name)
        except Exception as exc:
            entry.state = PluginState.FAILED
            entry.error = str(exc)
            raise PluginLoadError(name, exc) from exc

    async def initialize_all(self) -> list[str]:
        """Initialize all registered plugins in dependency order.

        Returns
        -------
        Names of plugins that were successfully initialized.

        Plugins that fail are marked as :attr:`PluginState.FAILED` but do not
        prevent other plugins from initializing.
        """
        # Dependency check
        missing_map = self.check_dependencies()
        if missing_map:
            for pname, missing in missing_map.items():
                entry = self._plugins[pname]
                entry.state = PluginState.FAILED
                entry.error = f"Missing dependencies: {', '.join(missing)}"
                logger.error("Plugin '%s' has unsatisfied deps: %s", pname, missing)

        # Topological sort only over plugins that have all deps present
        loadable = {
            name: entry
            for name, entry in self._plugins.items()
            if name not in missing_map and entry.state == PluginState.REGISTERED
        }

        if not loadable:
            return []

        order = _topological_sort(loadable)
        initialized: list[str] = []

        for name in order:
            try:
                await self.initialize_plugin(name)
                initialized.append(name)
            except (PluginLoadError, PluginDependencyError) as exc:
                logger.error("Failed to initialize plugin '%s': %s", name, exc)

        return initialized

    # -- Shutdown -----------------------------------------------------------

    async def shutdown_plugin(self, name: str) -> None:
        """Shut down a single plugin by name."""
        entry = self._plugins.get(name)
        if entry is None:
            raise KeyError(f"Plugin '{name}' is not registered")

        if entry.state not in (PluginState.ACTIVE, PluginState.FAILED):
            return

        entry.state = PluginState.SHUTTING_DOWN
        try:
            await entry.plugin.shutdown()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Error shutting down plugin '%s': %s", name, exc)
        finally:
            entry.state = PluginState.STOPPED

    async def shutdown_all(self) -> None:
        """Shut down all active plugins (in reverse initialization order)."""
        active = [
            name
            for name, entry in self._plugins.items()
            if entry.state in (PluginState.ACTIVE, PluginState.FAILED)
        ]
        # Reverse topological order for teardown
        try:
            order = _topological_sort(
                {n: self._plugins[n] for n in active if n in self._plugins}
            )
            order.reverse()
        except PluginDependencyError:
            order = active  # fallback: no ordering if sort fails

        for name in order:
            await self.shutdown_plugin(name)

    # -- Querying -----------------------------------------------------------

    def get(self, name: str) -> BasePlugin | None:
        """Return the plugin instance by name, or ``None``."""
        entry = self._plugins.get(name)
        return entry.plugin if entry else None

    def get_entry(self, name: str) -> PluginEntry | None:
        """Return the full :class:`PluginEntry` by name, or ``None``."""
        return self._plugins.get(name)

    def get_active(self, name: str) -> BasePlugin | None:
        """Return the plugin only if it's in ACTIVE state."""
        entry = self._plugins.get(name)
        if entry and entry.state == PluginState.ACTIVE:
            return entry.plugin
        return None

    def find_by_capability(self, capability: str) -> list[BasePlugin]:
        """Return all active plugins that declare a given capability."""
        names = self._capability_index.get(capability, [])
        return [
            self._plugins[n].plugin
            for n in names
            if n in self._plugins and self._plugins[n].state == PluginState.ACTIVE
        ]

    def list_plugins(self) -> list[PluginEntry]:
        """Return all registered plugin entries."""
        return list(self._plugins.values())

    def list_active(self) -> list[BasePlugin]:
        """Return all plugins in ACTIVE state."""
        return [
            entry.plugin
            for entry in self._plugins.values()
            if entry.state == PluginState.ACTIVE
        ]

    def list_names(self) -> list[str]:
        """Return all registered plugin names."""
        return list(self._plugins.keys())

    def list_capabilities(self) -> dict[str, list[str]]:
        """Return the full capability → plugin-names index."""
        return dict(self._capability_index)

    @property
    def count(self) -> int:
        """Number of registered plugins."""
        return len(self._plugins)

    def __contains__(self, name: str) -> bool:
        return name in self._plugins

    def __len__(self) -> int:
        return len(self._plugins)

    # -- Info / debugging ---------------------------------------------------

    def summary(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of the registry state."""
        return {
            "total": self.count,
            "by_state": {
                state.value: sum(1 for e in self._plugins.values() if e.state == state)
                for state in PluginState
            },
            "plugins": {
                name: {
                    "version": entry.manifest.version,
                    "state": entry.state.value,
                    "capabilities": entry.manifest.capabilities,
                    "dependencies": entry.manifest.dependencies,
                    "error": entry.error,
                }
                for name, entry in self._plugins.items()
            },
        }
