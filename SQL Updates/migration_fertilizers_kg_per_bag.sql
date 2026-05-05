-- Migration: add kg_per_bag to fertilizers table
-- Run once in Supabase SQL editor
ALTER TABLE fertilizers ADD COLUMN IF NOT EXISTS kg_per_bag numeric CHECK (kg_per_bag > 0);

COMMENT ON COLUMN fertilizers.kg_per_bag IS
  'Kilograms per bag. Required when unit = ''bag'' to allow kg conversion for application tracking.';
