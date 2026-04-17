-- Rollback: Drop user_preferences table and related objects
-- Date: 2026-03-22

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP TABLE IF EXISTS user_preferences;
