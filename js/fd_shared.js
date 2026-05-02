// ============================================================
// fd_shared.js v17 — Feed module state vars
// Must load after shared.js, before any fd_*.js page file
// ============================================================

// ============================================================
// feed.js — Feed module v17
// Pages: purchases, prices, recipesetup, feed (concentrate info),
//        rationsetup, projections
// Cross-module reads:  fcPenStats (shared.js, written by animals.js)
// Cross-module writes: fcPenStats (also written here from onProjPenChange)
// Depends on: shared.js
// ============================================================

// ---- Module-internal state ----
var currentRecipeIngs     = [];
var currentConcentrateCPK = null;
var modalIngId            = null;
var fcRoughageIngs        = [];
var fcRoughagePrices      = {};
var priceChart            = null;
var phIngsList            = [];
var phData                = {};
var phSelected            = {};
var phAvgDays             = 90;

// Purchase log state
var purchaseRows          = [];
var purchaseEditId        = null;
var purchaseAllIngs       = [];
var purchaseAllWorkers    = [];

// Recipe setup state
var rfEditRecipeId        = null;
var rfRowCounter          = 0;
var rfIngRows             = [];
var rsAllIngredients      = [];

