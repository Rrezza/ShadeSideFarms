// ============================================================
// setup_fertilizers.js v18 — Fertilizers page
// ============================================================
//
// Three-layer fertilizer model:
//   1. Registry  — master reference. Nutrient profile, purchase unit
//                  conversion, reorder threshold. Inline editable.
//   2. Purchases — what you bought, when, from where, at what cost.
//                  Qty stored as purchase units (bags / containers).
//                  kg/L total and cost/kg or L derived on display.
//   3. Inventory — derived stock view in setup_inventory.js.
//
// Type drives unit system:
//   liquid  → purchase unit = container, stock unit = L
//   others  → purchase unit = bag,       stock unit = kg
// ============================================================

// ============================================================
// HELPERS
// ============================================================
function fertStockUnit(type) {
  return type === 'liquid' ? 'L' : 'kg';
}
function fertPurchUnitLabel(type) {
  return type === 'liquid' ? 'container' : 'bag';
}
function fertNf(val) {
  // Format a nullable numeric for display in the nutrient modal
  return (val != null && val !== '') ? parseFloat(val) : '';
}

// ============================================================
// STATE
// ============================================================
var fertData         = [];
var fertPurchaseData = [];
var fertNutrientsId  = null;  // fertilizer id open in nutrients modal

// ============================================================
// LOAD
// ============================================================
async function loadFertilizersPage() {
  document.getElementById('fert-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await sbGet('fertilizers', 'select=*&order=name');
    fertData = r;
    renderFertTable();
    renderAbbrevKey('abbrev-fertilizers', ['PKR']);
  } catch (err) {
    document.getElementById('fert-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

// ============================================================
// REGISTRY TABLE — inline editable
// ============================================================
function renderFertTable() {
  document.getElementById('fert-count').textContent =
    fertData.length + ' fertilizer' + (fertData.length !== 1 ? 's' : '');
  var tbl = document.getElementById('fert-table');
  if (!fertData.length) {
    tbl.innerHTML = '<div class="empty">No fertilizers yet. Click + Add fertilizer.</div>';
    return;
  }
  var TYPES = ['granular','liquid','organic','mineral','other'];
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Name</th>' +
    '<th>Type</th>' +
    '<th>Chemical form</th>' +
    '<th class="right">Qty / purchase unit</th>' +
    '<th class="right">Reorder point</th>' +
    '<th>Supplier</th>' +
    '<th>Notes</th>' +
    '<th style="text-align:center">Active</th>' +
    '<th></th><th></th>' +
    '</tr></thead><tbody>';

  fertData.forEach(function(f) {
    var su  = fertStockUnit(f.type);
    var pu  = fertPurchUnitLabel(f.type);
    var typeOpts = TYPES.map(function(t) {
      return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');

    html += '<tr style="' + (!f.active ? 'opacity:0.5' : '') + '">' +

      // Name
      '<td><input type="text" value="' + (f.name || '').replace(/"/g, '&quot;') +
        '" style="min-width:120px;width:100%"' +
        ' onchange="patchFert(' + f.id + ',\'name\',this.value)"></td>' +

      // Type — changing type updates the unit labels immediately on next render;
      // user will see updated labels after save/refresh
      '<td><select onchange="patchFert(' + f.id + ',\'type\',this.value)">' +
        typeOpts + '</select></td>' +

      // Chemical form
      '<td><input type="text" value="' + (f.chemical_form || '').replace(/"/g, '&quot;') +
        '" style="min-width:180px;width:100%" placeholder="e.g. Gypsum 90% CaSO₄·2H₂O"' +
        ' onchange="patchFert(' + f.id + ',\'chemical_form\',this.value||null)"></td>' +

      // Qty per purchase unit — label shows units inline
      '<td class="right" style="white-space:nowrap">' +
        '<input type="number" value="' + (f.quantity_per_purchase_unit != null ? f.quantity_per_purchase_unit : '') +
          '" style="width:72px;text-align:right" min="0" step="0.1" placeholder="—"' +
          ' onchange="patchFert(' + f.id + ',\'quantity_per_purchase_unit\',this.value?parseFloat(this.value):null)">' +
        '<span style="color:var(--muted);font-size:11px;margin-left:5px">' + su + '/' + pu + '</span>' +
      '</td>' +

      // Reorder point
      '<td class="right" style="white-space:nowrap">' +
        '<input type="number" value="' + (f.reorder_point != null ? f.reorder_point : '') +
          '" style="width:72px;text-align:right" min="0" step="1" placeholder="—"' +
          ' onchange="patchFert(' + f.id + ',\'reorder_point\',this.value?parseFloat(this.value):null)">' +
        '<span style="color:var(--muted);font-size:11px;margin-left:5px">' + su + '</span>' +
      '</td>' +

      // Supplier
      '<td><input type="text" value="' + (f.supplier || '').replace(/"/g, '&quot;') +
        '" style="min-width:100px;width:100%" placeholder="—"' +
        ' onchange="patchFert(' + f.id + ',\'supplier\',this.value||null)"></td>' +

      // Notes
      '<td><input type="text" value="' + (f.notes || '').replace(/"/g, '&quot;') +
        '" style="min-width:140px;width:100%" placeholder="—"' +
        ' onchange="patchFert(' + f.id + ',\'notes\',this.value||null)"></td>' +

      // Active
      '<td style="text-align:center">' +
        '<input type="checkbox" ' + (f.active ? 'checked' : '') +
        ' onchange="patchFert(' + f.id + ',\'active\',this.checked)">' +
      '</td>' +

      // Nutrients button
      '<td><button class="btn btn-sm" onclick="openFertNutrientsModal(' + f.id + ')"' +
        ' title="View / edit nutrient profile">🧪 Nutrients</button></td>' +

      // Delete
      '<td><button class="btn btn-sm del-btn"' +
        ' onclick="deleteFertilizer(' + f.id + ',\'' + (f.name || '').replace(/'/g, "\\'") + '\')"' +
        '>Delete</button></td>' +

      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ============================================================
// PATCH (generic — unchanged from v17)
// ============================================================
async function patchFert(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('fertilizers', id, d);
    var f = fertData.find(function(x) { return x.id === id; });
    if (f) f[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadFertilizersPage();
  }
}

// ============================================================
// NUTRIENTS MODAL — edit from registry row
// ============================================================
var NUTRIENT_MAP = [
  ['fn-n',    'n_pct',    'N %'],
  ['fn-p2o5', 'p2o5_pct', 'P₂O₅ %'],
  ['fn-k2o',  'k2o_pct',  'K₂O %'],
  ['fn-ca',   'ca_pct',   'Ca %'],
  ['fn-mg',   'mg_pct',   'Mg %'],
  ['fn-s',    's_pct',    'S %'],
  ['fn-fe',   'fe_ppm',   'Fe ppm'],
  ['fn-zn',   'zn_ppm',   'Zn ppm'],
  ['fn-b',    'b_ppm',    'B ppm'],
  ['fn-mn',   'mn_ppm',   'Mn ppm']
];

function openFertNutrientsModal(id) {
  var f = fertData.find(function(x) { return x.id === id; });
  if (!f) return;
  fertNutrientsId = id;
  document.getElementById('fert-nutrients-title').textContent =
    'Nutrient profile — ' + f.name;
  NUTRIENT_MAP.forEach(function(m) {
    var el = document.getElementById(m[0]);
    if (el) el.value = f[m[1]] != null ? f[m[1]] : '';
  });
  document.getElementById('fn-status').textContent = '';
  document.getElementById('fert-nutrients-modal').style.display = 'flex';
}

function closeFertNutrientsModal() {
  document.getElementById('fert-nutrients-modal').style.display = 'none';
  fertNutrientsId = null;
}

async function saveFertNutrients() {
  if (!fertNutrientsId) return;
  var statusEl = document.getElementById('fn-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var d = {};
    NUTRIENT_MAP.forEach(function(m) {
      var el = document.getElementById(m[0]);
      if (!el) return;
      var v = el.value.trim();
      d[m[1]] = v !== '' ? parseFloat(v) : null;
    });
    await sbPatch('fertilizers', fertNutrientsId, d);
    // Update local cache so table reflects new values without full reload
    var f = fertData.find(function(x) { return x.id === fertNutrientsId; });
    if (f) Object.assign(f, d);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(closeFertNutrientsModal, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// PURCHASE MODAL
// ============================================================
function updatePurchaseModalLabels() {
  var fertId   = document.getElementById('fp-fert').value;
  var fert     = fertData.find(function(f) { return String(f.id) === String(fertId); });
  var isLiquid = fert && fert.type === 'liquid';
  var pu = isLiquid ? 'container' : 'bag';
  document.getElementById('fp-qty-label').textContent  = 'Quantity (' + pu + 's)';
  document.getElementById('fp-cost-label').textContent = 'Cost per ' + pu + ' (PKR)';
  updatePurchaseDerived();
}

function updatePurchaseDerived() {
  var fertId = document.getElementById('fp-fert').value;
  var fert   = fertData.find(function(f) { return String(f.id) === String(fertId); });
  var qty    = parseFloat(document.getElementById('fp-qty').value);
  var cost   = parseFloat(document.getElementById('fp-cost').value);
  var divEl  = document.getElementById('fp-derived');
  var textEl = document.getElementById('fp-derived-text');

  if (!fert || !fert.quantity_per_purchase_unit) { divEl.style.display = 'none'; return; }

  var qpu = parseFloat(fert.quantity_per_purchase_unit);
  var su  = fertStockUnit(fert.type);
  var pu  = fertPurchUnitLabel(fert.type);
  var parts = [];

  if (!isNaN(qty) && qty > 0) {
    parts.push(r1(qty * qpu) + ' ' + su + ' total');
  }
  if (!isNaN(cost) && cost > 0 && qpu > 0) {
    parts.push(pkr(cost / qpu) + ' / ' + su);
  }
  if (parts.length) {
    divEl.style.display  = 'block';
    textEl.textContent   = '→  ' + parts.join('   ·   ');
  } else {
    divEl.style.display = 'none';
  }
}

async function openFertPurchaseModal() {
  if (!fertData.length) {
    fertData = await sbGet('fertilizers', 'active=eq.true&select=*&order=name');
  }
  var sel = document.getElementById('fp-fert');
  sel.innerHTML = '<option value="">Select fertilizer</option>' +
    fertData.filter(function(f) { return f.active; }).map(function(f) {
      var su  = fertStockUnit(f.type);
      var pu  = fertPurchUnitLabel(f.type);
      var qpu = f.quantity_per_purchase_unit
        ? ' · ' + f.quantity_per_purchase_unit + ' ' + su + '/' + pu
        : '';
      return '<option value="' + f.id + '">' + f.name + qpu + '</option>';
    }).join('');
  document.getElementById('fp-date').value = todayISO();
  ['fp-qty','fp-cost','fp-supplier','fp-notes'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('fp-qty-label').textContent  = 'Quantity (bags)';
  document.getElementById('fp-cost-label').textContent = 'Cost per bag (PKR)';
  document.getElementById('fp-derived').style.display  = 'none';
  document.getElementById('fp-status').textContent     = '';
  document.getElementById('fert-purch-modal').style.display = 'flex';
}

function closeFertPurchaseModal() {
  document.getElementById('fert-purch-modal').style.display = 'none';
}

async function submitFertPurchase() {
  var statusEl = document.getElementById('fp-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var fertId = document.getElementById('fp-fert').value;
    var date   = document.getElementById('fp-date').value;
    var qty    = parseFloat(document.getElementById('fp-qty').value);
    if (!fertId || !date || isNaN(qty) || qty <= 0)
      throw new Error('Fertilizer, date, and quantity required.');
    var d = { fertilizer_id: parseInt(fertId), date: date, qty: qty };
    var cost = document.getElementById('fp-cost').value;
    if (cost) d.cost_per_unit = parseFloat(cost);
    var sup = document.getElementById('fp-supplier').value.trim();
    if (sup) d.supplier = sup;
    var notes = document.getElementById('fp-notes').value.trim();
    if (notes) d.notes = notes;
    await sbInsert('fertilizer_purchases', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeFertPurchaseModal(); loadFertilizersPage(); }, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
