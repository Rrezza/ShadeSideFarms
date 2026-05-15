-- ============================================================
-- Migration: harvest destinations system
-- Run all three blocks in order in the Supabase SQL editor.
-- ============================================================

-- 1. Harvest destinations registry
--    Users manage rows here; JS reads this table instead of
--    hardcoded arrays. The 'key' column is what gets stored in
--    harvest_allocations.destination.
CREATE TABLE IF NOT EXISTS harvest_destinations (
  id         serial      PRIMARY KEY,
  key        text        NOT NULL UNIQUE,
  label      text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true
);

-- Seed with the standard set
INSERT INTO harvest_destinations (key, label, sort_order) VALUES
  ('feed_inventory',      'Feed inventory',                     10),
  ('sold',                'Sold',                               20),
  ('seed_stock',          'Seed stock',                         30),
  ('compost_mulch',       'Compost / mulch',                    40),
  ('household',           'Household use',                      50),
  ('bsf_feedstock',       'BSF feedstock',                      60),
  ('soil_incorporation',  'Soil incorporation',                  70),
  ('external_processing', 'External processing (e.g. oil press)',80),
  ('other',               'Other',                              90)
ON CONFLICT (key) DO NOTHING;

-- 2. Permitted destinations per crop
--    text[] array of destination keys. Empty array = all destinations shown.
ALTER TABLE crops
  ADD COLUMN IF NOT EXISTS permitted_destinations text[] NOT NULL DEFAULT '{}';

-- 3. Feed eligibility flag on ingredients
--    When true, this ingredient appears in feed-related dropdowns
--    (ration plans, allocation modal feed inventory rows, etc.)
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS feed_eligible boolean NOT NULL DEFAULT false;

-- Mark existing 'produced' and 'dual' source ingredients as feed-eligible
-- (safe default — review and adjust per ingredient in the setup page)
UPDATE ingredients
SET feed_eligible = true
WHERE source_type IN ('produced', 'dual')
  AND active = true;
