-- Add logged_by column to crop_observations
-- (references workers table, same pattern as other tables)

ALTER TABLE crop_observations
  ADD COLUMN IF NOT EXISTS logged_by integer REFERENCES workers(id);

-- Also check watering_events while we're here — same pattern
ALTER TABLE watering_events
  ADD COLUMN IF NOT EXISTS logged_by integer REFERENCES workers(id);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('crop_observations', 'watering_events')
  AND column_name = 'logged_by'
ORDER BY table_name;
