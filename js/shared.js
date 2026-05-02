// ============================================================
// shared.js — globals, DB helpers, formatters, page router,
// shared animal data, abbreviations key.
// Loaded once on page load. All other js/*.js files depend on this.
// v17: added animal_groups / group_members shared state.
// ============================================================

// ---- Supabase config ----
// Credentials are loaded from config.js (gitignored).
// Copy config.example.js → config.js and fill in your values.
var SB_URL = window.SHADESIDE_CONFIG ? window.SHADESIDE_CONFIG.supabaseUrl : '';
var SB_KEY = window.SHADESIDE_CONFIG ? window.SHADESIDE_CONFIG.supabaseKey : '';
var H  = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
var JH = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

// ---- DB helpers ----
async function sbGet(t, q) {
  var r = await fetch(SB_URL + '/rest/v1/' + t + '?' + q, { headers: H });
  if (!r.ok) throw new Error('GET ' + t + ': ' + r.status + ' ' + (await r.text()));
  return r.json();
}
async function sbPatch(t, id, d) {
  var r = await fetch(SB_URL + '/rest/v1/' + t + '?id=eq.' + id, {
    method: 'PATCH',
    headers: Object.assign({ 'Prefer': 'return=minimal' }, JH),
    body: JSON.stringify(d)
  });
  if (!r.ok) throw new Error(await r.text());
}
async function sbPatchWhere(t, q, d) {
  var r = await fetch(SB_URL + '/rest/v1/' + t + '?' + q, {
    method: 'PATCH',
    headers: Object.assign({ 'Prefer': 'return=minimal' }, JH),
    body: JSON.stringify(d)
  });
  if (!r.ok) throw new Error(await r.text());
}
async function sbDelete(t, id) {
  var r = await fetch(SB_URL + '/rest/v1/' + t + '?id=eq.' + id, {
    method: 'DELETE',
    headers: Object.assign({ 'Prefer': 'return=minimal' }, JH)
  });
  if (!r.ok) throw new Error(await r.text());
}

async function sbDeleteWhere(t, q) {
  var r = await fetch(SB_URL + '/rest/v1/' + t + '?' + q, {
    method: 'DELETE',
    headers: Object.assign({ 'Prefer': 'return=minimal' }, JH)
  });
  if (!r.ok) throw new Error(await r.text());
}
async function sbInsert(t, d) {
  var r = await fetch(SB_URL + '/rest/v1/' + t, {
    method: 'POST',
    headers: Object.assign({ 'Prefer': 'return=representation' }, JH),
    body: JSON.stringify(d)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Formatters ----
var pkr    = function(n) { return n == null ? '\u2014' : 'PKR ' + Math.round(n).toLocaleString(); };
var pct    = function(n) { return n == null ? '\u2014' : Number(n).toFixed(1) + '%'; };
var kgFmt  = function(n) { return n == null ? '\u2014' : Number(n).toLocaleString() + ' kg'; };
var r2     = function(n) { return Math.round(n * 100) / 100; };
var r1     = function(n) { return Math.round(n * 10) / 10; };
var fmtDate = function(d) {
  return d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
    : '\u2014';
};
var todayISO = function() { return new Date().toISOString().slice(0, 10); };

var CAT_BADGE = {
  grain: 'badge-amber', protein: 'badge-teal', roughage: 'badge-lime',
  mineral: 'badge-blue', supplement: 'badge-green', complete_feed: 'badge-brown',
  other: 'badge-gray'
};
var CHART_COLORS = ['#27623A', '#185FA5', '#B85C00', '#6B3AAB', '#0A6B54',
                    '#993556', '#3B6D11', '#4A2D8C', '#7A4100', '#0A5C45'];

var PURPOSE_BADGE = {
  meat:         'badge-amber',
  breeder:      'badge-teal',
  dual_purpose: 'badge-blue',
  layer:        'badge-lime',
  farm_labor:   'badge-gray',
  learning:     'badge-green',
  flock:        'badge-green'
};

// ---- Abbreviations dictionary ----
var ABBREV = {
  BCS:  'Body Condition Score (1.0-5.0 scale for ruminants)',
  DM:   'Dry Matter',
  DMI:  'Dry Matter Intake',
  FCR:  'Feed Conversion Ratio (kg DM consumed per kg live-weight gain)',
  CP:   'Crude Protein',
  ME:   'Metabolizable Energy',
  NDF:  'Neutral Detergent Fiber',
  PKR:  'Pakistani Rupees',
  EC:   'Electrical Conductivity (soil/water salinity proxy)',
  SAR:  'Sodium Adsorption Ratio',
  OM:   'Organic Matter',
  RSC:  'Residual Sodium Carbonate',
  BSF:  'Black Soldier Fly',
  Ca:   'Calcium',
  P:    'Phosphorus',
  ADG:  'Average Daily Gain (g/day)'
};

function renderAbbrevKey(containerId, keys) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var rows = keys
    .filter(function(k) { return ABBREV[k]; })
    .map(function(k) {
      return '<div class="abbrev-row"><span class="abbrev-key">' + k + '</span>' +
             '<span class="abbrev-def">' + ABBREV[k] + '</span></div>';
    }).join('');
  el.innerHTML =
    '<details class="abbrev-block">' +
      '<summary>Abbreviations used on this page</summary>' +
      '<div class="abbrev-grid">' + rows + '</div>' +
    '</details>';
}

// ============================================================
// PAGE ROUTER + MODULE LOADER
// ============================================================
var moduleLoaded = {};

function loadModule(name) {
  if (moduleLoaded[name]) return Promise.resolve();
  if (loadModule._inflight && loadModule._inflight[name]) return loadModule._inflight[name];
  if (!loadModule._inflight) loadModule._inflight = {};
  loadModule._inflight[name] = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'js/' + name + '.js?v=21';
    s.onload = function() { moduleLoaded[name] = true; resolve(); };
    s.onerror = function() { reject(new Error('Failed to load js/' + name + '.js')); };
    document.head.appendChild(s);
  });
  return loadModule._inflight[name];
}

// page name -> { module file, init function name }
var PAGE_MAP = {
  // Feed module
  purchases:      { module: 'fd_purchases', init: 'loadPurchases' },
  prices:         { module: 'fd_prices',    init: 'loadPriceHistory' },
  recipesetup:    { module: 'fd_recipes',   init: 'loadRecipeSetup' },
  feed:           { module: 'fd_feed',      init: 'loadFeedCost' },
  projections:    { module: 'fd_feed',      init: 'loadProjectionsPage' },
  // Animals module (v17) — split across an_animals, an_groups, an_intake, an_weights, an_feed
  animalslist:    { module: 'an_animals', init: 'loadAnimalsListPage' },
  angroups:       { module: 'an_groups',  init: 'loadGroupsPage' },
  intake:         { module: 'an_intake',  init: 'loadIntakePage' },
  weighttracking: { module: 'an_weights', init: 'loadWeightTrackingPage' },
  anfeed:         { module: 'an_feed',         init: 'loadAnimalFeedingPage' },
  rationplans:    { module: 'fd_ration_plans', init: 'loadRationPlansPage' },
  health:         { module: 'health',  init: 'loadHealthPage' },
  breeding:       { module: 'health',  init: 'loadBreedingPage' },
  costsales:      { module: 'health',           init: 'loadCostSalesPage' },
  farmexpenses:   { module: 'finance_expenses', init: 'loadFarmExpensesPage' },
  // Land module
  land:           { module: 'land',    init: 'loadLandPage' },
  // Setup module
  workers:        { module: 'setup_workers',     init: 'loadWorkersPage' },
  locations:      { module: 'setup_locations',   init: 'loadLocationsPage' },
  ingredients:    { module: 'setup_ingredients', init: 'loadIngredients' },
  species:        { module: 'setup_species',     init: 'loadSpeciesPage' },
  crops:          { module: 'setup_crops',       init: 'loadCropsPage' },
  fertilizers:    { module: 'setup_fertilizers', init: 'loadFertilizersPage' },
  tools:          { module: 'setup_tools',       init: 'loadToolsPage' },
  inventory:      { module: 'setup_inventory',   init: 'loadInventoryPage' }
};

async function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('active');
  if (btn) btn.classList.add('active');

  var m = PAGE_MAP[name];
  if (!m) return;
  try {
    await loadModule(m.module);
    if (typeof window[m.init] === 'function') {
      await window[m.init]();
    } else {
      console.warn('Page init function not found:', m.init);
    }
  } catch (err) {
    console.error('Page load failed:', name, err);
    var status = document.getElementById('sb-status');
    if (status) status.textContent = 'Page error: ' + err.message;
  }
}

function goToPage(name) {
  var btn = document.querySelector('.nav-item[data-page="' + name + '"]');
  if (btn) showPage(name, btn);
}

async function navLandTab(tab, btn) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var pageEl = document.getElementById('page-land');
  if (pageEl) pageEl.classList.add('active');
  if (btn) btn.classList.add('active');
  try {
    await loadModule('land');
    if (typeof loadLandPage === 'function') await loadLandPage();
    if (typeof showLandTab === 'function') showLandTab(tab, null);
  } catch (err) {
    console.error('navLandTab failed:', tab, err);
  }
}

// ============================================================
// SHARED ANIMAL DATA (v17: includes groups + active members)
// ============================================================
var anSharedAnimals       = [];
var anSharedWeights       = {};  // animal_id -> most-recent weight record
var anSharedPens          = [];  // kept for feed module compatibility
var anSharedSpecies       = [];
var anSharedWorkers       = [];
var anSharedGroups        = [];  // all animal_groups records
var anSharedMembers       = [];  // group_members where left_date IS NULL
var anSharedGroupLocations = []; // group_location_history where to_date IS NULL
var anSharedLoaded        = false;

async function loadSharedAnimalData() {
  var r = await Promise.all([
    sbGet('animals',
      'select=id,farm_id,name,breed,sex,purpose,is_breeding,born_on_farm,' +
      'batch_ref,status,entry_weight_kg,purchase_cost_pkr,intake_batch_id,' +
      'date_of_arrival,source,current_location_id,dam_id,sire_id,sire_unknown,' +
      'notes,species_id,locations(name)&order=farm_id'),
    sbGet('animal_weights', 'select=animal_id,weight_kg,bcs_score,date&order=date.desc&limit=3000'),
    sbGet('locations', 'location_type=eq.pen&active=eq.true&select=id,name&order=name'),
    sbGet('species', 'select=id,common_name,gestation_days&order=common_name'),
    sbGet('workers', 'select=id,name&active=eq.true&order=name'),
    sbGet('animal_groups',
      'select=id,name,primary_purpose,is_multi_species,target_weight_kg,status,closed_at,notes,' +
      'weigh_in_reminder_days,created_at&order=created_at.desc'),
    sbGet('group_members', 'left_date=is.null&select=id,group_id,animal_id,joined_date'),
    sbGet('group_location_history', 'to_date=is.null&select=id,group_id,location_id,from_date,locations(name)')
  ]);
  anSharedAnimals = r[0];
  var wm = {};
  r[1].forEach(function(w) { if (!wm[w.animal_id]) wm[w.animal_id] = w; });
  anSharedWeights = wm;
  anSharedPens    = r[2];
  anSharedSpecies = r[3];
  anSharedWorkers = r[4];
  anSharedGroups        = r[5];
  anSharedMembers       = r[6];
  anSharedGroupLocations = r[7];
  anSharedLoaded        = true;
}

function getLatestWeight(animalId)  { return anSharedWeights[animalId] || null; }
function getAnimalDisplayName(id)   { var a = anSharedAnimals.find(function(x) { return x.id === id; }); return a ? (a.name || a.farm_id) : '\u2014'; }
function getPenName(penId)          { var p = anSharedPens.find(function(x) { return x.id === penId; }); return p ? p.name : '\u2014'; }
function getSpeciesName(speciesId)  { var s = anSharedSpecies.find(function(x) { return x.id === speciesId; }); return s ? s.common_name : '\u2014'; }
function getGroupName(groupId)      { var g = anSharedGroups.find(function(x) { return x.id === groupId; }); return g ? g.name : '\u2014'; }
function getLocationName(locId)     {
  var l = anSharedPens.find(function(x) { return x.id === locId; });
  return l ? l.name : '\u2014';
}

// Returns active animal IDs in a group (currently in group_members with left_date IS NULL)
function getGroupAnimalIds(groupId) {
  return anSharedMembers
    .filter(function(m) { return m.group_id === groupId; })
    .map(function(m) { return m.animal_id; });
}

// Returns on-farm animals for a group (active + quarantine; excludes deceased/sold)
function getGroupAnimals(groupId) {
  var ids = getGroupAnimalIds(groupId);
  return anSharedAnimals.filter(function(a) {
    return ids.indexOf(a.id) >= 0 && a.status !== 'deceased' && a.status !== 'sold';
  });
}

// Returns the group_id an animal currently belongs to (null if unassigned)
function getAnimalGroupId(animalId) {
  var m = anSharedMembers.find(function(x) { return x.animal_id === animalId; });
  return m ? m.group_id : null;
}

// ============================================================
// CROSS-MODULE STATE
// ============================================================
// fcPenStats: set by animals.js when a group is selected;
// still consumed by calcFeedCost() in feed.js for projections.
var fcPenStats = null;

// ============================================================
// INITIAL BOOTSTRAP
// ============================================================
async function loadAll() {
  var statusEl = document.getElementById('sb-status');
  if (statusEl) statusEl.textContent = 'Loading...';
  try {
    await loadModule('fd_purchases');
    if (typeof window.loadPurchases === 'function') await window.loadPurchases();
    if (statusEl) {
      statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
    console.error('loadAll failed:', err);
  }
}

loadAll();
