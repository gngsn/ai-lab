-- Migration: Create user_preferences table
-- Description: Key-value preference store for per-user, per-feature configuration
-- Date: 2026-03-22

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    preference_key  TEXT NOT NULL,
    preference_value JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Each user can have only one value per preference key
    CONSTRAINT uq_user_preferences_user_key UNIQUE (user_id, preference_key)
);

-- Index for fast lookup by user_id
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
    ON user_preferences(user_id);

-- Index for looking up specific preference keys across users
CREATE INDEX IF NOT EXISTS idx_user_preferences_key
    ON user_preferences(preference_key);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key
    ON user_preferences(user_id, preference_key);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================

-- Enable RLS on the table
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own preferences
CREATE POLICY "Users can read own preferences"
    ON user_preferences
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
    ON user_preferences
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own preferences
CREATE POLICY "Users can update own preferences"
    ON user_preferences
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own preferences
CREATE POLICY "Users can delete own preferences"
    ON user_preferences
    FOR DELETE
    USING (auth.uid() = user_id);

-- Policy: Service role (server-side) bypasses RLS automatically via supabase service_role key
-- No explicit policy needed — service_role has full access when RLS is enabled.

-- ============================================================
-- Comments for documentation
-- ============================================================

COMMENT ON TABLE user_preferences IS
    'Key-value store for user preferences. Each row is one preference setting for a user.';

COMMENT ON COLUMN user_preferences.user_id IS
    'References auth.users — the owner of this preference.';

COMMENT ON COLUMN user_preferences.preference_key IS
    'Dot-notation preference key, e.g. "vocab.difficulty_level", "delivery.frequency", "vocab.topics".';

COMMENT ON COLUMN user_preferences.preference_value IS
    'JSONB value for this preference — supports strings, numbers, arrays, objects.';
