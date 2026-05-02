// ============================================================
// fd_purchases.js v17 — Purchase log page
// ============================================================

// ============================================================
// PURCHASE LOG
// ============================================================

async function loadPurchases() {
  var tbl = document.getElementById('purchase-table');
  if (!tbl) return;
  tbl.innerHTML = '<div class="loading">Loading…</div>';
  purchaseEditId = null;
  try {
    purchaseRows = await sbGet('ingredient_acquisitions',
      'select=id,date,acquisition_type,quantity_kg,total_cost_pkr,cost_per_kg,notes,' +
      'ingredients(id,name,category),workers(id,name)&order=date.desc&limit=500');
    var countEl = document.getElementById('purchase-count');
    if (countEl) countEl.textContent = purchaseRows.length + ' acquisition' + (purchaseRows.length !== 1 ? 's' : '');
    renderPurchaseTable();
    renderAbbrevKey('abbrev-purchases', ['PKR']);
  } catch (err) {
    tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderPurchaseTable() {
  var tbl = document.getElementById('purchase-table');
  if (!tbl) return;
  if (!purchaseRows.length) {
    tbl.innerHTML = '<div class="empty">No acquisitions logged. Use "+ New entry" to add one.</div>';
    return;
  }
  var ACQ_BADGE = { purchased: 'badge-blue', produced: 'badge-lime', vet_supplied: 'badge-teal', harvested: 'badge-green', dual: 'badge-gray' };
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Ingredient</th><th>Category</th><th>Type</th>' +
    '<th class="right">Qty (kg)</th><th class="right">Total cost</th>' +
    '<th class="right">Cost / kg</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';

  purchaseRows.forEach(function(r) {
    var ing = r.ingredients;
    if (String(purchaseEditId) === String(r.id)) {
      html += '<tr class="ing-selected">' +
        '<td><input type="date" id="pe-date" value="' + (r.date || '') + '" style="width:130px"></td>' +
        '<td style="font-weight:500">' + (ing ? ing.name : '—') + '</td>' +
        '<td>' + (ing && ing.category ? '<span class="badge ' + (CAT_BADGE[ing.category] || 'badge-gray') + '">' + ing.category + '</span>' : '—') + '</td>' +
        '<td><select id="pe-type" style="width:110px">' +
          ['purchased','produced','harvested','vet_supplied'].map(function(t) {
            return '<option value="' + t + '"' + (r.acquisition_type === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') +
        '</select></td>' +
        '<td class="right"><input type="number" id="pe-qty" value="' + (r.quantity_kg != null ? r.quantity_kg : '') + '" min="0.001" step="0.1" style="width:75px" oninput="peAutoCalc()"></td>' +
        '<td class="right"><input type="number" id="pe-total" value="' + (r.total_cost_pkr != null ? r.total_cost_pkr : '') + '" min="0" step="1" style="width:90px" oninput="peAutoCalc()"></td>' +
        '<td class="mono right" id="pe-cpk-display">' + (r.cost_per_kg != null ? pkr(r.cost_per_kg) + '/kg' : '—') + '</td>' +
        '<td><input type="text" id="pe-notes" value="' + (r.notes || '').replace(/"/g, '&quot;') + '" style="width:130px"></td>' +
        '<td><div style="display:flex;gap:6px;white-space:nowrap">' +
          '<button class="btn btn-sm btn-primary" onclick="savePurchaseEdit(' + r.id + ')">Save</button>' +
          '<button class="btn btn-sm" onclick="cancelPurchaseEdit()">Cancel</button>' +
        '</div></td>' +
      '</tr>';
    } else {
      html += '<tr>' +
        '<td class="mono">' + fmtDate(r.date) + '</td>' +
        '<td style="font-weight:500">' + (ing ? ing.name : '—') + '</td>' +
        '<td>' + (ing && ing.category ? '<span class="badge ' + (CAT_BADGE[ing.category] || 'badge-gray') + '">' + ing.category + '</span>' : '—') + '</td>' +
        '<td><span class="badge ' + (ACQ_BADGE[r.acquisition_type] || 'badge-gray') + '">' + (r.acquisition_type || '—') + '</span></td>' +
        '<td class="mono right">' + (r.quantity_kg != null ? r1(r.quantity_kg).toLocaleString() : '—') + '</td>' +
        '<td class="mono right">' + (r.total_cost_pkr != null ? pkr(r.total_cost_pkr) : '—') + '</td>' +
        '<td class="mono right">' + (r.cost_per_kg != null ? pkr(r.cost_per_kg) + '/kg' : '—') + '</td>' +
        '<td class="muted-cell" style="font-size:12px;max-width:180px">' + (r.notes || '') + '</td>' +
        '<td><div style="display:flex;gap:6px;white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="editPurchaseRow(' + r.id + ')">Edit</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deletePurchaseRow(' + r.id + ')">Delete</button>' +
        '</div></td>' +
      '</tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function editPurchaseRow(id) {
  purchaseEditId = id;
  renderPurchaseTable();
}

function cancelPurchaseEdit() {
  purchaseEditId = null;
  renderPurchaseTable();
}

async function deletePurchaseRow(id) {
  if (!confirm('Delete this acquisition record? This cannot be undone.')) return;
  try {
    var resp = await fetch(SB_URL + '/rest/v1/ingredient_acquisitions?id=eq.' + id, {
      method: 'DELETE',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, JH)
    });
    if (!resp.ok) throw new Error(await resp.text());
    purchaseRows = purchaseRows.filter(function(row) { return String(row.id) !== String(id); });
    var countEl = document.getElementById('purchase-count');
    if (countEl) countEl.textContent = purchaseRows.length + ' acquisition' + (purchaseRows.length !== 1 ? 's' : '');
    renderPurchaseTable();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

function peAutoCalc() {
  var qty   = parseFloat((document.getElementById('pe-qty')   || {}).value);
  var total = parseFloat((document.getElementById('pe-total') || {}).value);
  var disp  = document.getElementById('pe-cpk-display');
  if (disp && qty > 0 && !isNaN(total) && total > 0) {
    disp.textContent = pkr(total / qty) + '/kg';
  }
}

async function savePurchaseEdit(id) {
  var date  = (document.getElementById('pe-date')  || {}).value;
  var type  = (document.getElementById('pe-type')  || {}).value;
  var qty   = parseFloat((document.getElementById('pe-qty')   || {}).value);
  var total = parseFloat((document.getElementById('pe-total') || {}).value);
  var notes = ((document.getElementById('pe-notes') || {}).value || '').trim() || null;

  if (!date) { alert('Date is required.'); return; }
  if (isNaN(qty) || qty <= 0) { alert('Quantity must be greater than zero.'); return; }

  // cost_per_kg is a GENERATED column — do not include in PATCH
  try {
    await sbPatch('ingredient_acquisitions', id, {
      date: date,
      acquisition_type: type,
      quantity_kg: qty,
      total_cost_pkr: isNaN(total) ? null : total,
      notes: notes
    });
    var row = purchaseRows.find(function(r) { return r.id === id; });
    if (row) {
      row.date = date; row.acquisition_type = type;
      row.quantity_kg = qty;
      row.total_cost_pkr = isNaN(total) ? null : total;
      row.cost_per_kg = (qty > 0 && !isNaN(total) && total > 0) ? total / qty : null;
      row.notes = notes;
    }
    purchaseEditId = null;
    renderPurchaseTable();
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

async function togglePurchaseForm() {
  var formEl = document.getElementById('purchase-add-form');
  if (!formEl) return;
  if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }

  // Load ingredients and workers if not cached
  if (!purchaseAllIngs.length) {
    try { purchaseAllIngs = await sbGet('ingredients', 'active=eq.true&select=id,name,category&order=category,name'); }
    catch (e) { purchaseAllIngs = []; }
  }
  if (!purchaseAllWorkers.length) {
    try { purchaseAllWorkers = await sbGet('workers', 'active=eq.true&select=id,name&order=name'); }
    catch (e) { purchaseAllWorkers = []; }
  }

  var ingOpts = '<option value="">— select ingredient —</option>' +
    purchaseAllIngs.map(function(i) {
      return '<option value="' + i.id + '">' + i.name + ' (' + (i.category || 'other') + ')</option>';
    }).join('');
  var workerOpts = '<option value="">— none —</option>' +
    purchaseAllWorkers.map(function(w) {
      return '<option value="' + w.id + '">' + w.name + '</option>';
    }).join('');

  formEl.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">' +
      '<div class="fc-field"><label>Date</label><input type="date" id="pa-date" value="' + todayISO() + '"></div>' +
      '<div class="fc-field"><label>Ingredient</label><select id="pa-ing">' + ingOpts + '</select></div>' +
      '<div class="fc-field"><label>Type</label><select id="pa-type">' +
        '<option value="purchased">Purchased</option>' +
        '<option value="produced">Produced (on-farm)</option>' +
        '<option value="harvested">Harvested</option>' +
        '<option value="vet_supplied">Vet supplied</option>' +
      '</select></div>' +
      '<div class="fc-field"><label>Quantity (kg)</label><input type="number" id="pa-qty" min="0.001" step="0.1" placeholder="e.g. 50" oninput="paAutoCalc()"></div>' +
      '<div class="fc-field"><label>Total cost (PKR)</label><input type="number" id="pa-total" min="0" step="1" placeholder="e.g. 4500" oninput="paAutoCalc()"></div>' +
      '<div class="fc-field"><label>Cost / kg <span style="color:var(--faint);font-weight:400">(auto)</span></label><input type="number" id="pa-cpk" min="0" step="0.01" placeholder="Auto-calculated" readonly style="background:var(--bg2)"></div>' +
      '<div class="fc-field"><label>Recorded by</label><select id="pa-worker">' + workerOpts + '</select></div>' +
      '<div class="fc-field"><label>Notes</label><input type="text" id="pa-notes" placeholder="Optional"></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
      '<button class="btn btn-primary" onclick="submitPurchaseEntry()">Save entry</button>' +
      '<button class="btn" onclick="togglePurchaseForm()">Cancel</button>' +
      '<span id="pa-status" style="font-size:13px;color:var(--muted)"></span>' +
    '</div>';
  formEl.style.display = 'block';
}

function paAutoCalc() {
  var qty   = parseFloat((document.getElementById('pa-qty')   || {}).value);
  var total = parseFloat((document.getElementById('pa-total') || {}).value);
  var cpkEl = document.getElementById('pa-cpk');
  if (cpkEl && qty > 0 && !isNaN(total) && total > 0) {
    cpkEl.value = Math.round(total / qty * 100) / 100;
  }
}

async function submitPurchaseEntry() {
  var date     = (document.getElementById('pa-date')   || {}).value;
  var ingId    = (document.getElementById('pa-ing')    || {}).value;
  var type     = (document.getElementById('pa-type')   || {}).value || 'purchased';
  var qty      = parseFloat((document.getElementById('pa-qty')    || {}).value);
  var total    = parseFloat((document.getElementById('pa-total')  || {}).value);
  var workerId = (document.getElementById('pa-worker') || {}).value || null;
  var notes    = ((document.getElementById('pa-notes') || {}).value || '').trim() || null;
  var statusEl = document.getElementById('pa-status');

  if (!date)  { if (statusEl) statusEl.textContent = 'Date required.'; return; }
  if (!ingId) { if (statusEl) statusEl.textContent = 'Select an ingredient.'; return; }
  if (isNaN(qty) || qty <= 0) { if (statusEl) statusEl.textContent = 'Quantity must be > 0.'; return; }

  // cost_per_kg is GENERATED — do not insert it
  var data = {
    date: date,
    ingredient_id: parseInt(ingId),
    acquisition_type: type,
    quantity_kg: qty,
    total_cost_pkr: isNaN(total) ? null : total,
    recorded_by: workerId ? parseInt(workerId) : null,
    notes: notes
  };

  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbInsert('ingredient_acquisitions', data);
    if (statusEl) statusEl.textContent = 'Saved ✓';
    document.getElementById('purchase-add-form').style.display = 'none';
    loadPurchases();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

