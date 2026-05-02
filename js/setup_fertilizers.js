// ============================================================
// setup_fertilizers.js v17 — Fertilizers page
// ============================================================

// FERTILIZERS PAGE
// ============================================================
var fertData          = [];
var fertPurchaseData  = [];
var editingFertId     = null;

async function loadFertilizersPage() {
  document.getElementById('fert-table').innerHTML        = '<div class="loading">Loading…</div>';
  document.getElementById('fert-purch-table').innerHTML  = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('fertilizers',           'select=*&order=name'),
      sbGet('fertilizer_purchases',  'select=*,fertilizers(id,name,unit)&order=date.desc&limit=300')
    ]);
    fertData         = r[0];
    fertPurchaseData = r[1];
    renderFertTable();
    renderFertPurchaseTable();
    renderAbbrevKey('abbrev-fertilizers', ['PKR']);
  } catch (err) {
    document.getElementById('fert-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderFertTable() {
  document.getElementById('fert-count').textContent =
    fertData.length + ' fertilizer' + (fertData.length !== 1 ? 's' : '');
  var tbl = document.getElementById('fert-table');
  if (!fertData.length) {
    tbl.innerHTML = '<div class="empty">No fertilizers yet. Click + Add fertilizer.</div>';
    return;
  }
  var TYPES = ['granular','liquid','organic','mineral','other'];
  var UNITS = ['kg','bag','litre','tonne'];
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Name</th><th>Type</th><th>Unit</th><th>Supplier</th><th>Active</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';
  fertData.forEach(function(f) {
    var typeOpts = TYPES.map(function(t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    var unitOpts = UNITS.map(function(u) { return '<option value="' + u + '"' + (f.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
    html += '<tr style="' + (!f.active ? 'opacity:0.5' : '') + '">' +
      '<td><input type="text" value="' + (f.name || '').replace(/"/g, '&quot;') + '" style="width:100%" onchange="patchFert(' + f.id + ',\'name\',this.value)"></td>' +
      '<td><select onchange="patchFert(' + f.id + ',\'type\',this.value||null)"><option value="">—</option>' + typeOpts + '</select></td>' +
      '<td><select onchange="patchFert(' + f.id + ',\'unit\',this.value)">' + unitOpts + '</select></td>' +
      '<td><input type="text" value="' + (f.supplier || '').replace(/"/g, '&quot;') + '" style="width:100%" placeholder="—" onchange="patchFert(' + f.id + ',\'supplier\',this.value||null)"></td>' +
      '<td style="text-align:center"><input type="checkbox" ' + (f.active ? 'checked' : '') + ' onchange="patchFert(' + f.id + ',\'active\',this.checked)"></td>' +
      '<td><input type="text" value="' + (f.notes || '').replace(/"/g, '&quot;') + '" style="width:100%;min-width:140px" placeholder="—" onchange="patchFert(' + f.id + ',\'notes\',this.value||null)"></td>' +
      '<td><button class="btn btn-sm del-btn" onclick="deleteFertilizer(' + f.id + ',\'' + (f.name || '').replace(/'/g,"\\'") + '\')">Delete</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function renderFertPurchaseTable() {
  document.getElementById('fert-purch-count').textContent =
    fertPurchaseData.length + ' purchase' + (fertPurchaseData.length !== 1 ? 's' : '');
  var tbl = document.getElementById('fert-purch-table');
  if (!fertPurchaseData.length) {
    tbl.innerHTML = '<div class="empty">No purchases logged. Click + Log purchase.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Fertilizer</th><th class="right">Qty</th>' +
    '<th class="right">Cost / unit</th><th class="right">Total</th><th>Supplier</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';
  fertPurchaseData.forEach(function(p) {
    var fert = p.fertilizers || {};
    var unit = fert.unit || '';
    var total = (p.qty != null && p.cost_per_unit != null) ? parseFloat(p.qty) * parseFloat(p.cost_per_unit) : null;
    html += '<tr>' +
      '<td class="mono">' + fmtDate(p.date) + '</td>' +
      '<td style="font-weight:500">' + (fert.name || '—') + '</td>' +
      '<td class="mono right">' + (p.qty != null ? r1(p.qty) + ' ' + unit : '—') + '</td>' +
      '<td class="mono right">' + (p.cost_per_unit != null ? pkr(p.cost_per_unit) + (unit ? ' / ' + unit : '') : '—') + '</td>' +
      '<td class="mono right">' + (total != null ? pkr(total) : '—') + '</td>' +
      '<td class="muted-cell">' + (p.supplier || '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (p.notes || '') + '</td>' +
      '<td><button class="btn btn-sm del-btn" onclick="deleteFertPurchase(' + p.id + ')">Delete</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

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

function openFertModal() {
  editingFertId = null;
  document.getElementById('fert-modal-title').textContent = 'Add fertilizer';
  ['fert-name','fert-supplier','fert-notes'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('fert-type').value = 'granular';
  document.getElementById('fert-unit').value = 'kg';
  document.getElementById('fert-modal-status').textContent = '';
  document.getElementById('fert-modal').style.display = 'flex';
}
function closeFertModal() { document.getElementById('fert-modal').style.display = 'none'; }
async function submitFert() {
  var statusEl = document.getElementById('fert-modal-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var name = document.getElementById('fert-name').value.trim();
    if (!name) throw new Error('Name is required.');
    var d = {
      name: name,
      type: document.getElementById('fert-type').value,
      unit: document.getElementById('fert-unit').value,
      supplier: document.getElementById('fert-supplier').value.trim() || null,
      notes:    document.getElementById('fert-notes').value.trim() || null,
      active: true
    };
    await sbInsert('fertilizers', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeFertModal(); loadFertilizersPage(); }, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function openFertPurchaseModal() {
  // Make sure registry is loaded
  if (!fertData.length) {
    fertData = await sbGet('fertilizers', 'active=eq.true&select=*&order=name');
  }
  var sel = document.getElementById('fp-fert');
  sel.innerHTML = '<option value="">Select fertilizer</option>' +
    fertData.filter(function(f) { return f.active; }).map(function(f) {
      return '<option value="' + f.id + '">' + f.name + ' (' + f.unit + ')</option>';
    }).join('');
  document.getElementById('fp-date').value = todayISO();
  ['fp-qty','fp-cost','fp-supplier','fp-notes'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('fp-status').textContent = '';
  document.getElementById('fert-purch-modal').style.display = 'flex';
}
function closeFertPurchaseModal() { document.getElementById('fert-purch-modal').style.display = 'none'; }
async function submitFertPurchase() {
  var statusEl = document.getElementById('fp-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var fertId = document.getElementById('fp-fert').value;
    var date   = document.getElementById('fp-date').value;
    var qty    = parseFloat(document.getElementById('fp-qty').value);
    if (!fertId || !date || isNaN(qty) || qty <= 0) throw new Error('Fertilizer, date, and quantity required.');
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
