"""Supabase client singleton for the platform.

Uses the service_role key so that server-side operations bypass RLS.
Configuration is read from environment variables:
  - SUPABASE_URL: The Supabase project URL
  - SUPABASE_SERVICE_ROLE_KEY: The service-role secret key
"""

from __future__ import annotations

import os
from functools import lru_cache

from supabase import Client, create_client


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Environment variable '{name}' is required but not set. "
            f"Set it before starting the application."
        )
    return value


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """Return a cached Supabase client instance.

    The client is created once and reused for the lifetime of the process.
    Uses the service_role key for full server-side access (bypasses RLS).
    """
    url = _require_env("SUPABASE_URL")
    key = _require_env("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)
