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

### 10. Animal module code review (an_helpers.js, an_animals.js, an_intake.js, an_groups.js, an_weights.js, an_feed.js) — 6 confirmed bugs (one a live crash), 2 confirmed cleanup, 2 confirmed efficiency
- **Status:** Reviewed 2026-09-13 via `/code-review` at high effort, 8 finder agents + 1-vote verification. Third module in the Foundation → Land → Animals → Feed → Setup sequence. None of these are fixed yet.
- **Confirmed bugs, ranked by severity — #1 is a live crash, worth fixing first:**
  1. `an_animals.js:59` — `renderAnimalsList()` references an undeclared variable `alFilterUnassigned` (the real one is `alFilterTab`). This throws a `ReferenceError` and breaks the whole Animals list page **any time the current filter tab has zero matching animals** — e.g. clicking "Sick" or "Quarantine" when none currently qualify, a completely normal everyday state. Found independently by 4 of the review's 8 finder passes — the most corroborated finding of the session so far.
  2. `an_intake.js:260-271` — batch intake reimplements farm-ID prefix logic inline instead of calling `speciesPrefix()` from `an_helpers.js`, and the inline copy omits Rabbit (`R-`) and Donkey (`DN-`), defaulting them to `A-`. Batch-intaking those species gets a different, wrong prefix than single-animal intake of the same species gets.
  3. `an_intake.js:168-169,257-258,296/316/323` — three `sbInsert()` results are indexed with no length check (same bug class as Foundation/Land findings). Worse than a simple crash risk: if Supabase returns fewer rows than requested, nothing throws, but the success message shows a farm-ID range derived from the truncated array while quarantine/group-membership records also silently only cover the returned subset — the UI reports full success for animals that didn't get their records created.
  4. `an_helpers.js:45-52` — `computeGroupStats()` treats a group that's genuinely *losing* weight identically to a group with too few weigh-ins — both show "insufficient data" instead of the group showing a real negative ADG. Hides exactly the signal (a health/feed problem) a farm manager most needs to see.
  5. `an_helpers.js:31` (duplicated `an_groups.js:85`) — current-weight calc treats `entry_weight_kg = 0` as missing via a truthy check, while a nearby line correctly uses `!= null` — confirmed reachable (the intake form's weight field allows 0), and causes the two averages this function computes to silently disagree on which animals count.
  6. `an_feed.js:388-389` — the feed variance column's guard truthy-checks a summed concentrate total, so a period where concentrate was legitimately 0 (every event logged as the real `not_offered` response — i.e. feed ran out) shows blank instead of flagging the ~-100% shortfall the column exists to catch.
- **Confirmed efficiency (not yet fixed):** every single-row edit across the module (`an_animals.js:172` and similar in `an_intake.js`/`an_groups.js`) refetches all 9 shared Supabase queries instead of updating the one changed record in memory — routine batch work like checking 15 animals during quarantine clearance costs 15x the necessary round trips. Table renders in `an_animals.js`/`an_weights.js`/`an_groups.js` re-scan full shared arrays per row via `.find()`/`.every()` instead of indexing once — same O(n×m) pattern already flagged in `land.js`, will get slower as the herd scales per FARMDOMAIN.md's growth goals.
- **Confirmed cleanup (not yet fixed):** `wtAllWeights` is declared as shared state in `an_helpers.js:13` but is fully dead — `an_weights.js` independently re-declares and exclusively owns the same global (both load as classic scripts into one global scope), silently shadowing the `an_helpers.js` copy. `an_helpers.js:9-12`'s `wtChart1`/`wtChart2`/`wtAxis1`/`wtAxis2` are dead globals from a pre-rebuild two-chart design (confirmed zero references anywhere) — `CODEBASE.md`'s `an_helpers.js` entry still documents them as live and needs correcting.
- **Also found, not yet verified (lower confidence):** `speciesPrefix()` hardcodes species prefixes as an if/else chain rather than a `species` table column, meaning every new species (e.g. the planned turkeys per FARMDOMAIN.md) needs a code change nobody editing the Species setup page would know to make; date-math ("days since X") is copy-pasted inline 6 times across the module instead of one helper; `statusBadge()` exists in `an_helpers.js` but `an_animals.js`/`an_groups.js` each hardcode the identical badge-color ternary instead of calling it; two files (`an_animals.js`/`an_groups.js`) each hand-roll their own ordered child-table delete list instead of one shared cascade-delete helper.
- Source: scoped code review, 2026-09-13.

---

## Resolved — no code change needed

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
