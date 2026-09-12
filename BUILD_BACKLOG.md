# ShadeSide Farms App — Build Backlog

Running list of confirmed pending items from the gap-by-gap review of `shadeside_app_context_breakdown.md` §6. Add/remove/check off items as we go. Not in build order — sequence to be decided once the existing codebase kinks are worked out.

---

## Pending

### 1. Wire Farm Expenses page into nav
- **Status:** Confirmed gap — verified against `Index.html` + `shared.js` `PAGE_MAP` directly (zero references to `farmexpenses`/`finance_expenses` in either).
- **Already built:** `finance_expenses.js` — `loadFarmExpensesPage`, `renderFarmExpensesPage`, full CRUD against `farm_expenses` table.
- **What's needed:** `farmexpenses` entry in `PAGE_MAP` (shared.js), sidebar nav button, `#page-farmexpenses` container in `Index.html`.
- Source: breakdown doc §6 item 1.

### 2. Phase 3 items
- **Status:** Pending — three pieces remain (manure item resolved, see below).
- **Items:**
  - External-processing receive-back workflow (`processing_transaction_outputs` table + "Receive back" modal in Ingredient Inventory)
  - Fertilizer `source_type` (purchased/gifted/own_animals)
  - Seed deduction from stock on sowing (tied to `plot_crops.qty_kg_sown`)
- Source: breakdown doc §6 item 2.

### 3. Wire feed cost into Cost & Sales P&L
- **Status:** Pending — blocked on gap #3 (real feeding data), not a code gap on its own.
- **Context:** `renderCSGroup` in `health.js` already aggregates purchase cost + health cost vs. sale revenue into a per-group "Actual margin" — this is real, working code, contrary to the doc's "no aggregation layer" framing. The feed line is explicitly stubbed: `'Feed cost (actual)' → '—'`, "Feed log not yet implemented for this group."
- **What's needed:** once real `feeding_events` data exists (see gap #3), wire actual feed cost into this same P&L view.
- Source: breakdown doc §6 item 7 (partially superseded by direct code check).

### 4. Labor / farm_expenses group-attribution — needs a design decision
- **Status:** Pending — design decision required before building, not just a wiring task.
- **Problem:** `farm_expenses` (where labor costs live, §4.7) has no `group_id` field — it's a flat farm-wide log by category, with no join path to attribute a cost to a specific animal cohort.
- **Decision needed:** add a `group_id` FK to `farm_expenses` (or a subset of categories, e.g. day_labor/veterinary), or build a separate allocation mechanism (e.g. manual split entry) — before any labor cost can appear in group P&L.
- Source: breakdown doc §6 items 7 and 8 (batch-level costing + labor allocation log), combined since they're the same underlying gap.

---

## Resolved — no code change needed

### Gypsum / manure as fertilizer-registry entries (was gap #5 + part of item #2)
- **Decision:** Gypsum and farmyard manure are modeled as `fertilizers` registry rows, not separate `amendment_applications`/`gypsum_applications` tables.
- **Verified:** `fertilizer_applications` already logs against any `fertilizer_id` via the existing App Log tab in `land.js` — no new table or UI required once registry rows exist.
- **Not verified (live data, not code):** you believe "Gypsum" and "Farmyard Manure" rows already exist in the live `fertilizers` table; if not, will be added going forward. No further action needed here.
- **Cleanup flagged:** `land.js` lines 41-48 define `AMEND_LABELS`/`AMEND_BADGE` (gypsum/compost/bsf_frass/biochar/lime/farmyard_manure/other) but neither constant is referenced anywhere else in the file — dead code, likely a leftover from an earlier separate-amendment-table design. Remove during a cleanup pass to avoid a future session assuming amendments are tracked separately from fertilizers.

### 5. Rotate the Supabase anon key (public repo exposure)
- **Status:** Confirmed action item, not just a design decision — repo `github.com/Rrezza/ShadeSideFarms` is public.
- **Verified:** `.gitignore` only protects `config.js`; `config.js` doesn't exist in the repo (README's setup pattern was never actually implemented); the anon key lives directly in `js/shared.js`, which has no gitignore protection.
- **Not directly verified:** exact live committed bytes of `js/shared.js` on GitHub (tooling couldn't browse the tree or fetch the raw file directly) — check it yourself on the GitHub web UI, and also check the "Old Index Files" folder for older committed copies of the key.
- **Action:** generate a new anon key in Supabase project settings, update `shared.js`, treat the old key as burned regardless of RLS status.
- **Separate, still open:** whether RLS policies correctly restrict what the anon role can read/write — that's live Supabase config, not visible from code, needs checking in the Supabase dashboard.
- Source: breakdown doc §6 item 9, escalated after direct repo check.

### 6. Concentrate Information dead route — archived, not removed yet
- **Status:** Keeping `page-feed`/`PAGE_MAP.feed`/`loadFeedCost` in place for now. Pending prerequisite before full removal.
- **What's needed first:** audit `fd_feed.js` to identify which functions the dead `loadFeedCost` page uses exclusively vs. which are also called by the live `loadProjectionsPage` (Cost Projections, still in nav) — both live in the same file. Only remove functions with no live callers; don't touch anything Projections depends on.
- Source: breakdown doc §6 item 10, decision made this session.

### 7. Drop unused `v_concentrate_cost_*` / `v_latest_ingredient_prices` views
- **Status:** Ready to execute, pending your own confirmation.
- **Verified:** no code in the repo queries any of these three views — cost calculations are done directly in JS from `recipe_ingredients`/`ingredient_acquisitions` joins.
- **Caveat (can't verify from code):** safe to drop only if nothing outside this codebase depends on them — a manual SQL editor query, a BI tool, another script. Confirm you don't have anything else pointed at these before dropping.
- **Action:** `DROP VIEW` in Supabase SQL editor — not an app-code change.
- Source: breakdown doc §6 item 11, scope corrected after direct code check (doc implied live risk; there is none currently).

---

## Archived — not applicable (no BSF on farm)

Revisit if/when BSF is introduced on the farm. Not added as build items now since there's no real workflow to build against yet.

- **BSF harvest logging** (was gap #4) — schema exists (`bsf_harvests`, `bsf_harvest_destinations`), no dashboard or applet UI. Verified: current BSF references in code are downstream-consumption only (larvae as feed input, frass as fertilizer type) — no harvest-event logging exists.
- **BSF feedstock input log** (was gap #6) — `bsf_inputs` not built; outputs are tracked but inputs aren't, so conversion efficiency can't be computed. Smaller add-on to the above, same blocker.

---

## Notes
- Items get added here as they're confirmed during review — a claim in the breakdown doc isn't added until checked against the live code.
- This file needs to be manually re-added to the project's knowledge files after edits — I can't write directly into project knowledge, only produce an updated version for you to swap in.
