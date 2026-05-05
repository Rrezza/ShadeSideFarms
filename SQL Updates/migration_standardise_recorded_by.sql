-- ============================================================
-- Migration: standardise worker column name to recorded_by
-- across all tables that currently use logged_by or worker_id
--
-- Run in Supabase SQL editor.
-- Safe to run — RENAME COLUMN is instant metadata-only in Postgres.
-- Foreign key constraints are automatically updated by Postgres
-- so the workers(name) join in PostgREST continues to work.
-- ============================================================

-- Tables currently using logged_by
ALTER TABLE crop_harvest_events  RENAME COLUMN logged_by TO recorded_by;
ALTER TABLE crop_observations     RENAME COLUMN logged_by TO recorded_by;
ALTER TABLE watering_events       RENAME COLUMN logged_by TO recorded_by;

-- Tables currently using worker_id
ALTER TABLE gypsum_applications   RENAME COLUMN worker_id TO recorded_by;
ALTER TABLE amendment_applications RENAME COLUMN worker_id TO recorded_by;
