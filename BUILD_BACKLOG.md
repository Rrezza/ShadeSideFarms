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
  - ~~Seed deduction from stock on sowing~~ — done 2026-11-25 with the crop store (r94)
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

### 5. Overview page — `plot_observations` table doesn't exist
- **Status:** Confirmed gap, not yet fixed. Console: `Could not find the table 'public.plot_observations' in the schema cache. Perhaps you meant 'public.crop_observations'`.
- **What's needed:** find what `overview.js` was trying to read and either point it at `crop_observations`/`plot_observations`-equivalent data or confirm the feature it backs is no longer wanted.
- Source: found 2026-09-12 while testing the anon-key rotation and the Farmhand.html fix.

### 6. Farmhand.html harvest flow — `plot_crops.active` column doesn't exist
- **Status:** Confirmed gap, not yet fixed. `init()`'s `plot_crops` fetch (`?...&active=eq.true&...`) 400s with `column plot_crops.active does not exist`, so `appData.plotCrops` stays empty and the Log Harvest screen's crop-group dropdown shows nothing.
- **What's needed:** check `plot_crops`'s real schema for the correct "is this planting active" column/condition (likely `status=eq.growing` alone, matching the pattern already used in the same query) and drop the bad `active=eq.true` clause.
- Source: found 2026-09-12 while testing the Farmhand.html fix below.

### 7. Supabase Dashboard — Site URL / Redirect URLs still point to localhost:3000 — ACTION NEEDED
- **Status:** Code side done (2026-09-13) — `auth.js`/`Index.html` now have a real forgot-password flow (request reset email → click link → set new password in-app). But it cannot work until you fix one Supabase setting.
- **Problem, found the hard way:** this session spent a long stretch debugging "can't sign in" — turned out to be two stacked issues. (1) The account owner's password was genuinely forgotten, and (2) the recovery email link redirects to `http://localhost:3000` (Supabase project's default Site URL, never changed), which goes nowhere on a phone or any real browser — so even a successful recovery click had no page to land on and set a new password. A second account (`rez@g.com`) was created via the dashboard as a workaround, but hit the *actual* root cause instead: the live site (`https://rrezza.github.io/ShadeSideFarms/`) was still serving the old, since-disabled legacy anon key because our fixes were only committed/pushed partway through the session (see item 5 above) — every request, including login, 401'd with `UNAUTHORIZED_DISABLED_LEGACY_KEY` regardless of which account was used. That part is now resolved by the push.
- **What's needed from you:** Supabase Dashboard → Authentication → URL Configuration → set Site URL to `https://rrezza.github.io/ShadeSideFarms/` and add it to Redirect URLs. Without this, clicking a password-reset email link will still redirect to a dead `localhost:3000` URL instead of landing on the new set-new-password screen.
- **Status update (2026-09-13):** confirmed via Supabase auth logs that sign-in now works end to end — `rdg@farm.com` successfully logged in (200 on `/token`) once the key-rotation fix was actually live on GitHub Pages. Site URL / Redirect URLs still need the dashboard fix described above for the reset-email flow specifically; normal password sign-in no longer needs it.
- **Not yet decided:** you now have three Supabase auth users — `rezarrezza@gmail.com` (original, password unknown), `rez@g.com`, and `rdg@farm.com` (the one that worked) — all created while chasing this bug. Pick one as canonical and delete the other two from Supabase Dashboard → Authentication → Users. All three have identical (full, non-scoped) read/write access per the RLS policies checked this session, so it's purely a housekeeping choice, not a security one.
- Source: found and mostly fixed 2026-09-12/13 during a login-lockout debugging session.

### 8. Foundation code review (shared.js + auth.js) — 5 confirmed bugs, 2 plausible, 3 cleanup
- **Status:** Reviewed 2026-09-13 via `/code-review` at high effort, 8 finder agents + 1-vote verification. First module in the planned Foundation → Land → Animals → Feed → Setup review sequence.
- **Confirmed bugs (fix candidates):**
  1. `shared.js:68` `fmtDate()` assumes a bare date string; `js/overview.js:391` calls it on a timestamptz (`plot_observations.observed_at`) with no pre-processing, so the Overview page's "Plot obs" row literally renders the text "Invalid Date" for any plot with a logged observation right now. `land.js:1366,1886` already work around this by slicing to 10 chars first — a known-but-inconsistently-patched hazard.
  2. `shared.js:279` `getLocationName()` is a copy-paste of `getPenName()` — it only searches the pens-only `anSharedPens` array, not the full `locations` table. `js/an_animals.js:77` calls it for every animal's Location column; any animal in quarantine or another non-pen location silently shows `—` instead of its real location.
  3. `js/auth.js:137` the new password-reset flow's recovery-redirect handler only checks for `type=recovery` in the URL hash. An expired/already-used reset link redirects with `#error=...` instead (confirmed via this session's own auth logs), which the guard doesn't catch — the user gets zero feedback that their link failed.
  4. `shared.js:52` `sbInsert()` never checks the returned array is non-empty before callers index `[0]` (e.g. `an_intake.js:169`, `health.js:564`, `fd_ration_plans.js:449`). If an RLS SELECT policy ever filters out a just-inserted row (real PostgREST behavior, and this project's own RLS correctness is still unverified per item 5 above), these throw an opaque "Cannot read properties of undefined" instead of a clear error.
  5. `shared.js:186` `showPage()` marks the page/nav button "active" before confirming the page's module actually loaded. A failed script fetch (flaky mobile network at the farm) leaves a blank/stale page marked active, with the only failure signal being 12px 30%-opacity text in the sidebar footer — invisible on mobile once the drawer auto-closes.
- **Plausible, not currently triggered:**
  6. `shared.js:379` `loadAll()` fires at parse time using the anon-key headers, racing `auth.js`'s `DOMContentLoaded`-gated session restore. Timing currently favors auth winning the race, but nothing guarantees it — matters once/if RLS differentiates anon vs. authenticated reads.
  7. `shared.js:67` `r1()`/`r2()` have no null-guard unlike `pkr()`/`pct()`/`kgFmt()` — every current call site happens to guard against null first, so this doesn't fire today, but it's a trap for the next caller.
- **Cleanup (lower priority):** `sbPatch`/`sbDelete` duplicate `sbPatchWhere`/`sbDeleteWhere` instead of wrapping them (plus `fd_purchases.js:96` re-derives `sbDelete` inline, a third copy); `H`/`JH` are two header objects kept in sync by hand across auth transitions instead of one being derived from the other; `loadSharedAnimalData()` fetches up to 3000 `animal_weights` rows and dedupes client-side just to get one row per animal, re-running on every one of ~15 cache-invalidating call sites.
- **Fixed (2026-09-13):** bugs #1 (`fmtDate`/"Invalid Date") and #2 (`getLocationName`) from the list above. `overview.js:391` now slices `observed_at` to a bare date before calling `fmtDate`, matching the pattern already used in `land.js`. `getLocationName()` now searches a new `anSharedLocations` array (all active locations, fetched alongside the other shared animal data) instead of the pens-only `anSharedPens` array; verified live against Supabase — correctly resolves non-pen locations (`Lower Acre 1`, `Upper Acres`) that previously returned `—`. `getPenName()` and its callers are untouched. Bugs #3 (recovery-redirect error handling), #4 (`sbInsert` empty-array), and #5 (`showPage` active-before-load) intentionally left alone for now — the reset-link one specifically was asked to be left alone.
- Source: scoped code review, 2026-09-13.

### 9. Land module code review (land.js) — 6 confirmed bugs, 1 confirmed dead code, 2 confirmed cleanup
- **Status:** Reviewed 2026-09-13 via `/code-review` at high effort, 8 finder agents + 1-vote verification. Second module in the Foundation → Land → Animals → Feed → Setup sequence. Line numbers below are pre-fix (the dead-code removal shifted everything after it up by ~170 lines — current locations noted where already fixed).
- **Fixed (2026-09-13):**
  6. Seed-stock silent data loss — `submitHarvestAlloc()` (now ~line 2409) now throws a clear error ("this crop group has no linked crop record, so it can't be allocated to seed stock") before submitting a `seed_stock` allocation whose crop group has no resolvable `crop_id`, instead of silently writing a row that `fd_seeds.js` would drop from its stock tally with no warning. Verified live: a group with no crop record is now blocked before any insert; a group with a valid crop record still allocates correctly with `crop_id` populated.
  - **Dead "Plots" tab removed** — ~170 lines (`renderLandPlots`, `submitLandPlot`, `patchLandPlot`, `retireLandPlot`, `toggleLandPlotForm`, `suggestPlotCode`, plus the leftover `#lp-code` auto-suggest wiring in `loadLandPage()`) deleted from `land.js`. Verified no dangling references anywhere in the repo, syntax checks clean, and the live Crop Tracking tab still renders correctly after the removal. `CODEBASE.md` updated to drop "Plots" from Land's sub-tab list and note where plot management actually lives (`setup_plots.js`).
- **Confirmed bugs, not yet fixed:**
  1. `land.js:1325,1533` — a crop group name is escaped for single quotes but not double quotes before going into a double-quoted `onclick` attribute (other free-text fields in the same file, e.g. `quality_notes`, correctly escape `"` as `&quot;`). A group name containing a literal `"` breaks that row's HTML.
  2. `land.js:451` — the fertilizer price chart's period cutoff is computed in local time then converted to UTC (`toISOString()`) before being used as a filter string. For a Pakistan user (UTC+5) viewing the chart between local midnight and ~5am, the cutoff is one day too early, silently including an extra day of data.
  3. `land.js:1934` — a new harvest's `cut_number` is `count of surviving rows + 1`, not `max existing cut_number + 1`. Deleting a middle cut (e.g. cut 2 of 3) and then logging a new harvest for that group produces a duplicate `cut_number` (two rows both "Cut 3").
  4. `land.js:2023` — a harvest with `quantity_kg` exactly 0 renders its edit field blank; saving that row for any reason (even an unrelated field) writes `null` via a falsy check, silently destroying the value and its linked `ingredient_acquisitions` row too. Not reachable via the app's own creation forms today (both entry points reject a 0/blank quantity), but reachable via direct DB edits or a future bulk-import path.
  5. `land.js:1898` — `submitLandCrop()` indexes `[0]` on an insert result with no length check, inconsistent with this same file's own guarded version of the identical pattern nearby. Same underlying risk as Foundation review item 8.4 (`sbInsert` empty-array).
- **Confirmed cleanup, not yet fixed:** `land.js`'s `safeFetch()` duplicates `overview.js`'s `safeFetchOv()` almost verbatim instead of one shared tolerant-fetch helper in `shared.js` — same shape as the Foundation review's reuse findings. Crop-level and plot-level observation panels are two ~150-190 line parallel CRUD stacks; real divergence exists (crop-obs syncs `health_status`/`pest_disease_flag` back to the parent row and has a delete-time rollback plot-obs lacks), so consolidating isn't a trivial table-name parameter swap, but the duplication is real and already inconsistent between the two.
- **Also found, not yet verified (lower confidence, worth a look during a fix pass):** an inconsistent `observed_at` timestamp construction between `submitPlotObservation` (raw date) and `submitObservation` (explicit UTC midnight); several O(n×m) linear-scan render costs in `renderLandCrops`/`renderLandFert` that will slow down as data accumulates; sequential `await`s in `submitHarvestAlloc`/`patchHarvest`/`refreshCropObs` where the calls are independent and could run in parallel; a hardcoded foliar-spray/tubewell salinity check that won't generalize to a future high-risk method.
- Source: scoped code review, 2026-09-13.

### 10. Animal module code review (an_helpers.js, an_animals.js, an_intake.js, an_groups.js, an_weights.js, an_feed.js) — 6 confirmed bugs, 2 confirmed cleanup, 2 confirmed efficiency
- **Status:** Reviewed 2026-09-13 via `/code-review` at high effort, 8 finder agents + 1-vote verification. Third module in the Foundation → Land → Animals → Feed → Setup sequence.
- **Fixed (2026-09-13):**
  1. Live crash — `an_animals.js:59`'s `renderAnimalsList()` referenced an undeclared variable `alFilterUnassigned`; now correctly compares `alFilterTab === 'unassigned'`. Was throwing a `ReferenceError` and breaking the whole Animals list page any time the current filter tab had zero matching animals (e.g. clicking "Sick" or "Quarantine" when none qualify — a normal everyday state). Found independently by 4 of the 8 finder passes, the most corroborated finding of the session so far. Verified live both empty-state message variants render correctly with no throw.
  - **Dead code removed** — `an_helpers.js`'s `wtChart1`/`wtChart2`/`wtAxis1`/`wtAxis2` (pre-rebuild two-chart design leftovers) and its shadowed duplicate `wtAllWeights` declaration deleted. Confirmed zero references anywhere in the repo before removal; `an_weights.js` remains the sole real owner of `wtAllWeights`/`wtChart`/`wtChartMode`/`wtYAxis`. `CODEBASE.md`'s `an_helpers.js` entry corrected to match.
  2. `an_intake.js` batch intake now calls `speciesPrefix()` from `an_helpers.js` (matching single-animal intake) instead of its own incomplete inline prefix map. Verified live: batch-intaking rabbits now correctly generates `R-001`, `R-002` instead of `A-001`, `A-002`.
  3. All three unguarded `sbInsert()` results in `an_intake.js` now throw a clear error if the database doesn't return the expected rows, instead of crashing or silently under-reporting. The multi-row batch case specifically now requires an exact count match before writing any quarantine/group records — verified live with a simulated 5-requested/3-returned case: correctly throws `"Expected 5 animals to be saved but the database returned 3..."` and skips the downstream writes entirely, instead of the old behavior of reporting full success for a partial insert.
  4. `computeGroupStats()` (`an_helpers.js`) now always computes ADG when there's enough data (≥7 days), including negative values, instead of folding weight loss into "insufficient data". Verified live: a simulated weight-loss case now returns a real `adg: -108.7` instead of `adgInsufficient: true`. Downstream display in `an_groups.js`/`overview.js` needed no changes — their truthy check on `stats.adg` already handles negative numbers correctly, it only ever hid a `0` exactly.
  5. Current-weight calc in `an_helpers.js` and the duplicated copy in `an_groups.js` now use `!= null` instead of a truthy check on `entry_weight_kg`, matching the pattern already used one line above. Verified live: an animal with `entry_weight_kg = 0` and no weigh-ins now correctly counts toward `avgCurrent` instead of being silently dropped.
  6. `an_feed.js`'s feed variance column now uses `!= null` instead of a truthy check on the summed concentrate total. Verified: a 0kg "feed ran out" period now correctly computes a -100% variance instead of showing blank.
- **Confirmed efficiency, not yet fixed:** every single-row edit across the module (`an_animals.js:172` and similar in `an_intake.js`/`an_groups.js`) refetches all 9 shared Supabase queries instead of updating the one changed record in memory — routine batch work like checking 15 animals during quarantine clearance costs 15x the necessary round trips. Table renders in `an_animals.js`/`an_weights.js`/`an_groups.js` re-scan full shared arrays per row via `.find()`/`.every()` instead of indexing once — same O(n×m) pattern already flagged in `land.js`, will get slower as the herd scales per FARMDOMAIN.md's growth goals.
- **Also found, not yet verified (lower confidence):** `speciesPrefix()` hardcodes species prefixes as an if/else chain rather than a `species` table column, meaning every new species (e.g. the planned turkeys per FARMDOMAIN.md) needs a code change nobody editing the Species setup page would know to make; date-math ("days since X") is copy-pasted inline 6 times across the module instead of one helper; `statusBadge()` exists in `an_helpers.js` but `an_animals.js`/`an_groups.js` each hardcode the identical badge-color ternary instead of calling it; two files (`an_animals.js`/`an_groups.js`) each hand-roll their own ordered child-table delete list instead of one shared cascade-delete helper.
- **Noticed in passing while fixing item 2, not touched (flagging per house rule rather than fixing unprompted):** `an_intake.js:266`'s `existingNums` filter in `submitBatchIntake()` does `a.farm_id.startsWith(prefix)` with no null-guard on `a.farm_id` — the equivalent shared helper `nextFarmIdForPrefix()` in `an_helpers.js` correctly checks `a.farm_id &&` first. Also `an_intake.js` has 4 leftover `console.log('[intake] ...')` debug lines (just before/after the `animals` insert in `submitBatchIntake`) that look like troubleshooting leftovers rather than intentional logging.
- Source: scoped code review, 2026-09-13. Items 2-6 fixed 2026-09-15.

### 11. Feed module code review (fd_shared.js, fd_recipes.js, fd_ration_plans.js, fd_feed.js, fd_inventory.js, fd_purchases.js, fd_prices.js, fd_seeds.js) — 5 confirmed bugs (one breaks core saves entirely), ~520 lines of confirmed dead code, 2 confirmed reuse
- **Status:** Reviewed 2026-09-15 via `/code-review` at high effort, 8 finder agents + 1-vote verification. Fourth module in the Foundation → Land → Animals → Feed → Setup sequence. None of these are fixed yet.
- **#1 — FIXED 2026-09-15:** `fd_inventory.js` (`submitFiAcq`, the "Log purchase/harvest" form, and the batch-mix auto-generated "produced" acquisition) both included `cost_per_kg` in their insert payload. **Confirmed directly against the live Supabase schema**: `ingredient_acquisitions.cost_per_kg` is a Postgres `GENERATED ALWAYS` column (`ROUND(total_cost_pkr/quantity_kg,2)`) — Postgres rejects any INSERT that supplies a value for a generated column. Removed `cost_per_kg` from both payloads (the DB computes it automatically). Verified live end-to-end: submitted a real test row through the actual form, confirmed it saved with `cost_per_kg` auto-computed correctly (50.00 from 500/10), then deleted the test row.
  - **Follow-on bug surfaced by this fix, FIXED 2026-09-15:** with the GENERATED-column error out of the way, logging an acquisition with type `purchased` (the most common real case) still failed on a *different*, previously-masked constraint: `CHECK (acquisition_type <> 'purchased' OR supplier_id IS NOT NULL)`, but the live "Log purchase" modal has no supplier field at all — supplier is recorded informally via the notes field ("Supplier, lot, quality notes…"). Per your decision, dropped the constraint (`ALTER TABLE ingredient_acquisitions DROP CONSTRAINT purchased_requires_supplier`, migration `drop_purchased_requires_supplier_constraint`) rather than adding a supplier dropdown — informal notes-field tracking is the intended workflow. Verified live end-to-end: a real `purchased` row now saves correctly with `supplier_id: null` and the supplier name in `notes`, exactly as intended.
  - **Net result: Ingredient Inventory's "Log purchase," "Log harvest receipt," and "Mix batch" are all fully working again**, for every acquisition type.
- **Other confirmed bugs, ranked by severity:**
  2. `fd_ration_plans.js:285` — the ration modeller divides an as-fed cost by a dry-matter fraction to compute `costPerKgAf`, then multiplies that DM-basis number by an as-fed quantity two lines later — a unit mismatch that overstates concentrate (and total) daily cost by ~14% at a typical 88% DM. This is a financial figure used directly for fattening-cycle cost projections.
  3. `fd_ration_plans.js:309-317` — blended CP/ME sums `weight × value` only for components with data present, never renormalizing the weights to what's actually there. A 40/30/30 conc/hay/fodder split with concentrate data missing understates blended CP by ~40%, which can flip the ✓/⚠/✗ adequacy flag from adequate to deficient purely because a field was blank.
  4. `fd_recipes.js:408,421` and `fd_ration_plans.js:448` — three more unguarded `sbInsert()[0]` indexes (same bug class as Foundation/Land/Animals findings), and confirmed worse here: neither the recipe→recipe_versions nor the ration_plan→ration_plan_versions create-flow rolls back the first insert if the second fails, leaving an orphaned parent row with no version — which then breaks the edit/detail view for that recipe or plan with no obvious cause.
  5. `fd_inventory.js:150` — stock calculation excludes ALL `acquisition_type='produced'` rows on the assumption they only come from concentrate batch outputs (tracked separately). Confirmed the inline acquisition-log editor lets a user set `'produced'` on any ingredient's row with no restriction — doing so on a non-concentrate ingredient (e.g. hand-harvested fodder) silently removes that quantity from stock everywhere, with no warning.
- **Confirmed dead code — large, ~520 lines combined:**
  - `fd_purchases.js` — the **entire 243-line file** is unreachable (no nav button, orphaned `PAGE_MAP` entry) and duplicates the live "Acquisition Log" tab in `fd_inventory.js` against the same table.
  - `fd_feed.js` — a ~277-line "Ration Setup" chain (`loadFeedModeller`, `onRoughageSelect`, `onConcRecipeSelect`, `saveRation`, `loadRationRecipes`, `loadRationFromSaved`, `deleteRationRecipe`) is dead, superseded by `fd_ration_plans.js` per that file's own header comment, and writes to an orphaned `ration_recipes` table nothing else touches. **Caveat before deleting the HTML**: the live Cost Projections page's `calcFeedCost()` still reads `fc-conc-split`/`fc-hay-split`/`fc-fodder-split` from DOM elements that only exist in this dead page's markup (JS fallback is `0`, not the HTML's `33.3/33.3/33.4` default) — removing the HTML before re-pointing Cost Projections at real persisted state would silently zero out its daily-quantity and cost figures.
  - This confirms and supersedes BUILD_BACKLOG item 6's framing — the "Concentrate Information" page it describes is real, but there's a second, larger dead chain in the same file nobody had found yet.
- **Confirmed reuse, not yet fixed:** nutrient adequacy thresholds (14%/12% CP, 9.0/8.5 ME) are hardcoded independently in at least 6 places across `fd_recipes.js`/`fd_feed.js`/`fd_ration_plans.js` — a farm target change means hunting down 6 literals, and missing one leaves pages disagreeing on the same recipe's adequacy verdict. `fd_inventory.js`'s `fiSafe()` and `fd_seeds.js`'s `sdSafe()` are a third independent copy of the same "swallow fetch errors, return []" wrapper already flagged twice this session in `land.js`/`overview.js` — strong signal it belongs in `shared.js` once, as `sbGetSafe()`.
- **Lower priority:** `fd_feed.js:35`'s price-entry modal rejects a legitimate price of exactly 0 via a falsy check — currently unreachable since it's part of the already-known-dead Concentrate Information page, but worth fixing alongside that page's eventual cleanup.
- Source: scoped code review, 2026-09-15.

### 12. Setup module code review (setup_shared.js, setup_species.js, setup_ingredients.js, setup_locations.js, setup_plots.js, setup_crops.js, setup_harvest_destinations.js, setup_fertilizers.js, setup_inventory.js, setup_workers.js, setup_tools.js) — 4 confirmed correctness bugs, 3 confirmed dead-code/doc-drift items, 3 confirmed reuse
- **Status:** Reviewed 2026-09-19 via `/code-review` at high effort, 8 finder agents + 1-vote verification. Fifth (final) module in the Foundation → Land → Animals → Feed → Setup sequence — **all four correctness bugs fixed, all confirmed dead code removed, same day.** Notably cleaner than the other four modules going in — all 11 pages were reachable (no dead pages/tabs here), and several files (`setup_harvest_destinations.js`, `setup_workers.js`, `setup_tools.js`, `setup_species.js`) came back with zero findings.
- **Fixed 2026-09-19:**
  1. **Cross-cutting, mattered most:** adding or deleting a species (`setup_species.js`), worker (`setup_workers.js`), or location (`setup_locations.js`) never refreshed the shared `anSharedSpecies`/`anSharedWorkers`/`anSharedPens` caches that `an_intake.js`, `an_feed.js`, `health.js`, `finance_expenses.js`, and `an_groups.js` all read from — only the *edit* path did. Added the same refresh call the edit paths already used to `submitSpecies`/`deleteSpecies`, `submitNewWorker`/`deleteWorker`, and `submitNewLocation`/`retireLocation`/`reactivateLocation` (the location one now refreshes both `anSharedPens` and `anSharedLocations` via a new shared `refreshSharedLocationCaches()` helper). Verified live via direct DB insert + cache-refresh call: a species invisible to the cache before the refresh call is correctly present after.
  2. `setup_inventory.js:63-64` — a fertilizer's `quantity_per_purchase_unit` of exactly `0` was treated as "no conversion factor" via a truthy check. Changed to `!= null`. Verified live: 0 now stays 0 instead of silently becoming `null`.
  3. `setup_locations.js:41-44` — the "Parent shed" dropdown filtered by `location_type === 'shed'` but not `active`. Added the `active` check every other filter in the file already had. Verified live: a retired test shed no longer appears in any parent-shed dropdown.
  4. `setup_crops.js:157-165` — `toggleCropDest()` had no guard against overlapping calls for the same crop. Added a per-crop promise queue (`cropDestQueue`) so each toggle waits for the previous one to fully land before reading the array again. Verified live by reproducing the exact race with a simulated network delay: old code lost one checkbox's change, the new queued version kept both.
- **Dead code removed, 2026-09-19:**
  - `setup_fertilizers.js` — the entire fertilizer purchase-modal chain (`openFertPurchaseModal`/`closeFertPurchaseModal`/`submitFertPurchase`/`updatePurchaseDerived`/`updatePurchaseModalLabels`), the dead `fertNf()` helper, the dead `fertPurchaseData` global, and the corresponding `#fert-purch-modal` HTML in `Index.html` — all with zero live callers, superseded by `land.js`'s `openLandPurchModal()`.
  - `setup_inventory.js` — the dead `invIngStock`/`invIngList` computation (two wasted queries per page load, zero consumers) **and a second dead cluster found while cleaning it up**: `openStockAdjModal`/`closeStockAdjModal`/`submitStockAdj`/`stockAdjIngId` and the `#stock-adj-modal` HTML, fully superseded by `fd_inventory.js`'s own separate `fi-adj-modal`/`submitFiAdj`. Neither was reachable from anywhere in the live app.
  - All removals verified: zero remaining references anywhere in the live codebase (repo-wide grep, excluding the `Old Index Files` backup folder), and every affected Setup page confirmed to still load cleanly afterward.
- **Confirmed reuse, not yet fixed:** the same "swallow FK error via string-matching instead of a structured error code" pattern already flagged in `land.js` recurs in `setup_shared.js`'s `fkErrMsg()` — a third module with this gap now. `setup_fertilizers.js`'s `fertStockUnit()`/`fertPurchUnitLabel()` hardcode a single `'liquid'` special case (everything else assumed kg/bag) and `setup_inventory.js` reimplements the identical ternary inline instead of calling the shared function — works today only because all 4 non-liquid types happen to be solids. The generic inline-edit/patch/delete pattern is copy-pasted across 8+ registry files (`setup_species.js`, `setup_ingredients.js`, `setup_locations.js`, `setup_crops.js`, `setup_fertilizers.js`, `setup_workers.js`, `setup_tools.js`, `setup_harvest_destinations.js`) instead of one shared helper each.
- Source: scoped code review, 2026-09-19.

### 14. Farm-wide inventory / purchasing system
- **Status:** Future — agreed direction 2026-11-20, not designed yet.
- **Idea:** one purchasing + stock system across all farm items — medicines, fuel, fertilizer, tools, feed ingredients, seeds — instead of today's separate per-module purchase tables.
- **Groundwork:** the medicine cabinet (`medicines` + `medicine_movements`) was deliberately built in the item-registry + movement-ledger shape such a system would use, so it can fold in with a mechanical migration. Fertilizers, ingredients and seeds each have their own purchase tables and pages today — migrating those is the real work.

### 17. Farmhand.html — "sick animal" quick report
- **Status:** Agreed for later (2026-11-25). Not designed yet.
- **Idea:** workers see problems first. A two-tap flow in `Farmhand.html` — pick animal, pick symptom (off feed, limping, coughing, scouring, bloat, injury, other), optional note — that creates an `observation` health event for that animal with a follow-up date of today, so it lands in the dashboard's Health › Due now and Overview follow-up reminders automatically.
- **To decide when building:** symptom list; whether to allow a photo; whether the worker picks from a list of animal IDs (needs readable tags on the goats) or by group + description.

### 19. Equipment depreciation
- **Status:** Deferred by choice (2026-11-25). Purchase date and cost are recorded on every equipment item, so straight-line depreciation over a useful life can be added later without re-entering anything — worth doing once a farm-wide P&L exists.

### 16. Land page — `crop_observations.notes` column doesn't exist
- **Status:** Confirmed, not fixed (found 2026-11-20 while testing the Inventory menu — flagging per house rule).
- **Problem:** loading the Land page requests `crop_observations?select=...,notes,...`, which 400s with `column crop_observations.notes does not exist` (the real column is `note`, singular — `overview.js` already uses `note`). Crop-level observations therefore don't load on the Land page.
- **Fix:** change `notes` → `note` in that `land.js` query (and anywhere it reads `.notes` off those rows). Small; needs your go-ahead.

---

## Resolved — no code change needed

### Ranged medicine doses — DONE 2026-11-26 (r98)
- Any label dose (and species row) can be a range, e.g. 4–8 ml. Dose grid pre-fills the midpoint; doses typed outside the range are flagged amber (warning only); reorder reminders estimate from the top of the range.

### Medicine routes and whole-group rounds — DONE 2026-11-26 (r97)
- Route on each medicine (usual) and each health event (actual). In water / in feed / spray rounds record one total (and water volume), split evenly per animal as estimated shares; withdrawal applies to every ticked animal. New label dose "per litre of water". Pregnant animals on an unsafe product are warned about, not unticked. Look-ahead for these uses the last round's total.
- Switching an existing round between whole-group and per-animal is blocked on edit (delete and re-log instead).

### Per-species medicine doses — DONE 2026-11-26 (r96)
- A medicine's label dose is now the default; species-specific rows (by weight or fixed per animal) override it. The dose grid and reorder reminders use each animal's species. Withdrawal stays one value per medicine (by choice — use the longest if labels differ).

### Pesticides & sprays, medicine fridge flag — DONE 2026-11-25 (r95)
- **Separate registry by choice** (not folded into fertilizers): `pesticides` + `pesticide_movements` ledger. Setup and Inventory pages "Pesticides & Sprays"; Land › Spraying tab logs sprays per plot.
- **Pre-harvest wait:** each product's days-to-wait; logging any harvest from a plot inside a waiting period asks to confirm. Overview plot cards show "safe to cut from …" and spray counts for the last 12 months, synthetic vs organic. Below-minimum pesticides join "Supplies to buy". Farmhand app has no warning (by choice). No worker re-entry period (by choice).
- **Medicines:** "Keep refrigerated" checkbox, shown as a fridge badge.
- Spray counts treat each logged spray as one, whatever the amount (assumption).

### Inventory step 3: crop store (Seeds & Harvest) — DONE 2026-11-25 (r94)
- Inventory › Seeds & Harvest reworked into a per-crop store: bought, harvested (harvest allocation destination `seed_stock`, relabelled "Crop store (grain / seed)"), sown (`plot_crops.qty_kg_sown`, new field on the planting form + editable in History), to feed (creates the Feed-stock entry), sold, household, spoiled, counts. New `crop_stock_movements` table; empty `seed_purchases` / `seed_stock_adjustments` dropped.
- **Your existing 22 plantings have no seed-sown amount** — fill them in from each crop's History if you want past sowing deducted.

### Inventory steps 1–2: health supplies, tools & equipment, consumables — DONE 2026-11-25 (r93)
- **Health supplies** (syringes, gloves…) live alongside medicines (Setup and Inventory › Medicines & Health Supplies), counted in pieces with Buy / **Use** / Count and minimum-stock reminders; kept out of dosing pickers.
- **Inventory › Tools & Equipment** (new; Setup › Tools and `setup_tools.js` removed): equipment with quantity, condition, purchase date and cost, repair log; totals for invested and repairs. No location tracking (by choice — things move around too much). No lending (rarely lent out).
- **Consumables** (fuel, twine, feed bags…) on the same page, same ledger as medicines; low ones join the Overview banner, renamed "Supplies to buy".

### Breeding events: edit and delete — DONE 2026-11-25 (r92)
- Edit (re-uses the mating form) and Delete on each breeding row.
- Fixed on the way: expected kidding date was a day early in UTC+5 (`toISOString()`); "Birth registered" showed Yes for any birth the doe had ever had, not one after that mating.

### Sign-in kept alive + breeding/species tidy-up — DONE 2026-11-25 (r91)
- **Root cause of the breeding "RLS error":** not the breeding table. Confirmed in the API logs — the save went out with the anonymous key (`POST 401`, "new row violates row-level security policy"). `auth.js` (1) never saved a refreshed session, so after Supabase rotated the refresh token the next reload silently dropped to read-only, and (2) had no renewal while the page was open, despite CODEBASE.md saying it did. Worse, edits/deletes sent while read-only returned success but changed nothing — confirmed: the Nitroxin "not safe in pregnancy" edit at 07:58 that day never saved.
- **Fix:** refreshed sessions saved; token renewed 2 min before expiry and on wake; every write calls `authBeforeWrite()` first (renews if needed, otherwise a clear "you are signed out" error).
- **Breeding:** "Sire unknown" dropdown removed from Breeding and Birth forms (blank sire = unknown); breeding location removed and `breeding_events.location_id` dropped (never shown or used, no rows).
- **Species:** gestation days added to Setup › Species (add + edit). Fixed: species add/edit/delete refreshed the shared species cache without `gestation_days`, which would have reset every pregnancy due date to the 150-day default.

### Health: pregnancy safety, weight alerts — DONE 2026-11-25 (r90)
- **Pregnancy safety:** `medicines.unsafe_in_pregnancy` + `animals.expected_birth_date`; pregnant = manual expected date or a logged mating within gestation, until a birth is logged or 14 days past due. Dose grid pre-fills 0 for pregnant animals on flagged medicines; "pregnant, due …" badges on Groups / Animals / dose grid.
- **Weight alerts on Overview:** loss > 0.5 kg since last weigh-in, slow gain (< half the group's average daily gain), and overdue weigh-ins per group. Dismissable (`weight_alert_dismissals`).
- **Fix:** per-goat health history showed group medicine rounds for goats deliberately skipped (e.g. Barka/BlackMom on 14 Nov) — now only shown if the goat was dosed.
- **Needs your setup:** neither group has a weigh-in reminder interval, so overdue alerts won't appear until one is set (Groups › Edit group). Barka/BlackMom's expected birth dates and Nitroxin's "not safe in pregnancy" box need setting for the pregnancy check to use them.

### Health: per-animal history, arrival protocols, targeted deworming — DONE 2026-11-25 (r89)
- **Per-animal health history:** Health button on Animals list and Groups member rows (`openAnimalHealthHistory()` in `health.js`).
- **Arrival protocols:** Setup › Health Protocols + Apply protocol on a group (`setup_protocols.js`; tables `health_protocols`, `health_protocol_steps`).
- **Targeted deworming:** FAMACHA scores at weigh-ins (`famacha_scores` table); deworming dose grid pre-fills 0 for scores 1–2 within 14 days (assumption: 14 days is the freshness cut-off — adjust `HF_FAMACHA_MAX_AGE_DAYS` if wanted); last-dewormer / same-class warning on the log form, Due cards and Schedules table.
- **Fixed on the way:** one-off schedules never closed after being logged (only repeating ones were handled) — they now set `active=false`. Repeating schedules' next due date was computed via `toISOString()` and landed one day early in Pakistan (UTC+5) — now local-date maths.
- **Not yet set:** none of your medicines has an active ingredient recorded (e.g. Nitroxin = nitroxynil), so the rotation check currently only catches the *same product* reused. Fill in Active ingredient under Setup › Medicines for it to catch different brands of the same drug.

### Health: mortality fix, withdrawal periods, follow-up reminders — DONE 2026-11-25 (r87)
- **Mortality (was #13):** `mortality` added to `health_event_enum`; the health event is now saved before the mortality record / deceased status / membership close, and rolled back if those fail. The mortality record now carries the animal's group (previously only set for group-targeted events, which can't log a death), so group P&L death counts are correct.
- **Withdrawal periods (was #15):** `medicines.withdrawal_days`; red "withdrawal to <date>" badges on Groups members and the Animals list; sale and Left farm warn and ask to confirm (checked against the sale/exit date).
- **Follow-ups:** `animal_health_events.follow_up_done`; open follow-ups show in Health › Due now (14 days) and on Overview (7 days / overdue) with Log follow-up and Done. Changing a follow-up date in Edit re-opens it.
- **Bug found and fixed on the way:** the Schedules form (added r82) reused the sale form's `sf-animal`/`sf-notes`/`sf-status` IDs. Because the Health page comes first in the page, recording a sale in Cost & Sales read the empty schedule box and always failed with "Select an animal" — sales were broken from r82 to r86. Schedule form IDs renamed to `sch-*`.

### Stale cached scripts after deploys — FIXED 2026-11-20 (r84)
- **Symptom:** after the r83 push, Setup › Medicines hung on "Loading..." — the browser was still running cached pre-r83 JS, because every script's cache-busting `?v=` number was hand-typed (`?v=29`, `?v=27`...) and never bumped with builds.
- **Fix:** one `APP_BUILD` constant in `Index.html` drives every `?v=` (static scripts + `loadModule()`) and the sidebar footer. `CLAUDE.md`'s version rule now points at it. GitHub Pages still caches `Index.html` itself for up to 10 minutes, so a deploy can take that long to reach a browser.

### Medicine cabinet + reorder reminders — BUILT 2026-11-20
- **Reorganised same day (r83):** split into Setup › Medicines (the list) and Inventory › Medicines (stock, buying, counts, reminders). New sidebar **Inventory** section above Feed now also holds Fertilizers, Feed Ingredients and Seeds (menu moves only — pages unchanged). Old Setup › Inventory page and `setup_inventory.js` removed (duplicated Land's fertilizer stock).
- New Medicines page (`health_meds.js`), per-animal dose grid on the Health treatment form, Schedules manager on the Health page, "Medicines to buy" banner on Overview. See `CODEBASE.md`.
- **Schema (migrations `medicine_inventory`, `health_events_allow_group_target`):** new `medicines` and `medicine_movements` tables; `medicine_id` on `animal_health_events` and `scheduled_health_events`; schedules' target rule relaxed to exactly one of animal/group/location (was animal-or-location only, so group schedules were impossible).
- **Pre-existing bug fixed because it blocked this:** `animal_health_events.animal_id` was `NOT NULL`, so the Health form's "Group" target could never save. Now nullable with a check that an animal or a group is set.
- **Verified:** with seeded test rows against live Supabase — stock maths, dose suggestions, look-ahead shortfall, Overview banner, cost auto-fill, and Cost & Sales P&L pickup. Form payloads were captured and replayed via SQL (the browser session was read-only, not signed in), so the signed-in click-through itself is untested. Test rows deleted.

### Gypsum / manure as fertilizer-registry entries (was gap #5 + part of item #2)
- **Decision:** Gypsum and farmyard manure are modeled as `fertilizers` registry rows, not separate `amendment_applications`/`gypsum_applications` tables.
- **Verified:** `fertilizer_applications` already logs against any `fertilizer_id` via the existing App Log tab in `land.js` — no new table or UI required once registry rows exist.
- **Not verified (live data, not code):** you believe "Gypsum" and "Farmyard Manure" rows already exist in the live `fertilizers` table; if not, will be added going forward. No further action needed here.
- **Cleanup flagged:** `land.js` lines 41-48 define `AMEND_LABELS`/`AMEND_BADGE` (gypsum/compost/bsf_frass/biochar/lime/farmyard_manure/other) but neither constant is referenced anywhere else in the file — dead code, likely a leftover from an earlier separate-amendment-table design. Remove during a cleanup pass to avoid a future session assuming amendments are tracked separately from fertilizers.

### 5. Rotate the Supabase anon key (public repo exposure) — DONE (2026-09-12)
- **Status:** Fully done. Legacy JWT-based API keys disabled in the Supabase dashboard and confirmed via `get_publishable_keys` (`disabled: true` on the legacy anon key). Live app re-verified working against the publishable key after disabling.
- **Done:** `js/shared.js` and `Farmhand.html` (a second hardcoded copy, not previously tracked in `CODEBASE.md` — found and fixed same session) both switched from the legacy anon JWT to the modern `sb_publishable_...` key. Verified live against Supabase via a local static server for both files. Confirmed no `service_role` key is referenced anywhere in the repo, so disabling legacy JWT keys won't break anything else here.
- **Not verified:** whether an older committed copy of the leaked JWT still sits in the "Old Index Files" folder or elsewhere in git history — history isn't rewritten by this fix, only the live code. The dashboard step (disabling legacy keys) is what actually invalidates the leaked key regardless of where else it's committed.
- **Separate, still open:** whether RLS policies correctly restrict what the anon role can read/write — see the 8 `rls_enabled_no_policy` findings from `get_advisors` (tables: `animal_purpose_history`, `bsf_harvest_destinations`, `bsf_harvests`, `ingredient_substitutes`, `production_event_inputs`, `production_event_labor`, `production_events`, `rainfall_events`) plus 6 `security_definer_view` findings on views `v_animals_current`, `v_latest_ingredient_prices`, `v_concentrate_cost_current`, `v_concentrate_cost_summary`, `v_pen_summary`, `v_health_due_soon`. Not addressed this session — flagging for a future pass.
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

### 8. Farmhand.html — fixed the syntax error and a deeper broken flow (2026-09-12)
- **Symptom found:** `Uncaught SyntaxError: Unexpected token ')'` — the whole inline `<script>` block failed to parse, so nothing on the page worked (no worker select, no flows). Localized via `node --check` on the extracted script to line 1727 — `wConfirm()` (watering) was missing its `await submitEntry('watering_events', payload, (queued) => {...})` opening call entirely, leaving a stray `});` with no matching call.
- **Deeper issue found while fixing:** `aConfirm()` (soil amendment) had the identical missing-wrapper bug, and its whole payload was built against a table (`amendment_applications`) and shape (`amendment_type`/`description` free text) that don't exist live — the real table is `fertilizer_applications`, which needs a `fertilizer_id` FK into the `fertilizers` registry (matching the design decision already made for `land.js`, see the resolved gypsum/manure item above) plus `worker_id` (not `recorded_by`). The UI's "Amendment type" dropdown was a hardcoded enum (gypsum/compost/bsf_frass/biogas_digestate/elemental_sulfur/other) that never matched any live schema.
- **Fixed:** watering flow now submits correctly with the required `method` (added a Method dropdown — flood/furrow/drip, matching `land.js`'s `lw-method` options — this table also turned out to require it, a second latent bug caught during testing) and `water_source` (defaulted to `'tubewell'`, same fallback `land.js` uses). Amendment flow now fetches the live `fertilizers` registry in `init()` and presents a real fertilizer picker instead of the dead enum; submits to `fertilizer_applications` with the correct columns. Both flows tested end-to-end against live Supabase (row inserted, verified by column values, then deleted as test data).
- **Verified NOT broken:** the other five `submitEntry()` calls (purchase, harvest ×2, crop observation, eggs) — checked each payload's fields against the live schema directly; all matched, no changes needed there.
- Source: found and fixed 2026-09-12 while making Farmhand.html usable for mobile field-testing. See items 5 and 6 above for two more schema mismatches found in the same pass (not yet fixed).

---

## Archived — not applicable (no BSF on farm)

Revisit if/when BSF is introduced on the farm. Not added as build items now since there's no real workflow to build against yet.

- **BSF harvest logging** (was gap #4) — schema exists (`bsf_harvests`, `bsf_harvest_destinations`), no dashboard or applet UI. Verified: current BSF references in code are downstream-consumption only (larvae as feed input, frass as fertilizer type) — no harvest-event logging exists.
- **BSF feedstock input log** (was gap #6) — `bsf_inputs` not built; outputs are tracked but inputs aren't, so conversion efficiency can't be computed. Smaller add-on to the above, same blocker.

---

## Notes
- Items get added here as they're confirmed during review — a claim in the breakdown doc isn't added until checked against the live code.
- This file needs to be manually re-added to the project's knowledge files after edits — I can't write directly into project knowledge, only produce an updated version for you to swap in.
