// ============================================================
// health_meds.js — Medicine cabinet: registry, stock ledger,
// purchases, cabinet counts, dose suggestions and reorder alerts.
// Page: Medicines (Animals nav section)
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
var medActionType  = null;   // 'purchase' | 'count'
var medExpanded    = new Set();  // medicine ids with their history row open

// How far ahead the reorder check looks at scheduled health rounds
var MED_LOOKAHEAD_DAYS = 30;

var MED_REASON_LABELS = {
  expired: 'Expired / discarded', spilled: 'Spilled / broken',
  unlogged_use: 'Used but not logged', correction: 'Count correction', other: 'Other'
};
var MED_TYPE_BADGE = { purchase: 'badge-green', dose: 'badge-blue', adjustment: 'badge-amber' };

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
      'health_event_id,animal_id,reason,notes,created_at&order=date.desc,id.desc')
  ]);
  medList = r[0];
  medMovements = r[1];
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
  if ((unit === 'tablet' || unit === 'dose') && Math.abs(n) !== 1) unit += 's';
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

// Human-readable label dose, e.g. "1 ml per 10 kg" or "2 ml per animal"
function medFmtDoseRate(med) {
  if (!med.dose_basis) return '—';
  if (med.dose_basis === 'per_head') return medFmtUnits(med, med.dose_amount) + ' per animal';
  return medFmtUnits(med, med.dose_amount) + ' per ' + Number(med.dose_weight_kg) + ' kg';
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
function medSuggestDose(med, animalId) {
  if (!med || !med.dose_basis) return null;
  if (med.dose_basis === 'per_head') return Number(med.dose_amount);
  var kg = medAnimalWeight(animalId);
  if (kg == null) return null;
  var raw = Number(med.dose_amount) * kg / Number(med.dose_weight_kg);
  return Math.max(0.5, Math.round(raw * 2) / 2);
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
    var need = 0, unweighed = 0;
    animals.forEach(function(a) {
      var d = medSuggestDose(med, a.id);
      if (d == null) unweighed++; else need += d;
    });
    if (!needs[med.id]) needs[med.id] = { total: 0, rounds: [] };
    needs[med.id].total += need;
    needs[med.id].rounds.push({ sched: s, need: need, animals: animals.length, unweighed: unweighed });
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
          ' &middot; due ' + fmtDate(rd.sched.next_due_date) + ' &middot; needs ~' + medFmtUnits(med, rd.need) +
          ' for ' + rd.animals + ' animal' + (rd.animals !== 1 ? 's' : '') +
          (rd.unweighed ? ' <span style="color:var(--amber)">(' + rd.unweighed + ' never weighed, not counted)</span>' : '') +
          '</div>';
      });
    }
    html += '</div>';
  });
  return html;
}

// ============================================================
// MEDICINES PAGE
// ============================================================
async function loadMedicinesPage() {
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

// Lays out the page shell once per render: alerts, add/edit form, purchase/count form, table
function renderMedicinesPage() {
  var alerts = medComputeAlerts(medPageScheds);
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
      '<div class="section-hdr"><h2>Medicine cabinet</h2>' +
      '<button class="btn btn-sm btn-primary" onclick="openMedForm(null)">+ Add medicine</button></div>' +
      '<div id="med-form-wrap"></div>' +
      '<div id="med-action-wrap"></div>' +
      '<div id="med-table"></div>' +
    '</div>';
  document.getElementById('med-content').innerHTML = html;
  if (medEditId !== null || medFormOpen) renderMedForm();
  if (medActionId !== null) renderMedActionForm();
  renderMedTable();
}

// ---- Medicines table: active grouped by active ingredient, retired at the bottom ----
function renderMedTable() {
  var tbl = document.getElementById('med-table');
  if (!medList.length) {
    tbl.innerHTML = '<div class="empty">No medicines yet. Use + Add medicine to stock the cabinet.</div>';
    return;
  }
  var rows = medList.slice().sort(function(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    var ai = (a.active_ingredient || '￿').toLowerCase(), bi = (b.active_ingredient || '￿').toLowerCase();
    if (ai !== bi) return ai < bi ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var colCount = 8;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Medicine</th><th>Used for</th><th>Pack</th><th>Label dose</th>' +
    '<th class="right">In stock</th><th class="right">Cost / unit</th><th>Latest expiry</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var lastGroup = null, retiredHeader = false;
  rows.forEach(function(m) {
    // Section separators: one per active ingredient, then a single "Retired" block
    if (!m.active && !retiredHeader) {
      html += '<tr><td colspan="' + colCount + '" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">Retired medicines</td></tr>';
      retiredHeader = true;
    } else if (m.active) {
      var grp = m.active_ingredient || 'No active ingredient recorded';
      if (grp.toLowerCase() !== (lastGroup || '').toLowerCase()) {
        lastGroup = grp;
        html += '<tr style="background:var(--bg)"><td colspan="' + colCount + '" style="' +
          'padding:6px 16px;font-size:11px;font-weight:600;color:var(--muted);' +
          'text-transform:uppercase;letter-spacing:0.06em;border-top:2px solid var(--border)">' +
          medEsc(grp) + '</td></tr>';
      }
    }

    var stock = medStock(m.id);
    var low = m.active && m.min_stock != null && stock < Number(m.min_stock);
    var cpu = medCostPerUnit(m.id);
    var expiry = medLatestExpiry(m.id);
    var hasMoves = medMovements.some(function(mv) { return mv.medicine_id === m.id; });

    html += '<tr' + (!m.active ? ' style="opacity:0.5"' : '') + '>' +
      '<td style="font-weight:500">' + medEsc(m.name) +
        '<div style="font-size:11px;color:var(--muted);font-weight:400">' + medEsc(m.form) + '</div></td>' +
      '<td class="muted-cell">' + (m.purpose ? medEsc(m.purpose) : '—') + '</td>' +
      '<td class="muted-cell">' + medFmtUnits(m, Number(m.pack_size)) + ' / ' + medEsc(m.pack_label) + '</td>' +
      '<td class="muted-cell">' + medFmtDoseRate(m) + '</td>' +
      '<td class="mono right"' + (low ? ' style="color:var(--red);font-weight:500"' : '') + '>' +
        medFmtStock(m, stock) +
        (m.min_stock != null ? '<div style="font-size:11px;color:var(--muted);font-weight:400">min ' + medFmtUnits(m, Number(m.min_stock)) + '</div>' : '') +
      '</td>' +
      '<td class="mono right">' + (cpu != null ? 'PKR ' + r2(cpu).toLocaleString() : '—') + '</td>' +
      '<td class="muted-cell">' + (expiry ? fmtDate(expiry) : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        (m.active
          ? '<button class="btn btn-sm btn-primary" onclick="openMedAction(' + m.id + ',\'purchase\')">Buy</button> ' +
            '<button class="btn btn-sm" onclick="openMedAction(' + m.id + ',\'count\')">Count</button> '
          : '') +
        '<button class="btn btn-sm" onclick="toggleMedHistory(' + m.id + ')">' + (medExpanded.has(m.id) ? 'Hide' : 'History') + '</button> ' +
        '<button class="btn btn-sm" onclick="openMedForm(' + m.id + ')">Edit</button> ' +
        (m.active
          ? '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',false)">Retire</button>'
          : '<button class="btn btn-sm" onclick="setMedActive(' + m.id + ',true)">Reactivate</button>') +
        // Delete only while the medicine has no ledger history; after that, retire it instead
        (!hasMoves ? ' <button class="btn btn-sm btn-danger" onclick="deleteMedicine(' + m.id + ')">Delete</button>' : '') +
      '</td></tr>';

    if (medExpanded.has(m.id)) {
      html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' +
        renderMedHistory(m) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ---- Per-medicine ledger history (expandable row) ----
function toggleMedHistory(id) {
  if (medExpanded.has(id)) medExpanded.delete(id); else medExpanded.add(id);
  renderMedTable();
}

function renderMedHistory(med) {
  var moves = medMovements.filter(function(mv) { return mv.medicine_id === med.id; });
  if (!moves.length) return '<div class="empty" style="padding:14px 22px">No purchases, doses or counts yet.</div>';
  var html = '<div style="padding:8px 22px 14px"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th class="right">Quantity</th><th class="right">Cost</th><th>Detail</th><th></th>' +
    '</tr></thead><tbody>';
  moves.forEach(function(mv) {
    var qty = Number(mv.quantity);
    var detail = [];
    if (mv.movement_type === 'purchase') {
      if (mv.packs != null) detail.push(Number(mv.packs) + ' ' + med.pack_label + (Number(mv.packs) !== 1 ? 's' : ''));
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
    renderMedicinesPage();
  } catch(err) { alert('Error: ' + err.message); }
}

// ============================================================
// ADD / EDIT MEDICINE FORM
// ============================================================
var medFormOpen = false;

function openMedForm(id) {
  medEditId = id;
  medFormOpen = true;
  renderMedForm();
  document.getElementById('med-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMedForm() {
  medEditId = null;
  medFormOpen = false;
  document.getElementById('med-form-wrap').innerHTML = '';
}

function renderMedForm() {
  var m = medEditId !== null ? medById(medEditId) : null;
  var v = function(k, d) { return m && m[k] != null ? medEsc(m[k]) : (d || ''); };
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + label + '</option>'; };

  // Suggest active ingredients and pack labels already in use, so spellings stay consistent
  var ingredients = [], packLabels = ['vial', 'bottle', 'box', 'strip', 'sachet'];
  medList.forEach(function(x) {
    if (x.active_ingredient && ingredients.indexOf(x.active_ingredient) < 0) ingredients.push(x.active_ingredient);
    if (x.pack_label && packLabels.indexOf(x.pack_label) < 0) packLabels.push(x.pack_label);
  });

  var form  = m ? m.form : 'liquid';
  var unit  = m ? m.stock_unit : 'ml';
  var basis = m ? (m.dose_basis || '') : '';

  document.getElementById('med-form-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + (m ? 'Edit ' + medEsc(m.name) : 'New medicine') + '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Name (brand) *</label><input type="text" id="mf-name" value="' + v('name') + '" placeholder="e.g. Ivomec 1%"></div>' +
        '<div class="hf-field"><label>Active ingredient</label><input type="text" id="mf-ingredient" list="mf-ingredient-list" value="' + v('active_ingredient') + '" placeholder="e.g. Ivermectin">' +
          '<datalist id="mf-ingredient-list">' + ingredients.map(function(i) { return '<option value="' + medEsc(i) + '">'; }).join('') + '</datalist></div>' +
        '<div class="hf-field"><label>Form</label><select id="mf-form">' +
          opt('liquid', 'Liquid', form) + opt('tablet', 'Tablet', form) + opt('powder', 'Powder', form) + opt('other', 'Other', form) +
        '</select></div>' +
      '</div>' +
      '<div class="hf-grid" style="grid-template-columns:1fr">' +
        '<div class="hf-field"><label>Used for</label><input type="text" id="mf-purpose" value="' + v('purpose') + '" placeholder="e.g. Dewormer — roundworm, lungworm, mites"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Stock unit</label><select id="mf-unit" onchange="updateMedFormUnits()">' +
          opt('ml', 'ml', unit) + opt('tablet', 'tablet', unit) + opt('g', 'g', unit) + opt('dose', 'dose', unit) +
        '</select></div>' +
        '<div class="hf-field"><label>Pack type</label><input type="text" id="mf-pack-label" list="mf-pack-list" value="' + v('pack_label', 'vial') + '">' +
          '<datalist id="mf-pack-list">' + packLabels.map(function(p) { return '<option value="' + medEsc(p) + '">'; }).join('') + '</datalist></div>' +
        '<div class="hf-field"><label>Amount per pack (<span class="mf-unit-lbl">' + unit + '</span>) *</label><input type="number" id="mf-pack-size" min="0" step="any" value="' + v('pack_size') + '" placeholder="e.g. 50"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Label dose</label><select id="mf-basis" onchange="updateMedFormUnits()">' +
          opt('', 'Not set', basis) + opt('per_kg', 'By body weight', basis) + opt('per_head', 'Fixed per animal', basis) +
        '</select></div>' +
        '<div class="hf-field" id="mf-amount-wrap"><label>Dose (<span class="mf-unit-lbl">' + unit + '</span>)</label><input type="number" id="mf-amount" min="0" step="any" value="' + v('dose_amount') + '" placeholder="e.g. 1"></div>' +
        '<div class="hf-field" id="mf-weight-wrap"><label>Per kg of body weight</label><input type="number" id="mf-weight" min="0" step="any" value="' + v('dose_weight_kg') + '" placeholder="e.g. 50"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        '<div class="hf-field"><label>Minimum stock to keep (<span class="mf-unit-lbl">' + unit + '</span>)</label><input type="number" id="mf-min" min="0" step="any" value="' + v('min_stock') + '" placeholder="Optional — reminder below this"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="mf-notes" value="' + v('notes') + '" placeholder="Optional — storage, withdrawal period, etc."></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitMedicine()">' + (m ? 'Save changes' : 'Add medicine') + '</button>' +
        '<button class="btn" onclick="closeMedForm()">Cancel</button>' +
        '<span id="mf-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
  updateMedFormUnits();
}

// Keeps unit labels and dose fields in step with the unit / dose-basis selects
function updateMedFormUnits() {
  var unit = document.getElementById('mf-unit').value;
  document.querySelectorAll('.mf-unit-lbl').forEach(function(el) { el.textContent = unit; });
  var basis = document.getElementById('mf-basis').value;
  document.getElementById('mf-amount-wrap').style.visibility = basis ? 'visible' : 'hidden';
  document.getElementById('mf-weight-wrap').style.visibility = basis === 'per_kg' ? 'visible' : 'hidden';
}

async function submitMedicine() {
  var statusEl = document.getElementById('mf-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var num = function(id) { var x = document.getElementById(id).value; return x === '' ? null : parseFloat(x); };
    var txt = function(id) { var x = document.getElementById(id).value.trim(); return x || null; };
    var basis = document.getElementById('mf-basis').value || null;
    var d = {
      name:              txt('mf-name'),
      active_ingredient: txt('mf-ingredient'),
      purpose:           txt('mf-purpose'),
      form:              document.getElementById('mf-form').value,
      stock_unit:        document.getElementById('mf-unit').value,
      pack_label:        txt('mf-pack-label') || 'pack',
      pack_size:         num('mf-pack-size'),
      dose_basis:        basis,
      dose_amount:       basis ? num('mf-amount') : null,
      dose_weight_kg:    basis === 'per_kg' ? num('mf-weight') : null,
      min_stock:         num('mf-min'),
      notes:             txt('mf-notes')
    };
    if (!d.name) throw new Error('Name is required.');
    if (!(d.pack_size > 0)) throw new Error('Amount per pack must be greater than 0.');
    if (basis && !(d.dose_amount > 0)) throw new Error('Enter the label dose amount, or set Label dose to "Not set".');
    if (basis === 'per_kg' && !(d.dose_weight_kg > 0)) throw new Error('Enter how many kg of body weight the dose covers.');

    if (medEditId !== null) await sbPatch('medicines', medEditId, d);
    else await sbInsert('medicines', [d]);
    closeMedForm();
    await medLoadData();
    renderMedicinesPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function setMedActive(id, active) {
  try {
    await sbPatch('medicines', id, { active: active });
    await medLoadData();
    renderMedicinesPage();
  } catch(err) { alert('Error: ' + err.message); }
}

async function deleteMedicine(id) {
  var m = medById(id);
  if (!confirm('Delete ' + (m ? m.name : 'this medicine') + '? This cannot be undone.')) return;
  try {
    await sbDelete('medicines', id);
    await medLoadData();
    renderMedicinesPage();
  } catch(err) {
    // Most likely a schedule or health event still points at it
    alert('Could not delete — it is probably linked to a schedule or health event. Retire it instead.\n\n' + err.message);
  }
}

// ============================================================
// PURCHASE AND CABINET-COUNT FORMS
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
  document.getElementById('med-action-wrap').innerHTML = '';
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
        '<div class="hf-field"><label>Total cost (PKR)</label><input type="number" id="ma-cost" min="0" step="1" placeholder="For dose costing" oninput="updateMedActionHint()"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        '<div class="hf-field"><label>Expiry date</label><input type="date" id="ma-expiry"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="ma-notes" placeholder="Optional — supplier, batch"></div>' +
      '</div>';
  } else {
    body =
      '<div style="font-weight:500;margin-bottom:12px">Cabinet count &mdash; ' + medEsc(m.name) +
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
  document.getElementById('med-action-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' + body +
      '<div id="ma-hint" class="fc-derived" style="display:none;margin:4px 0 12px"></div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitMedAction()">' + (medActionType === 'purchase' ? 'Save purchase' : 'Save count') + '</button>' +
        '<button class="btn" onclick="closeMedAction()">Cancel</button>' +
        '<span id="ma-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
}

// Live summary under the form: units added / cost per unit, or count difference
function updateMedActionHint() {
  var m = medById(medActionId);
  var hint = document.getElementById('ma-hint');
  if (!m || !hint) return;
  var text = '';
  if (medActionType === 'purchase') {
    var packs = parseFloat(document.getElementById('ma-packs').value);
    var cost  = parseFloat(document.getElementById('ma-cost').value);
    if (packs > 0) {
      var units = packs * m.pack_size;
      text = 'Adds ' + medFmtUnits(m, units);
      if (cost >= 0) text += ' &middot; PKR ' + r2(cost / units).toLocaleString() + ' per ' + m.stock_unit;
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
      var costRaw = document.getElementById('ma-cost').value;
      row = {
        medicine_id: m.id, date: date, movement_type: 'purchase',
        quantity: packs * m.pack_size, packs: packs,
        cost_pkr: costRaw === '' ? null : parseFloat(costRaw),
        expiry_date: document.getElementById('ma-expiry').value || null,
        notes: notes
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
    renderMedicinesPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
