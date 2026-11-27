// ============================================================
// health_meds.js — Stock ledger for medicines and countable supplies:
// registry, purchases, use, cabinet counts, dose suggestions, reorder alerts.
// Three item kinds share the ledger (medicines.kind):
//   medicine      — dosed to animals
//   health_supply — syringes, gloves, gauze…   (shown with medicines)
//   farm_supply   — fuel, twine, feed bags…     (shown on Inventory › Tools & Equipment)
// Pages: Setup › Medicines & Health Supplies (the list: add / edit / retire)
//        Inventory › Medicines & Health Supplies (stock, buy, use, count, history, reminders)
//        Inventory › Tools & Equipment — "Consumables" section (list + stock in one)
// Also loaded on demand by health.js (treatment form dose grid)
// and overview.js (reorder banner) for its shared helpers.
// Depends on: shared.js (sbGet/sbInsert/sbPatch/sbDelete, anShared* animal data)
//
// Stock model: medicine_movements is a ledger. Every purchase adds,
// every dose subtracts, every cabinet-count adjustment corrects drift.
// Current stock = sum of a medicine's movement quantities, always in
// the medicine's stock_unit (ml / tablet / g / dose).
// ============================================================

// ---- Module state ----
var medList        = [];     // all medicines (active + retired)
var medMovements   = [];     // all ledger rows, newest first
var medEditId      = null;   // medicine being edited in the add/edit form (null = adding)
var medActionId    = null;   // medicine the purchase/count form is open for
var medActionType  = null;   // 'purchase' | 'use' | 'count'
var medFormKind    = 'medicine';  // kind of item the add/edit form is for
var medExpanded    = new Set();  // medicine ids with their history row open
var medBreedings   = [];     // breeding_events { dam_id, date } — for pregnancy checks
var medBirths      = [];     // birth_events { dam_id, date }
var medSpeciesDoses = [];    // medicine_species_doses — per-species label dose overrides
var medSpeciesList  = [];    // species { id, common_name } — for the form and labels
var medFormDoses    = [];    // working copy of the species rows while the add/edit form is open
var medFormSpeciesMode = false; // form's "Different dose per species" switch

// How far ahead the reorder check looks at scheduled health rounds
var MED_LOOKAHEAD_DAYS = 30;

// How a medicine is given. Stored on the medicine (its usual route) and on each
// health event (the route actually used). Keys match the DB check constraint.
var MED_ROUTES = {
  im: 'Intramuscular', deep_im: 'Deep intramuscular', sc: 'Under the skin',
  iv: 'Intravenous', slow_iv: 'Slow intravenous', oral: 'Oral drench',
  water: 'In drinking water', feed: 'In feed', pour_on: 'Pour-on',
  spray: 'Spray / dip', topical: 'On the skin', intranasal: 'Intranasal',
  intramammary: 'Into the udder', other: 'Other'
};
// Routes given to a whole group at once: the round records one total amount,
// stored as an even share per animal (is_share), instead of a per-animal grid
var MED_BULK_ROUTES = ['water', 'feed', 'spray'];
function medIsBulkRoute(route) { return MED_BULK_ROUTES.indexOf(route) >= 0; }
// Routes where a water volume makes sense (and the per-litre dose applies)
function medUsesWater(route) { return route === 'water' || route === 'spray'; }
function medRouteLabel(route) { return route ? (MED_ROUTES[route] || route) : ''; }

// ---- Medicine types ----
// What a medicine is: groups the lists, and separates prevention (vaccines,
// dewormers, supplements) from treating illness. Keys match the DB check.
var MED_CLASSES = {
  vaccine: 'Vaccines', dewormer: 'Dewormers', antiparasitic_ext: 'External antiparasitics',
  antibiotic: 'Antibiotics', anti_inflammatory: 'Anti-inflammatories / pain relief',
  supplement: 'Vitamins, minerals and supplements', other: 'Other medicines'
};
// Event type suggested on the treatment form when a medicine of this type is picked
var MED_CLASS_EVENT = {
  vaccine: 'vaccination', dewormer: 'deworming', antiparasitic_ext: 'treatment',
  antibiotic: 'treatment', anti_inflammatory: 'treatment', supplement: 'supplement'
};

// ---- Treatment courses ----
// A course is N doses, one every X hours. Allowed intervals match the DB check.
var MED_COURSE_INTERVALS = { 8: '3 times a day', 12: 'twice a day', 24: 'once a day', 48: 'every 2 days', 72: 'every 3 days' };

// "3 doses, once a day" / "6 doses, twice a day (3 days)"; '' when no course
// laterPct: later doses as a % of the first (null / 100 = all the same),
// e.g. "6 doses, once a day — first dose full, then 50%"
function medFmtCourse(doses, intervalHours, laterPct) {
  if (!doses || !intervalHours) return '';
  // Calendar days from first dose to last, inclusive
  var days = 1 + Math.floor((doses - 1) * intervalHours / 24);
  return doses + ' doses, ' + (MED_COURSE_INTERVALS[intervalHours] || 'every ' + intervalHours + ' h') +
    (intervalHours !== 24 ? ' (over ' + days + ' day' + (days !== 1 ? 's' : '') + ')' : '') +
    (laterPct && laterPct < 100 ? ' \u2014 first dose full, then ' + laterPct + '%' : '');
}

// Date a course's dose number k (0-based) is due: start + whole days elapsed.
// Twice a day puts doses 0 and 1 on day 0, doses 2 and 3 on day 1, and so on.
function medCourseDueDate(startISO, k, intervalHours) {
  return medAddDays(startISO, Math.floor(k * intervalHours / 24));
}

var MED_REASON_LABELS = {
  expired: 'Expired / discarded', spilled: 'Spilled / broken',
  unlogged_use: 'Used but not logged', correction: 'Count correction', other: 'Other'
};
var MED_TYPE_BADGE = { purchase: 'badge-green', dose: 'badge-blue', use: 'badge-teal', adjustment: 'badge-amber' };

// Which page is showing the stock UI. The three pages reuse the same element
// ids (forms, tables), so each render first empties the others' containers.
var MED_CONTEXTS = {
  meds:  { container: 'med-content',      kinds: ['medicine', 'health_supply'] },
  setup: { container: 'medsetup-content', kinds: ['medicine', 'health_supply'] },
  farm:  { container: 'fsup-content',     kinds: ['farm_supply'] }
};
var medCtx = 'meds';

function medClaim(ctx) {
  medCtx = ctx;
  Object.keys(MED_CONTEXTS).forEach(function(k) {
    if (k === ctx) return;
    var el = document.getElementById(MED_CONTEXTS[k].container);
    if (el) el.innerHTML = '';
  });
}

function medInCtx(m) { return MED_CONTEXTS[medCtx].kinds.indexOf(m.kind || 'medicine') >= 0; }
// Small "fridge" badge shown after a medicine's name when it must be kept cold
function medFridgeBadge(m) {
  return m.refrigerate ? ' <span class="badge badge-blue" style="font-size:10px" title="Keep refrigerated">&#10052; fridge</span>' : '';
}
function medIsSupply(m) { return m.kind === 'health_supply' || m.kind === 'farm_supply'; }

// Re-render whichever page the ledger UI is on after a save
function medRerender() {
  if (medCtx === 'setup') renderMedSetupPage();
  else if (medCtx === 'farm') renderFarmSupplies();
  else renderMedicinesPage();
}

function medEsc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// SHARED HELPERS (used by health.js and overview.js too)
// ============================================================

// Fetches the registry and the full ledger. The cabinet is small
// (tens of medicines, hundreds of movements), so one fetch of each is fine.
async function medLoadData() {
  var r = await Promise.all([
    sbGet('medicines', 'select=*&order=name'),
    sbGet('medicine_movements',
      'select=id,medicine_id,date,movement_type,quantity,packs,cost_pkr,expiry_date,' +
      'health_event_id,animal_id,is_share,pack_size,reason,notes,created_at&order=date.desc,id.desc'),
    // Breeding/birth records drive the pregnancy checks used when dosing
    sbGet('breeding_events', 'select=dam_id,date&order=date.desc'),
    sbGet('birth_events', 'select=dam_id,date&order=date.desc'),
    // Per-species dose overrides, and species names to label them
    sbGet('medicine_species_doses', 'select=*'),
    sbGet('species', 'select=id,common_name,category&order=common_name')
  ]);
  medList = r[0];
  medMovements = r[1];
  medBreedings = r[2];
  medBirths = r[3];
  medSpeciesDoses = r[4];
  medSpeciesList = r[5];
}

function medById(id) {
  return medList.find(function(m) { return m.id === id; }) || null;
}

// Current stock in stock units = sum of the ledger
function medStock(medId) {
  return medMovements.reduce(function(sum, mv) {
    return mv.medicine_id === medId ? sum + Number(mv.quantity) : sum;
  }, 0);
}

// Cost of one stock unit, taken from the most recent purchase that has a price.
// Ledger is already sorted newest first, so the first match wins.
function medCostPerUnit(medId) {
  var p = medMovements.find(function(mv) {
    return mv.medicine_id === medId && mv.movement_type === 'purchase' &&
           mv.cost_pkr != null && Number(mv.quantity) > 0;
  });
  return p ? Number(p.cost_pkr) / Number(p.quantity) : null;
}

// Expiry of the most recent purchase — information only, shown in the list
function medLatestExpiry(medId) {
  var p = medMovements.find(function(mv) {
    return mv.medicine_id === medId && mv.movement_type === 'purchase' && mv.expiry_date;
  });
  return p ? p.expiry_date : null;
}

// Formats a quantity in stock units, e.g. "40 ml", "1 tablet", "2.5 g"
function medFmtUnits(med, qty) {
  var n = Math.round(qty * 100) / 100;
  var unit = med.stock_unit;
  if ((unit === 'tablet' || unit === 'dose' || unit === 'piece') && Math.abs(n) !== 1) unit += 's';
  return n.toLocaleString() + ' ' + unit;
}

// Formats stock as whole packs plus loose units, e.g. "2 vials + 40 ml"
function medFmtStock(med, qty) {
  if (qty <= 0) return medFmtUnits(med, qty);
  var packs = Math.floor(qty / med.pack_size + 1e-9);
  var rest  = Math.round((qty - packs * med.pack_size) * 100) / 100;
  var parts = [];
  if (packs) parts.push(packs + ' ' + med.pack_label + (packs !== 1 ? 's' : ''));
  if (rest > 0 || !packs) parts.push(medFmtUnits(med, rest));
  return parts.join(' + ');
}

function medSpeciesName(speciesId) {
  var sp = medSpeciesList.find(function(x) { return x.id === speciesId; });
  return sp ? sp.common_name : 'Species ' + speciesId;
}

function medSpeciesCategory(speciesId) {
  var sp = medSpeciesList.find(function(x) { return x.id === speciesId; });
  return sp ? (sp.category || 'other') : null;
}

// Label for a dose row: its species, or its category ("Poultry")
function medDoseRowLabel(d) {
  return d.species_id != null ? medSpeciesName(d.species_id) : (SPECIES_CATEGORIES[d.category] || d.category);
}

// True when a medicine is dosed per species (it has species rows). Such a
// medicine has no general dose: a species without a row gets no suggestion.
function medIsSpeciesDosed(med) {
  return medSpeciesDoses.some(function(d) { return d.medicine_id === med.id; });
}

// The label rate to use for one species. A medicine dosed per species/category
// uses that species' own row if it has one, else its category's row (e.g.
// "Poultry"), else no rate. Otherwise the general dose applies to every animal.
// All have the same shape ({ dose_basis, dose_amount, ... }); dose_basis null = no rate.
var MED_NO_RATE = { dose_basis: null };
function medRateFor(med, speciesId) {
  if (!medIsSpeciesDosed(med)) return med;
  var rows = medSpeciesDoses.filter(function(d) { return d.medicine_id === med.id; });
  var cat = medSpeciesCategory(speciesId);
  return rows.find(function(d) { return d.species_id != null && d.species_id === speciesId; }) ||
         rows.find(function(d) { return d.category && d.category === cat; }) ||
         MED_NO_RATE;
}

// Allowed routes of a medicine (array of MED_ROUTES keys; empty = not set)
function medRoutes(med) { return (med && med.routes) || []; }

// The amount from a label rate. Ranged doses ("4 to 8 ml") store the low end in
// dose_amount and the high end in dose_amount_max. which: 'mid' (default — what
// the dose grid pre-fills), 'min', or 'max' (used by the reorder look-ahead, so
// the estimate never comes up short).
function medRateAmount(rate, which) {
  var lo = Number(rate.dose_amount);
  var hi = rate.dose_amount_max != null ? Number(rate.dose_amount_max) : lo;
  if (which === 'min') return lo;
  if (which === 'max') return hi;
  return (lo + hi) / 2;
}

// Amount text: "4 ml" or, for a range, "4–8 ml"
function medFmtRateAmount(med, rate) {
  if (rate.dose_amount_max == null) return medFmtUnits(med, Number(rate.dose_amount));
  return (Math.round(Number(rate.dose_amount) * 100) / 100).toLocaleString() + '\u2013' + medFmtUnits(med, Number(rate.dose_amount_max));
}

// One rate as text, e.g. "1 ml per 10 kg", "4–8 ml per animal"
function medFmtRate(med, rate) {
  if (!rate || !rate.dose_basis) return '—';
  var amt = medFmtRateAmount(med, rate);
  if (rate.dose_basis === 'per_head') return amt + ' per animal';
  if (rate.dose_basis === 'per_litre') return amt + ' per ' + Number(rate.dose_water_l) + ' L water';
  return amt + ' per ' + Number(rate.dose_weight_kg) + ' kg';
}

// Suggested total for a bulk round from a per-litre label dose, rounded to the
// nearest half unit. Null when the medicine has no per-litre dose or no volume given.
// animalIds: the animals in the round — for a medicine dosed by species/category
// their (single, shared) per-litre rate is used; mixed rates give no suggestion.
function medSuggestWaterTotal(med, litres, animalIds) {
  if (!med || !(litres > 0)) return null;
  var rate = med;
  if (medIsSpeciesDosed(med)) {
    var rates = [];
    (animalIds || []).forEach(function(id) {
      var a = anSharedAnimals.find(function(x) { return x.id === id; });
      var r = medRateFor(med, a ? a.species_id : null);
      if (rates.indexOf(r) < 0) rates.push(r);
    });
    if (rates.length !== 1) return null;
    rate = rates[0];
  }
  if (rate.dose_basis !== 'per_litre') return null;
  var raw = medRateAmount(rate, 'mid') * litres / Number(rate.dose_water_l);
  return Math.max(0.5, Math.round(raw * 2) / 2);
}

// Splits a bulk round's total evenly over the animals present. Shares are
// rounded to 4 decimals and the last one takes the rounding remainder, so the
// shares always add up to exactly the total taken out of stock.
function medSplitShares(total, animalIds) {
  var n = animalIds.length;
  if (!n) return [];
  var each = Math.round(total / n * 10000) / 10000;
  return animalIds.map(function(id, i) {
    var q = i < n - 1 ? each : Math.round((total - each * (n - 1)) * 10000) / 10000;
    return { animal_id: id, qty: q, share: true };
  });
}

// Total used in the most recent bulk round of this medicine that covered any of
// these animals — the look-ahead estimate for in-water / spray schedules, whose
// label dose depends on a water volume that isn't known in advance.
function medLastBulkTotal(medId, animalIds) {
  var byEvent = {}, latest = null;
  medMovements.forEach(function(mv) {
    if (mv.medicine_id !== medId || mv.movement_type !== 'dose' || !mv.is_share || !mv.health_event_id) return;
    var ev = byEvent[mv.health_event_id] || (byEvent[mv.health_event_id] = { date: mv.date, total: 0, hit: false });
    ev.total += -Number(mv.quantity);
    if (animalIds.indexOf(mv.animal_id) >= 0) ev.hit = true;
  });
  Object.keys(byEvent).forEach(function(k) {
    var ev = byEvent[k];
    if (ev.hit && (!latest || ev.date > latest.date)) latest = ev;
  });
  return latest;
}

// Human-readable label dose: the default, then any species overrides,
// e.g. "1 ml per 10 kg; Sheep: 1 ml per 25 kg; Donkey: 5 ml per animal"
function medFmtDoseRate(med) {
  var parts = medDoseLines(med);
  return parts.length ? parts.join('; ') : '—';
}

// The label dose as separate lines (general dose, or one per species) —
// one line each in the Setup list, joined with ';' elsewhere
function medDoseLines(med) {
  var parts = [];
  if (med.dose_basis) parts.push(medFmtRate(med, med));
  medSpeciesDoses.filter(function(d) { return d.medicine_id === med.id; })
    // Category rows first, then species rows (which override their category), each A–Z
    .sort(function(a, b) {
      if ((a.species_id != null) !== (b.species_id != null)) return a.species_id != null ? 1 : -1;
      return medDoseRowLabel(a).localeCompare(medDoseRowLabel(b));
    })
    .forEach(function(d) { parts.push(medEsc(medDoseRowLabel(d)) + ': ' + medFmtRate(med, d)); });
  return parts;
}

// The weight used for dosing: latest weigh-in, else entry weight, else null
function medAnimalWeight(animalId) {
  var w = getLatestWeight(animalId);
  if (w && w.weight_kg != null) return Number(w.weight_kg);
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  return a && a.entry_weight_kg != null ? Number(a.entry_weight_kg) : null;
}

// Suggested dose for one animal from the label rate, rounded to the nearest
// half unit (matches how doses are actually drawn up: 18 kg and 22 kg goats
// both get 2 ml). Returns null when there's no label rate, or when the rate is
// weight-based and the animal has never been weighed.
// The rate comes from the animal's species when the medicine has one for it.
// A ranged label dose is pre-filled at its midpoint (which = 'mid', the
// default); the reorder look-ahead asks for 'max'.
function medSuggestDose(med, animalId, which) {
  if (!med) return null;
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  var rate = medRateFor(med, a ? a.species_id : null);
  if (!rate.dose_basis || rate.dose_basis === 'per_litre') return null;  // per-litre is a bulk-round rate
  if (rate.dose_basis === 'per_head') return medRateAmount(rate, which);
  var kg = medAnimalWeight(animalId);
  if (kg == null) return null;
  var raw = medRateAmount(rate, which) * kg / Number(rate.dose_weight_kg);
  return Math.max(0.5, Math.round(raw * 2) / 2);
}

// The label range for one animal, unrounded: { min, max } — or null when the
// rate isn't a range (or is weight-based and the animal was never weighed).
// Used to flag doses typed outside the label range.
function medDoseRange(med, animalId) {
  if (!med) return null;
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  var rate = medRateFor(med, a ? a.species_id : null);
  if (!rate.dose_basis || rate.dose_basis === 'per_litre' || rate.dose_amount_max == null) return null;
  if (rate.dose_basis === 'per_head') return { min: medRateAmount(rate, 'min'), max: medRateAmount(rate, 'max') };
  var kg = medAnimalWeight(animalId);
  if (kg == null) return null;
  var f = kg / Number(rate.dose_weight_kg);
  return { min: medRateAmount(rate, 'min') * f, max: medRateAmount(rate, 'max') * f };
}

// ---- Meat withdrawal ----
// An animal is in withdrawal while today is before (dose date + the medicine's
// withdrawal_days) for any dose it received. Returns the latest such window:
// { safeDate: 'YYYY-MM-DD', med } — or null when the animal is safe.
// field: 'withdrawal_days' (meat, default) or 'milk_withdrawal_days'.
function medWithdrawalFor(animalId, asOfISO, field) {
  var asOf = asOfISO || todayISO();
  var key = field || 'withdrawal_days';
  var worst = null;
  medMovements.forEach(function(mv) {
    if (mv.animal_id !== animalId || mv.movement_type !== 'dose') return;
    var med = medById(mv.medicine_id);
    if (!med || !med[key]) return;
    var d = new Date(mv.date + 'T00:00:00');
    d.setDate(d.getDate() + Number(med[key]));
    var safe = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (safe > asOf && (!worst || safe > worst.safeDate)) worst = { safeDate: safe, med: med };
  });
  return worst;
}

// Small red badge for tables; '' when the animal is not in withdrawal
// Small red badges for tables: meat withdrawal, plus milk withdrawal for an
// animal marked as being milked. '' when neither applies.
function medWithdrawalBadge(animalId) {
  var w = medWithdrawalFor(animalId);
  var html = w
    ? ' <span class="badge badge-red" title="' + medEsc(w.med.name) + ' meat withdrawal">meat withdrawal to ' + fmtDate(w.safeDate) + '</span>'
    : '';
  if (medIsMilked(animalId)) {
    var mw = medWithdrawalFor(animalId, null, 'milk_withdrawal_days');
    if (mw) html += ' <span class="badge badge-red" title="' + medEsc(mw.med.name) + ' milk withdrawal">milk withdrawal to ' + fmtDate(mw.safeDate) + '</span>';
  }
  return html;
}

// ---- Milking ----
// animals.being_milked is set by hand on the animal's Edit row (not every doe that kids is milked)
function medIsMilked(animalId) {
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  return !!(a && a.being_milked);
}
function medMilkingBadge(animalId) {
  return medIsMilked(animalId) ? ' <span class="badge badge-teal">milking</span>' : '';
}

// Confirm dialog before a sale / slaughter / exit. Returns true to go ahead.
// asOfISO is the sale or exit date, so back-dated entries are checked correctly.
function medConfirmWithdrawal(animalId, asOfISO, action) {
  var w = medWithdrawalFor(animalId, asOfISO);
  if (!w) return true;
  return confirm(getAnimalDisplayName(animalId) + ' is still in the meat withdrawal period for ' + w.med.name +
    ' until ' + fmtDate(w.safeDate) + '.\n\n' + action + ' anyway?');
}

// ---- Pregnancy ----
// How long past the expected date an animal still counts as pregnant (late kidding)
var MED_PREG_GRACE_DAYS = 14;

function medAddDays(iso, days) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Is this animal pregnant today? Two sources:
//   manual   — animals.expected_birth_date, set from the animal's Edit row
//   breeding — a mating logged within the species' gestation period
// Either way it stops counting once a birth is logged after conception, or
// MED_PREG_GRACE_DAYS after the expected date. Returns { due, source } or null.
function medPregnancy(animalId) {
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  if (!a || a.sex === 'male') return null;
  var sp = anSharedSpecies.find(function(s) { return s.id === a.species_id; });
  var gestation = sp && sp.gestation_days ? Number(sp.gestation_days) : 150;
  var today = todayISO();
  var birthSince = function(iso) {
    return medBirths.some(function(b) { return b.dam_id === animalId && b.date >= iso; });
  };
  // day: how far into the pregnancy today is (day 0 = mating / estimated conception)
  var dayOf = function(startISO) {
    return Math.round((new Date(today + 'T00:00:00') - new Date(startISO + 'T00:00:00')) / 864e5);
  };
  if (a.expected_birth_date && today <= medAddDays(a.expected_birth_date, MED_PREG_GRACE_DAYS) &&
      !birthSince(medAddDays(a.expected_birth_date, -gestation))) {
    // No mating record: conception estimated back from the expected date
    var est = medAddDays(a.expected_birth_date, -gestation);
    return { due: a.expected_birth_date, source: 'manual', start: est, day: dayOf(est) };
  }
  var mating = medBreedings.find(function(b) { return b.dam_id === animalId; });  // newest first
  if (mating) {
    var due = medAddDays(mating.date, gestation);
    if (today <= medAddDays(due, MED_PREG_GRACE_DAYS) && !birthSince(mating.date)) {
      return { due: due, source: 'breeding', start: mating.date, day: dayOf(mating.date) };
    }
  }
  return null;
}

// Pregnancy rule labels for the medicine form and list
var MED_PREG_RULES = { safe: 'Safe in pregnancy', avoid_all: 'Avoid throughout pregnancy',
                       avoid_first: 'Avoid early pregnancy (first … days)', avoid_last: 'Avoid late pregnancy (last … days)' };
function medFmtPregRule(med) {
  if (med.pregnancy_rule === 'avoid_all') return 'not in pregnancy';
  if (med.pregnancy_rule === 'avoid_first') return 'not in first ' + med.pregnancy_rule_days + ' days of pregnancy';
  if (med.pregnancy_rule === 'avoid_last') return 'not in last ' + med.pregnancy_rule_days + ' days of pregnancy';
  return '';
}

// Why this medicine shouldn't be given to this animal right now, or '' if it's fine.
// Covers the pregnancy rule (by stage) and "not for milking animals". The dose
// grid pre-fills 0 for any animal with a reason and lists the reasons.
function medSkipReason(med, animalId) {
  if (!med) return '';
  var reasons = [];
  var rule = med.pregnancy_rule || (med.unsafe_in_pregnancy ? 'avoid_all' : 'safe');
  var p = rule !== 'safe' ? medPregnancy(animalId) : null;
  if (p) {
    var toDue = Math.round((new Date(p.due + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 864e5);
    var est = p.source === 'manual' ? ' (estimated)' : '';
    if (rule === 'avoid_all') reasons.push('pregnant');
    else if (rule === 'avoid_first' && p.day < med.pregnancy_rule_days) reasons.push('day ' + p.day + ' of pregnancy' + est + ' — avoid first ' + med.pregnancy_rule_days + ' days');
    else if (rule === 'avoid_last' && toDue < med.pregnancy_rule_days) reasons.push((toDue >= 0 ? 'due in ' + toDue + ' days' : 'overdue') + est + ' — avoid last ' + med.pregnancy_rule_days + ' days');
  }
  if (med.not_for_milking && medIsMilked(animalId)) reasons.push('being milked');
  return reasons.join(', ');
}

function medPregnancyBadge(animalId) {
  var p = medPregnancy(animalId);
  return p ? ' <span class="badge badge-blue" title="' + (p.source === 'manual' ? 'Set on the animal' : 'From breeding record') + '">pregnant, due ' + fmtDate(p.due) + '</span>' : '';
}

// On-farm animals a schedule applies to (animal, group or location target)
function medScheduleAnimals(sched) {
  var onFarm = function(a) { return a.status !== 'deceased' && a.status !== 'sold'; };
  if (sched.animal_id) {
    return anSharedAnimals.filter(function(a) { return a.id === sched.animal_id && onFarm(a); });
  }
  if (sched.group_id) return getGroupAnimals(sched.group_id);
  if (sched.location_id) {
    return anSharedAnimals.filter(function(a) { return a.current_location_id === sched.location_id && onFarm(a); });
  }
  return [];
}

// Builds the reorder alert list. Two kinds of alert per medicine:
//   - shortfall: scheduled rounds due within MED_LOOKAHEAD_DAYS need more than is in stock
//   - below minimum: stock is under the medicine's min_stock level
// Rounds for the same medicine are added together, since they draw on the same stock.
// Brands are NOT pooled by active ingredient — each schedule names one exact medicine.
function medComputeAlerts(schedules) {
  var horizon = new Date(); horizon.setDate(horizon.getDate() + MED_LOOKAHEAD_DAYS);
  var horizonISO = horizon.toISOString().slice(0, 10);

  // Estimated need per medicine from upcoming (or overdue) scheduled rounds
  var needs = {};
  (schedules || []).forEach(function(s) {
    if (!s.active || !s.medicine_id || !s.next_due_date || s.next_due_date > horizonISO) return;
    var med = medById(s.medicine_id);
    if (!med || !med.active) return;
    var animals = medScheduleAnimals(s);
    var need = 0, unweighed = 0, fromLast = null;
    var bulkOnly = medRoutes(med).length && medRoutes(med).every(medIsBulkRoute);
    var lastBulk = medRoutes(med).some(medIsBulkRoute) ? medLastBulkTotal(med.id, animals.map(function(a) { return a.id; })) : null;
    if (lastBulk || bulkOnly) {
      // In-water / in-feed / spray rounds: assume the same total as last time
      // (no earlier round = no estimate; the minimum-stock reminder still applies)
      fromLast = lastBulk || { total: 0, none: true };
      need = fromLast.total;
    } else {
      animals.forEach(function(a) {
        var d = medSuggestDose(med, a.id, 'max');  // top of any label range, so the estimate isn't short
        if (d == null) unweighed++; else need += d;
      });
    }
    // A running course needs every remaining dose, not just the next one
    var remaining = s.course_total ? Math.max(0, s.course_total - (s.course_given || 0)) : 1;
    need *= remaining;
    // Tapering course: once dose 1 is given, the rest are a % of it
    if (s.course_total && (s.course_given || 0) >= 1 && s.course_later_pct) need *= s.course_later_pct / 100;
    if (!needs[med.id]) needs[med.id] = { total: 0, rounds: [] };
    needs[med.id].total += need;
    needs[med.id].rounds.push({ sched: s, need: need, animals: animals.length, unweighed: unweighed, fromLast: fromLast, remaining: s.course_total ? remaining : null });
  });

  var alerts = [];
  medList.forEach(function(med) {
    if (!med.active) return;
    var stock = medStock(med.id);
    var n = needs[med.id];
    var shortfall = n ? n.total - stock : 0;
    var belowMin = med.min_stock != null && stock < Number(med.min_stock);
    if (shortfall > 0 || belowMin) {
      alerts.push({ med: med, stock: stock, need: n, shortfall: shortfall, belowMin: belowMin });
    }
  });
  // Shortfalls before below-minimum, then by name
  alerts.sort(function(a, b) {
    if ((a.shortfall > 0) !== (b.shortfall > 0)) return a.shortfall > 0 ? -1 : 1;
    return a.med.name.localeCompare(b.med.name);
  });
  return alerts;
}

// Renders the alert list as cards. Returns '' when nothing needs attention,
// so callers can hide the banner entirely.
function medAlertsHtml(alerts) {
  if (!alerts.length) return '';
  var html = '';
  alerts.forEach(function(al) {
    var med = al.med;
    var cls = al.shortfall > 0 ? 'overdue' : 'soon';
    var title = medEsc(med.name) + (med.active_ingredient ? ' <span style="font-weight:400;color:var(--muted)">(' + medEsc(med.active_ingredient) + ')</span>' : '');
    var tag = al.shortfall > 0
      ? 'Short ' + medFmtUnits(med, al.shortfall) + ' (≈' + Math.ceil(al.shortfall / med.pack_size - 1e-9) + ' ' + med.pack_label + (Math.ceil(al.shortfall / med.pack_size - 1e-9) !== 1 ? 's' : '') + ')'
      : 'Below minimum';
    html += '<div class="due-card ' + cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">' + title + '</span>' +
      '<span class="due-card-days ' + cls + '">' + tag + '</span></div>' +
      '<div class="due-card-meta">In stock: ' + medFmtStock(med, al.stock) +
      (med.min_stock != null ? ' &middot; minimum ' + medFmtUnits(med, Number(med.min_stock)) : '') + '</div>';
    if (al.need) {
      al.need.rounds.forEach(function(rd) {
        var target = rd.sched.animal_id ? getAnimalDisplayName(rd.sched.animal_id)
                   : (rd.sched.group_id ? getGroupName(rd.sched.group_id) : getLocationName(rd.sched.location_id));
        html += '<div class="due-card-meta">' + medEsc(rd.sched.description) + ' &middot; ' + medEsc(target) +
          ' &middot; due ' + fmtDate(rd.sched.next_due_date) +
          (rd.fromLast
            ? (rd.fromLast.none ? ' &middot; <span style="color:var(--muted)">no earlier round to estimate from</span>'
                                : ' &middot; needs ~' + medFmtUnits(med, rd.need) + ' (same as the last round)')
            : ' &middot; needs ~' + medFmtUnits(med, rd.need) + ' for ' + rd.animals + ' animal' + (rd.animals !== 1 ? 's' : '')) +
          (rd.remaining ? ' &middot; ' + rd.remaining + ' dose' + (rd.remaining !== 1 ? 's' : '') + ' left in course' : '') +
          (rd.unweighed ? ' <span style="color:var(--amber)">(' + rd.unweighed + ' never weighed, not counted)</span>' : '') +
          '</div>';
      });
    }
    html += '</div>';
  });
  return html;
}

// ============================================================
// INVENTORY › MEDICINES & HEALTH SUPPLIES (stock, buying, use, counting)
// ============================================================
async function loadMedicinesPage() {
  medClaim('meds');
  var el = document.getElementById('med-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var r = await Promise.all([
      medLoadData(),
      sbGet('scheduled_health_events', 'active=eq.true&select=*')
    ]);
    medPageScheds = r[1];
    renderMedicinesPage();
    document.getElementById('med-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}
var medPageScheds = [];  // active schedules, for the alert panel on this page

// Lays out the page: reorder alerts, the purchase/use/count form slot, and the stock table
function renderMedicinesPage() {
  medClaim('meds');
  var alerts = medComputeAlerts(medPageScheds).filter(function(al) { return medInCtx(al.med); });
  var html =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Needs attention</h2>' +
      '<span class="section-meta">' + alerts.length + ' item' + (alerts.length !== 1 ? 's' : '') +
      ' &middot; rounds due in the next ' + MED_LOOKAHEAD_DAYS + ' days + minimum stock</span></div>' +
      '<div style="padding:16px 22px">' +
        (alerts.length ? medAlertsHtml(alerts) : '<div class="empty">Nothing to buy right now.</div>') +
      '</div>' +
    '</div>' +
    '<div class="section">' +
      '<div class="section-hdr"><h2>Stock</h2>' +
      // Adding/editing items lives in Setup; link there so it's one click away
      '<button class="btn btn-sm" onclick="goToPage(\'medsetup\')">Manage list</button></div>' +
      '<div id="med-action-wrap"></div>' +
      '<div id="med-table"></div>' +
    '</div>';
  document.getElementById('med-content').innerHTML = html;
  if (medActionId !== null) renderMedActionForm();
  renderMedTable();
}

// Groups the current page's items: medicines by active ingredient (brands of the
// same drug together), then supplies. Returns [{ label, meds }]; retired go last.
function medGroupedRows(includeRetired) {
  var kindOrder = { medicine: 0, health_supply: 1, farm_supply: 2 };
  // Medicines group by type, then by active ingredient within it (brands of the same drug together)
  var classOrder = Object.keys(MED_CLASSES);
  var classRank = function(m) { var i = classOrder.indexOf(m.med_class); return i < 0 ? classOrder.length : i; };
  var groupKey = function(m) {
    if (m.kind === 'health_supply') return 'Health supplies';
    if (m.kind === 'farm_supply') return 'Consumables';
    return (MED_CLASSES[m.med_class] || 'Type not set') + ' \u2014 ' + (m.active_ingredient || 'no active ingredient recorded');
  };
  var rows = medList.filter(function(m) { return medInCtx(m) && (includeRetired || m.active); }).sort(function(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    var ka = kindOrder[a.kind || 'medicine'], kb = kindOrder[b.kind || 'medicine'];
    if (ka !== kb) return ka - kb;
    if (classRank(a) !== classRank(b)) return classRank(a) - classRank(b);
    var ai = (a.kind === 'medicine' || !a.kind ? (a.active_ingredient || '￿') : '').toLowerCase();
    var bi = (b.kind === 'medicine' || !b.kind ? (b.active_ingredient || '￿') : '').toLowerCase();
    if (ai !== bi) return ai < bi ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var groups = [];
  rows.forEach(function(m) {
    var label = !m.active ? 'Retired' : groupKey(m);
    var last = groups[groups.length - 1];
    if (!last || last.label.toLowerCase() !== label.toLowerCase()) groups.push({ label: label, meds: [m] });
    else last.meds.push(m);
  });
  return groups;
}

// Separator row used by the stock and list tables
function medGroupRow(label, colCount) {
  return '<tr style="background:var(--bg)"><td colspan="' + colCount + '" style="' +
    'padding:6px 16px;font-size:11px;font-weight:600;color:var(--muted);' +
    'text-transform:uppercase;letter-spacing:0.06em;border-top:2px solid var(--border)">' +
    medEsc(label) + '</td></tr>';
}

// ---- Stock table (Inventory page, and the Consumables section) ----
// On the Consumables section the list is managed here too, so Edit / Retire /
// Delete appear alongside Buy / Use / Count.
function renderMedTable() {
  var tbl = document.getElementById('med-table');
  var farm = medCtx === 'farm';
  var groups = medGroupedRows(farm);
  if (!groups.length) {
    tbl.innerHTML = '<div class="empty">' + (farm
      ? 'No consumables yet. Use + Add consumable for things like fuel, twine or feed bags.'
      : 'Nothing here yet. Add medicines and health supplies in Setup › Medicines & Health Supplies, then log purchases here.') + '</div>';
    return;
  }
  var colCount = 7;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Item</th><th>Used for</th><th>Pack</th>' +
    '<th class="right">In stock</th><th class="right">Cost / unit</th><th>' + (farm ? 'Spent' : 'Latest expiry') + '</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  groups.forEach(function(g) {
    html += medGroupRow(g.label, colCount);
    g.meds.forEach(function(m) {
      var stock = medStock(m.id);
      var low = m.active && m.min_stock != null && stock < Number(m.min_stock);
      var cpu = medCostPerUnit(m.id);
      var expiry = medLatestExpiry(m.id);
      var spent = medMovements.reduce(function(s, mv) {
        return mv.medicine_id === m.id && mv.movement_type === 'purchase' && mv.cost_pkr != null ? s + Number(mv.cost_pkr) : s;
      }, 0);
      var hasMoves = medMovements.some(function(mv) { return mv.medicine_id === m.id; });
      html += '<tr' + (!m.active ? ' style="opacity:0.5"' : '') + '>' +
        '<td style="font-weight:500">' + medEsc(m.name) + medFridgeBadge(m) + '</td>' +
        '<td class="muted-cell">' + (m.purpose ? medEsc(m.purpose) : '—') + '</td>' +
        '<td class="muted-cell">' + medFmtUnits(m, Number(m.pack_size)) + ' / ' + medEsc(m.pack_label) + '</td>' +
        '<td class="mono right"' + (low ? ' style="color:var(--red);font-weight:500"' : '') + '>' +
          medFmtStock(m, stock) +
          (m.min_stock != null ? '<div style="font-size:11px;color:var(--muted);font-weight:400">min ' + medFmtUnits(m, Number(m.min_stock)) + '</div>' : '') +
        '</td>' +
        '<td class="mono right">' + (cpu != null ? 'PKR ' + r2(cpu).toLocaleString() : '—') + '</td>' +
        '<td class="' + (farm ? 'mono' : 'muted-cell') + '">' + (farm ? (spent ? pkr(spent) : '—') : (expiry ? fmtDate(expiry) : '—')) + '</td>' +
        '<td style="white-space:nowrap">' +
          (m.active
            ? '<button class="btn btn-sm btn-primary" onclick="openMedAction(' + m.id + ',\'purchase\')">Buy</button> ' +
              (medIsSupply(m) ? '<button class="btn btn-sm" onclick="openMedAction(' + m.id + ',\'use\')">Use</button> ' : '') +
              '<button class="btn btn-sm" onclick="openMedAction(' + m.id + ',\'count\')">Count</button> '
            : '') +
          '<button class="btn btn-sm" onclick="toggleMedHistory(' + m.id + ')">' + (medExpanded.has(m.id) ? 'Hide' : 'History') + '</button>' +
          (farm
            ? ' <button class="btn btn-sm" onclick="openMedForm(' + m.id + ')">Edit</button> ' +
              (m.active
                ? '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',false)">Retire</button>'
                : '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',true)">Reactivate</button>') +
              (!hasMoves ? ' <button class="btn btn-sm btn-danger" onclick="deleteMedicine(' + m.id + ')">Delete</button>' : '')
            : '') +
        '</td></tr>';
      if (medExpanded.has(m.id)) {
        html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' +
          renderMedHistory(m) + '</td></tr>';
      }
    });
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ---- Per-item ledger history (expandable row) ----
function toggleMedHistory(id) {
  if (medExpanded.has(id)) medExpanded.delete(id); else medExpanded.add(id);
  renderMedTable();
}

function renderMedHistory(med) {
  var moves = medMovements.filter(function(mv) { return mv.medicine_id === med.id; });
  if (!moves.length) return '<div class="empty" style="padding:14px 22px">No purchases, use or counts yet.</div>';
  var html = '<div style="padding:8px 22px 14px"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th class="right">Quantity</th><th class="right">Cost</th><th>Detail</th><th></th>' +
    '</tr></thead><tbody>';
  moves.forEach(function(mv) {
    var qty = Number(mv.quantity);
    var detail = [];
    if (mv.movement_type === 'purchase') {
      if (mv.packs != null) detail.push(Number(mv.packs) + ' ' + med.pack_label + (Number(mv.packs) !== 1 ? 's' : '') +
        (mv.pack_size != null ? ' of ' + medFmtUnits(med, Number(mv.pack_size)) : ''));
      if (mv.expiry_date) detail.push('expires ' + fmtDate(mv.expiry_date));
    }
    if (mv.animal_id) detail.push(medEsc(getAnimalDisplayName(mv.animal_id)));
    if (mv.reason) detail.push(MED_REASON_LABELS[mv.reason] || mv.reason);
    if (mv.notes) detail.push(medEsc(mv.notes));
    html += '<tr>' +
      '<td class="mono">' + fmtDate(mv.date) + '</td>' +
      '<td><span class="badge ' + (MED_TYPE_BADGE[mv.movement_type] || 'badge-gray') + '">' + mv.movement_type + '</span></td>' +
      '<td class="mono right">' + (qty > 0 ? '+' : '') + medFmtUnits(med, qty) + '</td>' +
      '<td class="mono right">' + (mv.cost_pkr != null ? pkr(mv.cost_pkr) : '—') + '</td>' +
      '<td class="muted-cell">' + (detail.length ? detail.join(' &middot; ') : '—') + '</td>' +
      // Doses are owned by their health event, so they can't be deleted from here
      '<td>' + (mv.movement_type !== 'dose'
        ? '<button class="btn btn-sm btn-danger" onclick="deleteMedMovement(' + mv.id + ')">Delete</button>' : '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

async function deleteMedMovement(id) {
  if (!confirm('Delete this stock entry? Stock will be recalculated. This cannot be undone.')) return;
  try {
    await sbDelete('medicine_movements', id);
    await medLoadData();
    medRerender();
  } catch(err) { alert('Error: ' + err.message); }
}

// ============================================================
// INVENTORY › TOOLS & EQUIPMENT — Consumables section
// (list and stock managed together; container #fsup-content)
// ============================================================
async function loadFarmSupplies() {
  medClaim('farm');
  var el = document.getElementById('fsup-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await medLoadData();
    renderFarmSupplies();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderFarmSupplies() {
  medClaim('farm');
  var low = medList.filter(function(m) {
    return m.kind === 'farm_supply' && m.active && m.min_stock != null && medStock(m.id) < Number(m.min_stock);
  }).length;
  document.getElementById('fsup-content').innerHTML =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Consumables</h2>' +
      '<div style="display:flex;gap:10px;align-items:center">' +
        '<span class="section-meta">' + (low ? '<span style="color:var(--red)">' + low + ' below minimum</span>' : 'Fuel, twine, feed bags, disinfectant…') + '</span>' +
        '<button class="btn btn-sm btn-primary" onclick="openMedForm(null, \'farm_supply\')">+ Add consumable</button>' +
      '</div></div>' +
      '<div id="med-form-wrap"></div>' +
      '<div id="med-action-wrap"></div>' +
      '<div id="med-table"></div>' +
    '</div>';
  if (medFormOpen) renderMedForm();
  if (medActionId !== null) renderMedActionForm();
  renderMedTable();
}

// ============================================================
// SETUP › MEDICINES & HEALTH SUPPLIES (the list: add / edit / retire / delete)
// ============================================================
async function loadMedSetupPage() {
  medClaim('setup');
  var el = document.getElementById('medsetup-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await medLoadData();
    renderMedSetupPage();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderMedSetupPage() {
  medClaim('setup');
  document.getElementById('medsetup-content').innerHTML =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Medicines, vaccines and health supplies</h2>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-sm btn-primary" onclick="openMedForm(null, \'medicine\')">+ Add medicine</button>' +
        '<button class="btn btn-sm btn-primary" onclick="openMedForm(null, \'health_supply\')">+ Add health supply</button>' +
      '</div></div>' +
      '<div id="med-form-wrap"></div>' +
      '<div id="medsetup-table"></div>' +
    '</div>';
  if (medFormOpen) renderMedForm();
  renderMedSetupTable();
}

function renderMedSetupTable() {
  var tbl = document.getElementById('medsetup-table');
  var groups = medGroupedRows(true);
  if (!groups.length) {
    tbl.innerHTML = '<div class="empty">Nothing yet. Use + Add medicine or + Add health supply to start the list.</div>';
    return;
  }
  var colCount = 10;
  // Widths: the text-heavy columns (Used for, Notes, Dose & route) get room;
  // short values stay on one line so their columns shrink to fit
  var html = '<div style="overflow-x:auto"><table class="tbl-compact"><thead><tr>' +
    '<th>Item</th><th style="min-width:220px">Used for</th><th>Pack</th><th style="min-width:120px">Dose &amp; route</th>' +
    '<th style="min-width:80px">Course</th><th>With&shy;drawal</th><th>Cautions</th><th class="right">Min stock</th>' +
    '<th style="min-width:100px">Notes</th><th></th>' +
    '</tr></thead><tbody>';
  // One line per fact, all in the cell's own font, so the columns read evenly
  var lines = function(arr) { return arr.length ? arr.map(function(t) { return '<div>' + t + '</div>'; }).join('') : '—'; };
  groups.forEach(function(g) {
    html += medGroupRow(g.label, colCount);
    g.meds.forEach(function(m) {
      var supply = medIsSupply(m);
      // Delete only while nothing has been bought/dosed/counted; after that, retire it
      var hasMoves = medMovements.some(function(mv) { return mv.medicine_id === m.id; });
      html += '<tr' + (!m.active ? ' style="opacity:0.5"' : '') + '>' +
        '<td style="font-weight:500;white-space:nowrap">' + medEsc(m.name) + medFridgeBadge(m) +
          '<div style="font-size:11px;color:var(--muted);font-weight:400">' + (supply ? 'health supply' : medEsc(m.form)) + '</div></td>' +
        '<td class="muted-cell">' + (m.purpose ? medEsc(m.purpose) : '—') + '</td>' +
        '<td class="muted-cell" style="white-space:nowrap">' + medFmtUnits(m, Number(m.pack_size)) + '<div>per ' + medEsc(m.pack_label) + '</div></td>' +
        // Dose lines, then the route(s) on their own line
        '<td class="muted-cell">' + (supply ? '—' : lines(medDoseLines(m).concat(
          medRoutes(m).length ? ['Route: ' + medRoutes(m).map(medRouteLabel).join(' or ')] : []))) + '</td>' +
        '<td class="muted-cell">' + (!supply && m.course_doses ? medFmtCourse(m.course_doses, m.course_interval_hours, m.course_later_pct) : '—') + '</td>' +
        '<td class="muted-cell" style="white-space:nowrap">' + (supply ? '—' : lines(
          (m.withdrawal_days != null ? ['Meat: ' + m.withdrawal_days + ' d'] : []).concat(
          m.milk_withdrawal_days != null ? ['Milk: ' + m.milk_withdrawal_days + ' d'] : []))) + '</td>' +
        // Who it shouldn't go to (pregnancy stage, milking animals)
        '<td style="max-width:140px">' + (supply ? '—' : lines(
          (medFmtPregRule(m) ? ['<span class="badge badge-red">' + medFmtPregRule(m) + '</span>'] : []).concat(
          m.not_for_milking ? ['<span class="badge badge-red">not for milking animals</span>'] : []))) + '</td>' +
        '<td class="mono right" style="white-space:nowrap">' + (m.min_stock != null ? medFmtUnits(m, Number(m.min_stock)) : '—') + '</td>' +
        '<td class="muted-cell">' + (m.notes ? medEsc(m.notes) : '—') + '</td>' +
        // Buttons stacked to keep the column narrow
        '<td><div style="display:flex;flex-direction:column;gap:4px">' +
          '<button class="btn btn-sm" onclick="openMedForm(' + m.id + ')">Edit</button>' +
          (m.active
            ? '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',false)">Retire</button>'
            : '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',true)">Reactivate</button>') +
          (!hasMoves ? '<button class="btn btn-sm btn-danger" onclick="deleteMedicine(' + m.id + ')">Delete</button>' : '') +
        '</div></td></tr>';
    });
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ---- Add / edit form (all three kinds) ----
// Medicines get the full form (ingredient, dose rate, withdrawal, pregnancy);
// supplies only need name, use, unit, pack and minimum stock.
var medFormOpen = false;

function openMedForm(id, kind) {
  medEditId = id;
  var m = id !== null ? medById(id) : null;
  medFormKind = m ? (m.kind || 'medicine') : (kind || 'medicine');
  // Copy this medicine's species rows into the form's working list
  medFormSpeciesMode = !!(m && medIsSpeciesDosed(m));
  medFormDoses = m ? medSpeciesDoses.filter(function(d) { return d.medicine_id === m.id; }).map(function(d) {
    return { species_id: d.species_id, category: d.category, dose_basis: d.dose_basis, dose_amount: d.dose_amount,
             dose_amount_max: d.dose_amount_max, dose_weight_kg: d.dose_weight_kg, dose_water_l: d.dose_water_l };
  }) : [];
  medFormOpen = true;
  renderMedForm();
  document.getElementById('med-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMedForm() {
  medEditId = null;
  medFormOpen = false;
  var wrap = document.getElementById('med-form-wrap');
  if (wrap) wrap.innerHTML = '';
}

var MED_KIND_LABEL = { medicine: 'medicine', health_supply: 'health supply', farm_supply: 'consumable' };
var MED_UNITS = {
  medicine:      ['ml', 'tablet', 'g', 'dose'],
  health_supply: ['piece', 'ml', 'g'],
  farm_supply:   ['piece', 'L', 'kg', 'ml', 'g']
};

function renderMedForm() {
  var m = medEditId !== null ? medById(medEditId) : null;
  var kind = medFormKind;
  var isMed = kind === 'medicine';
  var v = function(k, d) { return m && m[k] != null ? medEsc(m[k]) : (d || ''); };
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + label + '</option>'; };

  // Suggest active ingredients and pack labels already in use, so spellings stay consistent
  var ingredients = [], packLabels = isMed ? ['vial', 'bottle', 'box', 'strip', 'sachet'] : ['box', 'pack', 'bag', 'roll', 'can', 'bottle', 'litre'];
  medList.forEach(function(x) {
    if (x.active_ingredient && ingredients.indexOf(x.active_ingredient) < 0) ingredients.push(x.active_ingredient);
    if (x.pack_label && packLabels.indexOf(x.pack_label) < 0 && (x.kind || 'medicine') === kind) packLabels.push(x.pack_label);
  });

  var form  = m ? m.form : (isMed ? 'liquid' : 'other');
  var unit  = m ? m.stock_unit : MED_UNITS[kind][0];
  var basis = m ? (m.dose_basis || '') : '';
  var routes = m ? medRoutes(m) : [];
  var title = (m ? 'Edit ' + medEsc(m.name) : 'New ' + MED_KIND_LABEL[kind]);

  var html = '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + title + '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Name' + (isMed ? ' (brand)' : '') + ' *</label><input type="text" id="mf-name" value="' + v('name') + '" placeholder="' +
          (isMed ? 'e.g. Ivomec 1%' : kind === 'health_supply' ? 'e.g. Syringe 5 ml' : 'e.g. Diesel') + '"></div>' +
        (isMed
          ? '<div class="hf-field"><label>Active ingredient</label><input type="text" id="mf-ingredient" list="mf-ingredient-list" value="' + v('active_ingredient') + '" placeholder="e.g. Ivermectin">' +
              '<datalist id="mf-ingredient-list">' + ingredients.map(function(i) { return '<option value="' + medEsc(i) + '">'; }).join('') + '</datalist></div>' +
            '<div class="hf-field"><label>Type</label><select id="mf-class">' +
              opt('', 'Not set', m ? (m.med_class || '') : '') +
              Object.keys(MED_CLASSES).map(function(k) { return opt(k, MED_CLASSES[k], m ? (m.med_class || '') : ''); }).join('') +
            '</select></div>' +
            '<div class="hf-field"><label>Form</label><select id="mf-form">' +
              opt('liquid', 'Liquid', form) + opt('tablet', 'Tablet', form) + opt('powder', 'Powder', form) + opt('other', 'Other', form) +
            '</select></div>'
          : '<div class="hf-field" style="grid-column:span 2"><label>Used for</label><input type="text" id="mf-purpose" value="' + v('purpose') + '" placeholder="' +
              (kind === 'health_supply' ? 'e.g. Injections' : 'e.g. Chaff cutter, generator') + '"></div>') +
      '</div>' +
      (isMed
        ? '<div class="hf-grid" style="grid-template-columns:1fr">' +
            '<div class="hf-field"><label>Used for</label><input type="text" id="mf-purpose" value="' + v('purpose') + '" placeholder="e.g. Dewormer — roundworm, lungworm, mites"></div>' +
          '</div>'
        : '') +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Stock unit</label><select id="mf-unit" onchange="updateMedFormUnits()">' +
          MED_UNITS[kind].concat(MED_UNITS[kind].indexOf(unit) < 0 ? [unit] : []).map(function(u) { return opt(u, u, unit); }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Pack type</label><input type="text" id="mf-pack-label" list="mf-pack-list" value="' + v('pack_label', packLabels[0]) + '">' +
          '<datalist id="mf-pack-list">' + packLabels.map(function(p) { return '<option value="' + medEsc(p) + '">'; }).join('') + '</datalist></div>' +
        '<div class="hf-field"><label>Amount per pack (<span class="mf-unit-lbl">' + unit + '</span>) *</label><input type="number" id="mf-pack-size" min="0" step="any" value="' + v('pack_size', isMed ? '' : '1') + '" placeholder="e.g. 50"></div>' +
      '</div>';
  if (isMed) {
    html +=
      // Switch between one general dose and a dose per species (no mixing:
      // a species-dosed medicine has no general fallback)
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:2px 0 10px">' +
        '<input type="checkbox" id="mf-species-mode"' + (medFormSpeciesMode ? ' checked' : '') + ' onchange="toggleMedSpeciesMode(this.checked)"> ' +
        'Different dose per species / category</label>' +
      '<div class="hf-grid" id="mf-general-dose"' + (medFormSpeciesMode ? ' style="display:none"' : '') + '>' +
        '<div class="hf-field"><label>Label dose</label><select id="mf-basis" onchange="updateMedFormUnits()">' +
          opt('', 'Not set', basis) + opt('per_kg', 'By body weight', basis) + opt('per_head', 'Fixed per animal', basis) +
          opt('per_litre', 'Per litre of water', basis) +
        '</select></div>' +
        // Dose, with an optional "to" for ranged labels ("4 to 8 ml")
        '<div class="hf-field" id="mf-amount-wrap"><label>Dose (<span class="mf-unit-lbl">' + unit + '</span>) &middot; to (if a range)</label>' +
          '<div style="display:flex;gap:6px;align-items:center"><input type="number" id="mf-amount" min="0" step="any" value="' + v('dose_amount') + '" placeholder="e.g. 4" style="min-width:0">' +
          '<span style="color:var(--muted)">to</span><input type="number" id="mf-amount-max" min="0" step="any" value="' + v('dose_amount_max') + '" placeholder="optional" style="min-width:0"></div></div>' +
        // The third box is either "per N kg of body weight" or "per N litres of water"
        '<div class="hf-field" id="mf-weight-wrap"><label>Per kg of body weight</label><input type="number" id="mf-weight" min="0" step="any" value="' + v('dose_weight_kg') + '" placeholder="e.g. 50"></div>' +
        '<div class="hf-field" id="mf-water-wrap" style="display:none"><label>Per litres of water</label><input type="number" id="mf-water" min="0" step="any" value="' + v('dose_water_l') + '" placeholder="e.g. 1"></div>' +
      '</div>' +
      // One dose row per species; rendered by renderMedSpeciesDoses()
      '<div id="mf-species-block" style="margin:0 0 12px' + (medFormSpeciesMode ? '' : ';display:none') + '">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Dose per category or species &middot; a species row overrides its category &middot; animals with neither get no suggested dose</div>' +
        '<div id="mf-species-wrap"></div>' +
      '</div>' +
      // Allowed routes: one ticked is pre-filled when logging; several must be chosen each time
      '<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">Routes it can be given by &middot; ' +
        'one ticked is pre-filled when logging; with several you pick each time. In water, in feed and spray rounds record one total for the group.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:12px">' +
        Object.keys(MED_ROUTES).map(function(k) {
          return '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" class="mf-route" value="' + k + '"' +
            (routes.indexOf(k) >= 0 ? ' checked' : '') + '> ' + MED_ROUTES[k] + '</label>';
        }).join('') +
      '</div>' +
      // Course: given as several doses over time (blank = a single dose)
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Course &mdash; number of doses</label><input type="number" id="mf-course-doses" min="2" step="1" value="' + v('course_doses') + '" placeholder="Blank = single dose"></div>' +
        '<div class="hf-field"><label>Given</label><select id="mf-course-interval">' +
          Object.keys(MED_COURSE_INTERVALS).map(function(h) { return opt(String(h), MED_COURSE_INTERVALS[h], String(m && m.course_interval_hours ? m.course_interval_hours : 24)); }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Later doses (% of the first)</label><input type="number" id="mf-course-pct" min="1" max="100" step="1" value="' + v('course_later_pct') + '" placeholder="100 = all the same"></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin:-4px 0 12px">Each dose after the first becomes a reminder in Health › Due now. ' +
        'For "full dose on day 1, then half", enter 50%.</div>';
  }
  html += '<div class="hf-grid">' +
        '<div class="hf-field"><label>Minimum stock to keep (<span class="mf-unit-lbl">' + unit + '</span>)</label><input type="number" id="mf-min" min="0" step="any" value="' + v('min_stock') + '" placeholder="Optional — reminder below this"></div>' +
        (isMed ? '<div class="hf-field"><label>Meat withdrawal (days)</label><input type="number" id="mf-withdrawal" min="0" step="1" value="' + v('withdrawal_days') + '" placeholder="From the label — 0 if none"></div>' : '') +
        (isMed ? '<div class="hf-field"><label>Milk withdrawal (days)</label><input type="number" id="mf-milk-withdrawal" min="0" step="1" value="' + v('milk_withdrawal_days') + '" placeholder="From the label — 0 if none"></div>' : '') +
        '<div class="hf-field"' + (isMed ? '' : ' style="grid-column:span 2"') + '><label>Notes</label><input type="text" id="mf-notes" value="' + v('notes') + '" placeholder="Optional"></div>' +
      '</div>' +
      (isMed
        // Pregnancy by stage: animals inside the window are pre-filled 0 when dosing
        ? '<div class="hf-grid">' +
            '<div class="hf-field"><label>Pregnancy</label><select id="mf-preg-rule" onchange="document.getElementById(\'mf-preg-days-wrap\').style.visibility=(this.value===\'avoid_first\'||this.value===\'avoid_last\')?\'visible\':\'hidden\'">' +
              Object.keys(MED_PREG_RULES).map(function(k) { return opt(k, MED_PREG_RULES[k], m ? (m.pregnancy_rule || 'safe') : 'safe'); }).join('') +
            '</select></div>' +
            '<div class="hf-field" id="mf-preg-days-wrap" style="visibility:' + (m && (m.pregnancy_rule === 'avoid_first' || m.pregnancy_rule === 'avoid_last') ? 'visible' : 'hidden') + '">' +
              '<label>Days</label><input type="number" id="mf-preg-days" min="1" step="1" value="' + v('pregnancy_rule_days') + '" placeholder="e.g. 45"></div>' +
            '<div class="hf-field" style="align-self:end;font-size:12px;color:var(--muted);padding-bottom:8px">Animals in that window are pre-filled 0 when dosing.</div>' +
          '</div>' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:2px 0 10px">' +
            '<input type="checkbox" id="mf-no-milking"' + (m && m.not_for_milking ? ' checked' : '') + '> ' +
            'Not for animals being milked (pre-filled 0 when dosing)</label>' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:2px 0 10px">' +
            '<input type="checkbox" id="mf-fridge"' + (m && m.refrigerate ? ' checked' : '') + '> ' +
            'Keep refrigerated</label>'
        : '') +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitMedicine()">' + (m ? 'Save changes' : 'Add ' + MED_KIND_LABEL[kind]) + '</button>' +
        '<button class="btn" onclick="closeMedForm()">Cancel</button>' +
        '<span id="mf-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
  document.getElementById('med-form-wrap').innerHTML = html;
  if (isMed) renderMedSpeciesDoses();
  updateMedFormUnits();
}

// ---- Species-specific dose rows (inside the medicine form) ----
// Each row: species, basis (by weight / per animal), amount, and kg covered.
// Edits are copied into medFormDoses as they happen so re-renders keep them.
function renderMedSpeciesDoses() {
  var wrap = document.getElementById('mf-species-wrap');
  if (!wrap) return;
  var unit = document.getElementById('mf-unit') ? document.getElementById('mf-unit').value : '';
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + label + '</option>'; };
  // Each row targets a category ("c:poultry") or one species ("s:2"); a target can only have one row
  var keyOf = function(d) { return d.species_id != null ? 's:' + d.species_id : (d.category ? 'c:' + d.category : ''); };
  var used = medFormDoses.map(keyOf);
  var html = '';
  medFormDoses.forEach(function(d, i) {
    var cur = keyOf(d);
    var free = function(k) { return k === cur || used.indexOf(k) < 0; };
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' +
      '<select onchange="setMedSpeciesDose(' + i + ',\'target\',this.value)" style="min-width:140px">' +
        '<option value="">Species or category…</option>' +
        '<optgroup label="Categories">' +
          Object.keys(SPECIES_CATEGORIES).filter(function(k) { return free('c:' + k); })
            .map(function(k) { return opt('c:' + k, SPECIES_CATEGORIES[k], cur); }).join('') +
        '</optgroup><optgroup label="Species (overrides its category)">' +
          medSpeciesList.filter(function(sp) { return free('s:' + sp.id); })
            .map(function(sp) { return opt('s:' + sp.id, medEsc(sp.common_name), cur); }).join('') +
        '</optgroup>' +
      '</select>' +
      '<select onchange="setMedSpeciesDose(' + i + ',\'dose_basis\',this.value)">' +
        opt('per_kg', 'By body weight', d.dose_basis) + opt('per_head', 'Fixed per animal', d.dose_basis) +
        opt('per_litre', 'Per litre of water', d.dose_basis) +
      '</select>' +
      '<input type="number" min="0" step="any" style="width:80px" placeholder="dose" value="' + (d.dose_amount != null ? d.dose_amount : '') + '"' +
        ' oninput="setMedSpeciesDose(' + i + ',\'dose_amount\',this.value,true)">' +
      '<span style="font-size:13px;color:var(--muted)">to</span>' +
      '<input type="number" min="0" step="any" style="width:70px" placeholder="optional" value="' + (d.dose_amount_max != null ? d.dose_amount_max : '') + '"' +
        ' oninput="setMedSpeciesDose(' + i + ',\'dose_amount_max\',this.value,true)"> ' +
      '<span class="mf-unit-lbl" style="font-size:13px">' + unit + '</span>' +
      (d.dose_basis === 'per_kg'
        ? '<span style="font-size:13px;color:var(--muted)">per</span>' +
          '<input type="number" min="0" step="any" style="width:70px" placeholder="kg" value="' + (d.dose_weight_kg != null ? d.dose_weight_kg : '') + '"' +
            ' oninput="setMedSpeciesDose(' + i + ',\'dose_weight_kg\',this.value,true)">' +
          '<span style="font-size:13px;color:var(--muted)">kg</span>'
        : d.dose_basis === 'per_litre'
        ? '<span style="font-size:13px;color:var(--muted)">per</span>' +
          '<input type="number" min="0" step="any" style="width:70px" placeholder="litres" value="' + (d.dose_water_l != null ? d.dose_water_l : '') + '"' +
            ' oninput="setMedSpeciesDose(' + i + ',\'dose_water_l\',this.value,true)">' +
          '<span style="font-size:13px;color:var(--muted)">L water</span>'
        : '<span style="font-size:13px;color:var(--muted)">per animal</span>') +
      '<button class="btn btn-sm" onclick="removeMedSpeciesDose(' + i + ')">Remove</button>' +
    '</div>';
  });
  if (medFormDoses.length < medSpeciesList.length + Object.keys(SPECIES_CATEGORIES).length) {
    html += '<button class="btn btn-sm" onclick="addMedSpeciesDose()">+ Add species or category</button>';
  }
  wrap.innerHTML = html;
}

// Stores one edited field. Typing in a number box skips the re-render so the
// cursor isn't lost; select changes re-render (they can show/hide the kg box).
function setMedSpeciesDose(i, field, value, noRender) {
  var d = medFormDoses[i];
  if (!d) return;
  if (field === 'target') {
    // "s:<id>" = one species, "c:<key>" = a whole category
    d.species_id = value.indexOf('s:') === 0 ? parseInt(value.slice(2)) : null;
    d.category   = value.indexOf('c:') === 0 ? value.slice(2) : null;
  }
  else if (field === 'dose_basis') d.dose_basis = value;
  else d[field] = value === '' ? null : parseFloat(value);
  if (!noRender) renderMedSpeciesDoses();
}

// Ticking "Different dose per species" hides the general dose and shows the
// species rows (starting one if there are none); unticking does the reverse.
// Whichever side is hidden is cleared when the medicine is saved.
function toggleMedSpeciesMode(on) {
  medFormSpeciesMode = on;
  document.getElementById('mf-general-dose').style.display = on ? 'none' : '';
  document.getElementById('mf-species-block').style.display = on ? '' : 'none';
  if (on && !medFormDoses.length) addMedSpeciesDose();
}

function addMedSpeciesDose() {
  medFormDoses.push({ species_id: null, category: null, dose_basis: 'per_kg', dose_amount: null, dose_amount_max: null, dose_weight_kg: null, dose_water_l: null });
  renderMedSpeciesDoses();
}

function removeMedSpeciesDose(i) {
  medFormDoses.splice(i, 1);
  renderMedSpeciesDoses();
}

// Keeps unit labels and dose fields in step with the unit / dose-basis selects
function updateMedFormUnits() {
  var unit = document.getElementById('mf-unit').value;
  document.querySelectorAll('.mf-unit-lbl').forEach(function(el) { el.textContent = unit; });
  var basisEl = document.getElementById('mf-basis');
  if (!basisEl) return;
  var basis = basisEl.value;
  document.getElementById('mf-amount-wrap').style.visibility = basis ? 'visible' : 'hidden';
  // Per-litre swaps the "per kg" box for "per litres of water"
  document.getElementById('mf-weight-wrap').style.display = basis === 'per_litre' ? 'none' : '';
  document.getElementById('mf-weight-wrap').style.visibility = basis === 'per_kg' ? 'visible' : 'hidden';
  document.getElementById('mf-water-wrap').style.display = basis === 'per_litre' ? '' : 'none';
}

async function submitMedicine() {
  var statusEl = document.getElementById('mf-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    // Fields that don't exist for this kind read as null
    var el  = function(id) { return document.getElementById(id); };
    var num = function(id) { var x = el(id); return !x || x.value === '' ? null : parseFloat(x.value); };
    var txt = function(id) { var x = el(id); return x ? (x.value.trim() || null) : null; };
    var isMed = medFormKind === 'medicine';
    // Species-dosed medicines have no general dose
    var speciesMode = isMed && medFormSpeciesMode;
    var basis = isMed && !speciesMode ? (el('mf-basis').value || null) : null;
    var d = {
      kind:              medFormKind,
      name:              txt('mf-name'),
      active_ingredient: isMed ? txt('mf-ingredient') : null,
      med_class:         isMed ? (el('mf-class').value || null) : null,
      purpose:           txt('mf-purpose'),
      form:              isMed ? el('mf-form').value : 'other',
      stock_unit:        el('mf-unit').value,
      pack_label:        txt('mf-pack-label') || 'pack',
      pack_size:         num('mf-pack-size'),
      dose_basis:        basis,
      dose_amount:       basis ? num('mf-amount') : null,
      dose_amount_max:   basis ? num('mf-amount-max') : null,
      dose_weight_kg:    basis === 'per_kg' ? num('mf-weight') : null,
      dose_water_l:      basis === 'per_litre' ? num('mf-water') : null,
      course_doses:      isMed && num('mf-course-doses') != null ? Math.round(num('mf-course-doses')) : null,
      routes:            isMed ? Array.prototype.map.call(document.querySelectorAll('.mf-route:checked'), function(cb) { return cb.value; }) : [],
      min_stock:         num('mf-min'),
      withdrawal_days:   isMed && num('mf-withdrawal') != null ? Math.round(num('mf-withdrawal')) : null,
      pregnancy_rule:    isMed ? el('mf-preg-rule').value : 'safe',
      milk_withdrawal_days: isMed && num('mf-milk-withdrawal') != null ? Math.round(num('mf-milk-withdrawal')) : null,
      not_for_milking:   isMed ? el('mf-no-milking').checked : false,
      refrigerate:       isMed ? el('mf-fridge').checked : false,
      notes:             txt('mf-notes')
    };
    // Course interval only matters when there is a course
    d.course_interval_hours = d.course_doses ? parseInt(el('mf-course-interval').value) : null;
    var pct = num('mf-course-pct');
    d.course_later_pct = d.course_doses && pct != null && pct < 100 ? Math.round(pct) : null;
    if (d.course_doses && pct != null && !(pct >= 1 && pct <= 100)) throw new Error('Later doses must be between 1% and 100% of the first.');
    if (d.course_doses != null && d.course_doses < 2) throw new Error('A course needs at least 2 doses (leave it blank for a single dose).');
    // Days only for the early/late rules; unsafe_in_pregnancy kept in step for older app versions
    d.pregnancy_rule_days = d.pregnancy_rule === 'avoid_first' || d.pregnancy_rule === 'avoid_last' ? num('mf-preg-days') : null;
    if ((d.pregnancy_rule === 'avoid_first' || d.pregnancy_rule === 'avoid_last') && !(d.pregnancy_rule_days > 0)) throw new Error('Enter how many days of pregnancy to avoid.');
    if (d.pregnancy_rule_days) d.pregnancy_rule_days = Math.round(d.pregnancy_rule_days);
    d.unsafe_in_pregnancy = d.pregnancy_rule !== 'safe';
    if (!d.name) throw new Error('Name is required.');
    if (!(d.pack_size > 0)) throw new Error('Amount per pack must be greater than 0.');
    if (basis && !(d.dose_amount > 0)) throw new Error('Enter the label dose amount, or set Label dose to "Not set".');
    if (d.dose_amount_max != null && !(d.dose_amount_max > d.dose_amount)) throw new Error('The top of the dose range must be more than the bottom (leave "to" blank for a single amount).');
    if (basis === 'per_kg' && !(d.dose_weight_kg > 0)) throw new Error('Enter how many kg of body weight the dose covers.');
    if (basis === 'per_litre' && !(d.dose_water_l > 0)) throw new Error('Enter how many litres of water the dose is for.');

    // Species rows: check each is complete before saving anything
    if (speciesMode && !medFormDoses.length) throw new Error('Add a dose for at least one species or category, or untick "Different dose per species / category".');
    var speciesRows = speciesMode ? medFormDoses.map(function(sd) {
      if (sd.species_id == null && !sd.category) throw new Error('Pick a species or category for each dose row, or remove the empty row.');
      var name = medDoseRowLabel(sd);
      if (!(sd.dose_amount > 0)) throw new Error('Enter the dose for ' + name + '.');
      if (sd.dose_basis === 'per_kg' && !(sd.dose_weight_kg > 0)) throw new Error('Enter how many kg of body weight the ' + name + ' dose covers.');
      if (sd.dose_basis === 'per_litre' && !(sd.dose_water_l > 0)) throw new Error('Enter how many litres of water the ' + name + ' dose is for.');
      if (sd.dose_amount_max != null && !(sd.dose_amount_max > sd.dose_amount)) throw new Error('The top of the ' + name + ' dose range must be more than the bottom.');
      return {
        species_id: sd.species_id != null ? sd.species_id : null, category: sd.species_id != null ? null : sd.category,
        dose_basis: sd.dose_basis, dose_amount: sd.dose_amount, dose_amount_max: sd.dose_amount_max,
        dose_weight_kg: sd.dose_basis === 'per_kg' ? sd.dose_weight_kg : null,
        dose_water_l: sd.dose_basis === 'per_litre' ? sd.dose_water_l : null
      };
    }) : [];

    var medId = medEditId;
    if (medId !== null) await sbPatch('medicines', medId, d);
    else {
      var saved = await sbInsert('medicines', [d]);
      if (!saved || !saved.length) throw new Error('The medicine was not saved — the database returned nothing.');
      medId = saved[0].id;
    }
    // Replace this medicine's species rows with the form's list (simplest way to
    // handle added, changed and removed rows together)
    if (isMed) {
      var hadRows = medSpeciesDoses.some(function(sd) { return sd.medicine_id === medId; });
      if (hadRows) await sbDeleteWhere('medicine_species_doses', 'medicine_id=eq.' + medId);
      if (speciesRows.length) {
        await sbInsert('medicine_species_doses', speciesRows.map(function(r) { r.medicine_id = medId; return r; }));
      }
    }
    closeMedForm();
    await medLoadData();
    medRerender();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function setMedActive(id, active) {
  try {
    await sbPatch('medicines', id, { active: active });
    await medLoadData();
    medRerender();
  } catch(err) { alert('Error: ' + err.message); }
}

async function deleteMedicine(id) {
  var m = medById(id);
  if (!confirm('Delete ' + (m ? m.name : 'this item') + '? This cannot be undone.')) return;
  try {
    await sbDelete('medicines', id);
    await medLoadData();
    medRerender();
  } catch(err) {
    // Most likely a schedule or health event still points at it
    alert('Could not delete — it is probably linked to a schedule or health event. Retire it instead.\n\n' + err.message);
  }
}

// ============================================================
// PURCHASE, USE AND COUNT FORMS
// ============================================================
function openMedAction(id, type) {
  medActionId = id;
  medActionType = type;
  renderMedActionForm();
  document.getElementById('med-action-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMedAction() {
  medActionId = null;
  medActionType = null;
  var wrap = document.getElementById('med-action-wrap');
  if (wrap) wrap.innerHTML = '';
}

function renderMedActionForm() {
  var m = medById(medActionId);
  if (!m) { closeMedAction(); return; }
  var stock = medStock(m.id);
  var body;
  if (medActionType === 'purchase') {
    body =
      '<div style="font-weight:500;margin-bottom:12px">Log purchase &mdash; ' + medEsc(m.name) +
        ' <span style="font-weight:400;color:var(--muted)">(' + medFmtUnits(m, Number(m.pack_size)) + ' per ' + medEsc(m.pack_label) + ')</span></div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="ma-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Number of ' + medEsc(m.pack_label) + 's *</label><input type="number" id="ma-packs" min="0" step="any" placeholder="e.g. 2" oninput="updateMedActionHint()"></div>' +
        '<div class="hf-field"><label>Total cost (PKR)</label><input type="number" id="ma-cost" min="0" step="1" placeholder="What you paid" oninput="updateMedActionHint()"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        // Pre-filled with the usual pack; change it when this purchase came in a different size
        '<div class="hf-field"><label>Size of each ' + medEsc(m.pack_label) + ' this time (' + m.stock_unit + ')</label>' +
          '<input type="number" id="ma-pack-size" min="0" step="any" value="' + Number(m.pack_size) + '" oninput="updateMedActionHint()"></div>' +
        '<div class="hf-field"><label>Expiry date</label><input type="date" id="ma-expiry"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="ma-notes" placeholder="Optional — supplier, batch"></div>' +
      '</div>';
  } else if (medActionType === 'use') {
    // Supplies used up (not dosed to a specific animal)
    body =
      '<div style="font-weight:500;margin-bottom:12px">Log use &mdash; ' + medEsc(m.name) +
        ' <span style="font-weight:400;color:var(--muted)">(in stock ' + medFmtStock(m, stock) + ')</span></div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="ma-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Amount used (' + m.stock_unit + ') *</label><input type="number" id="ma-used" min="0" step="any" placeholder="e.g. 10" oninput="updateMedActionHint()"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="ma-notes" placeholder="Optional — what for"></div>' +
      '</div>';
  } else {
    body =
      '<div style="font-weight:500;margin-bottom:12px">Stock count &mdash; ' + medEsc(m.name) +
        ' <span style="font-weight:400;color:var(--muted)">(app says ' + medFmtStock(m, stock) + ')</span></div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="ma-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Full ' + medEsc(m.pack_label) + 's</label><input type="number" id="ma-count-packs" min="0" step="1" value="0" oninput="updateMedActionHint()"></div>' +
        '<div class="hf-field"><label>Plus loose / opened (' + m.stock_unit + ')</label><input type="number" id="ma-count-loose" min="0" step="any" value="0" oninput="updateMedActionHint()"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        '<div class="hf-field"><label>Reason for difference</label><select id="ma-reason">' +
          '<option value="">Select if counts differ</option>' +
          Object.keys(MED_REASON_LABELS).map(function(k) { return '<option value="' + k + '">' + MED_REASON_LABELS[k] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="ma-notes" placeholder="Optional"></div>' +
      '</div>';
  }
  var saveLabel = { purchase: 'Save purchase', use: 'Save use', count: 'Save count' }[medActionType];
  document.getElementById('med-action-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' + body +
      '<div id="ma-hint" class="fc-derived" style="display:none;margin:4px 0 12px"></div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitMedAction()">' + saveLabel + '</button>' +
        '<button class="btn" onclick="closeMedAction()">Cancel</button>' +
        '<span id="ma-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
}

// Live summary under the form: units added / cost per unit, remaining after use, or count difference
function updateMedActionHint() {
  var m = medById(medActionId);
  var hint = document.getElementById('ma-hint');
  if (!m || !hint) return;
  var text = '';
  if (medActionType === 'purchase') {
    var packs = parseFloat(document.getElementById('ma-packs').value);
    var cost  = parseFloat(document.getElementById('ma-cost').value);
    var size  = parseFloat(document.getElementById('ma-pack-size').value);
    if (packs > 0 && size > 0) {
      var units = packs * size;
      text = 'Adds ' + medFmtUnits(m, units);
      if (cost >= 0) text += ' &middot; PKR ' + r2(cost / units).toLocaleString() + ' per ' + m.stock_unit;
    }
  } else if (medActionType === 'use') {
    var used = parseFloat(document.getElementById('ma-used').value);
    if (used > 0) {
      var left = medStock(m.id) - used;
      text = 'Leaves ' + medFmtStock(m, left) + (left < 0 ? ' <span style="color:var(--red)">&middot; more than the app shows in stock</span>' : '');
    }
  } else {
    var counted = medCountedUnits(m);
    var diff = counted - medStock(m.id);
    text = 'Counted ' + medFmtUnits(m, counted) + ' &middot; ' +
      (Math.abs(diff) < 1e-9 ? 'matches the app' : (diff > 0 ? '+' : '') + medFmtUnits(m, diff) + ' vs the app');
  }
  hint.innerHTML = text;
  hint.style.display = text ? 'block' : 'none';
}

function medCountedUnits(m) {
  var packs = parseFloat(document.getElementById('ma-count-packs').value) || 0;
  var loose = parseFloat(document.getElementById('ma-count-loose').value) || 0;
  return packs * m.pack_size + loose;
}

async function submitMedAction() {
  var statusEl = document.getElementById('ma-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var m = medById(medActionId);
    var date = document.getElementById('ma-date').value;
    var notes = document.getElementById('ma-notes').value.trim() || null;
    if (!date) throw new Error('Date is required.');
    var row;
    if (medActionType === 'purchase') {
      var packs = parseFloat(document.getElementById('ma-packs').value);
      if (!(packs > 0)) throw new Error('Enter how many ' + m.pack_label + 's were bought.');
      var size = parseFloat(document.getElementById('ma-pack-size').value);
      if (!(size > 0)) throw new Error('Enter the size of each ' + m.pack_label + '.');
      var costRaw = document.getElementById('ma-cost').value;
      row = {
        medicine_id: m.id, date: date, movement_type: 'purchase',
        quantity: packs * size, packs: packs,
        // Only recorded when it differs from the usual pack, to keep history readable
        pack_size: size !== Number(m.pack_size) ? size : null,
        cost_pkr: costRaw === '' ? null : parseFloat(costRaw),
        expiry_date: document.getElementById('ma-expiry').value || null,
        notes: notes
      };
    } else if (medActionType === 'use') {
      var used = parseFloat(document.getElementById('ma-used').value);
      if (!(used > 0)) throw new Error('Enter how much was used.');
      // Valued at the latest purchase price, like doses
      var cpu = medCostPerUnit(m.id);
      row = {
        medicine_id: m.id, date: date, movement_type: 'use',
        quantity: -used, cost_pkr: cpu != null ? r2(used * cpu) : null, notes: notes
      };
    } else {
      // A count is stored as the difference between what's physically there and the ledger
      var diff = Math.round((medCountedUnits(m) - medStock(m.id)) * 1000) / 1000;
      if (diff === 0) {
        statusEl.textContent = 'Count matches the app — nothing to record.'; statusEl.style.color = 'var(--green)';
        return;
      }
      var reason = document.getElementById('ma-reason').value;
      if (!reason) throw new Error('Pick a reason for the difference.');
      row = {
        medicine_id: m.id, date: date, movement_type: 'adjustment',
        quantity: diff, reason: reason, notes: notes
      };
    }
    await sbInsert('medicine_movements', [row]);
    closeMedAction();
    await medLoadData();
    medRerender();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
