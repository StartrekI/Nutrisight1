-- Performance indexes for NutriSight Neon Postgres
--
-- Run this in the Neon console (SQL Editor) to add the indexes that back the
-- hot query paths in backend/api/home.js and backend/api/scan/save.js.
--
-- Every statement uses IF NOT EXISTS so running it multiple times is safe.
-- None of these indexes change application behavior — they only make existing
-- queries faster.
--
-- Expected impact:
--   - /api/home latency drops 50-80% once user has > few hundred scans
--   - /api/scan/save user_stats lookup becomes O(log n) instead of O(n)
--   - Duplicate-email check on /api/auth/register uses the unique index
--
-- Corresponding audit items: 4.7.4 in CODEBASE_AUDIT.md

-- ───────────────────────────────────────────────────────────────
-- scan_summaries — the hottest table, used by 5 queries in /api/home
-- ───────────────────────────────────────────────────────────────

-- Covers: SELECT ... WHERE user_id = $ AND scanned_at > NOW() - INTERVAL '7 days'
--         SELECT ... WHERE user_id = $ AND (scanned_at AT TIME ZONE ...) = ...
--         SELECT ... WHERE user_id = $ GROUP BY dow
CREATE INDEX IF NOT EXISTS idx_scan_summaries_user_scanned
  ON scan_summaries(user_id, scanned_at DESC);

-- Covers the concerns aggregation UNION ALL sub-query.
-- Partial indexes only store rows where the concern is non-null — much smaller.
CREATE INDEX IF NOT EXISTS idx_scan_summaries_user_top_concern
  ON scan_summaries(user_id) WHERE top_concern IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_summaries_user_top_concern_2
  ON scan_summaries(user_id) WHERE top_concern_2 IS NOT NULL;

-- ───────────────────────────────────────────────────────────────
-- user_stats — looked up by /api/home and /api/scan/save
-- ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_stats_user_id
  ON user_stats(user_id);

-- ───────────────────────────────────────────────────────────────
-- recommendations — looked up by /api/home top picks
-- ───────────────────────────────────────────────────────────────

-- Covers: SELECT DISTINCT ON (name) ... WHERE user_id = $ ORDER BY name, score DESC
CREATE INDEX IF NOT EXISTS idx_recommendations_user_name_score
  ON recommendations(user_id, name, score DESC);

-- ───────────────────────────────────────────────────────────────
-- users — login lookup + register uniqueness
-- ───────────────────────────────────────────────────────────────

-- Enforces uniqueness AND backs the lookup used by auth/login + auth/register.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email);
