// ============================================================
// pesticides.js — Pesticides & sprays: registry, stock ledger, spray log,
// and the pre-harvest waiting check.
// Pages: Setup › Pesticides & Sprays     (the list: add / edit / retire)
//        Inventory › Pesticides & Sprays (stock, buy, count, history)
//        Land › Spraying                 (log sprays per plot, per-plot summary)
// Also loaded on demand by land.js (harvest warning) and overview.js
// (plot-card spray status and the "Supplies to buy" banner).
// Depends on: shared.js (sbGet/sbInsert/sbPatch/sbDelete, fmtDate, pkr, r2, todayISO)
//
// Stock model: pesticide_movements is a ledger, like the medicine cabinet.
// Purchases add, sprays ('application' rows, tied to a plot) subtract, and
// stock counts store the difference as an 'adjustment'.
// Stock = sum of a product's movement quantities, in its stock_unit.
//
// Waiting period: each product has pre_harvest_days. A plot sprayed on day D
// is not safe to harvest until D + pre_harvest_days. Sprays are logged per plot,
// so every crop on that plot is treated as sprayed (the cautious reading).
// ============================================================

// ---- Module state ----
var pestList      = [];    // all products (active + retired)
var pestMoves     = [];    // all ledger rows, newest first
var pestPlots     = [];    // field_plots, for plot names and the spray form
var pestWorkers   = [];    // active workers, for the spray form
var pestEditId    = null;  // product being edited in the Setup form (null = adding)
var pestFormOpen  = false;
var pestActionId  = null;  // product the Buy / Count form is open for
var pestActionType = null; // 'purchase' | 'count'
var pestExpanded  = new Set();  // product ids with their history row open (Inventory)
var spFormOpen    = false; // spray log form open (Land › Spraying)
var spEditId      = null;  // spray (movement id) being edited
var spPlotFilter  = '';    // plot filter on the spray log

// How far back the plot spray counts look (agreed: last 12 months)
var PEST_COUNT_MONTHS = 12;

var PEST_TYPE_LABELS = { insecticide: 'Insecticide', herbicide: 'Herbicide', fungicide: 'Fungicide', other: 'Other' };
var PEST_TYPE_BADGE  = { insecticide: 'badge-amber', herbicide: 'badge-brown', fungicide: 'badge-blue', other: 'badge-gray' };
var PEST_MOVE_BADGE  = { purchase: 'badge-green', application: 'badge-blue', adjustment: 'badge-amber' };
var PEST_MOVE_LABEL  = { purchase: 'purchase', application: 'spray', adjustment: 'count' };
var PEST_UNITS = ['ml', 'L', 'g', 'kg'];
var PEST_REASON_LABELS = {
  expired: 'Expired / discarded', spilled: 'Spilled / leaked',
  unlogged_use: 'Used but not logged', correction: 'Count correction', other: 'Other'
};

function pestEsc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// SHARED HELPERS (also used by land.js and overview.js)
// ============================================================

// Fetches the registry, the full ledger and plot names. Small tables, one fetch each.
async function pestLoadData() {
  var r = await Promise.all([
    sbGet('pesticides', 'select=*&order=name'),
    sbGet('pesticide_movements',
      'select=id,pesticide_id,date,movement_type,quantity,packs,pack_size,cost_pkr,field_plot_id,' +
      'water_litres,target,worker_id,reason,notes,created_at&order=date.desc,id.desc'),
    sbGet('field_plots', 'select=id,plot_code,plot_name,status&order=plot_code')
  ]);
  pestList  = r[0];
  pestMoves = r[1];
  pestPlots = r[2];
}

function pestById(id) {
  return pestList.find(function(p) { return p.id === id; }) || null;
}

function pestPlotName(plotId) {
  var p = pestPlots.find(function(x) { return x.id === plotId; });
  if (!p) return '—';
  return (p.plot_code || '') + (p.plot_name ? (p.plot_code ? ' · ' : '') + p.plot_name : '') || ('Plot ' + p.id);
}

function pestWorkerName(id) {
  var list = pestWorkers.length ? pestWorkers : (typeof anSharedWorkers !== 'undefined' ? anSharedWorkers : []);
  var w = list.find(function(x) { return x.id === id; });
  return w ? w.name : '—';
}

// Current stock in stock units = sum of the ledger
function pestStock(pestId) {
  return pestMoves.reduce(function(sum, mv) {
    return mv.pesticide_id === pestId ? sum + Number(mv.quantity) : sum;
  }, 0);
}

// Cost of one stock unit, from the most recent priced purchase (ledger is newest first)
function pestCostPerUnit(pestId) {
  var p = pestMoves.find(function(mv) {
    return mv.pesticide_id === pestId && mv.movement_type === 'purchase' &&
           mv.cost_pkr != null && Number(mv.quantity) > 0;
  });
  return p ? Number(p.cost_pkr) / Number(p.quantity) : null;
}

// "250 ml", "1.5 kg"
function pestFmtUnits(p, qty) {
  var n = Math.round(qty * 100) / 100;
  return n.toLocaleString() + ' ' + p.stock_unit;
}

// Whole packs plus loose units, e.g. "2 bottles + 250 ml"
function pestFmtStock(p, qty) {
  if (qty <= 0) return pestFmtUnits(p, qty);
  var packs = Math.floor(qty / p.pack_size + 1e-9);
  var rest  = Math.round((qty - packs * p.pack_size) * 100) / 100;
  var parts = [];
  if (packs) parts.push(packs + ' ' + p.pack_label + (packs !== 1 ? 's' : ''));
  if (rest > 0 || !packs) parts.push(pestFmtUnits(p, rest));
  return parts.join(' + ');
}

// Adds days to a YYYY-MM-DD date using local dates. (toISOString() would
// convert to UTC and land a day early in Pakistan, UTC+5.)
function pestAddDays(iso, days) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// First date a spray's waiting period is over (null if the product has no waiting period)
function pestSafeFrom(mv) {
  var p = pestById(mv.pesticide_id);
  if (!p || !p.pre_harvest_days) return null;
  return pestAddDays(mv.date, p.pre_harvest_days);
}

// The waiting period still running on a plot on a given date, or null.
// When several sprays overlap, the one that ends last wins.
// Returns { spray, pesticide, safeFrom }.
function pestPlotWindow(plotId, asOfISO) {
  var asOf = asOfISO || todayISO();
  var best = null;
  pestMoves.forEach(function(mv) {
    if (mv.movement_type !== 'application' || mv.field_plot_id !== plotId) return;
    if (mv.date > asOf) return;                       // a spray after the harvest date doesn't count
    var safe = pestSafeFrom(mv);
    if (!safe || safe <= asOf) return;                // waiting period already over
    if (!best || safe > best.safeFrom) best = { spray: mv, pesticide: pestById(mv.pesticide_id), safeFrom: safe };
  });
  return best;
}

// Number of sprays on a plot in the last PEST_COUNT_MONTHS months, split by
// organic / biological vs synthetic. Each logged spray counts once.
function pestPlotCounts(plotId) {
  var since = new Date(); since.setMonth(since.getMonth() - PEST_COUNT_MONTHS);
  var sinceISO = since.getFullYear() + '-' + String(since.getMonth() + 1).padStart(2, '0') + '-' + String(since.getDate()).padStart(2, '0');
  var out = { synthetic: 0, organic: 0, last: null };
  pestMoves.forEach(function(mv) {
    if (mv.movement_type !== 'application' || mv.field_plot_id !== plotId) return;
    if (!out.last) out.last = mv;                     // ledger is newest first
    if (mv.date < sinceISO) return;
    var p = pestById(mv.pesticide_id);
    if (p && p.organic) out.organic++; else out.synthetic++;
  });
  return out;
}

// Short "2 synthetic · 5 organic" text for the counts above
function pestCountsText(c) {
  if (!c.synthetic && !c.organic) return 'None';
  var parts = [];
  if (c.synthetic) parts.push(c.synthetic + ' synthetic');
  if (c.organic) parts.push(c.organic + ' organic');
  return parts.join(' · ');
}

// Warn-and-confirm before logging a harvest from a plot still inside a
// waiting period (same pattern as the meat withdrawal check). Returns true to go ahead.
function pestConfirmHarvest(plotId, dateISO) {
  var w = pestPlotWindow(plotId, dateISO);
  if (!w) return true;
  return confirm(
    'This plot was sprayed with ' + (w.pesticide ? w.pesticide.name : 'a pesticide') +
    ' on ' + fmtDate(w.spray.date) + '.\n' +
    'Its pre-harvest waiting period runs until ' + fmtDate(w.safeFrom) + '.\n\n' +
    'Harvesting before then risks residue in feed or food. Log this harvest anyway?'
  );
}

// Products below their minimum stock — for the Inventory page and the Overview banner
function pestLowStock() {
  return pestList.filter(function(p) {
    return p.active && p.min_stock != null && pestStock(p.id) < Number(p.min_stock);
  }).sort(function(a, b) { return a.name.localeCompare(b.name); });
}

// Same card style as the medicine reorder alerts
function pestAlertsHtml(list) {
  return list.map(function(p) {
    return '<div class="due-card soon">' +
      '<div class="due-card-top"><span class="due-card-title">' + pestEsc(p.name) +
        (p.active_ingredient ? ' <span style="font-weight:400;color:var(--muted)">(' + pestEsc(p.active_ingredient) + ')</span>' : '') +
      '</span><span class="due-card-days soon">Below minimum</span></div>' +
      '<div class="due-card-meta">In stock: ' + pestFmtStock(p, pestStock(p.id)) +
        ' &middot; minimum ' + pestFmtUnits(p, Number(p.min_stock)) + '</div>' +
    '</div>';
  }).join('');
}

// Type and organic/synthetic badges shown next to a product's name
function pestBadges(p) {
  return '<span class="badge ' + (PEST_TYPE_BADGE[p.pest_type] || 'badge-gray') + '" style="font-size:10px">' +
      (PEST_TYPE_LABELS[p.pest_type] || p.pest_type) + '</span> ' +
    (p.organic
      ? '<span class="badge badge-lime" style="font-size:10px">organic</span>'
      : '<span class="badge badge-gray" style="font-size:10px">synthetic</span>');
}

// ============================================================
// SETUP › PESTICIDES & SPRAYS (the list)
// ============================================================
async function loadPestSetupPage() {
  var el = document.getElementById('pestsetup-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await pestLoadData();
    renderPestSetupPage();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderPestSetupPage() {
  document.getElementById('pestsetup-content').innerHTML =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Pesticides, herbicides and fungicides</h2>' +
        '<button class="btn btn-sm btn-primary" onclick="openPestForm(null)">+ Add product</button></div>' +
      '<div id="ps-form-wrap"></div>' +
      '<div id="ps-table"></div>' +
    '</div>';
  if (pestFormOpen) renderPestForm();
  renderPestSetupTable();
}

function renderPestSetupTable() {
  var tbl = document.getElementById('ps-table');
  if (!pestList.length) {
    tbl.innerHTML = '<div class="empty">No products yet. Use + Add product to start the list.</div>';
    return;
  }
  // Active first, then by name; retired ones get a separator row
  var rows = pestList.slice().sort(function(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var colCount = 7;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Product</th><th>Active ingredient</th><th>Used for</th><th>Pack</th>' +
    '<th class="right">Pre-harvest wait</th><th class="right">Minimum stock</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var retiredHdr = false;
  rows.forEach(function(p) {
    if (!p.active && !retiredHdr) {
      html += '<tr><td colspan="' + colCount + '" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">Retired products</td></tr>';
      retiredHdr = true;
    }
    // Delete only while nothing has been bought/sprayed/counted; after that, retire it
    var hasMoves = pestMoves.some(function(mv) { return mv.pesticide_id === p.id; });
    html += '<tr' + (!p.active ? ' style="opacity:0.5"' : '') + '>' +
      '<td style="font-weight:500">' + pestEsc(p.name) + '<div style="margin-top:2px">' + pestBadges(p) + '</div></td>' +
      '<td class="muted-cell">' + (p.active_ingredient ? pestEsc(p.active_ingredient) : '—') + '</td>' +
      '<td class="muted-cell">' + (p.purpose ? pestEsc(p.purpose) : '—') + '</td>' +
      '<td class="muted-cell">' + pestFmtUnits(p, Number(p.pack_size)) + ' / ' + pestEsc(p.pack_label) + '</td>' +
      '<td class="mono right">' + (p.pre_harvest_days != null ? p.pre_harvest_days + ' d' : '—') + '</td>' +
      '<td class="mono right">' + (p.min_stock != null ? pestFmtUnits(p, Number(p.min_stock)) : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="openPestForm(' + p.id + ')">Edit</button> ' +
        (p.active
          ? '<button class="btn btn-sm" onclick="setPestActive(' + p.id + ',false)">Retire</button>'
          : '<button class="btn btn-sm" onclick="setPestActive(' + p.id + ',true)">Reactivate</button>') +
        (!hasMoves ? ' <button class="btn btn-sm btn-danger" onclick="deletePesticide(' + p.id + ')">Delete</button>' : '') +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function openPestForm(id) {
  pestEditId = id;
  pestFormOpen = true;
  renderPestForm();
  document.getElementById('ps-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePestForm() {
  pestEditId = null;
  pestFormOpen = false;
  var wrap = document.getElementById('ps-form-wrap');
  if (wrap) wrap.innerHTML = '';
}

function renderPestForm() {
  var p = pestEditId !== null ? pestById(pestEditId) : null;
  var v = function(k, d) { return p && p[k] != null ? pestEsc(p[k]) : (d || ''); };
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + label + '</option>'; };
  var type = p ? p.pest_type : 'insecticide';
  var unit = p ? p.stock_unit : 'ml';

  // Suggest active ingredients and pack labels already in use, so spellings stay consistent
  var ingredients = [], packLabels = ['bottle', 'can', 'sachet', 'bag', 'jar'];
  pestList.forEach(function(x) {
    if (x.active_ingredient && ingredients.indexOf(x.active_ingredient) < 0) ingredients.push(x.active_ingredient);
    if (x.pack_label && packLabels.indexOf(x.pack_label) < 0) packLabels.push(x.pack_label);
  });

  document.getElementById('ps-form-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + (p ? 'Edit ' + pestEsc(p.name) : 'New product') + '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Name (brand) *</label><input type="text" id="pf-name" value="' + v('name') + '" placeholder="e.g. Neem oil, Confidor"></div>' +
        '<div class="hf-field"><label>Type</label><select id="pf-type">' +
          Object.keys(PEST_TYPE_LABELS).map(function(k) { return opt(k, PEST_TYPE_LABELS[k], type); }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Active ingredient</label><input type="text" id="pf-ingredient" list="pf-ingredient-list" value="' + v('active_ingredient') + '" placeholder="e.g. Imidacloprid, azadirachtin">' +
          '<datalist id="pf-ingredient-list">' + ingredients.map(function(i) { return '<option value="' + pestEsc(i) + '">'; }).join('') + '</datalist></div>' +
      '</div>' +
      '<div class="hf-grid" style="grid-template-columns:1fr">' +
        '<div class="hf-field"><label>Used for</label><input type="text" id="pf-purpose" value="' + v('purpose') + '" placeholder="e.g. Aphids, whitefly on fodder"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Stock unit</label><select id="pf-unit" onchange="updatePestFormUnits()">' +
          PEST_UNITS.map(function(u) { return opt(u, u, unit); }).join('') + '</select></div>' +
        '<div class="hf-field"><label>Pack type</label><input type="text" id="pf-pack-label" list="pf-pack-list" value="' + v('pack_label', 'bottle') + '">' +
          '<datalist id="pf-pack-list">' + packLabels.map(function(l) { return '<option value="' + pestEsc(l) + '">'; }).join('') + '</datalist></div>' +
        '<div class="hf-field"><label>Amount per pack (<span class="pf-unit-lbl">' + unit + '</span>) *</label><input type="number" id="pf-pack-size" min="0" step="any" value="' + v('pack_size') + '" placeholder="e.g. 500"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Pre-harvest wait (days)</label><input type="number" id="pf-phi" min="0" step="1" value="' + v('pre_harvest_days') + '" placeholder="From the label — 0 if none"></div>' +
        '<div class="hf-field"><label>Minimum stock (<span class="pf-unit-lbl">' + unit + '</span>)</label><input type="number" id="pf-min" min="0" step="any" value="' + v('min_stock') + '" placeholder="Optional — reminder below this"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="pf-notes" value="' + v('notes') + '" placeholder="Optional — mixing rate, cautions"></div>' +
      '</div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:2px 0 10px">' +
        '<input type="checkbox" id="pf-organic"' + (p && p.organic ? ' checked' : '') + '> ' +
        'Organic / biological (e.g. neem, Bt) — counted separately from synthetic sprays</label>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitPesticide()">' + (p ? 'Save changes' : 'Add product') + '</button>' +
        '<button class="btn" onclick="closePestForm()">Cancel</button>' +
        '<span id="pf-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
}

function updatePestFormUnits() {
  var unit = document.getElementById('pf-unit').value;
  document.querySelectorAll('.pf-unit-lbl').forEach(function(el) { el.textContent = unit; });
}

async function submitPesticide() {
  var statusEl = document.getElementById('pf-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var el  = function(id) { return document.getElementById(id); };
    var num = function(id) { return el(id).value === '' ? null : parseFloat(el(id).value); };
    var txt = function(id) { return el(id).value.trim() || null; };
    var d = {
      name:              txt('pf-name'),
      pest_type:         el('pf-type').value,
      active_ingredient: txt('pf-ingredient'),
      organic:           el('pf-organic').checked,
      purpose:           txt('pf-purpose'),
      stock_unit:        el('pf-unit').value,
      pack_label:        txt('pf-pack-label') || 'pack',
      pack_size:         num('pf-pack-size'),
      pre_harvest_days:  num('pf-phi') != null ? Math.round(num('pf-phi')) : null,
      min_stock:         num('pf-min'),
      notes:             txt('pf-notes')
    };
    if (!d.name) throw new Error('Name is required.');
    if (!(d.pack_size > 0)) throw new Error('Amount per pack must be greater than 0.');
    if (d.pre_harvest_days != null && d.pre_harvest_days < 0) throw new Error('Pre-harvest wait can\'t be negative.');

    if (pestEditId !== null) await sbPatch('pesticides', pestEditId, d);
    else await sbInsert('pesticides', [d]);
    closePestForm();
    await pestLoadData();
    renderPestSetupPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function setPestActive(id, active) {
  try {
    await sbPatch('pesticides', id, { active: active });
    await pestLoadData();
    renderPestSetupPage();
  } catch(err) { alert('Error: ' + err.message); }
}

async function deletePesticide(id) {
  var p = pestById(id);
  if (!confirm('Delete ' + (p ? p.name : 'this product') + '? This cannot be undone.')) return;
  try {
    await sbDelete('pesticides', id);
    await pestLoadData();
    renderPestSetupPage();
  } catch(err) {
    alert('Could not delete — it already has purchases or sprays logged. Retire it instead.\n\n' + err.message);
  }
}

// ============================================================
// INVENTORY › PESTICIDES & SPRAYS (stock, buy, count, history)
// ============================================================
async function loadPestInventoryPage() {
  var el = document.getElementById('pestinv-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await pestLoadData();
    renderPestInventoryPage();
    document.getElementById('pestinv-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderPestInventoryPage() {
  var low = pestLowStock();
  document.getElementById('pestinv-content').innerHTML =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Needs attention</h2>' +
        '<span class="section-meta">' + low.length + ' below minimum stock</span></div>' +
      '<div style="padding:16px 22px">' +
        (low.length ? pestAlertsHtml(low) : '<div class="empty">Nothing to buy right now.</div>') +
      '</div>' +
    '</div>' +
    '<div class="section">' +
      '<div class="section-hdr"><h2>Stock</h2>' +
        // Adding/editing products lives in Setup; link there so it's one click away
        '<button class="btn btn-sm" onclick="goToPage(\'pestsetup\')">Manage list</button></div>' +
      '<div id="pi-action-wrap"></div>' +
      '<div id="pi-table"></div>' +
    '</div>';
  if (pestActionId !== null) renderPestActionForm();
  renderPestStockTable();
}

function renderPestStockTable() {
  var tbl = document.getElementById('pi-table');
  var rows = pestList.filter(function(p) { return p.active; });
  if (!rows.length) {
    tbl.innerHTML = '<div class="empty">No products yet. Add them in Setup › Pesticides &amp; Sprays, then log purchases here.</div>';
    return;
  }
  var colCount = 6;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Product</th><th>Pack</th><th class="right">In stock</th>' +
    '<th class="right">Cost / unit</th><th class="right">Spent</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(p) {
    var stock = pestStock(p.id);
    var low = p.min_stock != null && stock < Number(p.min_stock);
    var cpu = pestCostPerUnit(p.id);
    var spent = pestMoves.reduce(function(s, mv) {
      return mv.pesticide_id === p.id && mv.movement_type === 'purchase' && mv.cost_pkr != null ? s + Number(mv.cost_pkr) : s;
    }, 0);
    html += '<tr>' +
      '<td style="font-weight:500">' + pestEsc(p.name) + '<div style="margin-top:2px">' + pestBadges(p) + '</div></td>' +
      '<td class="muted-cell">' + pestFmtUnits(p, Number(p.pack_size)) + ' / ' + pestEsc(p.pack_label) + '</td>' +
      '<td class="mono right"' + (low ? ' style="color:var(--red);font-weight:500"' : '') + '>' + pestFmtStock(p, stock) +
        (p.min_stock != null ? '<div style="font-size:11px;color:var(--muted);font-weight:400">min ' + pestFmtUnits(p, Number(p.min_stock)) + '</div>' : '') +
      '</td>' +
      '<td class="mono right">' + (cpu != null ? 'PKR ' + r2(cpu).toLocaleString() : '—') + '</td>' +
      '<td class="mono right">' + (spent ? pkr(spent) : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm btn-primary" onclick="openPestAction(' + p.id + ',\'purchase\')">Buy</button> ' +
        '<button class="btn btn-sm" onclick="openPestAction(' + p.id + ',\'count\')">Count</button> ' +
        '<button class="btn btn-sm" onclick="togglePestHistory(' + p.id + ')">' + (pestExpanded.has(p.id) ? 'Hide' : 'History') + '</button>' +
      '</td></tr>';
    if (pestExpanded.has(p.id)) {
      html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' + renderPestHistory(p) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function togglePestHistory(id) {
  if (pestExpanded.has(id)) pestExpanded.delete(id); else pestExpanded.add(id);
  renderPestStockTable();
}

function renderPestHistory(p) {
  var moves = pestMoves.filter(function(mv) { return mv.pesticide_id === p.id; });
  if (!moves.length) return '<div class="empty" style="padding:14px 22px">No purchases, sprays or counts yet.</div>';
  var html = '<div style="padding:8px 22px 14px"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th class="right">Quantity</th><th class="right">Cost</th><th>Detail</th><th></th>' +
    '</tr></thead><tbody>';
  moves.forEach(function(mv) {
    var qty = Number(mv.quantity);
    var detail = [];
    if (mv.movement_type === 'purchase' && mv.packs != null) detail.push(Number(mv.packs) + ' ' + p.pack_label + (Number(mv.packs) !== 1 ? 's' : '') +
      (mv.pack_size != null ? ' of ' + pestFmtUnits(p, Number(mv.pack_size)) : ''));
    if (mv.field_plot_id) detail.push(pestEsc(pestPlotName(mv.field_plot_id)));
    if (mv.target) detail.push(pestEsc(mv.target));
    if (mv.reason) detail.push(PEST_REASON_LABELS[mv.reason] || mv.reason);
    if (mv.notes) detail.push(pestEsc(mv.notes));
    html += '<tr>' +
      '<td class="mono">' + fmtDate(mv.date) + '</td>' +
      '<td><span class="badge ' + (PEST_MOVE_BADGE[mv.movement_type] || 'badge-gray') + '">' + (PEST_MOVE_LABEL[mv.movement_type] || mv.movement_type) + '</span></td>' +
      '<td class="mono right">' + (qty > 0 ? '+' : '') + pestFmtUnits(p, qty) + '</td>' +
      '<td class="mono right">' + (mv.cost_pkr != null ? pkr(mv.cost_pkr) : '—') + '</td>' +
      '<td class="muted-cell">' + (detail.length ? detail.join(' &middot; ') : '—') + '</td>' +
      // Sprays are managed from Land › Spraying, so only purchases/counts delete here
      '<td>' + (mv.movement_type !== 'application'
        ? '<button class="btn btn-sm btn-danger" onclick="deletePestMove(' + mv.id + ')">Delete</button>' : '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

async function deletePestMove(id) {
  if (!confirm('Delete this stock entry? Stock will be recalculated. This cannot be undone.')) return;
  try {
    await sbDelete('pesticide_movements', id);
    await pestLoadData();
    renderPestInventoryPage();
  } catch(err) { alert('Error: ' + err.message); }
}

// ---- Buy / Count forms ----
function openPestAction(id, type) {
  pestActionId = id;
  pestActionType = type;
  renderPestActionForm();
  document.getElementById('pi-action-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePestAction() {
  pestActionId = null;
  pestActionType = null;
  var wrap = document.getElementById('pi-action-wrap');
  if (wrap) wrap.innerHTML = '';
}

function renderPestActionForm() {
  var p = pestById(pestActionId);
  if (!p) { closePestAction(); return; }
  var body;
  if (pestActionType === 'purchase') {
    body =
      '<div style="font-weight:500;margin-bottom:12px">Log purchase &mdash; ' + pestEsc(p.name) +
        ' <span style="font-weight:400;color:var(--muted)">(' + pestFmtUnits(p, Number(p.pack_size)) + ' per ' + pestEsc(p.pack_label) + ')</span></div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="pa2-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Number of ' + pestEsc(p.pack_label) + 's *</label><input type="number" id="pa2-packs" min="0" step="any" placeholder="e.g. 2" oninput="updatePestActionHint()"></div>' +
        '<div class="hf-field"><label>Total cost (PKR)</label><input type="number" id="pa2-cost" min="0" step="1" placeholder="What you paid" oninput="updatePestActionHint()"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        // Pre-filled with the usual pack; change it when this purchase came in a different size
        '<div class="hf-field"><label>Size of each ' + pestEsc(p.pack_label) + ' this time (' + p.stock_unit + ')</label>' +
          '<input type="number" id="pa2-pack-size" min="0" step="any" value="' + Number(p.pack_size) + '" oninput="updatePestActionHint()"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="pa2-notes" placeholder="Optional — supplier, batch"></div>' +
      '</div>';
  } else {
    body =
      '<div style="font-weight:500;margin-bottom:12px">Stock count &mdash; ' + pestEsc(p.name) +
        ' <span style="font-weight:400;color:var(--muted)">(app says ' + pestFmtStock(p, pestStock(p.id)) + ')</span></div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="pa2-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Full ' + pestEsc(p.pack_label) + 's</label><input type="number" id="pa2-count-packs" min="0" step="1" value="0" oninput="updatePestActionHint()"></div>' +
        '<div class="hf-field"><label>Plus opened (' + p.stock_unit + ')</label><input type="number" id="pa2-count-loose" min="0" step="any" value="0" oninput="updatePestActionHint()"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        '<div class="hf-field"><label>Reason for difference</label><select id="pa2-reason">' +
          '<option value="">Select if counts differ</option>' +
          Object.keys(PEST_REASON_LABELS).map(function(k) { return '<option value="' + k + '">' + PEST_REASON_LABELS[k] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="pa2-notes" placeholder="Optional"></div>' +
      '</div>';
  }
  document.getElementById('pi-action-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' + body +
      '<div id="pa2-hint" class="fc-derived" style="display:none;margin:4px 0 12px"></div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitPestAction()">' + (pestActionType === 'purchase' ? 'Save purchase' : 'Save count') + '</button>' +
        '<button class="btn" onclick="closePestAction()">Cancel</button>' +
        '<span id="pa2-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
}

function pestCountedUnits(p) {
  var packs = parseFloat(document.getElementById('pa2-count-packs').value) || 0;
  var loose = parseFloat(document.getElementById('pa2-count-loose').value) || 0;
  return packs * p.pack_size + loose;
}

// Live summary under the form: amount added and cost per unit, or count difference
function updatePestActionHint() {
  var p = pestById(pestActionId);
  var hint = document.getElementById('pa2-hint');
  if (!p || !hint) return;
  var text = '';
  if (pestActionType === 'purchase') {
    var packs = parseFloat(document.getElementById('pa2-packs').value);
    var cost  = parseFloat(document.getElementById('pa2-cost').value);
    var size  = parseFloat(document.getElementById('pa2-pack-size').value);
    if (packs > 0 && size > 0) {
      var units = packs * size;
      text = 'Adds ' + pestFmtUnits(p, units);
      if (cost >= 0) text += ' &middot; PKR ' + r2(cost / units).toLocaleString() + ' per ' + p.stock_unit;
    }
  } else {
    var counted = pestCountedUnits(p);
    var diff = counted - pestStock(p.id);
    text = 'Counted ' + pestFmtUnits(p, counted) + ' &middot; ' +
      (Math.abs(diff) < 1e-9 ? 'matches the app' : (diff > 0 ? '+' : '') + pestFmtUnits(p, diff) + ' vs the app');
  }
  hint.innerHTML = text;
  hint.style.display = text ? 'block' : 'none';
}

async function submitPestAction() {
  var statusEl = document.getElementById('pa2-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var p = pestById(pestActionId);
    var date = document.getElementById('pa2-date').value;
    var notes = document.getElementById('pa2-notes').value.trim() || null;
    if (!date) throw new Error('Date is required.');
    var row;
    if (pestActionType === 'purchase') {
      var packs = parseFloat(document.getElementById('pa2-packs').value);
      if (!(packs > 0)) throw new Error('Enter how many ' + p.pack_label + 's were bought.');
      var size = parseFloat(document.getElementById('pa2-pack-size').value);
      if (!(size > 0)) throw new Error('Enter the size of each ' + p.pack_label + '.');
      var costRaw = document.getElementById('pa2-cost').value;
      row = {
        pesticide_id: p.id, date: date, movement_type: 'purchase',
        quantity: packs * size, packs: packs,
        // Only recorded when it differs from the usual pack, to keep history readable
        pack_size: size !== Number(p.pack_size) ? size : null,
        cost_pkr: costRaw === '' ? null : parseFloat(costRaw), notes: notes
      };
    } else {
      // A count is stored as the difference between what's physically there and the ledger
      var diff = Math.round((pestCountedUnits(p) - pestStock(p.id)) * 1000) / 1000;
      if (diff === 0) {
        statusEl.textContent = 'Count matches the app — nothing to record.'; statusEl.style.color = 'var(--green)';
        return;
      }
      var reason = document.getElementById('pa2-reason').value;
      if (!reason) throw new Error('Pick a reason for the difference.');
      row = { pesticide_id: p.id, date: date, movement_type: 'adjustment', quantity: diff, reason: reason, notes: notes };
    }
    await sbInsert('pesticide_movements', [row]);
    closePestAction();
    await pestLoadData();
    renderPestInventoryPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// LAND › SPRAYING (spray log + per-plot summary)
// Rendered into #spray-content inside the Land page's spray panel.
// ============================================================
async function loadSprayLog() {
  var el = document.getElementById('spray-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var r = await Promise.all([
      pestLoadData(),
      sbGet('workers', 'select=id,name&active=eq.true&order=name').catch(function() { return []; })
    ]);
    pestWorkers = r[1];
    // Arriving from an Overview plot card pre-filters the log to that plot
    try {
      var target = sessionStorage.getItem('ov_target_plot');
      if (target) { spPlotFilter = target; sessionStorage.removeItem('ov_target_plot'); }
    } catch (_) {}
    renderSprayLog();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function sprayActivePlots() {
  return pestPlots.filter(function(p) { return p.status !== 'inactive'; });
}

function renderSprayLog() {
  var el = document.getElementById('spray-content');
  if (!el) return;
  el.innerHTML =
    '<div class="land-section">' +
      '<div class="land-section-hdr"><h2>Plots</h2>' +
        '<span class="land-section-meta">Sprays in the last ' + PEST_COUNT_MONTHS + ' months &middot; harvest waiting periods</span></div>' +
      '<div id="sp-summary"></div>' +
    '</div>' +
    '<div class="land-section">' +
      '<div class="land-section-hdr"><h2>Spray log</h2>' +
        '<span class="land-section-meta" id="sp-count"></span></div>' +
      '<div id="sp-form-wrap"></div>' +
      '<div style="padding:14px 22px;border-bottom:1px solid var(--border);display:flex;gap:14px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn-sm" onclick="openSprayForm(null)">+ Log spray</button>' +
        '<label style="font-size:13px;color:var(--muted)">Plot</label>' +
        '<select id="sp-plot-filter" onchange="spPlotFilter=this.value;renderSprayTable()">' +
          '<option value="">All plots</option>' +
          sprayActivePlots().map(function(p) {
            return '<option value="' + p.id + '"' + (String(p.id) === spPlotFilter ? ' selected' : '') + '>' + pestEsc(pestPlotName(p.id)) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div id="sp-table"></div>' +
    '</div>';
  if (spFormOpen) renderSprayForm();
  renderSpraySummary();
  renderSprayTable();
}

// One row per active plot: spray counts (synthetic vs organic), last spray, waiting period
function renderSpraySummary() {
  var plots = sprayActivePlots();
  var tbl = document.getElementById('sp-summary');
  if (!plots.length) { tbl.innerHTML = '<div class="empty">No plots yet. Add plots in Setup › Plots.</div>'; return; }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Plot</th><th class="right">Synthetic</th><th class="right">Organic</th><th>Last spray</th><th>Harvest</th>' +
    '</tr></thead><tbody>';
  plots.forEach(function(pl) {
    var c = pestPlotCounts(pl.id);
    var w = pestPlotWindow(pl.id);
    var lastP = c.last ? pestById(c.last.pesticide_id) : null;
    html += '<tr>' +
      '<td style="font-weight:500">' + pestEsc(pestPlotName(pl.id)) + '</td>' +
      '<td class="mono right">' + (c.synthetic || '—') + '</td>' +
      '<td class="mono right">' + (c.organic || '—') + '</td>' +
      '<td class="muted-cell">' + (c.last ? fmtDate(c.last.date) + ' &middot; ' + pestEsc(lastP ? lastP.name : '?') : '—') + '</td>' +
      '<td>' + (w
        ? '<span class="badge badge-red">wait until ' + fmtDate(w.safeFrom) + '</span>'
        : '<span class="badge badge-green">safe</span>') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function renderSprayTable() {
  var tbl = document.getElementById('sp-table');
  var sprays = pestMoves.filter(function(mv) {
    return mv.movement_type === 'application' && (!spPlotFilter || String(mv.field_plot_id) === spPlotFilter);
  });
  document.getElementById('sp-count').textContent = sprays.length + ' spray' + (sprays.length !== 1 ? 's' : '');
  if (!sprays.length) {
    tbl.innerHTML = '<div class="empty">No sprays logged' + (spPlotFilter ? ' on this plot' : '') + '. Use + Log spray to record one.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Plot</th><th>Product</th><th class="right">Amount</th><th class="right">Water</th>' +
    '<th>Target</th><th>Safe to harvest</th><th>Worker</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var today = todayISO();
  sprays.forEach(function(mv) {
    var p = pestById(mv.pesticide_id);
    var safe = pestSafeFrom(mv);
    html += '<tr>' +
      '<td class="mono">' + fmtDate(mv.date) + '</td>' +
      '<td>' + pestEsc(pestPlotName(mv.field_plot_id)) + '</td>' +
      '<td>' + (p ? pestEsc(p.name) + ' <span style="font-size:11px;color:var(--muted)">' + (p.organic ? 'organic' : 'synthetic') + '</span>' : '?') + '</td>' +
      '<td class="mono right">' + (p ? pestFmtUnits(p, -Number(mv.quantity)) : Math.abs(mv.quantity)) + '</td>' +
      '<td class="mono right">' + (mv.water_litres != null ? Number(mv.water_litres).toLocaleString() + ' L' : '—') + '</td>' +
      '<td class="muted-cell">' + (mv.target ? pestEsc(mv.target) : '—') + '</td>' +
      '<td>' + (safe
        ? (safe > today ? '<span class="badge badge-red">from ' + fmtDate(safe) + '</span>' : '<span class="muted-cell">' + fmtDate(safe) + '</span>')
        : '<span class="muted-cell">no wait</span>') + '</td>' +
      '<td class="muted-cell">' + (mv.worker_id ? pestEsc(pestWorkerName(mv.worker_id)) : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="openSprayForm(' + mv.id + ')">Edit</button> ' +
        '<button class="btn btn-sm btn-danger" onclick="deleteSpray(' + mv.id + ')">Delete</button>' +
      '</td></tr>';
    if (mv.notes) {
      html += '<tr><td></td><td colspan="8" class="muted-cell" style="padding-top:0;font-size:12px">' + pestEsc(mv.notes) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function openSprayForm(id) {
  spEditId = id;
  spFormOpen = true;
  renderSprayForm();
  document.getElementById('sp-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSprayForm() {
  spEditId = null;
  spFormOpen = false;
  var wrap = document.getElementById('sp-form-wrap');
  if (wrap) wrap.innerHTML = '';
}

function renderSprayForm() {
  var mv = spEditId !== null ? pestMoves.find(function(x) { return x.id === spEditId; }) : null;
  // Active products, plus the one being edited even if it has since been retired
  var products = pestList.filter(function(p) { return p.active || (mv && p.id === mv.pesticide_id); });
  var plotSel = mv ? String(mv.field_plot_id) : spPlotFilter;
  var opt = function(val, label, cur) { return '<option value="' + val + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + label + '</option>'; };
  document.getElementById('sp-form-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + (mv ? 'Edit spray' : 'Log spray') + '</div>' +
      (products.length ? '' : '<div class="fc-derived" style="margin-bottom:12px">No products yet — add them in Setup › Pesticides &amp; Sprays first.</div>') +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="sp-date" value="' + (mv ? mv.date : todayISO()) + '" onchange="updateSprayHint()"></div>' +
        '<div class="hf-field"><label>Plot *</label><select id="sp-plot">' +
          '<option value="">Select plot</option>' +
          sprayActivePlots().map(function(p) { return opt(p.id, pestEsc(pestPlotName(p.id)), plotSel); }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Product *</label><select id="sp-pest" onchange="updateSprayHint()">' +
          '<option value="">Select product</option>' +
          products.map(function(p) { return opt(p.id, pestEsc(p.name) + (p.organic ? ' (organic)' : ''), mv ? mv.pesticide_id : ''); }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Amount of product (<span id="sp-unit-lbl">' + (mv && pestById(mv.pesticide_id) ? pestById(mv.pesticide_id).stock_unit : 'unit') + '</span>) *</label>' +
          '<input type="number" id="sp-qty" min="0" step="any" value="' + (mv ? -Number(mv.quantity) : '') + '" placeholder="e.g. 250" oninput="updateSprayHint()"></div>' +
        '<div class="hf-field"><label>Water in tank mix (L)</label><input type="number" id="sp-water" min="0" step="any" value="' + (mv && mv.water_litres != null ? mv.water_litres : '') + '" placeholder="Optional"></div>' +
        '<div class="hf-field"><label>Sprayed for</label><input type="text" id="sp-target" value="' + (mv && mv.target ? pestEsc(mv.target) : '') + '" placeholder="e.g. Aphids, leaf spot"></div>' +
      '</div>' +
      '<div class="hf-grid two">' +
        '<div class="hf-field"><label>Worker</label><select id="sp-worker"><option value="">—</option>' +
          pestWorkers.map(function(w) { return opt(w.id, pestEsc(w.name), mv ? mv.worker_id : ''); }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="sp-notes" value="' + (mv && mv.notes ? pestEsc(mv.notes) : '') + '" placeholder="Optional — weather, coverage"></div>' +
      '</div>' +
      '<div id="sp-hint" class="fc-derived" style="display:none;margin:4px 0 12px"></div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitSpray()">' + (mv ? 'Save changes' : 'Save spray') + '</button>' +
        '<button class="btn" onclick="closeSprayForm()">Cancel</button>' +
        '<span id="sp-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
  updateSprayHint();
}

// Live hint: the date harvest becomes safe, and stock left after this spray
function updateSprayHint() {
  var hint = document.getElementById('sp-hint');
  if (!hint) return;
  var p = pestById(parseInt(document.getElementById('sp-pest').value));
  var unitLbl = document.getElementById('sp-unit-lbl');
  if (unitLbl) unitLbl.textContent = p ? p.stock_unit : 'unit';
  if (!p) { hint.style.display = 'none'; return; }
  var date = document.getElementById('sp-date').value || todayISO();
  var qty = parseFloat(document.getElementById('sp-qty').value);
  var parts = [];
  parts.push(p.pre_harvest_days
    ? 'Harvest safe from ' + fmtDate(pestAddDays(date, p.pre_harvest_days)) + ' (' + p.pre_harvest_days + '-day wait)'
    : (p.pre_harvest_days === 0 ? 'No pre-harvest wait' : 'No pre-harvest wait recorded for this product'));
  if (qty > 0) {
    // When editing, this spray's old amount is already out of stock — add it back first
    var old = spEditId !== null ? pestMoves.find(function(x) { return x.id === spEditId; }) : null;
    var base = pestStock(p.id) - (old && old.pesticide_id === p.id ? Number(old.quantity) : 0);
    var left = base - qty;
    parts.push('leaves ' + pestFmtStock(p, left) + (left < 0 ? ' <span style="color:var(--red)">&middot; more than the app shows in stock</span>' : ''));
  }
  hint.innerHTML = parts.join(' &middot; ');
  hint.style.display = 'block';
}

async function submitSpray() {
  var statusEl = document.getElementById('sp-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('sp-date').value;
    var plotId = parseInt(document.getElementById('sp-plot').value);
    var p      = pestById(parseInt(document.getElementById('sp-pest').value));
    var qty    = parseFloat(document.getElementById('sp-qty').value);
    var water  = document.getElementById('sp-water').value;
    var wId    = document.getElementById('sp-worker').value;
    if (!date) throw new Error('Date is required.');
    if (!plotId) throw new Error('Pick the plot that was sprayed.');
    if (!p) throw new Error('Pick the product used.');
    if (!(qty > 0)) throw new Error('Enter how much product was used.');
    // Valued at the latest purchase price, like medicine use
    var cpu = pestCostPerUnit(p.id);
    var row = {
      pesticide_id: p.id, date: date, movement_type: 'application',
      quantity: -qty, cost_pkr: cpu != null ? r2(qty * cpu) : null,
      field_plot_id: plotId,
      water_litres: water === '' ? null : parseFloat(water),
      target: document.getElementById('sp-target').value.trim() || null,
      worker_id: wId ? parseInt(wId) : null,
      notes: document.getElementById('sp-notes').value.trim() || null
    };
    if (spEditId !== null) await sbPatch('pesticide_movements', spEditId, row);
    else await sbInsert('pesticide_movements', [row]);
    closeSprayForm();
    await pestLoadData();
    renderSprayLog();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function deleteSpray(id) {
  if (!confirm('Delete this spray? The product goes back into stock and the waiting period is removed. This cannot be undone.')) return;
  try {
    await sbDelete('pesticide_movements', id);
    await pestLoadData();
    renderSprayLog();
  } catch(err) { alert('Error: ' + err.message); }
}
