# ShadeSide Farms — Codebase Map

Live reference for all JS modules. Update this file when modules are added, renamed, or significantly changed.

---

## Foundation

### `shared.js`
The global foundation that every other module depends on. Defines the Supabase connection (URL + API key), all DB helper functions (`sbGet`, `sbInsert`, `sbPatch`, `sbDelete`), common formatters (`fmtDate`, `pkr`, `todayISO`, `r1`), the page router, and shared animal state (`anSharedAnimals`, `anSharedSpecies`, `anSharedGroups`). Also renders the abbreviation key footer. No other JS file is independent of this one.

### `auth.js`
Handles Supabase email/password authentication. Restores sessions from localStorage on load, manages sign-in/sign-out, and schedules JWT refresh. Key global: `AUTH_SESSION_KEY`. Depends on the Supabase config in `shared.js`.

---

## Animal Module (`an_*`)

### `an_helpers.js`
Shared state and utility functions used by all animal pages. Declares module-level state including `grpExpanded`, weight/feeding tracking vars, and chart references (`wtChart1`, `wtChart2`). Key functions: `computeGroupStats()`, `getGroupAnimals()`, `speciesComposition()`. No direct Supabase calls — purely internal helpers consumed by other `an_*` files.

### `an_animals.js`
Animals registry list page. Renders filterable tabs (all / active / quarantine / unassigned / sick) and a tabular view of animals with breed, species, group, and location. Key globals: `alFilterTab`, `alEditId`, `alAssignAnimalId`. Key functions: `loadAnimalsListPage()`, `renderAnimalsList()`. Reads: `animals`, `animal_groups`, `locations`.

### `an_intake.js`
Animal intake and quarantine entry. Handles single and batch intake forms with auto-generated farm IDs, species/breed/entry weight, and purchase cost. Key global: `intakeTab`. Key functions: `loadIntakePage()`, `siAutoFarmId()`. Reads/writes: `animals`, `animal_groups`. Depends on `an_helpers.js`.

### `an_groups.js`
Animal groups management. Shows active/closed groups with membership stats, species composition, and inline editing. Key globals: `grpExpanded`, `grpEditId`. Key functions: `loadGroupsPage()`, `renderGroupsTable()`, `populateGroupCreateForm()`. Reads: `animal_groups`, `group_members`, `animals`.

### `an_weights.js`
Weight tracking and growth analysis. Unified chart for individual/group mode showing ADG, weight trends, FCR metrics, and outlier detection (IQR method). Key globals: `wtChart`, `wtChartMode`, `wtYAxis`, `wtAllWeights`, `wtOutlierData`. Key function: `loadWeightTrackingPage()`. Reads: `animal_weights`, `animals`. Depends on `an_helpers.js`.

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
Health events, breeding, births, cost, and sales tracking. Includes scheduled events with due dates, an event log, and step-through wizards for breeding and births. Key globals: `healthScheds`, `healthEvts`, `breedingData`, `birthData`, `birthStep`, `csGroupId`. Key function: `loadHealthPage()`. Reads: `scheduled_health_events`, `animal_health_events`, `animals`, `workers`.

---

## Land Module

### `land.js`
Land management hub with 7 sub-tabs: plots, fertilizer inventory, amendment application log, soil tests, crop tracking, watering, and water tests. Harvest flow is two-step: farmhands log the event (quantity only), managers allocate via modal to DB-driven destinations. Key globals: `landPlots`, `landFerts`, `landCrops`, `landHarvests`, `landAllocations`, `landDestinations`, `landWatering`, `landTests`, `landActiveTab`. Key functions: `loadLandPage()`, `renderLandCrops()`, `renderUnallocatedPanel()`, `submitHarvestEvent()`, `openHarvestAllocModal()`, `submitHarvestAlloc()`. Reads: plots, fertilizers, crops, crop_groups, crop_harvest_events, harvest_allocations, harvest_destinations, soil/water tests tables.

### `overview.js`
Dashboard landing page. Read-only cards per active plot showing current crops, recent activity, cumulative metrics, and quick links. Key globals: `ovPlots`, `ovCrops`, `ovHarvests`, `ovFertApps`, `ovWatering`, `ovSoilTests`. Key functions: `loadOverviewPage()`, `safeFetchOv()`. Reads: `plots`, `plot_crops`, `harvests`, `observations`.

---

## Finance Module

### `finance_expenses.js`
Farm expenses log with category filtering (feed, vet, labor, fuel, infrastructure, capex, other). Date range filters and badge labels per category. Key globals: `feExpenses`, `feEditId`, `feFilterCat`, `feFilterFrom`, `feFilterTo`, `FE_CATS`. Key functions: `loadFarmExpensesPage()`, `feCatLabel()`, `feCatBadge()`. Reads: `farm_expenses`, `workers`.

---

## Setup Module (`setup_*`)

### `setup_shared.js`
Shared delete helpers for all setup pages. Handles foreign-key constraint errors gracefully by prompting the user to deactivate instead of delete. Key functions: `fkErrMsg()`, `deleteIngredient()`, `deleteFertilizer()`, `deleteFertPurchase()`. Used by all `setup_*.js` files.

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
Three-layer fertilizer model: registry (nutrient profile, purchase unit, reorder threshold), purchases (qty, date, cost), and derived inventory. Liquid fertilizers track L/container; solids track kg/bag. Key globals: `fertData`, `fertPurchaseData`, `fertNutrientsId`. Key functions: `fertStockUnit()`, `fertPurchUnitLabel()`, `loadFertilizersPage()`. Reads: `fertilizers`, `fertilizer_purchases`.

### `setup_inventory.js`
Inventory page showing fertilizer stock (feed ingredient stock lives in `fd_inventory.js`). Stock = purchases − applications. Key globals: `invFertStock`, `invFertList`, `stockAdjIngId`. Key function: `loadInventoryPage()`. Reads: `fertilizers`, `fertilizer_purchases`, `fertilizer_applications`.

### `setup_workers.js`
Workers registry (permanent / part-time / day labour) with daily rates. Inline edit, active filtering. Key global: `workersData`. Key functions: `loadWorkersPage()`, `renderWorkersTable()`. Reads/writes: `workers`.

### `setup_tools.js`
Farm tools/equipment registry with condition tracking (new / good / fair / needs repair / retired). Inline edit. Key global: `toolData`. Key function: `loadToolsPage()`. Reads/writes: `tools`.
