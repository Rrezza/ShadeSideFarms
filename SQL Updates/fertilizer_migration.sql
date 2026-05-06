-- ============================================================
-- Fertilizers table — v18 migration
-- Adds nutrient profile columns, purchase unit conversion,
-- chemical form reference, and reorder threshold.
-- Run in Supabase SQL editor.
-- ============================================================

ALTER TABLE fertilizers
  ADD COLUMN IF NOT EXISTS quantity_per_purchase_unit numeric,
  ADD COLUMN IF NOT EXISTS chemical_form              text,
  ADD COLUMN IF NOT EXISTS n_pct                      numeric,
  ADD COLUMN IF NOT EXISTS p2o5_pct                   numeric,
  ADD COLUMN IF NOT EXISTS k2o_pct                    numeric,
  ADD COLUMN IF NOT EXISTS ca_pct                     numeric,
  ADD COLUMN IF NOT EXISTS mg_pct                     numeric,
  ADD COLUMN IF NOT EXISTS s_pct                      numeric,
  ADD COLUMN IF NOT EXISTS fe_ppm                     numeric,
  ADD COLUMN IF NOT EXISTS zn_ppm                     numeric,
  ADD COLUMN IF NOT EXISTS b_ppm                      numeric,
  ADD COLUMN IF NOT EXISTS mn_ppm                     numeric,
  ADD COLUMN IF NOT EXISTS reorder_point              numeric;

-- Keep the existing `unit` column as-is for legacy compatibility.
-- It is no longer used in stock calculations — stock unit is now
-- derived from type in JS (liquid → L, all others → kg).

-- All new columns are nullable. Existing rows will show blanks
-- in the registry until filled in manually. No existing data
-- is altered or at risk.

-- Verify:
SELECT id, name, type, unit,
       quantity_per_purchase_unit, chemical_form,
       n_pct, p2o5_pct, k2o_pct, ca_pct, mg_pct, s_pct,
       fe_ppm, zn_ppm, b_ppm, mn_ppm,
       reorder_point, active
FROM fertilizers
ORDER BY name;
