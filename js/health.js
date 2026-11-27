// ============================================================
// health.js v17
// Pages: Health, Breeding, Cost & Sales
// Depends on: shared.js
// ============================================================

// ---- Module state ----
var healthScheds     = [];   // active schedules due within 14 days (Due panel + form link)
var healthAllScheds  = [];   // every schedule, active and retired (Schedules table)
var healthEvts       = [];
var healthFollowups  = [];    // logged events with an open follow-up due within 14 days (or overdue)
var hfFollowupOf     = null;  // event whose follow-up the log form is currently recording
var hfFamacha        = {};    // animal_id -> latest FAMACHA { score, date }
var hfCostTouched    = false; // true once the user types a cost, so auto-costing stops overwriting it
var hfCourseSched    = null;  // running course schedule the form is logging the next dose of (null = not a course dose)
var hfBulkTotalTouched = false; // true once the user types a bulk-round total, so the per-litre suggestion stops overwriting it
var schedEditId      = null;  // schedule being edited (null = adding)
var breedingData     = [];
var birthData        = [];
var birthStep        = 1;
var pendingBirthEvt  = null;
var csGroupId        = null;   // selected group on Cost & Sales page

// ============================================================
// HEALTH PAGE
// ============================================================
async function loadHealthPage() {
  var dueEl = document.getElementById('health-due-panel');
  var logEl = document.getElementById('health-log-table');
  if (dueEl) dueEl.innerHTML = '<div class="loading">Loading...</div>';
  if (logEl) logEl.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    // Medicine helpers (stock, dose suggestions, costing) live in health_meds.js
    await loadModule('health_meds');
    var due14 = new Date(); due14.setDate(due14.getDate() + 14);
    var due14s = due14.toISOString().slice(0, 10);
    var r = await Promise.all([
      sbGet('scheduled_health_events', 'select=*&order=next_due_date'),
      sbGet('animal_health_events',
        'select=*,animals(farm_id,name),workers(name)&order=date.desc&limit=300'),
      medLoadData(),
      sbGet('animal_health_events',
        'follow_up_done=eq.false&follow_up_date=lte.' + due14s + '&select=*&order=follow_up_date'),
      sbGet('famacha_scores', 'select=animal_id,score,date&order=date.desc,id.desc&limit=3000')
    ]);
    healthFollowups = r[3];
    hfFamacha = {};
    r[4].forEach(function(f) { if (!hfFamacha[f.animal_id]) hfFamacha[f.animal_id] = f; });
    // All schedules feed the Schedules table; only active ones due within 14 days feed the Due panel
    healthAllScheds = r[0];
    healthScheds = healthAllScheds.filter(function(s) {
      return s.active && s.next_due_date && s.next_due_date <= due14s;
    });
    healthEvts = r[1];
    populateHealthForm();
    renderHealthDue();
    renderHealthLog();
    renderSchedTable();
    document.getElementById('health-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderAbbrevKey('abbrev-health', ['BCS', 'PKR']);
  } catch(err) {
    if (dueEl) dueEl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function populateHealthForm() {
  document.getElementById('hf-date').value = todayISO();

  // Populate animal selector (active only)
  var activeAnimals = anSharedAnimals.filter(function(a) { return a.status === 'active'; });
  document.getElementById('hf-animal').innerHTML =
    '<option value="">Select animal</option>' +
    activeAnimals.map(function(a) {
      return '<option value="' + a.id + '">' + a.farm_id + (a.name ? ' (' + a.name + ')' : '') + '</option>';
    }).join('');

  // Populate group selector
  document.getElementById('hf-group').innerHTML =
    '<option value="">Select group</option>' +
    anSharedGroups.filter(function(g){return g.status==='active';}).map(function(g) {
      return '<option value="' + g.id + '">' + g.name + '</option>';
    }).join('');

  // Scheduled protocols selector
  document.getElementById('hf-sched').innerHTML =
    '<option value="">None</option>' +
    healthScheds.map(function(s) {
      return '<option value="' + s.id + '">' + s.description + ' (due ' + fmtDate(s.next_due_date) + ')</option>';
    }).join('');

  // Medicine selector: active cabinet medicines, plus a free-text fallback
  document.getElementById('hf-med').innerHTML = hfMedOptionsHtml(true);
  hfFillRouteOptions(null);
  document.getElementById('hf-cost').value = '';
  hfCostTouched = false;
  hfCourseSched = null;
  onHfMedChange();
}

// <option> list of active medicines, labelled with purpose and current stock
// so the right one is easy to pick. withOther adds the "not in cabinet" option.
function hfMedOptionsHtml(withOther) {
  return '<option value="">None</option>' +
    // Only medicines are dosed; health supplies and consumables are logged via Use
    medList.filter(function(m) { return m.active && (m.kind || 'medicine') === 'medicine'; }).map(function(m) {
      return '<option value="' + m.id + '">' + medEsc(m.name) +
        (m.purpose ? ' — ' + medEsc(m.purpose) : '') +
        ' (' + medFmtStock(m, medStock(m.id)) + ')</option>';
    }).join('') +
    (withOther ? '<option value="other">Other — not in cabinet</option>' : '');
}

// Shows the free-text product/dose fields for "not in cabinet", otherwise the dose grid
// Route options for the chosen medicine: its allowed routes first, then the rest.
// One allowed route is pre-filled; with several the box starts empty and must be
// picked (a wrong guess between, say, deep IM and slow IV would mislead the record).
function hfFillRouteOptions(med) {
  var sel = document.getElementById('hf-route');
  var allowed = medRoutes(med);
  var optHtml = function(k) { return '<option value="' + k + '">' + MED_ROUTES[k] + '</option>'; };
  var others = Object.keys(MED_ROUTES).filter(function(k) { return allowed.indexOf(k) < 0; });
  sel.innerHTML = (allowed.length > 1 ? '<option value="">Choose route…</option>' : '<option value="">Not recorded</option>') +
    (allowed.length
      ? '<optgroup label="For this medicine">' + allowed.map(optHtml).join('') + '</optgroup>' +
        '<optgroup label="Other">' + others.map(optHtml).join('') + '</optgroup>'
      : others.map(optHtml).join(''));
  sel.value = allowed.length === 1 ? allowed[0] : '';
}

function onHfMedChange() {
  var v = document.getElementById('hf-med').value;
  document.getElementById('hf-free-wrap').style.display = v === 'other' ? 'grid' : 'none';
  // Route: shown whenever a product is chosen, pre-filled from the medicine's usual route
  document.getElementById('hf-route-wrap').style.display = v ? 'flex' : 'none';
  var med = v && v !== 'other' ? medById(parseInt(v)) : null;
  hfFillRouteOptions(med);
  hfBulkTotalTouched = false;
  renderHfDoseGrid();
  renderHfCourse();
}

// Course box under the dose grid.
//  - Logging a course reminder: shows which dose this is.
//  - Otherwise, with a cabinet medicine chosen: "Part of a course" switch, pre-set
//    from the medicine's course and changeable (the vet may say 5 days, not 3).
//    Saving the first dose then creates a reminder schedule for the rest.
function renderHfCourse() {
  var wrap = document.getElementById('hf-course-wrap');
  if (!wrap) return;
  if (hfCourseSched) {
    var s = hfCourseSched;
    wrap.innerHTML = '<div class="fc-derived">Course: dose ' + ((s.course_given || 0) + 1) + ' of ' + s.course_total +
      ' &middot; ' + (MED_COURSE_INTERVALS[s.course_interval_hours] || '') +
      ' &middot; started ' + fmtDate(s.course_start_date) +
      // Tapering course: the second dose is the first × the percentage; later ones repeat the previous
      (s.course_later_pct && (s.course_given || 0) === 1
        ? ' &middot; pre-filled at ' + s.course_later_pct + '% of the first dose'
        : ' &middot; pre-filled with the previous dose') + '</div>';
    return;
  }
  var v = document.getElementById('hf-med').value;
  var med = v && v !== 'other' ? medById(parseInt(v)) : null;
  if (!med) { wrap.innerHTML = ''; return; }
  var on = !!med.course_doses;
  var interval = med.course_interval_hours || 24;
  wrap.innerHTML =
    '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:6px">' +
      '<input type="checkbox" id="hf-course-on"' + (on ? ' checked' : '') + ' onchange="document.getElementById(\'hf-course-fields\').style.display=this.checked?\'flex\':\'none\'"> ' +
      'Part of a course (several doses over time)' +
      (med.course_doses ? ' <span style="color:var(--muted)">&middot; label: ' + medFmtCourse(med.course_doses, med.course_interval_hours, med.course_later_pct) + '</span>' : '') +
    '</label>' +
    '<div id="hf-course-fields" style="display:' + (on ? 'flex' : 'none') + ';gap:8px;align-items:center;flex-wrap:wrap;font-size:13px">' +
      '<input type="number" id="hf-course-doses" min="2" step="1" style="width:70px" value="' + (med.course_doses || 3) + '"> doses,' +
      '<select id="hf-course-interval">' +
        Object.keys(MED_COURSE_INTERVALS).map(function(h) {
          return '<option value="' + h + '"' + (Number(h) === interval ? ' selected' : '') + '>' + MED_COURSE_INTERVALS[h] + '</option>';
        }).join('') +
      '</select>' +
      '&middot; later doses <input type="number" id="hf-course-pct" min="1" max="100" step="1" style="width:60px" value="' + (med.course_later_pct || 100) + '">% of the first' +
      '<span style="color:var(--muted)">&middot; this is dose 1; the rest appear in Due now</span>' +
    '</div>';
}

// Pre-fills the dose entry with what a previous event gave (used for the next
// dose of a course): route, per-animal doses, or a bulk round's total, water and animals.
// factor scales every amount (e.g. 0.5 for the first reduced dose of a tapering course).
function hfPrefillFromEvent(eventId, factor) {
  var e = healthEvts.find(function(x) { return x.id === eventId; });
  if (!e) return;
  var f = factor || 1;
  if (e.route) { document.getElementById('hf-route').value = e.route; renderHfDoseGrid(); }
  var doses = medMovements.filter(function(mv) { return mv.health_event_id === eventId && mv.movement_type === 'dose'; });
  var given = {};
  doses.forEach(function(mv) { given[mv.animal_id] = Math.round(-Number(mv.quantity) * f * 100) / 100; });
  var bulkTotal = document.getElementById('hf-bulk-total');
  if (bulkTotal) {
    bulkTotal.value = Math.round(doses.reduce(function(s, mv) { return s - Number(mv.quantity); }, 0) * f * 100) / 100;
    hfBulkTotalTouched = true;
    var w = document.getElementById('hf-bulk-water');
    if (w && e.water_litres != null) w.value = e.water_litres;
    document.querySelectorAll('.hf-bulk-animal').forEach(function(cb) { cb.checked = cb.dataset.animal in given; });
  } else {
    document.querySelectorAll('.hf-dose-input').forEach(function(inp) {
      inp.value = inp.dataset.animal in given ? given[inp.dataset.animal] : 0;
      hfCheckRange(inp);
    });
  }
  updateHfDoseTotal();
}

// The animals a treatment covers, based on the form's target selection
function hfTargetAnimals() {
  var t = document.getElementById('hf-target-type').value;
  if (t === 'animal') {
    var id = parseInt(document.getElementById('hf-animal').value);
    return id ? anSharedAnimals.filter(function(a) { return a.id === id; }) : [];
  }
  var gid = parseInt(document.getElementById('hf-group').value);
  return gid ? getGroupAnimals(gid) : [];
}

// Per-animal dose grid: one row per animal, pre-filled with the label-rate
// suggestion from its latest weight. Each box is editable — the number entered
// is what's actually deducted from stock.
// FAMACHA scores older than this aren't used to skip an animal (eyelid colour changes fast)
var HF_FAMACHA_MAX_AGE_DAYS = 14;

// Latest FAMACHA score for an animal: { score, date, ageDays } or null
function hfLatestFamacha(animalId) {
  var f = hfFamacha[animalId];
  if (!f) return null;
  var age = Math.round((new Date(todayISO() + 'T00:00:00') - new Date(f.date + 'T00:00:00')) / 864e5);
  return { score: f.score, date: f.date, ageDays: age };
}

// Most recent deworming that covered this group / animal (for rotation checks).
// Group events count for the group; an individual animal also inherits its group's.
function healthLastDeworming(groupId, animalId) {
  return healthEvts.find(function(e) {
    if (e.event_type !== 'deworming' || !e.medicine_id) return false;
    if (groupId && e.group_id === groupId && !e.animal_id) return true;
    if (animalId && e.animal_id === animalId) return true;
    return false;
  }) || null;
}

// "Albendazole (Valbazen) on 14 Sep" style label for a past deworming
function healthDewormLabel(e) {
  var m = medById(e.medicine_id);
  if (!m) return e.product_used || '';
  return (m.active_ingredient ? m.active_ingredient + ' (' + m.name + ')' : m.name) + ' on ' + fmtDate(e.date);
}

// Rotation note for the log form: last dewormer used on this target, and a
// warning when the chosen medicine has the same active ingredient (or is the
// same product, if no ingredient is recorded).
function hfRotationHtml(med) {
  var t = document.getElementById('hf-target-type').value;
  var gid = t === 'group' ? parseInt(document.getElementById('hf-group').value) : getAnimalGroupId(parseInt(document.getElementById('hf-animal').value));
  var aid = t === 'animal' ? parseInt(document.getElementById('hf-animal').value) : null;
  var last = healthLastDeworming(gid, aid);
  if (!last) return '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">No earlier deworming recorded for this ' + t + '.</div>';
  var lastMed = medById(last.medicine_id);
  var same = lastMed && (
    (lastMed.active_ingredient && med.active_ingredient &&
      lastMed.active_ingredient.trim().toLowerCase() === med.active_ingredient.trim().toLowerCase()) ||
    lastMed.id === med.id);
  return '<div style="font-size:12px;margin-bottom:6px;' + (same ? 'color:var(--amber);font-weight:500' : 'color:var(--muted)') + '">' +
    'Last deworming: ' + medEsc(healthDewormLabel(last)) +
    (same ? ' — same active ingredient as this one. Rotating dewormer class slows resistance.' : '') + '</div>';
}

function renderHfDoseGrid() {
  var wrap = document.getElementById('hf-dose-grid');
  if (!wrap) return;
  var medId = parseInt(document.getElementById('hf-med').value);
  var med = medId ? medById(medId) : null;
  if (!med) { wrap.innerHTML = ''; return; }
  var animals = hfTargetAnimals();
  if (!animals.length) {
    wrap.innerHTML = '<div class="fc-hint" style="margin:0 0 12px">Select an animal or group to enter doses.</div>';
    return;
  }
  // In water / in feed / spray: one total for the group instead of a per-animal grid
  if (medIsBulkRoute(document.getElementById('hf-route').value)) { renderHfBulk(med, animals); return; }
  // Deworming rounds: show FAMACHA and pre-fill 0 for animals recently scored 1–2 (targeted treatment)
  var deworming = document.getElementById('hf-event-type').value === 'deworming';
  // Medicines flagged unsafe in pregnancy: pregnant animals are pre-filled 0
  // Animals this medicine shouldn't go to right now (pregnancy stage, being milked)
  var skipped = animals.map(function(a) { return { a: a, why: medSkipReason(med, a.id) }; }).filter(function(x) { return x.why; });
  var html = '<div style="margin:0 0 12px">' +
    (deworming ? hfRotationHtml(med) : '') +
    (skipped.length ? '<div style="font-size:12px;color:var(--red);font-weight:500;margin-bottom:6px">Pre-filled 0 for ' + medEsc(med.name) + ': ' +
      skipped.map(function(x) { return medEsc(x.a.farm_id) + ' (' + medEsc(x.why) + ')'; }).join('; ') + '.</div>' : '') +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Dose per animal (' + med.stock_unit + ') &middot; label ' +
      medFmtDoseRate(med) + ' &middot; pre-filled from latest weight, edit any you dosed differently, 0 = not dosed' +
      (deworming ? ' &middot; FAMACHA 1–2 within ' + HF_FAMACHA_MAX_AGE_DAYS + ' days pre-filled 0' : '') + '</div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Animal</th><th class="right">Weight</th>' + (deworming ? '<th class="right">FAMACHA</th>' : '') +
    '<th class="right">Suggested</th><th class="right">Dose given</th>' +
    '</tr></thead><tbody>';
  animals.forEach(function(a) {
    var kg = medAnimalWeight(a.id);
    var sug = medSuggestDose(med, a.id);
    var famCell = '', prefill = sug;
    if (deworming) {
      var f = hfLatestFamacha(a.id);
      var fresh = f && f.ageDays <= HF_FAMACHA_MAX_AGE_DAYS;
      if (fresh && f.score <= 2) prefill = 0;
      famCell = '<td class="mono right"' + (f && !fresh ? ' style="color:var(--faint)" title="Older than ' + HF_FAMACHA_MAX_AGE_DAYS + ' days — not used"' : '') + '>' +
        (f ? f.score + ' <span style="font-size:11px;color:var(--muted)">' + f.ageDays + 'd ago</span>' : '—') + '</td>';
    }
    if (medSkipReason(med, a.id)) prefill = 0;
    html += '<tr>' +
      '<td style="font-weight:500">' + a.farm_id + (a.name ? ' <span style="color:var(--muted);font-weight:400">' + medEsc(a.name) + '</span>' : '') +
        medPregnancyBadge(a.id) + medMilkingBadge(a.id) + '</td>' +
      '<td class="mono right">' + (kg != null ? r1(kg) + ' kg' : '—') + '</td>' +
      famCell +
      '<td class="mono right">' + (sug != null ? medFmtUnits(med, sug)
        // Species-dosed medicine with no row for this animal's species
        : (medIsSpeciesDosed(med) && medRateFor(med, a.species_id) === MED_NO_RATE
            ? '<span style="font-size:11px;color:var(--amber)">no dose set for ' + medEsc(medSpeciesName(a.species_id)) + '</span>' : '—')) + '</td>' +
      '<td class="right"><input type="number" class="hf-dose-input" data-animal="' + a.id + '" min="0" step="any" ' +
        'style="width:90px;text-align:right" value="' + (prefill != null ? prefill : '') + '" oninput="hfCheckRange(this);updateHfDoseTotal()">' +
        '<div class="hf-range-note" style="font-size:11px;color:var(--amber);display:none"></div></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>' +
    '<div id="hf-dose-total" class="fc-derived" style="margin-top:8px"></div></div>';
  wrap.innerHTML = html;
  document.querySelectorAll('.hf-dose-input').forEach(hfCheckRange);
  updateHfDoseTotal();
}

// Ranged label doses: a dose typed outside the animal's label range turns amber
// with a note. A warning only — 0 (not dosed) and blank are never flagged, and
// the vet may well have said otherwise.
function hfCheckRange(inp) {
  var note = inp.parentNode.querySelector('.hf-range-note');
  var med = medById(parseInt(document.getElementById('hf-med').value));
  // Reduced doses of a tapering course are meant to be below the label range
  var range = hfCourseSched && hfCourseSched.course_later_pct ? null : medDoseRange(med, parseInt(inp.dataset.animal));
  var q = parseFloat(inp.value);
  var msg = '';
  // Small tolerance: suggestions are rounded to the nearest half unit
  if (range && q > 0) {
    if (q < range.min - 0.25) msg = 'below label range';
    else if (q > range.max + 0.25) msg = 'above label range';
  }
  inp.style.borderColor = msg ? 'var(--amber)' : '';
  if (note) { note.textContent = msg; note.style.display = msg ? 'block' : 'none'; }
}

// Bulk round panel (in water / in feed / spray): water volume, one total amount,
// and a checklist of the animals present. The total is split evenly between the
// ticked animals when saved. Nobody is pre-unticked: a shared trough or spray
// can't skip one animal, so pregnant animals on an unsafe medicine get a warning
// instead (untick them only if they were penned separately).
function renderHfBulk(med, animals) {
  var route = document.getElementById('hf-route').value;
  var water = medUsesWater(route);
  var deworming = document.getElementById('hf-event-type').value === 'deworming';
  var flagged = animals.map(function(a) { return { a: a, why: medSkipReason(med, a.id) }; }).filter(function(x) { return x.why; });
  var html = '<div style="margin:0 0 12px">' +
    (deworming ? hfRotationHtml(med) : '') +
    (flagged.length ? '<div style="font-size:12px;color:var(--red);font-weight:500;margin-bottom:6px">' +
      medEsc(med.name) + ' shouldn\'t go to: ' +
      flagged.map(function(x) { return medEsc(x.a.farm_id) + ' (' + medEsc(x.why) + ')'; }).join('; ') +
      '. Untick them only if they were kept away from it.</div>' : '') +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Whole-group round (' + medEsc(medRouteLabel(route).toLowerCase()) +
      ') &middot; label ' + medFmtDoseRate(med) + ' &middot; the total is split evenly across the ticked animals as an estimate</div>' +
    '<div class="hf-grid">' +
      (water ? '<div class="hf-field"><label>Water (L)</label><input type="number" id="hf-bulk-water" min="0" step="any" placeholder="e.g. 20" oninput="onHfBulkWaterChange()"></div>' : '') +
      '<div class="hf-field"><label>Total product used (' + med.stock_unit + ') *</label><input type="number" id="hf-bulk-total" min="0" step="any" placeholder="e.g. 30" ' +
        'oninput="hfBulkTotalTouched = true; updateHfDoseTotal()"></div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin:2px 0 6px">Animals that got it</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:6px">' +
    animals.map(function(a) {
      return '<label style="display:flex;gap:6px;align-items:center;font-size:13px">' +
        '<input type="checkbox" class="hf-bulk-animal" data-animal="' + a.id + '" checked onchange="updateHfDoseTotal()"> ' +
        medEsc(a.farm_id) + (a.name ? ' <span style="color:var(--muted)">' + medEsc(a.name) + '</span>' : '') +
        medPregnancyBadge(a.id) + medMilkingBadge(a.id) + '</label>';
    }).join('') +
    '</div>' +
    '<div id="hf-dose-total" class="fc-derived" style="margin-top:8px"></div></div>';
  document.getElementById('hf-dose-grid').innerHTML = html;
  updateHfDoseTotal();
}

// Water volume typed: suggest the total from a per-litre label dose (until the user types their own)
function onHfBulkWaterChange() {
  var med = medById(parseInt(document.getElementById('hf-med').value));
  var litres = parseFloat(document.getElementById('hf-bulk-water').value);
  var ids = Array.prototype.map.call(document.querySelectorAll('.hf-bulk-animal:checked'), function(cb) { return parseInt(cb.dataset.animal); });
  var sug = medSuggestWaterTotal(med, litres, ids);
  if (sug != null && !hfBulkTotalTouched) document.getElementById('hf-bulk-total').value = sug;
  updateHfDoseTotal();
}

// Reads the dose entry: [{ animal_id, qty, share? }] for every animal dosed.
// Bulk rounds return the total split into even shares over the ticked animals.
function hfReadDoses() {
  var bulkTotal = document.getElementById('hf-bulk-total');
  if (bulkTotal) {
    var total = parseFloat(bulkTotal.value);
    var ids = [];
    document.querySelectorAll('.hf-bulk-animal').forEach(function(cb) { if (cb.checked) ids.push(parseInt(cb.dataset.animal)); });
    return total > 0 ? medSplitShares(total, ids) : [];
  }
  var out = [];
  document.querySelectorAll('.hf-dose-input').forEach(function(inp) {
    var q = parseFloat(inp.value);
    if (q > 0) out.push({ animal_id: parseInt(inp.dataset.animal), qty: q });
  });
  return out;
}

// Totals the grid, compares with stock, and fills the cost field from the
// latest purchase price (unless the user has typed their own cost)
function updateHfDoseTotal() {
  var el = document.getElementById('hf-dose-total');
  var med = medById(parseInt(document.getElementById('hf-med').value));
  if (!el || !med) return;
  var doses = hfReadDoses();
  var total = doses.reduce(function(s, d) { return s + d.qty; }, 0);
  var stock = medStock(med.id);
  var cpu = medCostPerUnit(med.id);
  var cost = cpu != null ? total * cpu : null;
  // Bulk round with no total typed yet: say what's needed rather than "0 ml for 0 animals"
  if (!doses.length && document.getElementById('hf-bulk-total')) {
    var ticked = document.querySelectorAll('.hf-bulk-animal:checked').length;
    el.innerHTML = 'Enter the total used &mdash; it will be split across the ' + ticked + ' ticked animal' + (ticked !== 1 ? 's' : '') +
      ' &middot; in stock ' + medFmtStock(med, stock);
    if (!hfCostTouched) document.getElementById('hf-cost').value = '';
    return;
  }
  var shares = doses.length && doses[0].share;
  el.innerHTML = 'Total ' + medFmtUnits(med, total) + (shares ? ' shared by ' : ' for ') + doses.length + ' animal' + (doses.length !== 1 ? 's' : '') +
    (shares ? ' (≈ ' + medFmtUnits(med, total / doses.length) + ' each)' : '') +
    ' &middot; in stock ' + medFmtStock(med, stock) +
    (total > stock ? ' <span style="color:var(--red)">&middot; more than the app shows in stock</span>' : '') +
    (cost != null ? ' &middot; cost ' + pkr(cost) : ' &middot; no purchase price yet');
  if (!hfCostTouched) document.getElementById('hf-cost').value = cost != null ? Math.round(cost) : '';
}

function toggleHealthForm() {
  hfFollowupOf = null;  // a fresh form isn't a follow-up of anything
  hfCourseSched = null; // ...or the next dose of a course
  renderHfCourse();
  document.getElementById('health-log-form').classList.toggle('open');
}

function onHfTargetChange() {
  var t = document.getElementById('hf-target-type').value;
  document.getElementById('hf-animal-wrap').style.display = t === 'animal' ? 'flex' : 'none';
  document.getElementById('hf-group-wrap').style.display  = t === 'group'  ? 'flex' : 'none';
  var mortFields = document.getElementById('hf-mortality-fields');
  if (mortFields) mortFields.style.display = 'none';
  renderHfDoseGrid();
}

function onHfEventTypeChange() {
  var et = document.getElementById('hf-event-type').value;
  var mortFields = document.getElementById('hf-mortality-fields');
  if (mortFields) mortFields.style.display = (et === 'mortality') ? 'grid' : 'none';
  renderHfDoseGrid();  // deworming adds the FAMACHA column and rotation note
}

// Days-until label and card colour shared by schedule and follow-up cards
function healthDueInfo(dateISO) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((new Date(dateISO + 'T00:00:00') - today) / 864e5);
  return {
    cls: diff < 0 ? 'overdue' : (diff <= 7 ? 'soon' : 'upcoming'),
    label: diff < 0
      ? Math.abs(diff) + ' day' + (Math.abs(diff) !== 1 ? 's' : '') + ' overdue'
      : (diff === 0 ? 'Due today' : diff + ' day' + (diff !== 1 ? 's' : '') + ' away')
  };
}

// Target of a logged event: the animal, else the group
function healthEventTarget(e) {
  return e.animal_id ? getAnimalDisplayName(e.animal_id) : (e.group_id ? getGroupName(e.group_id) : '—');
}

// For a deworming schedule: last dewormer used on its target, flagged amber
// when the schedule's medicine has the same active ingredient. '' otherwise.
function healthSchedRotationNote(s) {
  if (s.event_type !== 'deworming') return '';
  var last = healthLastDeworming(s.group_id, s.animal_id);
  if (!last) return '';
  var lastMed = medById(last.medicine_id), med = s.medicine_id ? medById(s.medicine_id) : null;
  var same = lastMed && med && (lastMed.id === med.id ||
    (lastMed.active_ingredient && med.active_ingredient &&
     lastMed.active_ingredient.trim().toLowerCase() === med.active_ingredient.trim().toLowerCase()));
  return '<div style="font-size:11px;' + (same ? 'color:var(--amber);font-weight:500' : 'color:var(--muted)') + '">Last: ' +
    medEsc(healthDewormLabel(last)) + (same ? ' \u2014 same class, consider rotating' : '') + '</div>';
}

function renderHealthDue() {
  var total = healthScheds.length + healthFollowups.length;
  document.getElementById('health-due-meta').textContent =
    healthScheds.length + ' scheduled · ' +
    healthFollowups.length + ' follow-up' + (healthFollowups.length !== 1 ? 's' : '') + ' · within 14 days';
  if (!total) {
    document.getElementById('health-due-panel').innerHTML =
      '<div class="empty">Nothing scheduled or due for follow-up in the next 14 days.</div>';
    return;
  }
  var html = '<div class="due-grid">';
  healthScheds.forEach(function(s) {
    var info = healthDueInfo(s.next_due_date);
    var target = schedTargetName(s);
    var targetLabel = s.animal_id ? 'Animal' : (s.group_id ? 'Group' : 'Location');
    html += '<div class="due-card ' + info.cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">' + medEsc(s.description) + '</span>' +
      '<span class="due-card-days ' + info.cls + '">' + info.label + '</span></div>' +
      '<div class="due-card-meta">' + (s.event_type || '') + ' &middot; ' + targetLabel + ': ' + medEsc(target) +
      (schedProductLabel(s) ? ' &middot; ' + medEsc(schedProductLabel(s)) : '') + '</div>';
    if (s.course_total) html += '<div class="due-card-meta" style="color:var(--blue);font-weight:500">Course: dose ' + ((s.course_given || 0) + 1) +
      ' of ' + s.course_total + ' &middot; ' + (MED_COURSE_INTERVALS[s.course_interval_hours] || '') + '</div>';
    if (s.dose) html += '<div class="due-card-meta">' + (s.course_total ? 'Previous dose: ' : 'Dose: ') + medEsc(s.dose) + '</div>';
    html += healthSchedRotationNote(s);
    html += '<div style="margin-top:8px"><button class="btn btn-sm" onclick="preFillHealthForm(' + s.id + ')">' + (s.course_total ? 'Log this dose' : 'Log this event') + '</button></div>';
    html += '</div>';
  });
  // Follow-ups from logged events: stay here until marked Done (or a follow-up event is logged)
  healthFollowups.forEach(function(e) {
    var info = healthDueInfo(e.follow_up_date);
    html += '<div class="due-card ' + info.cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">Follow-up: ' + medEsc(e.description || e.event_type) + '</span>' +
      '<span class="due-card-days ' + info.cls + '">' + info.label + '</span></div>' +
      '<div class="due-card-meta">' + medEsc(healthEventTarget(e)) + ' &middot; ' + (e.event_type || '') +
      ' logged ' + fmtDate(e.date) + (e.product_used ? ' &middot; ' + medEsc(e.product_used) : '') + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:6px">' +
        '<button class="btn btn-sm" onclick="preFillFollowup(' + e.id + ')">Log follow-up</button>' +
        '<button class="btn btn-sm" onclick="markFollowupDone(' + e.id + ')">Done</button>' +
      '</div></div>';
  });
  html += '</div>';
  document.getElementById('health-due-panel').innerHTML = html;
}

// Opens the log form pre-filled for a follow-up of an earlier event. Saving it
// marks the original follow-up done (see submitHealthEvent).
function preFillFollowup(eventId) {
  var e = healthFollowups.find(function(x) { return x.id === eventId; });
  if (!e) return;
  populateHealthForm();
  hfFollowupOf = eventId;
  document.getElementById('hf-event-type').value = e.event_type === 'mortality' ? 'observation' : (e.event_type || 'observation');
  document.getElementById('hf-desc').value = 'Follow-up: ' + (e.description || '');
  document.getElementById('hf-target-type').value = e.animal_id ? 'animal' : 'group';
  if (e.animal_id) document.getElementById('hf-animal').value = e.animal_id;
  else document.getElementById('hf-group').value = e.group_id;
  onHfTargetChange();
  document.getElementById('health-log-form').classList.add('open');
  document.getElementById('health-log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Opens the Health page with the log form pre-filled as an observation for one
// animal (used by Overview's weight alerts).
async function logObservationFor(animalId, desc) {
  await showPage('health', document.querySelector('.nav-item[data-page="health"]'));
  populateHealthForm();
  hfFollowupOf = null;
  document.getElementById('hf-target-type').value = 'animal';
  document.getElementById('hf-animal').value = animalId;
  document.getElementById('hf-event-type').value = 'observation';
  document.getElementById('hf-desc').value = desc || '';
  onHfTargetChange();
  document.getElementById('health-log-form').classList.add('open');
  document.getElementById('health-log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function markFollowupDone(eventId) {
  try {
    await sbPatch('animal_health_events', eventId, { follow_up_done: true });
    await loadHealthPage();
  } catch(err) { alert('Error: ' + err.message); }
}

function preFillHealthForm(schedId) {
  var sched = healthScheds.find(function(s) { return s.id === schedId; });
  if (!sched) return;
  hfFollowupOf = null;
  hfCourseSched = sched.course_total ? sched : null;
  document.getElementById('hf-event-type').value = sched.event_type || 'vaccination';
  document.getElementById('hf-sched').value = schedId;
  if (sched.description) document.getElementById('hf-desc').value = sched.description;
  if (sched.medicine_id && medById(sched.medicine_id)) {
    document.getElementById('hf-med').value = sched.medicine_id;
  } else if (sched.product) {
    document.getElementById('hf-med').value = 'other';
    document.getElementById('hf-product').value = sched.product;
    if (sched.dose) document.getElementById('hf-dose').value = sched.dose;
  }
  onHfMedChange();
  if (sched.animal_id) {
    document.getElementById('hf-target-type').value = 'animal';
    document.getElementById('hf-animal').value = sched.animal_id;
    onHfTargetChange();
  } else if (sched.group_id) {
    document.getElementById('hf-target-type').value = 'group';
    document.getElementById('hf-group').value = sched.group_id;
    onHfTargetChange();
  }
  // Next dose of a course: same route and amounts as the previous dose
  // (a tapering course scales the second dose down; later doses then repeat the previous one)
  if (hfCourseSched && sched.course_last_event_id) {
    var taper = sched.course_later_pct && (sched.course_given || 0) === 1 ? sched.course_later_pct / 100 : 1;
    hfPrefillFromEvent(sched.course_last_event_id, taper);
  }
  renderHfCourse();
  document.getElementById('health-log-form').classList.add('open');
  document.getElementById('health-log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHealthLog() {
  var logType   = document.getElementById('health-log-type-filter') ? document.getElementById('health-log-type-filter').value : '';
  var logGroup  = document.getElementById('health-log-group-filter') ? document.getElementById('health-log-group-filter').value : '';

  var evts = healthEvts.slice();
  if (logType)  evts = evts.filter(function(e) { return e.event_type === logType; });
  if (logGroup) {
    var gAnimalIds = getGroupAnimalIds(parseInt(logGroup));
    evts = evts.filter(function(e) {
      return (e.group_id && String(e.group_id) === logGroup) ||
             (e.animal_id && gAnimalIds.indexOf(e.animal_id) >= 0);
    });
  }

  document.getElementById('health-log-meta').textContent =
    evts.length + ' record' + (evts.length !== 1 ? 's' : '');
  if (!evts.length) {
    document.getElementById('health-log-table').innerHTML = '<div class="empty">No health events match the current filter.</div>';
    return;
  }
  var EVTYPE = {
    vaccination: 'badge-blue', deworming: 'badge-teal', treatment: 'badge-amber',
    observation: 'badge-gray', injury: 'badge-brown', mortality: 'badge-red'
  };
  var colCount = 10;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th></th><th>Date</th><th>Target</th><th>Type</th><th>Description</th>' +
    '<th>Product</th><th>Dose</th><th>Vet</th><th class="right">Cost</th><th>Follow-up</th>' +
    '</tr></thead><tbody>';
  evts.forEach(function(e) {
    var target = e.animals ? (e.animals.name || e.animals.farm_id)
               : (e.group_id ? getGroupName(e.group_id) : '—');
    var open = hlExpandedId === e.id;
    // Every row opens to show its per-animal doses (if any) plus Edit / Delete
    html += '<tr class="grp-row' + (open ? ' grp-row-open' : '') + '" style="cursor:pointer" onclick="toggleHealthLogRow(' + e.id + ')">' +
      '<td style="color:var(--muted);width:14px">' + (open ? '▾' : '▸') + '</td>' +
      '<td class="mono">' + fmtDate(e.date) + '</td>' +
      '<td style="font-weight:500">' + medEsc(target) + '</td>' +
      '<td><span class="badge ' + (EVTYPE[e.event_type] || 'badge-gray') + '">' + (e.event_type || '') + '</span></td>' +
      '<td>' + (e.description ? medEsc(e.description) : '—') +
        (e.course_dose_no ? ' <span class="badge badge-blue" style="font-size:10px">dose ' + e.course_dose_no + '/' + e.course_total + '</span>' : '') + '</td>' +
      '<td class="muted-cell">' + (e.product_used ? medEsc(e.product_used) : '—') +
        (e.route ? '<div style="font-size:11px">' + medRouteLabel(e.route) + '</div>' : '') + '</td>' +
      '<td class="muted-cell">' + (e.dose ? medEsc(e.dose) : '—') + '</td>' +
      '<td>' + (e.vet_involved ? '<span class="badge badge-teal">Yes</span>' : '—') + '</td>' +
      '<td class="mono right">' + (e.cost_pkr ? pkr(e.cost_pkr) : '—') + '</td>' +
      '<td class="muted-cell">' + (e.follow_up_date ? fmtDate(e.follow_up_date) : '—') + '</td>' +
      '</tr>';
    if (open) {
      html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' +
        (hlEditId === e.id ? renderHealthEventEdit(e) : renderHealthEventDetail(e)) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  document.getElementById('health-log-table').innerHTML = html;
}

// ============================================================
// HEALTH LOG — event detail, edit and delete
// ============================================================
var hlExpandedId = null;   // event whose detail row is open
var hlEditId     = null;   // event being edited (detail row shows the edit form)
var hlWeightsAt  = {};     // animal_id -> weight on/before the open event's date

// Dose rows (medicine_movements) recorded for an event, in farm-ID order
function hlEventDoses(eventId) {
  return medMovements.filter(function(mv) {
    return mv.health_event_id === eventId && mv.movement_type === 'dose';
  }).sort(function(a, b) {
    var fa = (anSharedAnimals.find(function(x) { return x.id === a.animal_id; }) || {}).farm_id || '';
    var fb = (anSharedAnimals.find(function(x) { return x.id === b.animal_id; }) || {}).farm_id || '';
    return fa.localeCompare(fb);
  });
}

async function toggleHealthLogRow(eventId) {
  hlEditId = null;
  hlExpandedId = hlExpandedId === eventId ? null : eventId;
  hlWeightsAt = {};
  renderHealthLog();
  if (hlExpandedId === null) return;
  // Fetch each dosed animal's weight as it was on the event date (latest weigh-in on or before it)
  var e = healthEvts.find(function(x) { return x.id === eventId; });
  var ids = hlEventDoses(eventId).map(function(mv) { return mv.animal_id; }).filter(Boolean);
  if (!e || !ids.length) return;
  try {
    var ws = await sbGet('animal_weights',
      'animal_id=in.(' + ids.join(',') + ')&date=lte.' + e.date + '&select=animal_id,weight_kg,date&order=date.desc');
    ws.forEach(function(w) { if (!(w.animal_id in hlWeightsAt)) hlWeightsAt[w.animal_id] = Number(w.weight_kg); });
    if (hlExpandedId === eventId && hlEditId === null) renderHealthLog();
  } catch(err) { console.warn('Health log: weight lookup failed —', err.message); }
}

// Read-only detail: per-animal dose table + Edit / Delete
function renderHealthEventDetail(e) {
  var doses = hlEventDoses(e.id);
  var med = e.medicine_id ? medById(e.medicine_id) : null;
  var shares = doses.some(function(mv) { return mv.is_share; });
  var html = '<div style="padding:14px 22px;background:var(--bg)">';
  // Route, and for whole-group rounds the water volume and how the total was split
  if (e.route || shares) {
    html += '<div style="font-size:13px;margin-bottom:10px">' +
      (e.route ? '<strong>' + medRouteLabel(e.route) + '</strong>' : '') +
      (e.water_litres != null ? ' &middot; ' + Number(e.water_litres).toLocaleString() + ' L water' : '') +
      (shares ? ' &middot; <span style="color:var(--muted)">whole-group round: the total is split evenly, so each animal\'s share is an estimate</span>' : '') +
      '</div>';
  }
  if (doses.length && med) {
    var total = 0, totalCost = 0, anyCost = false;
    html += '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Animal</th><th class="right">Weight then</th><th class="right">' + (shares ? 'Share (≈)' : 'Dose') + '</th><th class="right">Cost</th>' +
      '</tr></thead><tbody>';
    doses.forEach(function(mv) {
      var a = anSharedAnimals.find(function(x) { return x.id === mv.animal_id; });
      var qty = -Number(mv.quantity);
      total += qty;
      if (mv.cost_pkr != null) { totalCost += Number(mv.cost_pkr); anyCost = true; }
      // Weight on the event date: latest weigh-in on/before it, else the entry weight (marked)
      var kg = mv.animal_id in hlWeightsAt ? hlWeightsAt[mv.animal_id] : null;
      var kgTag = '';
      if (kg == null && a && a.entry_weight_kg != null) {
        kg = Number(a.entry_weight_kg);
        kgTag = ' <span style="font-size:11px;color:var(--muted)">entry</span>';
      }
      html += '<tr>' +
        '<td style="font-weight:500">' + (a ? medEsc(a.farm_id) + (a.name ? ' <span style="color:var(--muted);font-weight:400">' + medEsc(a.name) + '</span>' : '')
                                            : '<span style="color:var(--muted)">deleted animal</span>') + '</td>' +
        '<td class="mono right">' + (kg != null ? r1(kg) + ' kg' + kgTag : '—') + '</td>' +
        '<td class="mono right">' + medFmtUnits(med, qty) + '</td>' +
        '<td class="mono right">' + (mv.cost_pkr != null ? pkr(mv.cost_pkr) : '—') + '</td>' +
        '</tr>';
    });
    html += '<tr style="font-weight:600;background:var(--bg)"><td>Total &middot; ' + doses.length + ' animal' + (doses.length !== 1 ? 's' : '') + '</td><td></td>' +
      '<td class="mono right">' + medFmtUnits(med, total) + '</td>' +
      '<td class="mono right">' + (anyCost ? pkr(totalCost) : '—') + '</td></tr>';
    html += '</tbody></table></div>';
  } else {
    html += '<div style="font-size:13px;color:var(--muted)">No per-animal doses recorded for this event.</div>';
  }
  html += '<div style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn btn-sm" onclick="event.stopPropagation();startHealthEventEdit(' + e.id + ')">Edit</button>' +
    '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteHealthEvent(' + e.id + ')">Delete event</button>' +
    '</div></div>';
  return html;
}

function startHealthEventEdit(eventId) {
  hlEditId = eventId;
  renderHealthLog();
}

function cancelHealthEventEdit() {
  hlEditId = null;
  renderHealthLog();
}

// Edit form: event fields + one dose box per animal. Animals listed are the ones
// already dosed plus (for a group event) current group members who weren't,
// so a missed animal can be added. Blank / 0 removes that animal's dose.
// The medicine itself can't be changed here — delete and re-log for that.
function renderHealthEventEdit(e) {
  var med = e.medicine_id ? medById(e.medicine_id) : null;
  var doses = hlEventDoses(e.id);
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + label + '</option>'; };
  var html = '<div class="health-form-box open" style="margin:14px 22px" onclick="event.stopPropagation()">' +
    '<div style="font-weight:500;margin-bottom:12px">Edit event</div>' +
    '<div class="hf-grid">' +
      '<div class="hf-field"><label>Date</label><input type="date" id="he-date" value="' + e.date + '"></div>' +
      '<div class="hf-field"><label>Event type</label><select id="he-type">' +
        opt('vaccination', 'Vaccination', e.event_type) + opt('deworming', 'Deworming', e.event_type) +
        opt('treatment', 'Treatment', e.event_type) + opt('observation', 'Observation', e.event_type) +
        opt('injury', 'Injury', e.event_type) +
        (e.event_type === 'mortality' ? opt('mortality', 'Mortality', e.event_type) : '') +
      '</select></div>' +
      '<div class="hf-field"><label>Vet involved?</label><select id="he-vet">' +
        opt('false', 'No', String(!!e.vet_involved)) + opt('true', 'Yes', String(!!e.vet_involved)) +
      '</select></div>' +
    '</div>' +
    '<div class="hf-grid" style="grid-template-columns:1fr"><div class="hf-field"><label>Description</label>' +
      '<input type="text" id="he-desc" value="' + medEsc(e.description || '') + '"></div></div>';
  // Route: a cabinet-medicine round can only switch between routes of the same
  // kind (whole-group vs per-animal) — converting shares to doses or back is
  // error-prone, so that means deleting and re-logging instead
  var bulk = med && medIsBulkRoute(e.route);
  var routeKeys = Object.keys(MED_ROUTES).filter(function(k) { return !med || medIsBulkRoute(k) === bulk; });
  html += '<div class="hf-grid">' +
    '<div class="hf-field"><label>Route</label><select id="he-route">' +
      (bulk ? '' : opt('', 'Not recorded', e.route || '')) +
      routeKeys.map(function(k) { return opt(k, MED_ROUTES[k], e.route || ''); }).join('') +
    '</select></div>' +
    (bulk ? '<div class="hf-field"><label>Water (L)</label><input type="number" id="he-water" min="0" step="any" value="' + (e.water_litres != null ? e.water_litres : '') + '"></div>' : '') +
  '</div>';
  if (!med) {
    // Free-text product / dose for events not linked to a cabinet medicine
    html += '<div class="hf-grid two">' +
      '<div class="hf-field"><label>Product used</label><input type="text" id="he-product" value="' + medEsc(e.product_used || '') + '"></div>' +
      '<div class="hf-field"><label>Dose</label><input type="text" id="he-dose" value="' + medEsc(e.dose || '') + '"></div>' +
    '</div>';
  }
  html += '<div class="hf-grid">' +
      '<div class="hf-field"><label>Cost (PKR)</label><input type="number" id="he-cost" min="0" step="1" value="' + (e.cost_pkr != null ? Math.round(e.cost_pkr) : '') + '"></div>' +
      '<div class="hf-field"><label>Follow-up date</label><input type="date" id="he-followup" value="' + (e.follow_up_date || '') + '"></div>' +
      (med ? '<div class="hf-field"><label>&nbsp;</label><button class="btn btn-sm" onclick="recalcHealthEventCost(' + e.id + ')">Recalculate cost from latest price</button></div>' : '') +
    '</div>';

  if (bulk) {
    // Whole-group round: total + which animals got it; shares are recalculated on save
    var shareIds = doses.map(function(mv) { return mv.animal_id; });
    var others = e.group_id ? getGroupAnimals(e.group_id).filter(function(a) { return shareIds.indexOf(a.id) < 0; }) : [];
    var bulkTotal = doses.reduce(function(sum, mv) { return sum - Number(mv.quantity); }, 0);
    html += '<div class="hf-grid"><div class="hf-field"><label>Total ' + medEsc(med.name) + ' used (' + med.stock_unit + ')</label>' +
        '<input type="number" id="he-bulk-total" min="0" step="any" value="' + Math.round(bulkTotal * 10000) / 10000 + '"></div></div>' +
      '<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">Animals that got it &middot; the total is re-split evenly when you save</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 16px">';
    doses.forEach(function(mv) {
      if (!mv.animal_id) return;
      var a = anSharedAnimals.find(function(x) { return x.id === mv.animal_id; });
      html += '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" class="he-bulk-animal" data-animal="' + mv.animal_id + '" checked> ' +
        (a ? medEsc(a.farm_id) : 'Animal #' + mv.animal_id) + '</label>';
    });
    others.forEach(function(a) {
      html += '<label style="display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted)"><input type="checkbox" class="he-bulk-animal" data-animal="' + a.id + '"> ' +
        medEsc(a.farm_id) + '</label>';
    });
    html += '</div>';
  } else if (med) {
    var dosedIds = doses.map(function(mv) { return mv.animal_id; });
    var extra = e.group_id ? getGroupAnimals(e.group_id).filter(function(a) { return dosedIds.indexOf(a.id) < 0; }) : [];
    html += '<div style="font-size:12px;color:var(--muted);margin:4px 0 6px">' + medEsc(med.name) + ' doses (' + med.stock_unit +
      ') &middot; blank or 0 removes a dose &middot; stock is adjusted by the difference</div>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Animal</th><th class="right">Dose given</th></tr></thead><tbody>';
    var row = function(animalId, label, val) {
      return '<tr><td style="font-weight:500">' + label + '</td>' +
        '<td class="right"><input type="number" class="he-dose-input" data-animal="' + animalId + '" min="0" step="any" ' +
        'style="width:90px;text-align:right" value="' + (val != null ? val : '') + '"></td></tr>';
    };
    doses.forEach(function(mv) {
      var a = anSharedAnimals.find(function(x) { return x.id === mv.animal_id; });
      // Doses whose animal was deleted can't be re-saved against it; show them read-only
      if (!mv.animal_id) return;
      html += row(mv.animal_id, a ? medEsc(a.farm_id) : 'Animal #' + mv.animal_id, -Number(mv.quantity));
    });
    extra.forEach(function(a) {
      html += row(a.id, medEsc(a.farm_id) + ' <span style="color:var(--muted);font-weight:400">(not dosed)</span>', null);
    });
    html += '</tbody></table></div>';
  }
  html += '<div style="display:flex;gap:10px;margin-top:12px">' +
    '<button class="btn btn-primary" onclick="saveHealthEventEdit(' + e.id + ')">Save changes</button>' +
    '<button class="btn" onclick="cancelHealthEventEdit()">Cancel</button>' +
    '<span id="he-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
    '</div></div>';
  return html;
}

// Per-unit cost for a dose row: the price it was originally costed at, else the latest purchase price
function hlUnitCost(mv, medId) {
  if (mv && mv.cost_pkr != null && Number(mv.quantity) !== 0) return Number(mv.cost_pkr) / -Number(mv.quantity);
  return medCostPerUnit(medId);
}

// Fills the cost box from the doses currently entered, priced at the latest purchase
function recalcHealthEventCost(eventId) {
  var e = healthEvts.find(function(x) { return x.id === eventId; });
  var cpu = medCostPerUnit(e.medicine_id);
  if (cpu == null) { alert('No purchase with a price has been logged for this medicine yet — log one under Inventory › Medicines first.'); return; }
  var total = 0;
  var bulkEl = document.getElementById('he-bulk-total');
  if (bulkEl) total = parseFloat(bulkEl.value) || 0;
  else document.querySelectorAll('.he-dose-input').forEach(function(inp) { var q = parseFloat(inp.value); if (q > 0) total += q; });
  document.getElementById('he-cost').value = Math.round(total * cpu);
}

async function saveHealthEventEdit(eventId) {
  var statusEl = document.getElementById('he-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var e = healthEvts.find(function(x) { return x.id === eventId; });
    var med = e.medicine_id ? medById(e.medicine_id) : null;
    var date = document.getElementById('he-date').value;
    var desc = document.getElementById('he-desc').value.trim();
    if (!date || !desc) throw new Error('Date and description are required.');
    var costRaw = document.getElementById('he-cost').value;
    var patch = {
      date: date,
      event_type: document.getElementById('he-type').value,
      description: desc,
      vet_involved: document.getElementById('he-vet').value === 'true',
      cost_pkr: costRaw === '' ? null : parseFloat(costRaw),
      follow_up_date: document.getElementById('he-followup').value || null
    };
    // A new or changed follow-up date re-opens the reminder
    if (patch.follow_up_date && patch.follow_up_date !== e.follow_up_date) patch.follow_up_done = false;
    patch.route = document.getElementById('he-route').value || null;
    var bulk = med && medIsBulkRoute(e.route);
    if (bulk) {
      var wRaw = document.getElementById('he-water').value;
      patch.water_litres = wRaw === '' ? null : parseFloat(wRaw);
    }

    if (!med) {
      patch.product_used = document.getElementById('he-product').value.trim() || null;
      patch.dose = document.getElementById('he-dose').value.trim() || null;
      await sbPatch('animal_health_events', eventId, patch);
    } else {
      // The amount each animal should end up with: typed per animal, or for a
      // whole-group round the total re-split over the ticked animals
      var existing = hlEventDoses(eventId);
      var wanted = {};   // animal_id -> qty (0 = remove)
      if (bulk) {
        var bulkTotal = parseFloat(document.getElementById('he-bulk-total').value);
        if (!(bulkTotal > 0)) throw new Error('Enter the total amount used.');
        var ids = [];
        document.querySelectorAll('.he-bulk-animal').forEach(function(cb) {
          wanted[parseInt(cb.dataset.animal)] = 0;
          if (cb.checked) ids.push(parseInt(cb.dataset.animal));
        });
        if (!ids.length) throw new Error('Tick at least one animal. To remove the whole event, use Delete event instead.');
        medSplitShares(bulkTotal, ids).forEach(function(x) { wanted[x.animal_id] = x.qty; });
      } else {
        document.querySelectorAll('.he-dose-input').forEach(function(inp) {
          var q = parseFloat(inp.value);
          wanted[parseInt(inp.dataset.animal)] = q > 0 ? q : 0;
        });
      }
      // Work out each dose row's change: update, add, or remove
      var updates = [], inserts = [], removals = [];
      var total = 0, count = 0;
      Object.keys(wanted).forEach(function(key) {
        var animalId = parseInt(key);
        var q = wanted[key];
        var mv = existing.find(function(x) { return x.animal_id === animalId; });
        if (q > 0) {
          total += q; count++;
          var uc = hlUnitCost(mv, med.id);
          var fields = { quantity: -q, date: date, cost_pkr: uc != null ? r2(q * uc) : null, is_share: !!bulk };
          if (mv) updates.push({ id: mv.id, fields: fields });
          else inserts.push(Object.assign({ medicine_id: med.id, movement_type: 'dose', health_event_id: eventId, animal_id: animalId }, fields));
        } else if (mv) {
          removals.push(mv.id);
        }
      });
      // Doses whose animal has since been deleted aren't editable — keep them in the total
      existing.filter(function(mv) { return !mv.animal_id; }).forEach(function(mv) {
        total += -Number(mv.quantity); count++;
        updates.push({ id: mv.id, fields: { date: date } });
      });
      if (!count) throw new Error('At least one animal needs a dose. To remove the whole event, use Delete event instead.');
      patch.dose = bulk
        ? medFmtUnits(med, total) + (patch.water_litres ? ' in ' + patch.water_litres + ' L water' : '') + ', ' + count + ' animal' + (count !== 1 ? 's' : '')
        : medFmtUnits(med, total) + (count > 1 ? ' total, ' + count + ' animals' : '');

      for (var i = 0; i < updates.length; i++) await sbPatch('medicine_movements', updates[i].id, updates[i].fields);
      if (inserts.length) await sbInsert('medicine_movements', inserts);
      for (var j = 0; j < removals.length; j++) await sbDelete('medicine_movements', removals[j]);
      await sbPatch('animal_health_events', eventId, patch);
    }
    hlEditId = null;
    await loadHealthPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function deleteHealthEvent(eventId) {
  var e = healthEvts.find(function(x) { return x.id === eventId; });
  var doses = hlEventDoses(eventId);
  var med = e && e.medicine_id ? medById(e.medicine_id) : null;
  var total = doses.reduce(function(s, mv) { return s - Number(mv.quantity); }, 0);
  var msg = 'Delete this health event?' +
    (doses.length && med ? '\n\n' + medFmtUnits(med, total) + ' of ' + med.name + ' will go back into stock.' : '') +
    '\n\nIf it was logged against a schedule, the schedule\'s next due date is not changed back — edit it under Schedules if needed.' +
    (e && e.event_type === 'mortality' ? '\n\nThis only removes the log entry — the animal stays marked as deceased and its mortality record is kept.' : '') +
    '\n\nThis cannot be undone.';
  if (!confirm(msg)) return;
  try {
    // Dose rows are removed automatically with the event (on delete cascade)
    await sbDelete('animal_health_events', eventId);
    hlExpandedId = null; hlEditId = null;
    await loadHealthPage();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

async function submitHealthEvent() {
  var statusEl = document.getElementById('hf-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var targetType = document.getElementById('hf-target-type').value;
    var animalId   = targetType === 'animal' ? document.getElementById('hf-animal').value : null;
    var groupId    = targetType === 'group'  ? document.getElementById('hf-group').value  : null;
    var date       = document.getElementById('hf-date').value;
    var desc       = document.getElementById('hf-desc').value.trim();
    var evType     = document.getElementById('hf-event-type').value;
    if (!date || !desc) throw new Error('Date and description required.');
    if (targetType === 'animal' && !animalId) throw new Error('Select an animal.');
    if (targetType === 'group'  && !groupId)  throw new Error('Select a group.');
    if (evType === 'mortality' && targetType !== 'animal') throw new Error('A death must be logged against an individual animal, not a group.');
    var d = {
      date: date, event_type: evType, description: desc,
      vet_involved: document.getElementById('hf-vet').value === 'true'
    };
    if (animalId) d.animal_id = parseInt(animalId);
    if (groupId)  d.group_id  = parseInt(groupId);
    // Medicine: a cabinet medicine is recorded by id (with a readable summary in
    // product_used/dose for the log); "other" keeps the old free-text fields
    var medSel = document.getElementById('hf-med').value;
    var med = (medSel && medSel !== 'other') ? medById(parseInt(medSel)) : null;
    var route = medSel ? (document.getElementById('hf-route').value || null) : null;
    if (med && !route && medRoutes(med).length > 1) throw new Error(med.name + ' can be given more than one way — choose the route used.');
    if (route) d.route = route;
    var doses = [];
    if (med) {
      doses = hfReadDoses();
      var bulk = medIsBulkRoute(route);
      if (!doses.length) {
        if (!bulk) throw new Error('Enter a dose for at least one animal, or set Medicine to None.');
        if (!(parseFloat(document.getElementById('hf-bulk-total').value) > 0)) throw new Error('Enter the total amount of ' + med.name + ' used.');
        throw new Error('Tick at least one animal that got it.');
      }
      var doseTotal = doses.reduce(function(s, x) { return s + x.qty; }, 0);
      var waterEl = document.getElementById('hf-bulk-water');
      var litres = bulk && waterEl && waterEl.value !== '' ? parseFloat(waterEl.value) : null;
      if (litres != null) d.water_litres = litres;
      d.medicine_id  = med.id;
      d.product_used = med.name;
      d.dose = bulk
        ? medFmtUnits(med, doseTotal) + (litres ? ' in ' + litres + ' L water' : '') + ', ' + doses.length + ' animal' + (doses.length !== 1 ? 's' : '')
        : medFmtUnits(med, doseTotal) + (doses.length > 1 ? ' total, ' + doses.length + ' animals' : '');
    } else if (medSel === 'other') {
      var prod = document.getElementById('hf-product').value.trim(); if (prod) d.product_used = prod;
      var dose = document.getElementById('hf-dose').value.trim();    if (dose) d.dose = dose;
    }
    // Course: either the next dose of a running course, or the first dose of a new one
    var schedSel = parseInt(document.getElementById('hf-sched').value) || null;
    var courseSched = hfCourseSched && hfCourseSched.id === schedSel ? hfCourseSched : null;
    var courseOnEl = document.getElementById('hf-course-on');
    var newCourse = null;
    if (!courseSched && med && courseOnEl && courseOnEl.checked) {
      var cDoses = parseInt(document.getElementById('hf-course-doses').value);
      if (!(cDoses >= 2)) throw new Error('A course needs at least 2 doses — or untick "Part of a course".');
      var cPct = parseInt(document.getElementById('hf-course-pct').value);
      if (!(cPct >= 1 && cPct <= 100)) throw new Error('Later doses must be between 1% and 100% of the first.');
      newCourse = { total: cDoses, interval: parseInt(document.getElementById('hf-course-interval').value), pct: cPct < 100 ? cPct : null };
      d.course_dose_no = 1; d.course_total = cDoses;
    } else if (courseSched) {
      d.course_dose_no = (courseSched.course_given || 0) + 1; d.course_total = courseSched.course_total;
    }
    var cost = document.getElementById('hf-cost').value;           if (cost) d.cost_pkr = parseFloat(cost);
    var fu   = document.getElementById('hf-followup').value;       if (fu)   d.follow_up_date = fu;

    var saved = await sbInsert('animal_health_events', [d]);
    if (!saved || !saved.length) throw new Error('The health event was not returned by the database — check it saved before retrying.');

    // One stock movement per dosed animal, valued at the latest purchase price.
    // If this fails, remove the event so stock and the log never disagree.
    if (med) {
      var cpu = medCostPerUnit(med.id);
      var moves = doses.map(function(x) {
        return {
          medicine_id: med.id, date: date, movement_type: 'dose', quantity: -x.qty,
          cost_pkr: cpu != null ? r2(x.qty * cpu) : null,
          health_event_id: saved[0].id, animal_id: x.animal_id,
          is_share: !!x.share
        };
      });
      try {
        await sbInsert('medicine_movements', moves);
      } catch(moveErr) {
        await sbDelete('animal_health_events', saved[0].id).catch(function() {});
        throw new Error('Could not record the doses, so the event was not saved: ' + moveErr.message);
      }
    }

    // Mortality: written AFTER the health event so a failure can't leave an animal
    // marked dead with no log entry. If these follow-on writes fail, the event is
    // removed again so the user can retry cleanly.
    if (evType === 'mortality') {
      try {
        var cause    = document.getElementById('hf-mort-cause').value.trim();
        var disposal = document.getElementById('hf-mort-disposal').value;
        var mortRec = {
          animal_id: parseInt(animalId),
          date: date,
          probable_cause: cause || null,
          carcass_disposal: disposal || null,
          vet_confirmed: document.getElementById('hf-vet').value === 'true'
        };
        var mortGroup = getAnimalGroupId(parseInt(animalId));
        if (mortGroup) mortRec.group_id = mortGroup;
        await sbInsert('animal_mortality', [mortRec]);
        await sbPatch('animals', parseInt(animalId), { status: 'deceased' });
        // Close the animal's group membership
        var memRec = anSharedMembers.find(function(m) { return m.animal_id === parseInt(animalId); });
        if (memRec) await sbPatch('group_members', memRec.id, { left_date: date, left_reason: 'deceased' });
      } catch(mortErr) {
        await sbDelete('animal_health_events', saved[0].id).catch(function() {});
        throw new Error('Could not record the death, so the event was not saved: ' + mortErr.message);
      }
    }

    // Logging a follow-up closes the original event's follow-up reminder
    if (hfFollowupOf) {
      await sbPatch('animal_health_events', hfFollowupOf, { follow_up_done: true });
      hfFollowupOf = null;
    }

    // Update scheduled event if linked
    var schedId = document.getElementById('hf-sched').value;
    if (schedId) {
      var sched = healthScheds.find(function(s) { return s.id === parseInt(schedId); });
      if (sched && sched.course_total) {
        // Course: count this dose; move to the next dose's date, or close when done
        var givenNow = (sched.course_given || 0) + 1;
        await sbPatch('scheduled_health_events', sched.id, givenNow >= sched.course_total
          ? { course_given: givenNow, last_done_date: date, course_last_event_id: saved[0].id, active: false }
          : { course_given: givenNow, last_done_date: date, course_last_event_id: saved[0].id, dose: d.dose || null,
              next_due_date: medCourseDueDate(sched.course_start_date || date, givenNow, sched.course_interval_hours) });
      } else if (sched && sched.interval_days) {
        // Repeating: move the due date on by the interval. Built from local date
        // parts — toISOString() would shift it a day early in Pakistan (UTC+5).
        var nextDue = new Date(date + 'T00:00:00');
        nextDue.setDate(nextDue.getDate() + sched.interval_days);
        await sbPatch('scheduled_health_events', parseInt(schedId), {
          last_done_date: date,
          next_due_date: nextDue.getFullYear() + '-' + String(nextDue.getMonth() + 1).padStart(2, '0') +
                         '-' + String(nextDue.getDate()).padStart(2, '0')
        });
      } else if (sched) {
        // One-off (e.g. a protocol's arrival step): done once, so close it
        await sbPatch('scheduled_health_events', parseInt(schedId), { last_done_date: date, active: false });
      }
    }

    // New course: the remaining doses become a schedule that reminds dose by dose.
    // The event itself is already saved, so a failure here is reported, not rolled back.
    if (newCourse) {
      try {
        var cs = {
          event_type: evType, description: desc, medicine_id: med.id, dose: d.dose,
          course_total: newCourse.total, course_given: 1, course_interval_hours: newCourse.interval, course_later_pct: newCourse.pct,
          course_start_date: date, course_last_event_id: saved[0].id, last_done_date: date,
          next_due_date: medCourseDueDate(date, 1, newCourse.interval), active: true,
          notes: 'Course: ' + medFmtCourse(newCourse.total, newCourse.interval, newCourse.pct)
        };
        if (animalId) cs.animal_id = parseInt(animalId); else cs.group_id = parseInt(groupId);
        await sbInsert('scheduled_health_events', [cs]);
      } catch(courseErr) {
        throw new Error('Dose 1 was saved, but the reminders for the rest of the course could not be created: ' + courseErr.message);
      }
    }
    hfCourseSched = null;

    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('health-log-form').classList.remove('open');
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await loadHealthPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// PER-ANIMAL HEALTH HISTORY (opened from the Animals list and
// Groups page member rows). Needs health_meds.js loaded with data.
// ============================================================
// An event belongs to an animal's history when it was logged for that animal,
// it dosed that animal, or it was logged for a group the animal was in on that date.
async function openAnimalHealthHistory(animalId) {
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  document.getElementById('ah-title').textContent = 'Health history — ' + (a ? a.farm_id + (a.name ? ' (' + a.name + ')' : '') : 'animal');
  document.getElementById('ah-body').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('ah-modal').style.display = 'flex';
  try {
    await loadModule('health_meds');
    // Every group membership the animal has ever had (including ones it has left)
    var r = await Promise.all([
      sbGet('group_members', 'animal_id=eq.' + animalId + '&select=group_id,joined_date,left_date'),
      medLoadData()
    ]);
    var memberships = r[0];
    var doses = medMovements.filter(function(mv) { return mv.animal_id === animalId && mv.movement_type === 'dose'; });
    var dosedEventIds = doses.map(function(mv) { return mv.health_event_id; }).filter(Boolean);
    var groupIds = memberships.map(function(m) { return m.group_id; });

    // One query covering all three ways an event can involve this animal
    var ors = ['animal_id.eq.' + animalId];
    if (dosedEventIds.length) ors.push('id.in.(' + dosedEventIds.join(',') + ')');
    if (groupIds.length)      ors.push('group_id.in.(' + groupIds.join(',') + ')');
    var evts = await sbGet('animal_health_events', 'or=(' + ors.join(',') + ')&select=*&order=date.desc,id.desc');

    // Group events only count while the animal was actually in that group, and a
    // group medicine round only counts if this animal was dosed — animals deliberately
    // skipped (e.g. pregnant does) didn't receive it, so it isn't part of their history.
    evts = evts.filter(function(e) {
      if (e.animal_id === animalId || dosedEventIds.indexOf(e.id) >= 0) return true;
      if (e.medicine_id) return false;
      return memberships.some(function(m) {
        return m.group_id === e.group_id && e.date >= m.joined_date && (!m.left_date || e.date <= m.left_date);
      });
    });
    renderAnimalHealthHistory(animalId, evts, doses);
  } catch(err) {
    document.getElementById('ah-body').innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderAnimalHealthHistory(animalId, evts, doses) {
  var EVTYPE = {
    vaccination: 'badge-blue', deworming: 'badge-teal', treatment: 'badge-amber',
    observation: 'badge-gray', injury: 'badge-brown', mortality: 'badge-red'
  };
  // Summary: withdrawal status, treatment count, medicine cost for this animal
  var w = medWithdrawalFor(animalId);
  var medCost = doses.reduce(function(s, mv) { return s + (mv.cost_pkr != null ? Number(mv.cost_pkr) : 0); }, 0);
  var unpriced = doses.some(function(mv) { return mv.cost_pkr == null; });
  var html = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 16px">' +
    '<span class="badge ' + (w ? 'badge-red' : 'badge-green') + '">' +
      (w ? 'Meat withdrawal until ' + fmtDate(w.safeDate) + ' — ' + medEsc(w.med.name) : 'Not in meat withdrawal') + '</span>' +
    (medIsMilked(animalId) ? (function() {
      var mw = medWithdrawalFor(animalId, null, 'milk_withdrawal_days');
      return '<span class="badge ' + (mw ? 'badge-red' : 'badge-green') + '">' +
        (mw ? 'Milk withdrawal until ' + fmtDate(mw.safeDate) + ' — ' + medEsc(mw.med.name) : 'Not in milk withdrawal') + '</span>';
    })() : '') +
    '<span class="badge badge-gray">' + evts.length + ' event' + (evts.length !== 1 ? 's' : '') + '</span>' +
    '<span class="badge badge-gray">' + doses.length + ' dose' + (doses.length !== 1 ? 's' : '') + '</span>' +
    '<span class="badge badge-gray">Medicine cost ' +
      (!doses.length ? pkr(0)
        : doses.every(function(mv) { return mv.cost_pkr == null; }) ? 'not priced yet'
        : pkr(medCost) + (unpriced ? ' (some doses unpriced)' : '')) + '</span>' +
    '</div>';

  // Doses not tied to any remaining event (e.g. their event was on a deleted animal) still count
  var shownDoseIds = [];
  if (!evts.length && !doses.length) {
    document.getElementById('ah-body').innerHTML = html + '<div class="empty">No health events recorded for this animal.</div>';
    return;
  }
  html += '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th>Description</th><th>Medicine</th>' +
    '<th class="right">Dose given</th><th class="right">Cost</th><th></th>' +
    '</tr></thead><tbody>';
  evts.forEach(function(e) {
    var mv = doses.find(function(d) { return d.health_event_id === e.id; });
    if (mv) shownDoseIds.push(mv.id);
    var med = e.medicine_id ? medById(e.medicine_id) : null;
    var scope = e.group_id && !e.animal_id
      ? '<span class="badge badge-gray" style="font-size:10px">group: ' + medEsc(getGroupName(e.group_id)) + '</span>' : '';
    html += '<tr>' +
      '<td class="mono">' + fmtDate(e.date) + '</td>' +
      '<td><span class="badge ' + (EVTYPE[e.event_type] || 'badge-gray') + '">' + (e.event_type || '') + '</span></td>' +
      '<td>' + (e.description ? medEsc(e.description) : '—') + (e.vet_involved ? ' <span class="badge badge-teal" style="font-size:10px">vet</span>' : '') + '</td>' +
      '<td class="muted-cell">' + (med ? medEsc(med.name) : (e.product_used ? medEsc(e.product_used) : '—')) +
        (e.route ? '<div style="font-size:11px">' + medRouteLabel(e.route) + '</div>' : '') + '</td>' +
      // This animal's own dose (or its even share of a whole-group round); for an individual free-text event, its dose text
      '<td class="mono right">' + (mv && med && mv.is_share ? '≈ ' + medFmtUnits(med, -Number(mv.quantity)) + ' <span style="font-size:11px;color:var(--muted)">share</span>'
                                   : mv && med ? medFmtUnits(med, -Number(mv.quantity))
                                   : (e.animal_id && e.dose ? medEsc(e.dose) : (med ? '<span style="color:var(--muted)">not dosed</span>' : '—'))) + '</td>' +
      '<td class="mono right">' + (mv ? (mv.cost_pkr != null ? pkr(mv.cost_pkr) : '—')
                                   : (e.animal_id && e.cost_pkr ? pkr(e.cost_pkr) : '—')) + '</td>' +
      '<td>' + scope + '</td>' +
      '</tr>';
  });
  doses.filter(function(d) { return shownDoseIds.indexOf(d.id) < 0; }).forEach(function(d) {
    var med = medById(d.medicine_id);
    html += '<tr><td class="mono">' + fmtDate(d.date) + '</td><td><span class="badge badge-gray">dose</span></td>' +
      '<td class="muted-cell">No linked event</td><td class="muted-cell">' + (med ? medEsc(med.name) : '—') + '</td>' +
      '<td class="mono right">' + (med ? medFmtUnits(med, -Number(d.quantity)) : '') + '</td>' +
      '<td class="mono right">' + (d.cost_pkr != null ? pkr(d.cost_pkr) : '—') + '</td><td></td></tr>';
  });
  html += '</tbody></table></div>';
  document.getElementById('ah-body').innerHTML = html;
}

function closeAnimalHealthHistory() {
  document.getElementById('ah-modal').style.display = 'none';
}

// ============================================================
// SCHEDULES (recurring rounds — feed the Due panel and the
// medicine reorder look-ahead in health_meds.js)
// ============================================================

// What a schedule administers: the cabinet medicine's name, else free-text product
function schedProductLabel(s) {
  var m = s.medicine_id ? medById(s.medicine_id) : null;
  return m ? m.name : (s.product || '');
}

function schedTargetName(s) {
  if (s.animal_id)   return getAnimalDisplayName(s.animal_id);
  if (s.group_id)    return getGroupName(s.group_id);
  if (s.location_id) return getLocationName(s.location_id);
  return '—';
}

function renderSchedTable() {
  var tbl = document.getElementById('health-sched-table');
  if (!healthAllScheds.length) {
    tbl.innerHTML = '<div class="empty">No schedules yet. Use + Add schedule to set up a recurring round.</div>';
    return;
  }
  // Active first, then by next due date; retired at the bottom
  var rows = healthAllScheds.slice().sort(function(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.next_due_date || '9999').localeCompare(b.next_due_date || '9999');
  });
  var colCount = 8;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Description</th><th>Type</th><th>Target</th><th>Medicine</th>' +
    '<th class="right">Every</th><th>Last done</th><th>Next due</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var retiredHeader = false;
  rows.forEach(function(s) {
    if (!s.active && !retiredHeader) {
      html += '<tr><td colspan="' + colCount + '" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">Retired schedules</td></tr>';
      retiredHeader = true;
    }
    html += '<tr' + (!s.active ? ' style="opacity:0.5"' : '') + '>' +
      '<td style="font-weight:500">' + medEsc(s.description) + '</td>' +
      '<td class="muted-cell">' + (s.event_type || '—') + '</td>' +
      '<td>' + medEsc(schedTargetName(s)) + '</td>' +
      '<td class="muted-cell">' + (schedProductLabel(s) ? medEsc(schedProductLabel(s)) : '—') + healthSchedRotationNote(s) + '</td>' +
      '<td class="mono right">' + (s.interval_days ? s.interval_days + ' d' : 'once') + '</td>' +
      '<td class="mono">' + fmtDate(s.last_done_date) + '</td>' +
      '<td class="mono">' + fmtDate(s.next_due_date) + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="openSchedForm(' + s.id + ')">Edit</button> ' +
        '<button class="btn btn-sm" onclick="setSchedActive(' + s.id + ',' + !s.active + ')">' + (s.active ? 'Retire' : 'Reactivate') + '</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteSchedule(' + s.id + ')">Delete</button>' +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// Opens the add/edit form; id = null for a new schedule
function openSchedForm(id) {
  schedEditId = id;
  var s = id !== null ? healthAllScheds.find(function(x) { return x.id === id; }) : null;
  document.getElementById('sch-title').textContent = s ? 'Edit schedule' : 'New schedule';
  document.getElementById('sch-group').innerHTML = '<option value="">Select group</option>' +
    anSharedGroups.filter(function(g) { return g.status === 'active'; }).map(function(g) {
      return '<option value="' + g.id + '">' + medEsc(g.name) + '</option>';
    }).join('');
  document.getElementById('sch-animal').innerHTML = '<option value="">Select animal</option>' +
    anSharedAnimals.filter(function(a) { return a.status === 'active' || a.status === 'quarantine'; }).map(function(a) {
      return '<option value="' + a.id + '">' + a.farm_id + (a.name ? ' (' + medEsc(a.name) + ')' : '') + '</option>';
    }).join('');
  document.getElementById('sch-med').innerHTML = hfMedOptionsHtml(false);

  document.getElementById('sch-desc').value        = s ? s.description || '' : '';
  document.getElementById('sch-event-type').value  = s ? s.event_type || 'deworming' : 'deworming';
  document.getElementById('sch-target-type').value = s && s.animal_id ? 'animal' : 'group';
  document.getElementById('sch-group').value       = s && s.group_id ? s.group_id : '';
  document.getElementById('sch-animal').value      = s && s.animal_id ? s.animal_id : '';
  document.getElementById('sch-med').value         = s && s.medicine_id ? s.medicine_id : '';
  document.getElementById('sch-product').value     = s ? s.product || '' : '';
  document.getElementById('sch-interval').value    = s && s.interval_days ? s.interval_days : '';
  document.getElementById('sch-next').value        = s ? s.next_due_date || '' : todayISO();
  document.getElementById('sch-notes').value       = s ? s.notes || '' : '';
  document.getElementById('sch-status').textContent = '';
  onSchTargetChange();
  var box = document.getElementById('sched-form');
  box.classList.add('open');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSchedForm() {
  schedEditId = null;
  document.getElementById('sched-form').classList.remove('open');
}

function onSchTargetChange() {
  var t = document.getElementById('sch-target-type').value;
  document.getElementById('sch-group-wrap').style.display  = t === 'group'  ? 'flex' : 'none';
  document.getElementById('sch-animal-wrap').style.display = t === 'animal' ? 'flex' : 'none';
}

async function submitSchedule() {
  var statusEl = document.getElementById('sch-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var t = document.getElementById('sch-target-type').value;
    var groupId  = parseInt(document.getElementById('sch-group').value)  || null;
    var animalId = parseInt(document.getElementById('sch-animal').value) || null;
    var interval = parseInt(document.getElementById('sch-interval').value) || null;
    var d = {
      description:   document.getElementById('sch-desc').value.trim(),
      event_type:    document.getElementById('sch-event-type').value,
      // Exactly one target is set; the other is cleared (DB enforces one target)
      group_id:      t === 'group'  ? groupId  : null,
      animal_id:     t === 'animal' ? animalId : null,
      location_id:   null,
      medicine_id:   parseInt(document.getElementById('sch-med').value) || null,
      product:       document.getElementById('sch-product').value.trim() || null,
      interval_days: interval,
      next_due_date: document.getElementById('sch-next').value || null,
      notes:         document.getElementById('sch-notes').value.trim() || null
    };
    if (!d.description) throw new Error('Description is required.');
    if (!d.group_id && !d.animal_id) throw new Error('Select a ' + t + '.');
    if (!d.next_due_date) throw new Error('Next due date is required.');
    if (schedEditId !== null) await sbPatch('scheduled_health_events', schedEditId, d);
    else await sbInsert('scheduled_health_events', [Object.assign({ active: true }, d)]);
    closeSchedForm();
    await loadHealthPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function setSchedActive(id, active) {
  try {
    await sbPatch('scheduled_health_events', id, { active: active });
    await loadHealthPage();
  } catch(err) { alert('Error: ' + err.message); }
}

async function deleteSchedule(id) {
  if (!confirm('Delete this schedule? Logged health events are kept. This cannot be undone.')) return;
  try {
    await sbDelete('scheduled_health_events', id);
    await loadHealthPage();
  } catch(err) { alert('Error: ' + err.message); }
}

// ============================================================
// BREEDING PAGE
// ============================================================
async function loadBreedingPage() {
  // Do NOT wipe breeding-content — static form fields (br-dam etc.) live inside it.
  // Set loading state only on the dynamic sub-panels.
  var dueEl = document.getElementById('breeding-due-panel');
  var evtEl = document.getElementById('br-event-table');
  var bthEl = document.getElementById('birth-event-table');
  if (dueEl) dueEl.innerHTML = '<div class="loading">Loading...</div>';
  if (evtEl) evtEl.innerHTML = '<div class="loading">Loading...</div>';
  if (bthEl) bthEl.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var r = await Promise.all([
      sbGet('breeding_events',
        'select=id,date,dam_id,sire_id,sire_unknown,observed_by,notes,' +
        'dams:animals!breeding_events_dam_id_fkey(farm_id,name,species_id),' +
        'sires:animals!breeding_events_sire_id_fkey(farm_id,name)&order=date.desc&limit=200'),
      sbGet('birth_events',
        'select=id,date,dam_id,sire_id,litter_size,live_births,stillbirths,notes,' +
        'dams:animals!birth_events_dam_id_fkey(farm_id,name),' +
        'sires:animals!birth_events_sire_id_fkey(farm_id,name)&order=date.desc&limit=100')
    ]);
    breedingData = r[0]; birthData = r[1];
    renderDueToKid();
    populateBreedingForm();
    renderBreedingEvents();
    renderBirthHistory();
    renderAbbrevKey('abbrev-breeding', ['BCS']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderDueToKid() {
  var el = document.getElementById('breeding-due-panel');
  if (!el) return;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 21);
  var cutoffS = cutoff.toISOString().slice(0, 10);

  // Find breeding events with no linked birth, expected kidding within 21 days
  var registeredDamDates = {};
  birthData.forEach(function(b) {
    registeredDamDates[b.dam_id + '_' + b.date] = true;
  });

  var due = breedingData.filter(function(b) {
    if (!b.dam_id) return false;
    var damA = anSharedAnimals.find(function(a) { return a.id === b.dam_id; });
    var gestDays = 150; // default goat
    if (damA) {
      var sp = anSharedSpecies.find(function(s) { return s.id === damA.species_id; });
      if (sp && sp.gestation_days) gestDays = sp.gestation_days;
    }
    var breedDate = new Date(b.date + 'T00:00:00');
    var expected  = new Date(breedDate); expected.setDate(expected.getDate() + gestDays);
    var expS      = expected.toISOString().slice(0, 10);
    b._expectedKidding = expS;
    b._gestDays = gestDays;
    if (expS > cutoffS) return false;
    // Check if birth already registered
    return !registeredDamDates[b.dam_id + '_' + expS];
  });

  if (!due.length) {
    el.innerHTML = '<div class="empty">No animals due to kid in the next 21 days.</div>';
    return;
  }
  var html = '<div class="due-grid">';
  due.forEach(function(b) {
    var due2  = new Date(b._expectedKidding + 'T00:00:00');
    var diff  = Math.round((due2 - today) / 864e5);
    var cls   = diff < 0 ? 'overdue' : (diff <= 7 ? 'soon' : 'upcoming');
    var daysLabel = diff < 0 ? Math.abs(diff) + 'd overdue' : (diff === 0 ? 'Today' : diff + 'd away');
    var damName = b.dams ? (b.dams.name || b.dams.farm_id) : '\u2014';
    var sireName = b.sires ? (b.sires.farm_id) : 'Unknown';
    html += '<div class="due-card ' + cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">Dam: ' + damName + '</span>' +
      '<span class="due-card-days ' + cls + '">' + daysLabel + '</span></div>' +
      '<div class="due-card-meta">Sire: ' + sireName + ' &middot; Bred: ' + fmtDate(b.date) + '</div>' +
      '<div class="due-card-meta">Expected kidding: ' + fmtDate(b._expectedKidding) + '</div>' +
      '<div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="openBirthModal(' + b.id + ')">Register birth</button></div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function populateBreedingForm() {
  var females = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'female' || a.purpose === 'breeder' || a.is_breeding);
  });
  var males = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'male');
  });
  document.getElementById('br-dam').innerHTML =
    '<option value="">Select dam</option>' +
    females.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('br-sire').innerHTML =
    '<option value="">Select sire (optional)</option>' +
    males.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('br-obs').innerHTML =
    '<option value="">Select worker</option>' +
    anSharedWorkers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('');
  document.getElementById('br-date').value = todayISO();
}

var brEditId = null;   // breeding event being edited in the form (null = logging a new one)

function toggleBrForm() {
  var box = document.getElementById('br-form-box');
  if (box.classList.contains('open')) { closeBrForm(); return; }
  brEditId = null;
  populateBreedingForm();
  document.getElementById('br-sire').value = '';
  document.getElementById('br-obs').value = '';
  document.getElementById('br-notes').value = '';
  document.getElementById('br-submit-btn').textContent = 'Save mating';
  document.getElementById('br-status').textContent = '';
  box.classList.add('open');
}

function closeBrForm() {
  brEditId = null;
  document.getElementById('br-submit-btn').textContent = 'Save mating';
  document.getElementById('br-form-box').classList.remove('open');
}

// Adds an <option> for an animal that's no longer in the dropdown's filter
// (e.g. a doe since sold), so editing an old record still shows who it was.
function brEnsureOption(selectId, animalId) {
  var sel = document.getElementById(selectId);
  if (!animalId || sel.querySelector('option[value="' + animalId + '"]')) return;
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  var o = document.createElement('option');
  o.value = animalId;
  o.textContent = a ? a.farm_id + (a.name ? ' (' + a.name + ')' : '') : 'Animal #' + animalId;
  sel.appendChild(o);
}

// Opens the mating form filled in with an existing record; Save then updates it
function startBreedingEdit(id) {
  var b = breedingData.find(function(x) { return x.id === id; });
  if (!b) return;
  populateBreedingForm();
  brEditId = id;
  brEnsureOption('br-dam', b.dam_id);
  brEnsureOption('br-sire', b.sire_id);
  document.getElementById('br-dam').value   = b.dam_id;
  document.getElementById('br-date').value  = b.date;
  document.getElementById('br-sire').value  = b.sire_id || '';
  document.getElementById('br-obs').value   = b.observed_by || '';
  document.getElementById('br-notes').value = b.notes || '';
  document.getElementById('br-submit-btn').textContent = 'Save changes';
  document.getElementById('br-status').textContent = '';
  var box = document.getElementById('br-form-box');
  box.classList.add('open');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteBreedingEvent(id) {
  var b = breedingData.find(function(x) { return x.id === id; });
  var who = b && b.dams ? (b.dams.name || b.dams.farm_id) : 'this doe';
  if (!confirm('Delete the mating record for ' + who + (b ? ' on ' + fmtDate(b.date) : '') + '? This cannot be undone.')) return;
  try {
    // A birth may point at this mating; keep the birth, just drop the link
    await sbPatchWhere('birth_events', 'breeding_event_id=eq.' + id, { breeding_event_id: null });
    await sbDelete('breeding_events', id);
    if (brEditId === id) closeBrForm();
    await loadBreedingPage();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

// Mating date + gestation as YYYY-MM-DD, using local date parts
// (toISOString() would land a day early in Pakistan, UTC+5)
function brExpectedDate(matingISO, gestDays) {
  var d = new Date(matingISO + 'T00:00:00');
  d.setDate(d.getDate() + gestDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderBreedingEvents() {
  var el = document.getElementById('br-event-table');
  if (!el) return;
  if (!breedingData.length) {
    el.innerHTML = '<div class="empty">No breeding events recorded.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Dam</th><th>Sire</th><th>Expected kidding</th><th>Birth registered</th><th>Notes</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  breedingData.forEach(function(b) {
    var gestDays = 150;
    var damA = anSharedAnimals.find(function(a) { return a.id === b.dam_id; });
    if (damA) {
      var sp = anSharedSpecies.find(function(s) { return s.id === damA.species_id; });
      if (sp && sp.gestation_days) gestDays = sp.gestation_days;
    }
    var expS = brExpectedDate(b.date, gestDays);
    var damName  = b.dams  ? (b.dams.name  || b.dams.farm_id)  : '—';
    var sireName = b.sires ? (b.sires.farm_id) : 'Unknown';
    // Only a birth after this mating counts as its birth
    var birthReg = birthData.find(function(bd) { return bd.dam_id === b.dam_id && bd.date >= b.date; });
    html += '<tr' + (brEditId === b.id ? ' class="ing-selected"' : '') + '>' +
      '<td class="mono">' + fmtDate(b.date) + '</td>' +
      '<td style="font-weight:500">' + damName + '</td>' +
      '<td class="muted-cell">' + sireName + '</td>' +
      '<td class="mono">' + fmtDate(expS) + '</td>' +
      '<td>' + (birthReg ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>') + '</td>' +
      '<td class="muted-cell">' + (b.notes || '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="startBreedingEdit(' + b.id + ')">Edit</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteBreedingEvent(' + b.id + ')">Delete</button>' +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function submitBreedingEvent() {
  var st = document.getElementById('br-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var damId = document.getElementById('br-dam').value;
    var date  = document.getElementById('br-date').value;
    if (!damId || !date) throw new Error('Dam and date required.');
    var sire  = document.getElementById('br-sire').value;
    var obs   = document.getElementById('br-obs').value;
    var notes = document.getElementById('br-notes').value.trim();
    // Every field is sent (null when blank) so an edit can also clear a value.
    // No sire picked = sire unknown (there's no separate "unknown" choice).
    var d = {
      dam_id: parseInt(damId), date: date,
      sire_id: sire ? parseInt(sire) : null,
      sire_unknown: !sire,
      observed_by: obs ? parseInt(obs) : null,
      notes: notes || null
    };
    if (brEditId !== null) await sbPatch('breeding_events', brEditId, d);
    else await sbInsert('breeding_events', [d]);
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    closeBrForm();
    await loadBreedingPage();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

function renderBirthHistory() {
  var el = document.getElementById('birth-event-table');
  if (!el) return;
  if (!birthData.length) {
    el.innerHTML = '<div class="empty">No birth events recorded.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Dam</th><th>Sire</th><th class="right">Litter</th>' +
    '<th class="right">Live</th><th class="right">Stillbirths</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  birthData.forEach(function(b) {
    var damName  = b.dams  ? (b.dams.name  || b.dams.farm_id)  : '\u2014';
    var sireName = b.sires ? (b.sires.farm_id) : '\u2014';
    html += '<tr>' +
      '<td class="mono">' + fmtDate(b.date) + '</td>' +
      '<td style="font-weight:500">' + damName + '</td>' +
      '<td class="muted-cell">' + sireName + '</td>' +
      '<td class="mono right">' + b.litter_size + '</td>' +
      '<td class="mono right" style="color:var(--green)">' + b.live_births + '</td>' +
      '<td class="mono right" style="color:' + (b.stillbirths > 0 ? 'var(--red)' : 'var(--faint)') + '">' + (b.stillbirths || 0) + '</td>' +
      '<td class="muted-cell">' + (b.notes || '\u2014') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ---- Birth modal ----
function openBirthModal(breedingEventId) {
  if (!anSharedLoaded) { alert('Please wait for data to load.'); return; }
  birthStep = 1; pendingBirthEvt = null;
  // Pre-populate dam if called from a breeding event shortcut
  if (breedingEventId) {
    var be = breedingData.find(function(b) { return b.id === breedingEventId; });
    if (be) {
      setTimeout(function() {
        var damSel = document.getElementById('bs1-dam');
        if (damSel) damSel.value = be.dam_id;
        if (be.sire_id) {
          var sireSel = document.getElementById('bs1-sire');
          if (sireSel) sireSel.value = be.sire_id;
        }
      }, 50);
    }
  }
  document.getElementById('birth-modal').style.display = 'flex';
  updateBirthStep();
  populateBirthForm();
}
function closeBirthModal() { document.getElementById('birth-modal').style.display = 'none'; }

function populateBirthForm() {
  var females = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'female' || a.purpose === 'breeder' || a.is_breeding);
  });
  var males = anSharedAnimals.filter(function(a) { return a.status === 'active' && a.sex === 'male'; });
  document.getElementById('bs1-dam').innerHTML =
    '<option value="">Select dam</option>' +
    females.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('bs1-sire').innerHTML =
    '<option value="">Select sire (optional)</option>' +
    males.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + '</option>'; }).join('');
  document.getElementById('bs1-worker').innerHTML =
    '<option value="">Select worker</option>' +
    anSharedWorkers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('');
  document.getElementById('bs1-date').value = todayISO();
}

function updateBirthStep() {
  ['birth-step-1','birth-step-2','birth-step-3'].forEach(function(id, i) {
    document.getElementById(id).style.display = (i + 1 === birthStep) ? 'block' : 'none';
  });
  for (var i = 1; i <= 3; i++) {
    var dot = document.getElementById('bstep-' + i);
    if (dot) dot.className = 'step-dot' + (i === birthStep ? ' active' : (i < birthStep ? ' done' : ''));
  }
  document.getElementById('birth-btn-next').textContent =
    birthStep === 2 ? 'Save & register offspring' : (birthStep === 3 ? 'Close' : 'Next');
  var cancelBtn = document.getElementById('birth-btn-cancel');
  if (cancelBtn) cancelBtn.style.display = birthStep === 3 ? 'none' : 'inline-block';
  document.getElementById('birth-status').textContent = '';
}

function updateLitterCalc() {
  var l     = parseInt(document.getElementById('bs1-litter').value) || 0;
  var live  = parseInt(document.getElementById('bs1-live').value)   || 0;
  var still = parseInt(document.getElementById('bs1-still').value)  || 0;
  var el    = document.getElementById('bs1-check');
  if (!l && !live && !still) { el.textContent = ''; return; }
  if (live + still === l) {
    el.innerHTML = '<span style="color:var(--green)">\u2713 Live + stillbirths = litter size</span>';
  } else {
    el.innerHTML = '<span style="color:var(--amber)">\u26a0 Live (' + live + ') + stillbirths (' + still + ') = ' +
                   (live + still) + ' \u2014 litter size set to ' + l + '</span>';
  }
}

async function birthNextStep() {
  var statusEl = document.getElementById('birth-status');
  statusEl.textContent = '';
  if (birthStep === 3) { closeBirthModal(); await loadBreedingPage(); return; }

  if (birthStep === 1) {
    try {
      var date   = document.getElementById('bs1-date').value;
      var damId  = document.getElementById('bs1-dam').value;
      var litter = parseInt(document.getElementById('bs1-litter').value);
      var live   = parseInt(document.getElementById('bs1-live').value);
      var still  = parseInt(document.getElementById('bs1-still').value) || 0;
      if (!date || !damId || isNaN(litter) || isNaN(live)) throw new Error('Date, dam, litter size, and live births required.');
      if (live + still !== litter) throw new Error('Live + stillbirths must equal litter size.');
      statusEl.textContent = 'Saving...';
      var d = {
        date: date, dam_id: parseInt(damId), litter_size: litter,
        live_births: live, stillbirths: still,
        sire_unknown: !document.getElementById('bs1-sire').value   // blank sire = unknown
      };
      var sire   = document.getElementById('bs1-sire').value;   if (sire)   d.sire_id     = parseInt(sire);
      var worker = document.getElementById('bs1-worker').value;  if (worker) d.recorded_by = parseInt(worker);
      var notes  = document.getElementById('bs1-notes').value.trim(); if (notes) d.notes = notes;
      var result = await sbInsert('birth_events', [d]);
      pendingBirthEvt = result[0];
      buildOffspringForms(live, d.dam_id, d.sire_id, d.sire_unknown, date);
      birthStep = 2; updateBirthStep();
    } catch(err) {
      statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
    }
  } else if (birthStep === 2) {
    try {
      statusEl.textContent = 'Creating animal records...';
      var damA = anSharedAnimals.find(function(a) { return String(a.id) === String(pendingBirthEvt.dam_id); });
      var speciesId = damA ? damA.species_id : (anSharedSpecies[0] && anSharedSpecies[0].id);
      var inserts = [];
      document.querySelectorAll('.offspring-card').forEach(function(card) {
        var fid = card.querySelector('.off-fid').value.trim();
        var sex = card.querySelector('.off-sex').value;
        var wt  = card.querySelector('.off-wt').value;
        var nm  = card.querySelector('.off-name').value.trim();
        if (!fid) return;
        var d2 = {
          farm_id: fid, species_id: speciesId, sex: sex,
          date_of_arrival: pendingBirthEvt.date, status: 'active',
          purpose: 'learning', is_breeding: false, born_on_farm: true,
          sire_unknown: pendingBirthEvt.sire_unknown
        };
        if (wt) d2.entry_weight_kg = parseFloat(wt);
        if (nm) d2.name = nm;
        if (pendingBirthEvt.dam_id)  d2.dam_id  = pendingBirthEvt.dam_id;
        if (pendingBirthEvt.sire_id) d2.sire_id = pendingBirthEvt.sire_id;
        inserts.push(d2);
      });
      var createdAnimals = inserts.length ? await sbInsert('animals', inserts) : [];
      if (createdAnimals.length && pendingBirthEvt) {
        var links = createdAnimals.map(function(a) { return { birth_event_id: pendingBirthEvt.id, animal_id: a.id }; });
        await sbInsert('birth_offspring', links);
      }
      document.getElementById('bs3-summary').textContent =
        'Birth registered \u2014 ' + createdAnimals.length + ' offspring created.';
      document.getElementById('bs3-detail').textContent =
        'Offspring assigned purpose: learning. Assign to a group via the Intake page.';
      anSharedLoaded = false; await loadSharedAnimalData();
      birthStep = 3; updateBirthStep();
    } catch(err) {
      statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
    }
  }
}

function buildOffspringForms(count, damId, sireId, sireUnk, birthDate) {
  var damA = anSharedAnimals.find(function(a) { return a.id === damId; });
  var speciesId = damA ? damA.species_id : null;
  var prefix = 'A-';
  if (speciesId) {
    var sn = getSpeciesName(speciesId);
    if      (sn === 'Goat')    prefix = 'G-';
    else if (sn === 'Chicken') prefix = 'C-';
    else if (sn === 'Duck')    prefix = 'D-';
    else if (sn === 'Sheep')   prefix = 'S-';
    else if (sn === 'Goose')   prefix = 'GS-';
    else if (sn === 'Turkey')  prefix = 'T-';
  }
  var existingNums = anSharedAnimals
    .filter(function(a) { return a.farm_id.startsWith(prefix); })
    .map(function(a) { return parseInt(a.farm_id.replace(prefix, '')); })
    .filter(function(n) { return !isNaN(n); });
  var nextNum = existingNums.length ? Math.max.apply(null, existingNums) + 1 : 1;
  var html = '';
  for (var i = 0; i < count; i++) {
    var sid = prefix + String(nextNum + i).padStart(3, '0');
    html += '<div class="offspring-card" style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
      '<h4 style="font-size:13px;font-weight:500;margin-bottom:10px">Offspring ' + (i+1) + ' of ' + count + '</h4>' +
      '<div class="hf-grid"><div class="hf-field"><label>Farm ID</label>' +
      '<input type="text" class="off-fid" value="' + sid + '"></div>' +
      '<div class="hf-field"><label>Sex</label><select class="off-sex">' +
      '<option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option>' +
      '</select></div>' +
      '<div class="hf-field"><label>Birth weight (kg)</label>' +
      '<input type="number" class="off-wt" min="0" step="0.1" placeholder="Optional"></div></div>' +
      '<div class="hf-grid" style="grid-template-columns:1fr">' +
      '<div class="hf-field"><label>Name (optional)</label>' +
      '<input type="text" class="off-name" placeholder="Optional"></div></div>' +
      '</div>';
  }
  document.getElementById('bs2-offspring-forms').innerHTML =
    html || '<div style="font-size:13px;color:var(--faint)">No live births \u2014 click Save to complete.</div>';
}

// ============================================================
// COST & SALES PAGE
// ============================================================
async function loadCostSalesPage() {
  var el = document.getElementById('costsales-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    // Medicine data for the withdrawal-period check on sales
    await loadModule('health_meds');
    await medLoadData();
    var allGroups = anSharedGroups;
    if (!csGroupId && allGroups.length) csGroupId = allGroups[0].id;
    var grpOpts = allGroups.map(function(g) {
      return '<option value="' + g.id + '"' + (g.id === csGroupId ? ' selected' : '') + '>' +
        g.name + (g.status === 'closed' ? ' (closed)' : '') + '</option>';
    }).join('');
    var html =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
      '<label style="font-size:13px;color:var(--muted)">Group</label>' +
      '<select id="cs-group-sel" onchange="onCSGroupChange()">' + grpOpts + '</select>' +
      '</div>' +
      '<div id="cs-group-body"><div class="loading">Loading group P&amp;L...</div></div>';
    document.getElementById('costsales-content').innerHTML = html;
    if (csGroupId) await renderCSGroup(csGroupId);
    renderAbbrevKey('abbrev-costsales', ['PKR', 'ADG', 'FCR']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

async function onCSGroupChange() {
  var sel = document.getElementById('cs-group-sel');
  if (!sel) return;
  csGroupId = sel.value ? parseInt(sel.value) : null;
  if (csGroupId) await renderCSGroup(csGroupId);
}

async function renderCSGroup(groupId) {
  var el = document.getElementById('cs-group-body');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var group = anSharedGroups.find(function(g) { return g.id === groupId; });

    // Fetch all group members (including departed)
    var r = await Promise.all([
      sbGet('group_members', 'group_id=eq.' + groupId + '&select=id,animal_id,joined_date,left_date,left_reason,animals(farm_id,name,purchase_cost_pkr,entry_weight_kg,status)'),
      sbGet('animal_health_events', 'group_id=eq.' + groupId + '&select=cost_pkr'),
      sbGet('animal_sales', 'group_id=eq.' + groupId + '&select=id,animal_id,date,exit_weight_kg,sale_price_pkr,buyer,notes,animals(farm_id,name)&order=date.desc'),
      sbGet('animal_mortality', 'group_id=eq.' + groupId + '&select=id,animal_id,date,probable_cause')
    ]);
    var members   = r[0];
    var healthEvs = r[1];
    var sales     = r[2];
    var mortality = r[3];

    // Also get per-animal health costs for individual animals in the group
    var memberIds = members.map(function(m) { return m.animal_id; }).filter(Boolean);
    var indivHealthCosts = [];
    if (memberIds.length) {
      indivHealthCosts = await sbGet('animal_health_events',
        'animal_id=in.(' + memberIds.join(',') + ')&select=cost_pkr');
    }

    // Purchase cost
    var purchaseCost = members.reduce(function(sum, m) {
      var c = m.animals && m.animals.purchase_cost_pkr ? parseFloat(m.animals.purchase_cost_pkr) : 0;
      return sum + c;
    }, 0);

    // Health costs
    var healthCost = 0;
    healthEvs.forEach(function(e) { if (e.cost_pkr) healthCost += parseFloat(e.cost_pkr); });
    indivHealthCosts.forEach(function(e) { if (e.cost_pkr) healthCost += parseFloat(e.cost_pkr); });

    // Sales revenue
    var saleRevenue = sales.reduce(function(sum, s) {
      return sum + (s.sale_price_pkr ? parseFloat(s.sale_price_pkr) : 0);
    }, 0);

    // Active animals (still in group)
    var activeMembers  = members.filter(function(m) { return !m.left_date; });
    var soldMembers    = members.filter(function(m) { return m.left_reason === 'sold'; });
    var deceasedMembers= members.filter(function(m) { return m.left_reason === 'deceased'; });

    // Confirmed costs (purchase + health)
    var confirmedCost = purchaseCost + healthCost;

    // Projected remaining feed cost — not calculable without feed log; show placeholder
    var targetWt = group && group.target_weight_kg ? parseFloat(group.target_weight_kg) : null;

    // P&L
    var confirmedMargin = saleRevenue - confirmedCost;

    // Render
    var costHtml = '<div class="section"><div class="section-hdr"><h2>Cost summary</h2></div><div style="padding:0">' +
      '<table class="cycle-table"><tbody>' +
      '<tr><td class="c-label">Purchase cost (all members)</td><td class="c-val mono">' + pkr(purchaseCost) + '</td>' +
      '<td class="c-note" style="font-size:11px;color:var(--faint)">' + members.length + ' animal' + (members.length!==1?'s':'') + ' total (' + activeMembers.length + ' active)</td></tr>' +
      '<tr><td class="c-label">Health costs</td><td class="c-val mono">' + pkr(healthCost) + '</td><td></td></tr>' +
      '<tr class="section-break"><td colspan="3">Feed costs</td></tr>' +
      '<tr><td class="c-label">Feed cost (actual)</td><td class="c-val mono">\u2014</td><td class="c-note" style="color:var(--amber)">Feed log not yet implemented for this group</td></tr>' +
      '<tr class="total-row"><td class="c-label"><strong>Total confirmed cost</strong></td><td class="c-val mono">' + pkr(confirmedCost) + '</td><td class="c-note">Purchase + health only</td></tr>' +
      '</tbody></table></div></div>';

    // Sales log
    var salesHtml = '<div class="section"><div class="section-hdr"><h2>Sales log</h2>' +
      '<button class="btn btn-sm btn-primary" onclick="toggleSaleForm()">+ Log sale</button></div>' +
      '<div id="sale-form-wrap" style="display:none;padding:16px 22px;background:var(--bg);border-bottom:1px solid var(--border)">' +
      '<div class="hf-grid">' +
      '<div class="hf-field"><label>Animal</label><select id="sf-animal">' +
      '<option value="">Select animal</option>' +
      members.filter(function(m){return m.animals;}).map(function(m) {
        return '<option value="' + m.animal_id + '">' + (m.animals.farm_id || m.animal_id) + (m.animals.name ? ' ('+m.animals.name+')' : '') + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="hf-field"><label>Date</label><input type="date" id="sf-date" value="' + todayISO() + '"></div>' +
      '<div class="hf-field"><label>Exit weight (kg)</label><input type="number" id="sf-wt" min="0" step="0.1" placeholder="kg"></div>' +
      '<div class="hf-field"><label>Sale price (PKR)</label><input type="number" id="sf-price" min="0" step="1" placeholder="Total sale price"></div>' +
      '<div class="hf-field"><label>Buyer</label><input type="text" id="sf-buyer" placeholder="Optional"></div>' +
      '<div class="hf-field"><label>Notes</label><input type="text" id="sf-notes" placeholder="Optional"></div>' +
      '</div><div style="display:flex;gap:10px;margin-top:8px">' +
      '<button class="btn btn-primary btn-sm" onclick="submitSale(' + groupId + ')">Save sale</button>' +
      '<button class="btn btn-sm" onclick="toggleSaleForm()">Cancel</button>' +
      '<span id="sf-status" style="font-size:13px;color:var(--muted);align-self:center"></span></div></div>';

    if (!sales.length) {
      salesHtml += '<div class="empty">No sales recorded for this group.</div>';
    } else {
      salesHtml += '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Date</th><th>Animal</th><th class="right">Exit weight</th><th class="right">Sale price</th>' +
        '<th class="right">Price/kg</th><th>Buyer</th></tr></thead><tbody>';
      sales.forEach(function(s) {
        var name = s.animals ? (s.animals.name || s.animals.farm_id) : '\u2014';
        var ppkg = (s.sale_price_pkr && s.exit_weight_kg) ? r1(s.sale_price_pkr / s.exit_weight_kg) : null;
        salesHtml += '<tr>' +
          '<td class="mono">' + fmtDate(s.date) + '</td>' +
          '<td style="font-weight:500">' + name + '</td>' +
          '<td class="mono right">' + (s.exit_weight_kg ? r1(s.exit_weight_kg) + ' kg' : '\u2014') + '</td>' +
          '<td class="mono right">' + pkr(s.sale_price_pkr) + '</td>' +
          '<td class="mono right">' + (ppkg ? 'PKR ' + ppkg.toLocaleString() + '/kg' : '\u2014') + '</td>' +
          '<td class="muted-cell">' + (s.buyer || '\u2014') + '</td>' +
          '</tr>';
      });
      salesHtml += '</tbody></table></div>';
    }
    salesHtml += '</div>';

    // P&L panel
    var plHtml = '<div class="section"><div class="section-hdr"><h2>P&amp;L</h2>' +
      (group && group.status === 'active' ? '<span class="section-meta">Group active \u2014 final P&amp;L on close</span>' : '<span class="section-meta">Group closed</span>') +
      '</div>' +
      '<table class="cycle-table"><tbody>' +
      '<tr><td class="c-label">Total confirmed cost</td><td class="c-val mono">' + pkr(confirmedCost) + '</td><td class="c-note">Purchase + health (feed costs not yet logged)</td></tr>' +
      '<tr><td class="c-label">Revenue recovered (sales)</td><td class="c-val mono">' + pkr(saleRevenue) + '</td>' +
      '<td class="c-note">' + soldMembers.length + ' animal' + (soldMembers.length!==1?'s':'') + ' sold</td></tr>' +
      '<tr><td class="c-label">Animals remaining</td><td class="c-val mono">' + activeMembers.length + '</td>' +
      '<td class="c-note">' + (targetWt ? 'Target: ' + targetWt + ' kg/head' : 'No target set') + '</td></tr>' +
      '<tr><td class="c-label">Mortality</td><td class="c-val mono">' + deceasedMembers.length + '</td><td></td></tr>' +
      '<tr class="total-row"><td class="c-label"><strong>Actual margin (to date)</strong></td>' +
      '<td class="c-val mono" style="color:' + (confirmedMargin >= 0 ? 'var(--green)' : 'var(--red)') + '">' + pkr(confirmedMargin) + '</td>' +
      '<td class="c-note">Revenue \u2212 confirmed costs</td></tr>' +
      '</tbody></table></div>';

    document.getElementById('cs-group-body').innerHTML = costHtml + salesHtml + plHtml;
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function toggleSaleForm() {
  var f = document.getElementById('sale-form-wrap');
  if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
}

async function submitSale(groupId) {
  var st = document.getElementById('sf-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var animalId = document.getElementById('sf-animal').value;
    var date     = document.getElementById('sf-date').value;
    var price    = document.getElementById('sf-price').value;
    if (!animalId) throw new Error('Select an animal.');
    if (!date)     throw new Error('Date required.');
    if (!price)    throw new Error('Sale price required.');
    // Selling inside a medicine withdrawal window needs a deliberate OK
    if (!medConfirmWithdrawal(parseInt(animalId), date, 'Record the sale')) { st.textContent = ''; return; }
    var d = {
      animal_id: parseInt(animalId),
      group_id: groupId,
      date: date,
      sale_price_pkr: parseFloat(price)
    };
    var wt    = document.getElementById('sf-wt').value;    if (wt)    d.exit_weight_kg = parseFloat(wt);
    var buyer = document.getElementById('sf-buyer').value.trim(); if (buyer) d.buyer = buyer;
    var notes = document.getElementById('sf-notes').value.trim(); if (notes) d.notes = notes;
    await sbInsert('animal_sales', [d]);
    // Update animal status to sold
    await sbPatch('animals', parseInt(animalId), { status: 'sold' });
    // Set group_members.left_date
    var memRecs = await sbGet('group_members',
      'group_id=eq.' + groupId + '&animal_id=eq.' + animalId + '&left_date=is.null&select=id&limit=1');
    if (memRecs.length) {
      await sbPatch('group_members', memRecs[0].id, { left_date: date, left_reason: 'sold' });
    }
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await renderCSGroup(groupId);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}
