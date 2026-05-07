// ============================================================
// fd_seeds.js — Seed Inventory
// ============================================================
//
// Stock per crop = seed_purchases + harvest_allocations to seed_stock
//                 + seed_stock_adjustments
//
// Only crops with at least one record are shown.
// Sowing deduction (qty_kg_sown on plot_crops) is wired in Phase 3.
//
// Depends on: shared.js (sbGet, sbInsert, sbDelete, sbPatch,
//             fmtDate, pkr, r1, todayISO, CAT_BADGE)
// ============================================================

var sdCrops         = [];   // crop registry
var sdPurchases     = [];   // seed_purchases (display + calc)
var sdAllocations   = [];   // harvest_allocations where destination='seed_stock'
var sdAdjustments   = [];   // seed_stock_adjustments
var sdWorkers       = [];
var sdEditId        = null; // inline edit for purchase log
var sdAdjCropId     = null;

function sdSafe(table, query) {
  return sbGet(table, query).catch(function(e) {
    console.warn('sd: query failed', table, e.message); return [];
  });
}

// ============================================================
// LOAD
// ============================================================
async function loadSeedInventory() {
  var tbl = document.getElementById('sd-stock-table');
  if (tbl) tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('crops', 'active=eq.true&select=id,name,local_name,category&order=name'),
      sdSafe('seed_purchases',
        'select=id,crop_id,variety,date,quantity_kg,cost_per_kg,supplier,' +
        'germination_pct,lot_ref,notes,crops(id,name,local_name)&order=date.desc&limit=500'),
      sdSafe('harvest_allocations',
        'select=id,harvest_event_id,quantity_kg,crop_id,destination' +
        '&destination=eq.seed_stock'),
      sdSafe('seed_stock_adjustments',
        'select=id,crop_id,date,delta_kg,reason,notes&order=date.desc'),
      sdSafe('workers', 'active=eq.true&select=id,name&order=name')
    ]);

    sdCrops       = r[0];
    sdPurchases   = r[1];
    sdAllocations = r[2];
    sdAdjustments = r[3];
    sdWorkers     = r[4];

    renderSdStock();
    renderSdPurchases();
    renderAbbrevKey('abbrev-seeds', ['PKR']);
  } catch (err) {
    if (tbl) tbl.innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error('loadSeedInventory:', err);
  }
}

// ============================================================
// STOCK TABLE
// ============================================================
function sdComputeStockMap() {
  var map = {};   // crop_id → { purchased, fromHarvest, adjusted }

  sdPurchases.forEach(function(p) {
    if (!map[p.crop_id]) map[p.crop_id] = { purchased: 0, fromHarvest: 0, adjusted: 0 };
    map[p.crop_id].purchased += parseFloat(p.quantity_kg) || 0;
  });

  sdAllocations.forEach(function(a) {
    if (!a.crop_id) return;
    if (!map[a.crop_id]) map[a.crop_id] = { purchased: 0, fromHarvest: 0, adjusted: 0 };
    map[a.crop_id].fromHarvest += parseFloat(a.quantity_kg) || 0;
  });

  sdAdjustments.forEach(function(a) {
    if (!map[a.crop_id]) map[a.crop_id] = { purchased: 0, fromHarvest: 0, adjusted: 0 };
    map[a.crop_id].adjusted += parseFloat(a.delta_kg) || 0;
  });

  return map;
}

function renderSdStock() {
  var tbl = document.getElementById('sd-stock-table');
  if (!tbl) return;

  var stockMap  = sdComputeStockMap();
  var cropIds   = Object.keys(stockMap).map(Number);

  if (!cropIds.length) {
    tbl.innerHTML = '<div class="empty">No seed records yet. Log a purchase or allocate from a harvest.</div>';
    document.getElementById('sd-stock-count').textContent = '0 crops tracked';
    return;
  }

  // Filter crop registry to only those with records
  var crops = sdCrops.filter(function(c) { return cropIds.indexOf(c.id) !== -1; });
  crops.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

  document.getElementById('sd-stock-count').textContent =
    crops.length + ' crop' + (crops.length !== 1 ? 's' : '') + ' tracked';

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Crop</th>' +
    '<th class="right">From purchases</th>' +
    '<th class="right">From harvest</th>' +
    '<th class="right">Adjustments</th>' +
    '<th class="right">Current stock</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  crops.forEach(function(c) {
    var s   = stockMap[c.id];
    var net = s.purchased + s.fromHarvest + s.adjusted;
    var cls = net <= 0 ? 'inv-stock-zero' : (net < 0.5 ? 'inv-stock-low' : 'inv-stock-pos');
    html += '<tr>' +
      '<td style="font-weight:500">' + c.name + (c.local_name ? ' <span class="muted-cell" style="font-size:11px">(' + c.local_name + ')</span>' : '') + '</td>' +
      '<td class="mono right">' + r1(s.purchased) + ' kg</td>' +
      '<td class="mono right">' + r1(s.fromHarvest) + ' kg</td>' +
      '<td class="mono right ' + (s.adjusted !== 0 ? (s.adjusted > 0 ? 'inv-stock-pos' : 'inv-stock-low') : '') + '">' +
        (s.adjusted !== 0 ? (s.adjusted > 0 ? '+' : '') + r1(s.adjusted) + ' kg' : '—') + '</td>' +
      '<td class="mono right ' + cls + '" style="font-weight:500">' + r1(net) + ' kg</td>' +
      '<td><button class="btn btn-sm" onclick="openSdAdj(' + c.id + ',\'' +
        c.name.replace(/'/g, "\\'") + '\')">Adjust</button></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ============================================================
// PURCHASE LOG
// ============================================================
function renderSdPurchases() {
  var tbl = document.getElementById('sd-purch-table');
  if (!tbl) return;

  document.getElementById('sd-purch-count').textContent =
    sdPurchases.length + ' purchase' + (sdPurchases.length !== 1 ? 's' : '');

  if (!sdPurchases.length) {
    tbl.innerHTML = '<div class="empty">No seed purchases logged yet.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Crop</th><th>Variety</th>' +
    '<th class="right">Qty (kg)</th><th class="right">Cost / kg</th>' +
    '<th class="right">Total cost</th>' +
    '<th class="right">Germ %</th>' +
    '<th>Supplier</th><th>Lot</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';

  sdPurchases.forEach(function(p) {
    var crop   = p.crops || {};
    var cpkg   = p.cost_per_kg   != null ? parseFloat(p.cost_per_kg)   : null;
    var qty    = p.quantity_kg   != null ? parseFloat(p.quantity_kg)   : null;
    var total  = (cpkg != null && qty != null) ? cpkg * qty : null;

    if (String(sdEditId) === String(p.id)) {
      // Inline edit row
      html += '<tr class="ing-selected">' +
        '<td><input type="date" id="sd-pe-date" value="' + (p.date || '') + '" style="width:130px"></td>' +
        '<td style="font-weight:500">' + (crop.name || '—') + '</td>' +
        '<td><input type="text" id="sd-pe-var" value="' + (p.variety || '').replace(/"/g,'&quot;') + '" style="width:120px" placeholder="—"></td>' +
        '<td><input type="number" id="sd-pe-qty" value="' + (qty != null ? qty : '') + '" min="0.001" step="0.1" style="width:75px" oninput="sdPeCalc()"></td>' +
        '<td><input type="number" id="sd-pe-cpk" value="' + (cpkg != null ? cpkg : '') + '" min="0" step="1" style="width:80px" oninput="sdPeCalc()"></td>' +
        '<td class="mono right" id="sd-pe-total-disp">' + (total != null ? pkr(total) : '—') + '</td>' +
        '<td><input type="number" id="sd-pe-germ" value="' + (p.germination_pct != null ? p.germination_pct : '') + '" min="0" max="100" step="1" style="width:60px" placeholder="—"></td>' +
        '<td><input type="text" id="sd-pe-sup" value="' + (p.supplier || '').replace(/"/g,'&quot;') + '" style="width:100px"></td>' +
        '<td><input type="text" id="sd-pe-lot" value="' + (p.lot_ref || '').replace(/"/g,'&quot;') + '" style="width:80px"></td>' +
        '<td><input type="text" id="sd-pe-notes" value="' + (p.notes || '').replace(/"/g,'&quot;') + '" style="width:120px"></td>' +
        '<td><div style="display:flex;gap:5px;white-space:nowrap">' +
          '<button class="btn btn-sm btn-primary" onclick="saveSdPurchEdit(' + p.id + ')">Save</button>' +
          '<button class="btn btn-sm" onclick="cancelSdPurchEdit()">Cancel</button></div></td>' +
        '</tr>';
    } else {
      html += '<tr>' +
        '<td class="mono">' + fmtDate(p.date) + '</td>' +
        '<td style="font-weight:500">' + (crop.name || '—') + '</td>' +
        '<td class="muted-cell">' + (p.variety || '—') + '</td>' +
        '<td class="mono right">' + (qty != null ? r1(qty) + ' kg' : '—') + '</td>' +
        '<td class="mono right">' + (cpkg != null ? pkr(cpkg) + '/kg' : '—') + '</td>' +
        '<td class="mono right">' + (total != null ? pkr(total) : '—') + '</td>' +
        '<td class="mono right">' + (p.germination_pct != null ? p.germination_pct + '%' : '—') + '</td>' +
        '<td class="muted-cell">' + (p.supplier || '—') + '</td>' +
        '<td class="muted-cell" style="font-size:12px">' + (p.lot_ref || '—') + '</td>' +
        '<td class="muted-cell" style="font-size:12px;max-width:160px">' + (p.notes || '') + '</td>' +
        '<td><div style="display:flex;gap:5px;white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="editSdPurch(' + p.id + ')">Edit</button>' +
          '<button class="btn btn-sm del-btn" onclick="deleteSdPurch(' + p.id + ')">Delete</button>' +
        '</div></td></tr>';
    }
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function editSdPurch(id)     { sdEditId = id;   renderSdPurchases(); }
function cancelSdPurchEdit() { sdEditId = null;  renderSdPurchases(); }

function sdPeCalc() {
  var qty = parseFloat((document.getElementById('sd-pe-qty') || {}).value);
  var cpk = parseFloat((document.getElementById('sd-pe-cpk') || {}).value);
  var el  = document.getElementById('sd-pe-total-disp');
  if (el) el.textContent = (qty > 0 && cpk >= 0 && !isNaN(cpk)) ? pkr(qty * cpk) : '—';
}

async function saveSdPurchEdit(id) {
  var date = (document.getElementById('sd-pe-date') || {}).value;
  var qty  = parseFloat((document.getElementById('sd-pe-qty')  || {}).value);
  var cpk  = parseFloat((document.getElementById('sd-pe-cpk')  || {}).value);
  var germ = parseFloat((document.getElementById('sd-pe-germ') || {}).value);
  var vari = ((document.getElementById('sd-pe-var')   || {}).value || '').trim() || null;
  var sup  = ((document.getElementById('sd-pe-sup')   || {}).value || '').trim() || null;
  var lot  = ((document.getElementById('sd-pe-lot')   || {}).value || '').trim() || null;
  var notes= ((document.getElementById('sd-pe-notes') || {}).value || '').trim() || null;
  if (!date || isNaN(qty) || qty <= 0) { alert('Date and quantity required.'); return; }
  try {
    await sbPatch('seed_purchases', id, {
      date: date, quantity_kg: qty,
      cost_per_kg: isNaN(cpk)  ? null : cpk,
      germination_pct: isNaN(germ) ? null : germ,
      variety: vari, supplier: sup, lot_ref: lot, notes: notes
    });
    sdEditId = null;
    await loadSeedInventory();
  } catch (err) { alert('Save failed: ' + err.message); }
}

async function deleteSdPurch(id) {
  if (!confirm('Delete this seed purchase record?')) return;
  try { await sbDelete('seed_purchases', id); await loadSeedInventory(); }
  catch (err) { alert('Delete failed: ' + err.message); }
}

// ============================================================
// PURCHASE MODAL
// ============================================================
function openSdPurchModal() {
  var cropEl = document.getElementById('sd-crop');
  if (cropEl) {
    cropEl.innerHTML = '<option value="">Select crop</option>' +
      sdCrops.map(function(c) {
        return '<option value="' + c.id + '">' + c.name +
          (c.local_name ? ' (' + c.local_name + ')' : '') + '</option>';
      }).join('');
  }
  document.getElementById('sd-date').value = todayISO();
  ['sd-variety','sd-qty','sd-cpk','sd-germ','sd-supplier','sd-lot','sd-notes'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('sd-status').textContent = '';
  document.getElementById('sd-purch-modal').style.display = 'flex';
}
function closeSdPurchModal() {
  document.getElementById('sd-purch-modal').style.display = 'none';
}

async function submitSdPurch() {
  var statusEl = document.getElementById('sd-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var cropId  = document.getElementById('sd-crop').value;
    var date    = document.getElementById('sd-date').value;
    var qty     = parseFloat(document.getElementById('sd-qty').value);
    var cpk     = parseFloat(document.getElementById('sd-cpk').value);
    var germ    = parseFloat(document.getElementById('sd-germ').value);
    var variety = (document.getElementById('sd-variety').value || '').trim() || null;
    var sup     = (document.getElementById('sd-supplier').value || '').trim() || null;
    var lot     = (document.getElementById('sd-lot').value || '').trim() || null;
    var notes   = (document.getElementById('sd-notes').value || '').trim() || null;
    if (!cropId) throw new Error('Select a crop.');
    if (!date)   throw new Error('Date required.');
    if (isNaN(qty) || qty <= 0) throw new Error('Enter a valid quantity.');
    var d = {
      crop_id: parseInt(cropId), date: date, quantity_kg: qty,
      cost_per_kg: isNaN(cpk)  ? null : cpk,
      germination_pct: isNaN(germ) ? null : germ,
      variety: variety, supplier: sup, lot_ref: lot, notes: notes
    };
    await sbInsert('seed_purchases', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeSdPurchModal(); loadSeedInventory(); }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// STOCK ADJUSTMENT MODAL
// ============================================================
function openSdAdj(cropId, cropName) {
  sdAdjCropId = cropId;
  document.getElementById('sd-adj-title').textContent = 'Adjust seed stock — ' + cropName;
  document.getElementById('sd-adj-date').value  = todayISO();
  document.getElementById('sd-adj-delta').value = '';
  document.getElementById('sd-adj-reason').value = 'count';
  document.getElementById('sd-adj-notes').value = '';
  document.getElementById('sd-adj-status').textContent = '';
  document.getElementById('sd-adj-modal').style.display = 'flex';
}
function closeSdAdj() { document.getElementById('sd-adj-modal').style.display = 'none'; }

async function submitSdAdj() {
  var statusEl = document.getElementById('sd-adj-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('sd-adj-date').value;
    var delta  = parseFloat(document.getElementById('sd-adj-delta').value);
    var reason = document.getElementById('sd-adj-reason').value;
    var notes  = (document.getElementById('sd-adj-notes').value || '').trim() || null;
    if (!sdAdjCropId || !date || isNaN(delta) || delta === 0)
      throw new Error('Date and a non-zero delta required.');
    await sbInsert('seed_stock_adjustments', [{
      crop_id: sdAdjCropId, date: date, delta_kg: delta, reason: reason, notes: notes
    }]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeSdAdj(); loadSeedInventory(); }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
