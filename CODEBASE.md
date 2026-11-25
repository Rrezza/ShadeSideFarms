# ShadeSide Farms — Codebase Map

Live reference for all JS modules. Update this file when modules are added, renamed, or significantly changed.

---

## Foundation

### `shared.js`
The global foundation that every other module depends on. Defines the Supabase connection (URL + API key), all DB helper functions (`sbGet`, `sbInsert`, `sbPatch`, `sbDelete`), common formatters (`fmtDate`, `pkr`, `todayISO`, `r1`), the page router (`showPage()`, `navLandTab()`), and shared animal state (`anSharedAnimals`, `anSharedSpecies`, `anSharedGroups`, `anSharedLocations` — all active locations, used by `getLocationName()`; distinct from `anSharedPens`, which `getPenName()` searches and which is filtered to `location_type=eq.pen` only, kept for feed-module compatibility). `loadModule()` lazy-loads page modules with `?v=APP_BUILD` for cache-busting (`APP_BUILD` is defined in the inline script at the bottom of `Index.html`, which also writes the static `<script>` tags and the sidebar build footer). Also renders the abbreviation key footer, and holds the mobile off-canvas sidebar (`toggleSidebar()`, `closeSidebar()` — toggled by `.shell.sidebar-open`, wired into `showPage()`/`navLandTab()` so picking a page auto-closes the drawer). No other JS file is independent of this one.

### `auth.js`
Handles Supabase email/password authentication. Restores sessions from localStorage on load, manages sign-in/sign-out, and schedules JWT refresh. Key global: `AUTH_SESSION_KEY`. Depends on the Supabase config in `shared.js`. Login modal in `Index.html` has three views toggled by `_authShowView()`: sign-in, forgot-password (`authRequestPasswordReset()` — POSTs `/auth/v1/recover`), and set-new-password (`authSubmitNewPassword()` — PUTs `/auth/v1/user`). `_authHandleRecoveryRedirect()`, called from `authInit()`, detects a `type=recovery` hash left by the emailed reset link, stashes the one-time tokens in `_authRecoverySession`, and strips the hash from the URL bar. **Requires a Supabase Dashboard config change to actually work**: Authentication → URL Configuration's Site URL is still `http://localhost:3000` (a leftover default) — must be updated to the app's real URL (and that URL added to the Redirect URLs allowlist) or the reset email link redirects nowhere useful. See `BUILD_BACKLOG.md`.

### `Farmhand.html`
Standalone single-page mobile app for farmhands, separate from `Index.html` — its own inline CSS/JS, own Supabase config (`SUPABASE_URL`, `SUPABASE_KEY`), not routed through `shared.js`. Home screen offers five quick-entry flows: feeding, watering, amendment (fertilizer application), purchase, and harvest. Uses a numpad-style input UI (`npTap`, `npDel`, `npClear`) and a worker-select step (`selectWorker`) before each flow. Key functions: `init()`, `startFlow()`, `showScreen()`, `populateAllForms()`. Reads: `workers`, `ingredients`, `suppliers`, `locations`, `species`, `animal_groups`, `field_plots`, `crop_groups`, `plot_crops`, `fertilizers`. Amendment flow (`aConfirm()`) writes to `fertilizer_applications` via a live fertilizer picker sourced from the `fertilizers` registry (matching `land.js`'s design — no free-text amendment types). Watering flow (`wConfirm()`) writes to `watering_events` with a Method dropdown (flood/furrow/drip) and a fixed `water_source: 'tubewell'` default, matching `land.js`'s own fallback. Has an offline queue (`pendingQueue`, `submitEntry()`, `drainQueue()`) that retries failed submissions — note that a submission queued with a bad/incomplete payload will keep failing on every retry until manually cleared, since the payload itself doesn't change.

---

## Sidebar layout (2026-11-20)
**Setup** = adding/editing the things themselves (plots, workers, locations, ingredients, species, crops, harvest destinations, fertilizers, medicines, tools). **Inventory** (sits above Feed) = stock levels and buying, one page per item type: Medicines (`health_meds.js`), Fertilizers (the Land page's `fert` tab via `navLandTab`), Feed Ingredients (`fd_inventory.js`), Seeds (`fd_seeds.js`). **Animals › Health** = administering doses and managing schedules. The old Setup › Inventory page (`setup_inventory.js`, fertilizer stock only — a duplicate of Land's) was removed.

---

## Animal Module (`an_*`)

### `an_helpers.js`
Shared state and utility functions used by all animal pages. Declares module-level state including `grpExpanded`, `intakeTab`, `anFeedGroupId`, `alFilterTab`. Key functions: `computeGroupStats()`, `getGroupAnimals()`, `speciesComposition()`, `speciesPrefix()`/`nextFarmIdForPrefix()` (auto farm-ID generation). No direct Supabase calls — purely internal helpers consumed by other `an_*` files. (2026-09-13: removed dead `wtChart1`/`wtChart2`/`wtAxis1`/`wtAxis2` and a shadowed duplicate `wtAllWeights` — all superseded by `an_weights.js`'s own `wtChart`/`wtChartMode`/`wtYAxis`/`wtAllWeights`, which is where that state actually lives now.)

### `an_animals.js`
Animals registry list page. Renders filterable tabs (all / active / quarantine / unassigned / sick) and a tabular view of animals with breed, species, group, and location. Key globals: `alFilterTab`, `alEditId`, `alAssignAnimalId`. Key functions: `loadAnimalsListPage()`, `renderAnimalsList()`, `alAfterChange()` (refreshes the Animals list or the Groups page, whichever is open, after Move group / Left farm / Delete). `alDeleteAnimal()` keeps the animal's `medicine_movements` dose rows (unlinks `animal_id`, and `health_event_id` for its own events) so medicine stock isn't wrongly restored. Reads: `animals`, `animal_groups`, `locations`.

### `an_intake.js`
Animal intake and quarantine entry. Handles single and batch intake forms with auto-generated farm IDs, species/breed/entry weight, and purchase cost. Key global: `intakeTab`. Key functions: `loadIntakePage()`, `siAutoFarmId()`. Reads/writes: `animals`, `animal_groups`. Depends on `an_helpers.js`.

### `an_groups.js`
Animal groups management. Shows active/closed groups with membership stats, species composition, and inline editing. Each member row in an expanded group has Edit (inline sex/status/purpose — `grpStartMemberEdit()`/`grpSaveMemberEdit()`), Move group, Left farm and Delete; the last three reuse `an_animals.js`'s modals and save logic (lazy-loaded), which call back into `renderGroupsFromShared()` via `alAfterChange()` so the open group stays open. Key globals: `grpExpanded`, `grpEditId`, `grpMemberEditId`. Key functions: `loadGroupsPage()`, `renderGroupsTable()`, `renderGroupsFromShared()`, `populateGroupCreateForm()`. Reads: `animal_groups`, `group_members`, `animals`.

### `an_weights.js`
Weight tracking and growth analysis. Unified chart for individual/group mode showing ADG, weight trends, FCR metrics, and outlier detection (IQR method). The weigh-in table also has a FAMACHA (1–5) column, saved to `famacha_scores` independently of weights (a score never needs a weight). Key globals: `wtChart`, `wtChartMode`, `wtYAxis`, `wtAllWeights`, `wtOutlierData`. Key function: `loadWeightTrackingPage()`. Reads: `animal_weights`, `animals`. Depends on `an_helpers.js`.

### `an_feed.js`
Animal feeding events page. Records daily/weekly/monthly feed offerings with response status (fully consumed, partial refusal, etc.). Key globals: `anFeedGroupId`, `afPeriod`, `afEditEventId`, `FEED_RESPONSE_LABELS`. Key function: `loadAnimalFeedingPage()`. Reads/writes: `groups`, `feeding_events`. Depends on `an_helpers.js`.

---

## Feed Module (`fd_*`)

### `fd_shared.js`
Module-level state declarations for the feed section. Initialises variables used across recipes, prices, and purchase log pages. No functions — purely state. Consumed by other `fd_*` files.

### `fd_recipes.js`
Recipe setup and nutrient tracking. Expandable detail rows show recipe composition and nutritional profile (CP, ME, NDF, fat). Key global: `rsDetailCache`. Key function: `toggleRecipeDetail()`. Reads: `recipes`, `recipe_versions`, `recipe_ingredients`, `species`.

### `fd_ration_plans.js`
Ration plan setup with integrated live feed modeller. Handles plan CRUD, recipe/roughage selection, nutrient targets, and cost projection per animal. Key globals: `rpEditPlanId`, `rpAllRecipes`, `rpAllRoughage`, `rpRoughagePrices`, `rpModelWeight`. Key function: `loadRationPlansPage()`. Reads: `ration_plans`, `ration_plan_versions`, `recipes`, `ingredients`, `ingredient_acquisitions`, `species`.

### `fd_feed.js`
Concentrate info, feed modelling, and ration editor. Modal for entering prices for ingredients without purchase history. Key global: `modalIngId`. Key functions: `loadRecipes()`, `openModal()`, `saveModalPrice()`. Reads/writes: `recipes`, `ingredient_acquisitions`.

### `fd_inventory.js`
Feed ingredient stock tracking. Three sections: stock summary with reorder warnings, acquisition log (purchases/harvests), and batch mixing events. Key globals: `fiIngredients`, `fiStockMap`, `fiAcqEditId`, `fiBatchRecipeLines`. Reads: `ingredients`, `ingredient_acquisitions`, `concentrate_batches`, `feeding_events`.

### `fd_purchases.js`
Acquisition log page for purchases, harvests, and vet supplies. Tabular view with edit/delete. Key globals: `purchaseRows`, `purchaseEditId`. Key functions: `loadPurchases()`, `renderPurchaseTable()`. Reads: `ingredient_acquisitions`, `ingredients`, `workers`.

### `fd_prices.js`
Price history charts for purchased ingredients. Selectable by category and name, tracks `cost_per_kg` over time. Key globals: `phIngsList`, `phData`, `phSelected`. Key function: `loadPriceHistory()`. Reads: `ingredients`, `ingredient_acquisitions`.

### `fd_seeds.js`
Seed inventory tracking (purchases, harvest allocations, adjustments). Stock calculated per crop. Key globals: `sdCrops`, `sdPurchases`, `sdAllocations`, `sdAdjustments`, `sdEditId`. Key functions: `loadSeedInventory()`, `sdSafe()`. Reads: `crops`, `seed_purchases`, `harvest_allocations`, `seed_stock_adjustments`.

---

## Health Module

### `health.js`
Health events, breeding, births, cost, and sales tracking. Includes scheduled events with due dates, an event log, a Schedules manager (create/edit/retire recurring rounds targeting a group or animal, optionally linked to a cabinet medicine — `renderSchedTable()`, `openSchedForm()`, `submitSchedule()`), and step-through wizards for breeding and births. The treatment form picks a medicine from the cabinet (or "Other — not in cabinet" free text) and shows a per-animal dose grid (`renderHfDoseGrid()`, pre-filled from label rate × latest weight); saving writes one `animal_health_events` row (group treatments carry `group_id`, no `animal_id`) plus one `medicine_movements` dose row per animal, and auto-fills the event cost from the latest purchase price unless typed over (`hfCostTouched`). Event log rows expand (`toggleHealthLogRow()`) to show per-animal doses with weight on the event date (latest weigh-in on/before it, else entry weight) and cost, plus Edit (`renderHealthEventEdit()` / `saveHealthEventEdit()` — event fields and per-animal doses; changed doses patch, new ones insert, blanked ones delete their `medicine_movements` rows so stock adjusts by the difference; medicine itself is not changeable) and Delete (`deleteHealthEvent()` — dose rows cascade-delete, returning medicine to stock; a linked schedule's next due date is not rolled back). The Due panel also lists open follow-ups (`healthFollowups` — events with `follow_up_done=false` and a follow-up date within 14 days or overdue) with Log follow-up (`preFillFollowup()`; saving sets the original's `follow_up_done`) and Done (`markFollowupDone()`). Mortality events write the health event first, then `animal_mortality` (with the animal's current group), status and membership — rolled back if those fail; group-targeted deaths are refused. Sale (`submitSale()`) asks for confirmation via `medConfirmWithdrawal()` when the animal is inside a withdrawal window. Per-animal health history (`openAnimalHealthHistory(animalId)`, `#ah-modal`): opened by the Health button on Animals list and Groups member rows; lists events logged for the animal, events that dosed it, and group events from while it was a member (`group_members` incl. past memberships), with that animal's own dose/cost, withdrawal status and medicine-cost total. Deworming rounds: the dose grid adds a FAMACHA column (latest score from `famacha_scores`, `hfFamacha`) and pre-fills 0 for animals scored 1–2 within `HF_FAMACHA_MAX_AGE_DAYS` (14); a rotation note shows the target's last deworming (`healthLastDeworming()`) and turns amber when the chosen medicine has the same active ingredient (or is the same product). Deworming schedules show the same note on Due cards and the Schedules table (`healthSchedRotationNote()`). Logging a schedule advances repeating ones (local-date maths — `toISOString()` shifted it a day early in UTC+5) and closes one-off ones (`active=false`). The Schedules form uses `sch-*` element IDs (the Cost & Sales sale form owns `sf-*`). Lazy-loads `health_meds.js` for its helpers. Key globals: `healthScheds` (active, due ≤14 days), `healthFollowups`, `hfFollowupOf`, `healthAllScheds`, `healthEvts`, `hlExpandedId`, `hlEditId`, `schedEditId`, `breedingData`, `birthData`, `birthStep`, `csGroupId`. Key function: `loadHealthPage()`. Reads: `scheduled_health_events`, `animal_health_events`, `medicines`, `medicine_movements`, `animals`, `workers`.

### `health_meds.js`
The medicine cabinet, serving two pages: **Setup › Medicines** (`loadMedSetupPage()` — the list itself: add/edit/retire/delete, `renderMedSetupTable()`) and **Inventory › Medicines** (`loadMedicinesPage()` — reorder alerts, stock table, Buy/Count forms, per-medicine history). Registry (`medicines`: name, active ingredient, purpose, form, stock unit ml/tablet/g/dose, pack type + size, label dose per kg or per head, minimum stock) and a stock ledger (`medicine_movements`: purchase / dose / adjustment; stock = sum of quantity). Purchases record packs, cost and an information-only expiry date; cabinet counts store the difference vs. the ledger as an adjustment with a reason. Also the shared helpers used by `health.js` and `overview.js`: `medLoadData()`, `medStock()`, `medCostPerUnit()` (latest purchase), `medSuggestDose()` (label rate × latest/entry weight, rounded to 0.5), `medFmtStock()` ("2 vials + 40 ml"), and `medComputeAlerts()` / `medAlertsHtml()` — reorder alerts for scheduled rounds due within `MED_LOOKAHEAD_DAYS` (30) whose estimated need exceeds stock, plus anything below minimum. Brands are not pooled by active ingredient (deliberate — each schedule names one exact medicine). Meat withdrawal: `medicines.withdrawal_days`; `medWithdrawalFor(animalId, asOf)` returns the latest unsafe window from that animal's doses, `medWithdrawalBadge()` renders the red "withdrawal to <date>" badge (Groups members, Animals list), `medConfirmWithdrawal()` is the warn-and-confirm used on sale and Left farm. Key globals: `medList`, `medMovements`, `medEditId`, `medActionId`, `medExpanded`. Key functions: `loadMedicinesPage()`, `loadMedSetupPage()`, `medGroupedRows()` (shared by both tables).

---

## Land Module

### `land.js`
Land management hub with 6 sub-tabs: fertilizer inventory, amendment application log, soil tests, crop tracking, watering, and water tests. (A 7th "Plots" tab was removed 2026-09-13 — it was dead code with no nav button or panel container; plot registry management lives in `setup_plots.js`.) Harvest flow is two-step: farmhands log the event (quantity only), managers allocate via modal to DB-driven destinations. The crop tracking tab has three named panes: "New Plantings" (form + filter), "Pending Allocations" (unallocated harvests), and "Crop Tracking" (group cards). Key globals: `landPlots`, `landFerts`, `landCrops`, `landHarvests`, `landAllocations`, `landDestinations`, `landPlotObservations`, `landWatering`, `landTests`, `landActiveTab`, `obsExpandedCrops`. Key functions: `loadLandPage()`, `renderLandCrops()`, `renderUnallocatedPanel()`, `submitHarvestEvent()`, `openHarvestAllocModal()`, `submitHarvestAlloc()`, `submitPlotObservation()`, `refreshPlotObs()`, `patchPlotObs()`, `deletePlotObs()`. Reads: plots, fertilizers, crops, crop_groups, crop_harvest_events, harvest_allocations, harvest_destinations, plot_observations, soil/water tests tables.

### `overview.js`
Dashboard landing page. Read-only cards per active plot and per active animal group. Plot cards show current crops, recent activity (incl. last plot observation), and cumulative metrics. Both sections (Plots and Animal Groups) are collapsible via `toggleOvSection()`. Shows commercial and learning animal groups. Key globals: `ovPlots`, `ovCrops`, `ovHarvests`, `ovFertApps`, `ovWatering`, `ovSoilTests`, `ovPlotObservations`, `ovPlotsCollapsed`, `ovAnimalsCollapsed`. Key functions: `loadOverviewPage()`, `safeFetchOv()`, `toggleOvSection()`. A "Health follow-ups" banner (`loadOverviewFollowups()`, `#ov-followups` — overdue or due within 7 days, not done) and a "Medicines to buy" banner sit above the plot cards (`loadOverviewMedAlerts()`, rendered into `#ov-med-alerts`, hidden when nothing needs buying; loads `health_meds.js` on demand and fails silently so plots always render). Reads: `field_plots`, `plot_crops`, `crop_groups`, `crop_harvest_events`, `crop_observations`, `fertilizer_applications`, `watering_events`, `soil_tests`, `fertilizers`, `crops`, `plot_observations`.

---

## Finance Module

### `finance_expenses.js`
Farm expenses log with category filtering (feed, vet, labor, fuel, infrastructure, capex, other). Date range filters and badge labels per category. Key globals: `feExpenses`, `feEditId`, `feFilterCat`, `feFilterFrom`, `feFilterTo`, `FE_CATS`. Key functions: `loadFarmExpensesPage()`, `feCatLabel()`, `feCatBadge()`. Reads: `farm_expenses`, `workers`.

---

## Setup Module (`setup_*`)

### `setup_shared.js`
Shared delete helpers for all setup pages. Handles foreign-key constraint errors gracefully by prompting the user to deactivate instead of delete. Key functions: `fkErrMsg()`, `deleteIngredient()`, `deleteFertilizer()`, `deleteFertPurchase()`, `refreshSharedLocationCaches()` (re-fetches `anSharedPens`/`anSharedLocations` after a location retire/reactivate/add, so other modules' location dropdowns stay current). Used by all `setup_*.js` files.

### `setup_species.js`
Species registry (common name, notes). Inline editable. Key globals: `speciesData`, `speciesEditId`. Key functions: `loadSpeciesPage()`, `renderSpeciesTable()`, `submitSpecies()`. Reads/writes: `species`.

### `setup_ingredients.js`
Feed ingredients registry with category, nutrient fields (DM%, CP%, ME, fat, NDF), inline edit, and `feed_eligible` toggle. `feed_eligible` controls whether an ingredient appears in feed-related dropdowns (ration plans, harvest allocation modal). Key globals: `ingData`, `ingSortCol`, `ingSortDir`, `selectedIngId`. Key functions: `loadIngredients()`, `renderIngredientsTable()`. Reads/writes: `ingredients`.

### `setup_locations.js`
Locations registry (pens, quarantine, field plots, storage, ponds, etc.). Inline edit, active filtering. Key global: `locationsData`. Key functions: `loadLocationsPage()`, `renderLocationsTable()`. Reads/writes: `locations`.

### `setup_plots.js`
Plot registry. Fields: code, name, type, area (acres/kanals), irrigation, location, notes. Inline edit, soft-retire. Key globals: `spPlots`, `spLocations`, `spCrops`, `spCropRegistry`, `spTests`. Key function: `loadPlotsPage()`. Reads: `plots`, `plot_crops`, `soil_tests`. Depends on `setup_shared.js`.

### `setup_crops.js`
Crops registry. Fields: name, local name, category, salt tolerance, nitrogen fixer, feeding notes, typical duration, active flag, and `permitted_destinations` (checkboxes from `harvest_destinations` table — controls which allocation destinations appear for this crop). Key globals: `cropRegData`, `cropDestData`. Key functions: `loadCropsPage()`, `renderCropsTable()`, `toggleCropDest()`. Reads/writes: `crops`. Also reads: `harvest_destinations`.

### `setup_harvest_destinations.js`
Harvest destinations registry. Rows here drive the destination dropdown in the harvest allocation modal. Users can add new destinations without code changes. Key column `key` is immutable after creation (stored in `harvest_allocations.destination`). Key global: `hdData`. Key functions: `loadHarvestDestinationsPage()`, `submitNewHd()`, `patchHd()`. Reads/writes: `harvest_destinations`.

### `setup_fertilizers.js`
Registry (nutrient profile, purchase unit, reorder threshold) and derived stock display. Liquid fertilizers track L/container; solids track kg/bag. Key globals: `fertData`, `fertNutrientsId`. Key functions: `fertStockUnit()`, `fertPurchUnitLabel()`, `loadFertilizersPage()`. Reads: `fertilizers`. Purchase logging itself lives in `land.js` (`openLandPurchModal()`) — this file's own purchase modal was dead code, removed 2026-09-19.

### `setup_protocols.js`
Setup › Health Protocols. Named, reusable schedule sets (`health_protocols` + `health_protocol_steps`: day offset from arrival, event type, description, cabinet medicine or free-text product, optional repeat interval). Steps edit in place (patch on change). Also the **Apply protocol** modal (`#pa-modal`, opened from a group on the Groups page): pick a protocol and arrival date (defaults to the earliest current member's join date), preview, then one `scheduled_health_events` row per step is created for the group (`notes` = "From protocol: …"). One-off steps close themselves when logged (see `health.js`). Key globals: `protoList`, `protoSteps`, `protoExpanded`, `protoApplyGroupId`. Key functions: `loadProtocolsPage()`, `openApplyProtocol()`, `submitApplyProtocol()`. Reads/writes: `health_protocols`, `health_protocol_steps`, `scheduled_health_events`.

### `setup_workers.js`
Workers registry (permanent / part-time / day labour) with daily rates. Inline edit, active filtering. Key global: `workersData`. Key functions: `loadWorkersPage()`, `renderWorkersTable()`. Reads/writes: `workers`.

### `setup_tools.js`
Farm tools/equipment registry with condition tracking (new / good / fair / needs repair / retired). Inline edit. Key global: `toolData`. Key function: `loadToolsPage()`. Reads/writes: `tools`.
