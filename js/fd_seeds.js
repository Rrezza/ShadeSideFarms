// ============================================================
// fd_seeds.js — Inventory › Seeds & Harvest (the crop store)
// ============================================================
//
// One stock per crop, in kg. Seed and stored grain are the same pile: wheat
// that's bought, harvested and kept can later be sown, fed, sold or eaten.
//
//   + bought      crop_stock_movements 'purchase' (with cost)
//   + harvested   harvest_allocations to destination 'seed_stock' ("Crop store")
//   − sown        plot_crops.qty_kg_sown (entered on the planting; editable here)
//   − to feed     crop_stock_movements 'to_feed' — also creates a matching
//                 ingredient_acquisitions row, so it shows up as Feed stock
//   − sold        crop_stock_movements 'sold' (with price)
//   − household   crop_stock_movements 'household'
//   − spoiled     crop_stock_movements 'spoiled'
//   ± count       crop_stock_movements 'adjustment' (from a physical count)
//
// Harvested produce carries no cost; only purchases do.
// Depends on: shared.js (sbGet, sbInsert, sbPatch, sbDelete, fmtDate, pkr, r2, todayISO)
// ============================================================

var sdCrops       = [];   // active crop registry
var sdMoves       = [];   // crop_stock_movements, newest first
var sdHarvestIn   = [];   // harvest_allocations to the crop store (with harvest date + group)
var sdSowings     = [];   // plot_crops with a crop (sown amounts + where)
var sdIngredients = [];   // feed-eligible ingredients, for "to feed"
var sdAction      = null; // { cropId, type: 'buy'|'out'|'count' } for the open form
var sdExpanded    = new Set();  // crop ids with their history open

var SD_OUT_TYPES = { to_feed: 'To feed', sold: 'Sold', household: 'Household use', spoiled: 'Spoiled / lost' };
var SD_TYPE_BADGE = {
  purchase: 'badge-green', harvest: 'badge-lime', sown: 'badge-blue', to_feed: 'badge-teal',
  sold: 'badge-amber', household: 'badge-gray', spoiled: 'badge-red', adjustment: 'badge-gray'
};
var SD_TYPE_LABEL = {
  purchase: 'bought', harvest: 'harvested', sown: 'sown', to_feed: 'to feed',
  sold: 'sold', household: 'household', spoiled: 'spoiled', adjustment: 'count'
};

function sdEsc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// kg with grams for small amounts (seed packets): 0.25 → "250 g", 12.5 → "12.5 kg"
function sdKg(n) {
  var v = Number(n) || 0;
  if (v !== 0 && Math.abs(v) < 1) return Math.round(v * 1000).toLocaleString() + ' g';
  return (Math.round(v * 100) / 100).toLocaleString() + ' kg';
}

function sdCropName(c) {
  return c ? c.name + (c.local_name ? ' (' + c.local_name + ')' : '') : '—';
}

// ============================================================
// LOAD
// ============================================================
async function loadSeedInventory() {
  var el = document.getElementById('sd-content');
  if (el) el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('crops', 'active=eq.true&select=id,name,local_name,category&order=name'),
      sbGet('crop_stock_movements', 'select=*&order=date.desc,id.desc'),
      sbGet('harvest_allocations',
        'destination=eq.seed_stock&select=id,crop_id,quantity_kg,notes,' +
        'crop_harvest_events(date,crop_groups(name))'),
      sbGet('plot_crops',
        'crop_id=not.is.null&select=id,crop_id,sow_date,qty_kg_sown,status,' +
        'field_plots(plot_code,plot_name),crop_groups(name)&order=sow_date.desc'),
      sbGet('ingredients', 'feed_eligible=eq.true&select=id,name&order=name')
    ]);
    sdCrops = r[0]; sdMoves = r[1]; sdHarvestIn = r[2]; sdSowings = r[3]; sdIngredients = r[4];
    renderSdPage();
  } catch (err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error('loadSeedInventory:', err);
  }
}

// ============================================================
// STOCK CALCULATION
// ============================================================
// Per crop: { bought, harvested, sown, to_feed, sold, household, spoiled, adjustment, stock, spent, sales }
// Outflows are positive numbers here (amount that left).
function sdTotals(cropId) {
  var t = { bought: 0, harvested: 0, sown: 0, to_feed: 0, sold: 0, household: 0, spoiled: 0, adjustment: 0, spent: 0, sales: 0 };
  sdMoves.forEach(function(m) {
    if (m.crop_id !== cropId) return;
    var q = Number(m.quantity_kg);
    if (m.movement_type === 'purchase') { t.bought += q; if (m.cost_pkr != null) t.spent += Number(m.cost_pkr); }
    else if (m.movement_type === 'adjustment') t.adjustment += q;
    else {
      t[m.movement_type] += -q;
      if (m.movement_type === 'sold' && m.price_pkr != null) t.sales += Number(m.price_pkr);
    }
  });
  sdHarvestIn.forEach(function(a) { if (a.crop_id === cropId) t.harvested += Number(a.quantity_kg) || 0; });
  sdSowings.forEach(function(p) { if (p.crop_id === cropId && p.qty_kg_sown) t.sown += Number(p.qty_kg_sown); });
  t.stock = t.bought + t.harvested + t.adjustment - t.sown - t.to_feed - t.sold - t.household - t.spoiled;
  return t;
}

// Crops shown: any with a movement, a harvest into the store, or seed sown
function sdActiveCropIds() {
  var ids = {};
  sdMoves.forEach(function(m) { ids[m.crop_id] = true; });
  sdHarvestIn.forEach(function(a) { if (a.crop_id) ids[a.crop_id] = true; });
  sdSowings.forEach(function(p) { if (p.qty_kg_sown) ids[p.crop_id] = true; });
  return sdCrops.filter(function(c) { return ids[c.id]; });
}

// ============================================================
// PAGE
// ============================================================
function renderSdPage() {
  var crops = sdActiveCropIds();
  var spent = 0, sales = 0;
  crops.forEach(function(c) { var t = sdTotals(c.id); spent += t.spent; sales += t.sales; });
  document.getElementById('sd-content').innerHTML =
    '<div class="section">' +
      '<div class="section-hdr"><h2>Crop store</h2>' +
      '<div style="display:flex;gap:10px;align-items:center">' +
        '<span class="section-meta">' + crops.length + ' crop' + (crops.length !== 1 ? 's' : '') +
          ' &middot; spent ' + pkr(spent) + ' &middot; sold ' + pkr(sales) + '</span>' +
        '<button class="btn btn-sm btn-primary" onclick="openSdAction(null, \'buy\')">+ Buy seed / grain</button>' +
      '</div></div>' +
      '<div id="sd-action-wrap"></div>' +
      '<div id="sd-stock-table"></div>' +
      '<div style="font-size:12px;color:var(--muted);padding:8px 22px 14px">Harvests come in through the harvest allocation step (destination "Crop store"). ' +
        'Seed sown is taken from each planting’s "Seed sown" amount — edit it in a crop’s History.</div>' +
    '</div>';
  if (sdAction) renderSdActionForm();
  renderSdStock();
}

function renderSdStock() {
  var tbl = document.getElementById('sd-stock-table');
  var crops = sdActiveCropIds();
  if (!crops.length) {
    tbl.innerHTML = '<div class="empty">Nothing in the crop store yet. Use + Buy seed / grain, or allocate a harvest to "Crop store".</div>';
    return;
  }
  var colCount = 11;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Crop</th><th class="right">Bought</th><th class="right">Harvested</th><th class="right">Sown</th>' +
    '<th class="right">To feed</th><th class="right">Sold</th><th class="right">Household</th><th class="right">Spoiled / count</th>' +
    '<th class="right">In store</th><th class="right">Spent / sales</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var cell = function(v) { return '<td class="mono right">' + (v ? sdKg(v) : '—') + '</td>'; };
  crops.forEach(function(c) {
    var t = sdTotals(c.id);
    // Spoilage and count corrections shown together as one net loss/gain figure
    var lossNet = t.spoiled - t.adjustment;
    html += '<tr>' +
      '<td style="font-weight:500">' + sdEsc(sdCropName(c)) + '</td>' +
      cell(t.bought) + cell(t.harvested) + cell(t.sown) + cell(t.to_feed) + cell(t.sold) + cell(t.household) +
      '<td class="mono right">' + (lossNet ? (lossNet > 0 ? '−' : '+') + sdKg(Math.abs(lossNet)) : '—') + '</td>' +
      '<td class="mono right" style="font-weight:600' + (t.stock < -0.0001 ? ';color:var(--red)' : '') + '">' + sdKg(t.stock) + '</td>' +
      '<td class="mono right" style="font-size:12px">' + (t.spent ? pkr(t.spent) : '—') + '<br>' + (t.sales ? '<span style="color:var(--green)">' + pkr(t.sales) + '</span>' : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm btn-primary" onclick="openSdAction(' + c.id + ',\'buy\')">Buy</button> ' +
        '<button class="btn btn-sm" onclick="openSdAction(' + c.id + ',\'out\')">Take out</button> ' +
        '<button class="btn btn-sm" onclick="openSdAction(' + c.id + ',\'count\')">Count</button> ' +
        '<button class="btn btn-sm" onclick="toggleSdHistory(' + c.id + ')">' + (sdExpanded.has(c.id) ? 'Hide' : 'History') + '</button>' +
      '</td></tr>';
    if (sdExpanded.has(c.id)) {
      html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' + renderSdHistory(c) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ============================================================
// HISTORY — every in/out for one crop, newest first
// ============================================================
function toggleSdHistory(cropId) {
  if (sdExpanded.has(cropId)) sdExpanded.delete(cropId); else sdExpanded.add(cropId);
  renderSdStock();
}

function renderSdHistory(c) {
  var rows = [];
  sdMoves.filter(function(m) { return m.crop_id === c.id; }).forEach(function(m) {
    var detail = [];
    if (m.variety) detail.push(sdEsc(m.variety));
    if (m.supplier) detail.push(sdEsc(m.supplier));
    if (m.movement_type === 'to_feed') {
      detail.push(m.ingredient_acquisition_id ? 'added to Feed stock' : 'feed entry removed');
    }
    if (m.notes) detail.push(sdEsc(m.notes));
    rows.push({
      date: m.date, type: m.movement_type, qty: Number(m.quantity_kg),
      money: m.movement_type === 'purchase' ? m.cost_pkr : (m.movement_type === 'sold' ? m.price_pkr : null),
      detail: detail.join(' &middot; '),
      action: '<button class="btn btn-sm btn-danger" onclick="deleteSdMove(' + m.id + ')">Delete</button>'
    });
  });
  sdHarvestIn.filter(function(a) { return a.crop_id === c.id; }).forEach(function(a) {
    var h = a.crop_harvest_events || {};
    rows.push({
      date: h.date || '', type: 'harvest', qty: Number(a.quantity_kg), money: null,
      detail: 'from ' + sdEsc(h.crop_groups ? h.crop_groups.name : 'harvest') + (a.notes ? ' &middot; ' + sdEsc(a.notes) : ''),
      action: '<span style="font-size:11px;color:var(--muted)">edit on Land</span>'
    });
  });
  // Plantings of this crop: sown amount editable here (also covers plantings logged before it was recorded)
  sdSowings.filter(function(p) { return p.crop_id === c.id; }).forEach(function(p) {
    var where = (p.field_plots ? p.field_plots.plot_code : '') + (p.crop_groups ? ' · ' + p.crop_groups.name : '');
    rows.push({
      date: p.sow_date || '', type: 'sown', qty: -(Number(p.qty_kg_sown) || 0), money: null,
      detail: sdEsc(where) + (p.status !== 'growing' ? ' &middot; ' + p.status : ''),
      action: '<span style="font-size:11px;color:var(--muted)">kg sown </span><input type="number" min="0" step="any" style="width:80px;text-align:right" ' +
        'value="' + (p.qty_kg_sown != null ? Number(p.qty_kg_sown) : '') + '" placeholder="none" onchange="patchSdSown(' + p.id + ', this.value)">',
      unrecorded: !p.qty_kg_sown
    });
  });
  if (!rows.length) return '<div class="empty" style="padding:14px 22px">No history yet.</div>';
  rows.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  var html = '<div style="padding:8px 22px 14px;background:var(--bg)"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th class="right">Quantity</th><th class="right">PKR</th><th>Detail</th><th></th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    html += '<tr' + (r.unrecorded ? ' style="opacity:0.6"' : '') + '>' +
      '<td class="mono">' + fmtDate(r.date) + '</td>' +
      '<td><span class="badge ' + (SD_TYPE_BADGE[r.type] || 'badge-gray') + '">' + SD_TYPE_LABEL[r.type] + '</span></td>' +
      '<td class="mono right">' + (r.unrecorded ? '<span style="color:var(--muted)">not recorded</span>' : (r.qty > 0 ? '+' : '−') + sdKg(Math.abs(r.qty))) + '</td>' +
      '<td class="mono right">' + (r.money != null ? pkr(r.money) : '—') + '</td>' +
      '<td class="muted-cell">' + (r.detail || '—') + '</td>' +
      '<td style="white-space:nowrap">' + r.action + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// Sets (or clears) a planting's seed-sown amount; the crop store recalculates from it
async function patchSdSown(plotCropId, value) {
  var v = value === '' ? null : parseFloat(value);
  if (v != null && (isNaN(v) || v < 0)) { alert('Enter a positive amount in kg, or leave blank.'); return; }
  try {
    await sbPatch('plot_crops', plotCropId, { qty_kg_sown: v });
    var p = sdSowings.find(function(x) { return x.id === plotCropId; });
    if (p) p.qty_kg_sown = v;
    renderSdPage();
  } catch (err) { alert('Save failed: ' + err.message); }
}

async function deleteSdMove(id) {
  var m = sdMoves.find(function(x) { return x.id === id; });
  var extra = m && m.movement_type === 'to_feed' && m.ingredient_acquisition_id
    ? '\n\nThe matching entry in Feed stock will be removed too.' : '';
  if (!confirm('Delete this crop store entry?' + extra + '\n\nThis cannot be undone.')) return;
  try {
    // Feed-stock entry first, so stock can't be counted in both places
    if (m && m.movement_type === 'to_feed' && m.ingredient_acquisition_id) {
      await sbDelete('ingredient_acquisitions', m.ingredient_acquisition_id);
    }
    await sbDelete('crop_stock_movements', id);
    await loadSeedInventory();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ============================================================
// BUY / TAKE OUT / COUNT FORM
// ============================================================
function openSdAction(cropId, type) {
  sdAction = { cropId: cropId, type: type };
  renderSdActionForm();
  document.getElementById('sd-action-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSdAction() {
  sdAction = null;
  document.getElementById('sd-action-wrap').innerHTML = '';
}

function renderSdActionForm() {
  var a = sdAction;
  var crop = a.cropId ? sdCrops.find(function(c) { return c.id === a.cropId; }) : null;
  var stock = crop ? sdTotals(crop.id).stock : null;
  // Crop picker only when buying from the page header (a crop not yet in the store)
  var cropField = crop
    ? '<input type="hidden" id="sdf-crop" value="' + crop.id + '">'
    : '<div class="hf-field"><label>Crop *</label><select id="sdf-crop"><option value="">Select crop</option>' +
        sdCrops.map(function(c) { return '<option value="' + c.id + '">' + sdEsc(sdCropName(c)) + '</option>'; }).join('') +
      '</select></div>';
  var title = { buy: 'Buy seed / grain', out: 'Take out of store', count: 'Stock count' }[a.type] +
    (crop ? ' &mdash; ' + sdEsc(sdCropName(crop)) + ' <span style="font-weight:400;color:var(--muted)">(in store ' + sdKg(stock) + ')</span>' : '');
  var body;
  if (a.type === 'buy') {
    body = '<div class="hf-grid">' + cropField +
        '<div class="hf-field"><label>Date</label><input type="date" id="sdf-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Quantity (kg) *</label><input type="number" id="sdf-qty" min="0" step="any" placeholder="e.g. 40, or 0.01 for 10 g"></div>' +
        '<div class="hf-field"><label>Total cost (PKR)</label><input type="number" id="sdf-cost" min="0" step="1" placeholder="What you paid"></div>' +
      '</div><div class="hf-grid">' +
        '<div class="hf-field"><label>Variety</label><input type="text" id="sdf-variety" placeholder="e.g. Chakwal-50, local desi"></div>' +
        '<div class="hf-field"><label>Supplier</label><input type="text" id="sdf-supplier" placeholder="Optional"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="sdf-notes" placeholder="Optional"></div>' +
      '</div>';
  } else if (a.type === 'out') {
    body = cropField + '<div class="hf-grid">' +
        '<div class="hf-field"><label>Where it went</label><select id="sdf-out" onchange="onSdOutTypeChange()">' +
          Object.keys(SD_OUT_TYPES).map(function(k) { return '<option value="' + k + '">' + SD_OUT_TYPES[k] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Date</label><input type="date" id="sdf-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Quantity (kg) *</label><input type="number" id="sdf-qty" min="0" step="any"></div>' +
      '</div><div class="hf-grid two">' +
        '<div class="hf-field" id="sdf-ing-wrap"><label>Feed ingredient *</label><select id="sdf-ing">' +
          '<option value="">Select ingredient</option>' +
          sdIngredients.map(function(i) {
            // Pre-select the ingredient named like the crop (e.g. Wheat → "Wheat grain")
            var match = crop && i.name.toLowerCase().indexOf(crop.name.toLowerCase()) >= 0;
            return '<option value="' + i.id + '"' + (match ? ' selected' : '') + '>' + sdEsc(i.name) + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="hf-field" id="sdf-price-wrap" style="display:none"><label>Sale price, total (PKR)</label><input type="number" id="sdf-price" min="0" step="1"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="sdf-notes" placeholder="Optional — buyer, reason"></div>' +
      '</div>';
  } else {
    body = cropField + '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date</label><input type="date" id="sdf-date" value="' + todayISO() + '"></div>' +
        '<div class="hf-field"><label>Actually in store (kg) *</label><input type="number" id="sdf-qty" min="0" step="any" oninput="onSdCountInput()"></div>' +
        '<div class="hf-field"><label>Notes</label><input type="text" id="sdf-notes" placeholder="Optional"></div>' +
      '</div><div id="sdf-hint" class="fc-derived" style="display:none;margin:0 0 10px"></div>';
  }
  document.getElementById('sd-action-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + title + '</div>' + body +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitSdAction()">Save</button>' +
        '<button class="btn" onclick="closeSdAction()">Cancel</button>' +
        '<span id="sdf-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div></div>';
}

// "To feed" needs an ingredient; "Sold" needs a price
function onSdOutTypeChange() {
  var t = document.getElementById('sdf-out').value;
  document.getElementById('sdf-ing-wrap').style.display = t === 'to_feed' ? 'flex' : 'none';
  document.getElementById('sdf-price-wrap').style.display = t === 'sold' ? 'flex' : 'none';
}

function onSdCountInput() {
  var hint = document.getElementById('sdf-hint');
  var v = parseFloat(document.getElementById('sdf-qty').value);
  if (isNaN(v)) { hint.style.display = 'none'; return; }
  var diff = v - sdTotals(sdAction.cropId).stock;
  hint.innerHTML = Math.abs(diff) < 0.0005 ? 'Matches the app' : (diff > 0 ? '+' : '−') + sdKg(Math.abs(diff)) + ' vs the app';
  hint.style.display = 'block';
}

async function submitSdAction() {
  var st = document.getElementById('sdf-status');
  st.textContent = 'Saving…'; st.style.color = 'var(--muted)';
  try {
    var cropId = parseInt(document.getElementById('sdf-crop').value);
    var date = document.getElementById('sdf-date').value;
    var qty = parseFloat(document.getElementById('sdf-qty').value);
    var notes = (document.getElementById('sdf-notes').value || '').trim() || null;
    if (!cropId) throw new Error('Pick a crop.');
    if (!date) throw new Error('Date is required.');
    if (isNaN(qty) || qty < 0 || (sdAction.type !== 'count' && qty === 0)) throw new Error('Enter a quantity in kg.');
    var row = { crop_id: cropId, date: date, notes: notes };

    if (sdAction.type === 'buy') {
      var cost = document.getElementById('sdf-cost').value;
      Object.assign(row, {
        movement_type: 'purchase', quantity_kg: qty,
        cost_pkr: cost === '' ? null : parseFloat(cost),
        variety: (document.getElementById('sdf-variety').value || '').trim() || null,
        supplier: (document.getElementById('sdf-supplier').value || '').trim() || null
      });
    } else if (sdAction.type === 'out') {
      var outType = document.getElementById('sdf-out').value;
      Object.assign(row, { movement_type: outType, quantity_kg: -qty });
      if (outType === 'sold') {
        var price = document.getElementById('sdf-price').value;
        row.price_pkr = price === '' ? null : parseFloat(price);
      }
      if (outType === 'to_feed') {
        // Moving grain into feed: record it as a harvested acquisition on the Feed page
        var ingId = parseInt(document.getElementById('sdf-ing').value);
        if (!ingId) throw new Error('Pick which feed ingredient this becomes.');
        var crop = sdCrops.find(function(c) { return c.id === cropId; });
        var acq = await sbInsert('ingredient_acquisitions', [{
          ingredient_id: ingId, acquisition_type: 'harvested', date: date, quantity_kg: qty,
          notes: 'From crop store (' + (crop ? crop.name : 'crop') + ')' + (notes ? ' — ' + notes : '')
        }]);
        if (!acq || !acq.length) throw new Error('The feed-stock entry was not returned by the database — check Feed Ingredients before retrying.');
        row.ingredient_acquisition_id = acq[0].id;
        try {
          await sbInsert('crop_stock_movements', [row]);
        } catch (e) {
          // Don't leave feed stock credited without the matching crop-store deduction
          await sbDelete('ingredient_acquisitions', acq[0].id).catch(function() {});
          throw e;
        }
        closeSdAction();
        await loadSeedInventory();
        return;
      }
    } else {
      // Count: store the difference between what's there and what the app says
      var diff = Math.round((qty - sdTotals(cropId).stock) * 1000) / 1000;
      if (diff === 0) { st.textContent = 'Count matches the app — nothing to record.'; st.style.color = 'var(--green)'; return; }
      Object.assign(row, { movement_type: 'adjustment', quantity_kg: diff });
    }
    await sbInsert('crop_stock_movements', [row]);
    closeSdAction();
    await loadSeedInventory();
  } catch (err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}
