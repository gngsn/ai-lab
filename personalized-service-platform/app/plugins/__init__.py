"""Built-in service plugins for the Personalized Service Platform.

This package contains first-party plugin implementations that ship with
the platform.  Each plugin module exposes a concrete ``BasePlugin``
subclass that the :class:`~app.services.plugin_registry.PluginRegistry`
can discover and manage automatically.

Plugins in this package serve a dual purpose:

1. **Production use** — they provide real functionality (e.g. vocabulary
   learning, daily quotes).
2. **Reference implementations** — they demonstrate the correct way to
   implement the plugin interface and are used as integration test
   fixtures to validate the platform's plugin lifecycle.
"""
