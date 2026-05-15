-- ============================================================
-- Migration: plot-level observations
-- Run in Supabase SQL editor.
-- ============================================================

-- 1. Plot observations table
--    Free-text log entries at the field_plot level, independent of
--    any specific crop. Used for whole-plot events: seed emergence,
--    general condition notes, irrigation runs, pest sightings, etc.
CREATE TABLE IF NOT EXISTS plot_observations (
  id             serial    PRIMARY KEY,
  field_plot_id  int       NOT NULL REFERENCES field_plots(id),
  observed_at    date      NOT NULL,
  notes          text      NOT NULL,
  recorded_by    int       REFERENCES workers(id)
);

CREATE INDEX IF NOT EXISTS plot_obs_plot_idx ON plot_observations(field_plot_id);

-- 2. RLS
ALTER TABLE plot_observations ENABLE ROW LEVEL SECURITY;

-- anon SELECT (overview dashboard uses anon key)
CREATE POLICY "anon_select_plot_observations"
  ON plot_observations FOR SELECT TO anon USING (true);

-- authenticated: full access
CREATE POLICY "auth_all_plot_observations"
  ON plot_observations FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON plot_observations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE plot_observations_id_seq TO authenticated;
-- ============================================================
