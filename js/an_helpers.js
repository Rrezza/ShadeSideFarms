// an_helpers.js v17
// Shared state vars and helper functions for all animal module pages
// Must load after shared.js, before any an_*.js page file
// ============================================================

// ---- Module state ----
var grpExpanded       = null;   // expanded group id on Groups page
var intakeTab         = 'single';
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
    var w = lw ? parseFloat(lw.weight_kg) : (a.entry_weight_kg != null ? parseFloat(a.entry_weight_kg) : null);
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
    // A negative ADG (weight loss) is a real, urgent signal — always surface it
    // rather than folding it into "insufficient data" alongside the too-few-days case.
    var gk = avgCur - avgEntry;
    adg = gk / avgDays * 1000;
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

// ============================================================
// WEIGHT ALERTS (shown on Overview)
// ============================================================
// Thresholds: a drop bigger than this between the last two weigh-ins is "loss"
// (smaller drops are scale noise / gut fill); "slow gain" is below this fraction
// of the group's average daily gain, measured over at least WA_MIN_INTERVAL_DAYS.
var WA_LOSS_KG           = 0.5;
var WA_SLOW_FRACTION     = 0.5;
var WA_MIN_INTERVAL_DAYS = 7;

// weightsAsc: animal_weights rows sorted by date ascending
// dismissals: weight_alert_dismissals rows
// Returns [{ type: 'loss'|'slow_gain', animal, groupId, prev, last, adg, groupAdg }]
//       + [{ type: 'overdue', groupId, overdue, total, threshold, oldestDays }]
function computeWeightAlerts(weightsAsc, dismissals) {
  var today = new Date(todayISO() + 'T00:00:00');
  var daysBetween = function(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); };
  var onFarm = anSharedAnimals.filter(function(a) { return a.status === 'active' || a.status === 'quarantine'; });

  // Last two weigh-ins per animal
  var byAnimal = {};
  weightsAsc.forEach(function(w) { (byAnimal[w.animal_id] = byAnimal[w.animal_id] || []).push(w); });
  var pairs = {};
  onFarm.forEach(function(a) {
    var ws = byAnimal[a.id];
    if (!ws || ws.length < 2) return;
    var prev = ws[ws.length - 2], last = ws[ws.length - 1];
    var days = daysBetween(prev.date, last.date);
    pairs[a.id] = {
      prev: prev, last: last, days: days,
      change: Number(last.weight_kg) - Number(prev.weight_kg),
      adg: days >= WA_MIN_INTERVAL_DAYS ? (Number(last.weight_kg) - Number(prev.weight_kg)) / days * 1000 : null
    };
  });

  var isDismissed = function(type, animalId, refDate) {
    return dismissals.some(function(d) { return d.alert_type === type && d.animal_id === animalId && d.ref_date === refDate; });
  };

  // Group average ADG over members' last intervals (needs 3+ members with data)
  var groupAdg = {};
  anSharedGroups.forEach(function(g) {
    var adgs = getGroupAnimalIds(g.id).map(function(id) { return pairs[id] && pairs[id].adg; })
      .filter(function(v) { return v != null; });
    if (adgs.length >= 3) groupAdg[g.id] = adgs.reduce(function(s, v) { return s + v; }, 0) / adgs.length;
  });

  var alerts = [];
  onFarm.forEach(function(a) {
    var p = pairs[a.id];
    if (!p) return;
    var gid = getAnimalGroupId(a.id);
    if (p.change < -WA_LOSS_KG) {
      if (!isDismissed('loss', a.id, p.last.date)) alerts.push({ type: 'loss', animal: a, groupId: gid, prev: p.prev, last: p.last });
      return;  // loss already covers it; don't also flag slow gain
    }
    var gAdg = gid != null ? groupAdg[gid] : null;
    if (p.adg != null && gAdg != null && gAdg > 0 && p.adg < gAdg * WA_SLOW_FRACTION &&
        !isDismissed('slow_gain', a.id, p.last.date)) {
      alerts.push({ type: 'slow_gain', animal: a, groupId: gid, prev: p.prev, last: p.last, adg: p.adg, groupAdg: gAdg });
    }
  });

  // Overdue weigh-ins, per group with a reminder interval. Never-weighed animals
  // count from their arrival date.
  anSharedGroups.filter(function(g) { return g.status === 'active' && g.weigh_in_reminder_days; }).forEach(function(g) {
    var snoozed = dismissals.some(function(d) {
      return d.alert_type === 'overdue' && d.group_id === g.id && d.dismissed_until >= todayISO();
    });
    if (snoozed) return;
    var members = getGroupAnimals(g.id);
    var overdue = 0, oldest = 0;
    members.forEach(function(a) {
      var ws = byAnimal[a.id];
      var since = ws && ws.length ? ws[ws.length - 1].date : a.date_of_arrival;
      if (!since) return;
      var d = Math.round((today - new Date(since + 'T00:00:00')) / 864e5);
      if (d > g.weigh_in_reminder_days) { overdue++; oldest = Math.max(oldest, d); }
    });
    if (overdue) alerts.push({ type: 'overdue', groupId: g.id, overdue: overdue, total: members.length,
                               threshold: g.weigh_in_reminder_days, oldestDays: oldest });
  });
  return alerts;
}

