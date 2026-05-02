// an_helpers.js v17
// Shared state vars and helper functions for all animal module pages
// Must load after shared.js, before any an_*.js page file
// ============================================================

// ---- Module state ----
var grpExpanded       = null;   // expanded group id on Groups page
var intakeTab         = 'single';
var wtChart1          = null;
var wtChart2          = null;
var wtAxis1           = 'weeks';
var wtAxis2           = 'weeks';
var wtAllWeights      = {};     // animal_id -> [{date,weight_kg}] sorted asc
var anFeedGroupId     = null;   // selected group on Feeding page
var alFilterTab       = 'all';     // Animals list active tab: all|active|quarantine|unassigned|sick
var alEditId          = null;      // animal id currently being inline-edited
var alAssignAnimalId  = null;      // animal id in group-assign modal
var grpEditId         = null;      // group id currently being edited


// ============================================================
// HELPERS
// ============================================================
function computeGroupStats(animals) {
  var today = new Date();
  var entryW = [], curW = [], days = [];
  var latestWeightDate = null;
  animals.forEach(function(a) {
    if (a.entry_weight_kg != null) entryW.push(parseFloat(a.entry_weight_kg));
    var lw = getLatestWeight(a.id);
    var w = lw ? parseFloat(lw.weight_kg) : (a.entry_weight_kg ? parseFloat(a.entry_weight_kg) : null);
    if (w != null) curW.push(w);
    if (lw && lw.date) {
      if (!latestWeightDate || lw.date > latestWeightDate) latestWeightDate = lw.date;
    }
    if (a.date_of_arrival) {
      var d = Math.round((today - new Date(a.date_of_arrival + 'T00:00:00')) / 864e5);
      if (d > 0) days.push(d);
    }
  });
  var avg = function(arr) { return arr.length ? arr.reduce(function(s,v){return s+v;},0)/arr.length : null; };
  var avgEntry = avg(entryW);
  var avgCur   = avg(curW);
  var avgDays  = avg(days) || 0;
  var adg = null, adgInsufficient = false;
  if (avgEntry != null && avgCur != null && avgDays >= 7) {
    var gk = avgCur - avgEntry;
    if (gk > 0) adg = gk / avgDays * 1000;
    else adgInsufficient = true;
  } else if (avgDays > 0 && avgDays < 7) {
    adgInsufficient = true;
  }
  return {
    headCount:         animals.length,
    avgEntry:          avgEntry,
    avgCurrent:        avgCur,
    avgDays:           Math.round(avgDays),
    adg:               adg,
    adgInsufficient:   adgInsufficient,
    latestWeightDate:  latestWeightDate
  };
}

function speciesPrefix(speciesId) {
  var s = anSharedSpecies.find(function(x) { return x.id === parseInt(speciesId); });
  if (!s) return 'A-';
  var n = s.common_name;
  if (n === 'Goat')    return 'G-';
  if (n === 'Chicken') return 'C-';
  if (n === 'Duck')    return 'D-';
  if (n === 'Sheep')   return 'S-';
  if (n === 'Rabbit')  return 'R-';
  if (n === 'Donkey')  return 'DN-';
  return n.charAt(0).toUpperCase() + '-';
}

function nextFarmIdForPrefix(prefix) {
  var existing = anSharedAnimals
    .filter(function(a) { return a.farm_id && a.farm_id.startsWith(prefix); })
    .map(function(a) { return parseInt(a.farm_id.replace(prefix, '')); })
    .filter(function(n) { return !isNaN(n); });
  var next = existing.length ? Math.max.apply(null, existing) + 1 : 1;
  return prefix + String(next).padStart(3, '0');
}

function siAutoFarmId() {
  var speciesId = document.getElementById('si-species').value;
  if (!speciesId) return;
  var prefix = speciesPrefix(speciesId);
  var farmIdEl = document.getElementById('si-farmid');
  // Only auto-fill if field is empty or still has a system-generated value
  if (farmIdEl && (!farmIdEl.value || farmIdEl.dataset.autoFilled === 'true')) {
    farmIdEl.value = nextFarmIdForPrefix(prefix);
    farmIdEl.dataset.autoFilled = 'true';
  }
}


function speciesComposition(animals) {
  var counts = {};
  animals.forEach(function(a) {
    var s = getSpeciesName(a.species_id);
    counts[s] = (counts[s] || 0) + 1;
  });
  return Object.keys(counts).map(function(k) { return k + ': ' + counts[k]; }).join(', ');
}

function purposeBadge(p) {
  return '<span class="badge ' + (PURPOSE_BADGE[p] || 'badge-gray') + '">' + (p || 'unknown').replace(/_/g,' ') + '</span>';
}

function statusBadge(s) {
  if (s === 'active')   return '<span class="badge badge-green">Active</span>';
  if (s === 'closed')   return '<span class="badge badge-gray">Closed</span>';
  if (s === 'quarantine') return '<span class="badge badge-amber">Quarantine</span>';
  return '<span class="badge badge-gray">' + s + '</span>';
}

function anSelect(items, valKey, labelFn, placeholder) {
  return '<option value="">' + placeholder + '</option>' +
    items.map(function(x) {
      return '<option value="' + x[valKey] + '">' + labelFn(x) + '</option>';
    }).join('');
}

