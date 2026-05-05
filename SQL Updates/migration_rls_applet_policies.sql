-- ============================================================
-- Migration: RLS INSERT policies for Farmhand applet
-- Run in Supabase SQL editor
--
-- The applet uses the anon key. RLS is enabled on these tables
-- but no INSERT policy exists, causing 42501 errors.
-- These policies mirror the current approach (auth deferred,
-- acceptable at current operational scale).
-- ============================================================

-- Feeding events
CREATE POLICY "anon_insert_feeding_events"
  ON feeding_events FOR INSERT TO anon WITH CHECK (true);

-- Watering events
CREATE POLICY "anon_insert_watering_events"
  ON watering_events FOR INSERT TO anon WITH CHECK (true);

-- Amendment applications
CREATE POLICY "anon_insert_amendment_applications"
  ON amendment_applications FOR INSERT TO anon WITH CHECK (true);

-- Ingredient acquisitions (purchases + on-farm harvests)
CREATE POLICY "anon_insert_ingredient_acquisitions"
  ON ingredient_acquisitions FOR INSERT TO anon WITH CHECK (true);

-- Crop harvest events
CREATE POLICY "anon_insert_crop_harvest_events"
  ON crop_harvest_events FOR INSERT TO anon WITH CHECK (true);

-- Crop observations
CREATE POLICY "anon_insert_crop_observations"
  ON crop_observations FOR INSERT TO anon WITH CHECK (true);

-- Egg production
CREATE POLICY "anon_insert_egg_production"
  ON egg_production FOR INSERT TO anon WITH CHECK (true);

-- ============================================================
-- READ policies — the applet also fetches reference data on
-- init (workers, ingredients, field_plots, etc.). If any of
-- those selects are also failing silently, add SELECT policies:
-- ============================================================

CREATE POLICY "anon_select_workers"
  ON workers FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_ingredients"
  ON ingredients FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_suppliers"
  ON suppliers FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_locations"
  ON locations FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_species"
  ON species FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_animal_groups"
  ON animal_groups FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_field_plots"
  ON field_plots FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_crop_groups"
  ON crop_groups FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_plot_crops"
  ON plot_crops FOR SELECT TO anon USING (true);

-- Feeding targets lookups
CREATE POLICY "anon_select_group_recipes"
  ON group_recipes FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_ration_plan_versions"
  ON ration_plan_versions FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_group_members"
  ON group_members FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_animals"
  ON animals FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_animal_weights"
  ON animal_weights FOR SELECT TO anon USING (true);
