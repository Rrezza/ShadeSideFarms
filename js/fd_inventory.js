// ============================================================
// fd_inventory.js — Feed Ingredient Inventory
// ============================================================
//
// Three sections on one page:
//   1. Stock summary  — current stock per ingredient, reorder warnings
//   2. Acquisition log — all purchases, harvest receipts, etc.
//   3. Concentrate batches — mixing events that decrement ingredients
//                            and add concentrate to stock
//
// Stock formula per ingredient:
//   + ingredient_acquisitions.quantity_kg
//   + ingredient_stock_adjustments.delta_kg
//   + concentrate_batches where recipe.output_ingredient_id = this (mixed)
//   − concentrate_batch_lines.qty_kg_used (consumed in mixing)
//   − feeding_events.hay_kg        (where ration_plan_version.hay_ingredient_id = this)
//   − feeding_events.green_fodder_kg (where ...green_fodder_ingredient_id = this)
//   − feeding_events.concentrate_kg  (where ...concentrate_recipe → output_ingredient_id = this)
//
// BSF larvae: excluded — on-farm produced, no purchased stock yet.
//
// Depends on: shared.js (sbGet, sbPatch, sbInsert, sbDelete,
//             fmtDate, pkr, r1, todayISO, renderAbbrevKey, CAT_BADGE)
// ============================================================

// ============================================================
// STATE
// ============================================================
var fiIngredients      = [];
var fiAcqRows          = [];   // for log display (full join)
var fiBatchRows        = [];   // for batch log display (full join)
var fiStockMap         = {};   // ingredient_id → computed stock object
var fiWorkers          = [];
var fiRecipes          = [];   // active recipes with output_ingredient_id
var fiAcqEditId        = null;
var fiAdjIngId         = null;
var fiBatchRecipeLines = [];   // recipe_ingredients for current batch modal recipe
var fiCurrentBatchQty  = 0;

var FI_ACQ_BADGE = {
  purchased:    'badge-blue',
  produced:     'badge-lime',
  harvested:    'badge-green',
  vet_supplied: 'badge-teal'
};
var FI_ACQ_LABEL = {
  purchased:    'Purchased',
  produced:     'On-farm produced',
  harvested:    'Harvested',
  vet_supplied: 'Vet supplied'
};

function fiSafe(table, query) {
  return sbGet(table, query).catch(function(e) {
    console.warn('fi: query failed', table, e.message); return [];
  });
}

// ============================================================
// LOAD
// ============================================================
async function loadIngredientInventory() {
  var stockTbl = document.getElementById('fi-stock-table');
  if (stockTbl) stockTbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('ingredients',
        'active=eq.true&select=id,name,category,reorder_point_kg&order=category,name'),

      // Acquisitions (display version — also used for stock calc)
      sbGet('ingredient_acquisitions',
        'select=id,date,acquisition_type,quantity_kg,total_cost_pkr,cost_per_kg,' +
        'notes,ingredient_id,ingredients(id,name,category),workers(id,name)' +
        '&order=date.desc&limit=2000'),

      // Stock adjustments
      fiSafe('ingredient_stock_adjustments', 'select=ingredient_id,delta_kg'),

      // Batch lines (what was consumed)
      fiSafe('concentrate_batch_lines', 'select=batch_id,ingredient_id,qty_kg_used'),

      // Batches (for stock calc — light)
      fiSafe('concentrate_batches',
        'select=id,qty_kg_produced,recipes(id,output_ingredient_id)'),

      // Batches (for display — full join)
      fiSafe('concentrate_batches',
        'select=id,date,qty_kg_produced,notes,recorded_by,' +
        'workers(name),' +
        'recipes(id,name,output_ingredient_id,out_ing:ingredients!output_ingredient_id(id,name))' +
        '&order=date.desc&limit=200'),

      // Feeding events (for stock decrement)
      fiSafe('feeding_events',
        'select=id,ration_plan_version_id,hay_kg,green_fodder_kg,concentrate_kg&limit=5000'),

      // Ration plan versions (ingredient linkage)
      fiSafe('ration_plan_versions',
        'select=id,hay_ingredient_id,green_fodder_ingredient_id,concentrate_recipe_id'),

      // Active recipes
      fiSafe('recipes',
        'active=eq.true&select=id,name,output_ingredient_id&order=name'),

      // Workers (for modals)
      fiSafe('workers', 'active=eq.true&select=id,name&order=name')
    ]);

    fiIngredients  = r[0];
    fiAcqRows      = r[1];
    fiBatchRows    = r[5];
    fiWorkers      = r[9];
    fiRecipes      = r[8];

    fiStockMap = fiComputeStock(
      fiIngredients, r[1], r[2], r[3], r[4], r[6], r[7], r[8]
    );

    renderFiStock();
    renderFiAcqLog();
    renderFiBatchLog();
    renderAbbrevKey('abbrev-fi', ['PKR']);

  } catch (err) {
    if (stockTbl) stockTbl.innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error('loadIngredientInventory:', err);
  }
}

// ============================================================
// STOCK CALCULATION
// ============================================================
function fiComputeStock(ingredients, acquisitions, adjustments,
                         batchLines, batches, feedEvents,
                         rationVersions, recipes) {
  var map = {};
  ingredients.forEach(function(ing) {
    map[ing.id] = {
      in_acquired: 0, in_adjusted: 0, in_mixed: 0,
      out_mixed: 0, out_hay: 0, out_fodder: 0, out_concentrate: 0,
      unresolved: 0
    };
  });

  // +IN: acquisitions
  acquisitions.forEach(function(a) {
    if (map[a.ingredient_id] && a.quantity_kg != null)
      map[a.ingredient_id].in_acquired += parseFloat(a.quantity_kg);
  });

  // ±: adjustments
  adjustments.forEach(function(a) {
    if (map[a.ingredient_id] && a.delta_kg != null)
      map[a.ingredient_id].in_adjusted += parseFloat(a.delta_kg);
  });

  // −OUT: ingredients consumed in mixing
  batchLines.forEach(function(bl) {
    if (map[bl.ingredient_id] && bl.qty_kg_used != null)
      map[bl.ingredient_id].out_mixed += parseFloat(bl.qty_kg_used);
  });

  // +IN: concentrate produced by batches
  batches.forEach(function(b) {
    var outId = b.recipes && b.recipes.output_ingredient_id;
    if (outId && map[outId] && b.qty_kg_produced != null)
      map[outId].in_mixed += parseFloat(b.qty_kg_produced);
  });

  // Build lookup maps
  var rpvMap = {};
  rationVersions.forEach(function(v) { rpvMap[v.id] = v; });
  var recipeMap = {};
  recipes.forEach(function(r) { recipeMap[r.id] = r; });

  // −OUT: feeding events
  feedEvents.forEach(function(fe) {
    if (!fe.ration_plan_version_id) { return; }
    var rpv = rpvMap[fe.ration_plan_version_id];
    if (!rpv) { return; }

    if (fe.hay_kg && rpv.hay_ingredient_id && map[rpv.hay_ingredient_id])
      map[rpv.hay_ingredient_id].out_hay += parseFloat(fe.hay_kg) || 0;

    if (fe.green_fodder_kg && rpv.green_fodder_ingredient_id && map[rpv.green_fodder_ingredient_id])
      map[rpv.green_fodder_ingredient_id].out_fodder += parseFloat(fe.green_fodder_kg) || 0;

    if (fe.concentrate_kg && rpv.concentrate_recipe_id) {
      var rec = recipeMap[rpv.concentrate_recipe_id];
      if (rec && rec.output_ingredient_id && map[rec.output_ingredient_id])
        map[rec.output_ingredient_id].out_concentrate += parseFloat(fe.concentrate_kg) || 0;
    }
  });

  return map;
}

function fiNetStock(s) {
  return s.in_acquired + s.in_adjusted + s.in_mixed
       - s.out_mixed - s.out_hay - s.out_fodder - s.out_concentrate;
}

// ============================================================
// 1. STOCK SUMMARY
// ============================================================
function renderFiStock() {
  var tbl = document.getElementById('fi-stock-table');
  if (!tbl) return;

  // Count feeding events with no ration plan — warn the user
  var unresolved = 0;
  // (Would need feeding_events data here — for now skip count)

  if (!fiIngredients.length) {
    tbl.innerHTML = '<div class="empty">No active ingredients. Add them in Setup → Ingredients.</div>';
    return;
  }

  document.getElementById('fi-stock-count').textContent =
    fiIngredients.length + ' ingredient' + (fiIngredients.length !== 1 ? 's' : '');

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Ingredient</th><th>Category</th>' +
    '<th class="right">Total in</th>' +
    '<th class="right">Total out</th>' +
    '<th class="right">Adjustments</th>' +
    '<th class="right">Stock</th>' +
    '<th>Status</th><th></th>' +
    '</tr></thead><tbody>';

  // Group by category
  var byCategory = {};
  fiIngredients.forEach(function(ing) {
    var cat = ing.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(ing);
  });

  Object.keys(byCategory).sort().forEach(function(cat) {
    html += '<tr style="background:var(--bg)"><td colspan="8" style="padding:6px 16px;' +
      'font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;' +
      'letter-spacing:0.06em;border-top:2px solid var(--border)">' + cat + '</td></tr>';

    byCategory[cat].forEach(function(ing) {
      var s    = fiStockMap[ing.id] || { in_acquired:0,in_adjusted:0,in_mixed:0,out_mixed:0,out_hay:0,out_fodder:0,out_concentrate:0 };
      var net  = fiNetStock(s);
      var totalIn  = s.in_acquired + s.in_mixed;
      var totalOut = s.out_mixed + s.out_hay + s.out_fodder + s.out_concentrate;
      var reorder  = ing.reorder_point_kg != null ? parseFloat(ing.reorder_point_kg) : null;

      var cls = net <= 0 ? 'inv-stock-zero'
        : (reorder != null && net < reorder ? 'inv-stock-low' : 'inv-stock-pos');

      var statusHtml;
      if (net <= 0)
        statusHtml = '<span class="badge badge-red">Out of stock</span>';
      else if (reorder != null && net < reorder)
        statusHtml = '<span class="badge badge-amber">Low — reorder ≤ ' + r1(reorder) + ' kg</span>';
      else
        statusHtml = '<span class="badge badge-green">OK</span>';

      // tooltip breakdown
      var title = 'In: ' + r1(s.in_acquired) + 'kg purchased/received'
        + (s.in_mixed > 0 ? ' + ' + r1(s.in_mixed) + 'kg mixed' : '')
        + (s.in_adjusted !== 0 ? ' | Adj: ' + r1(s.in_adjusted) + 'kg' : '')
        + ' | Out: ' + r1(s.out_hay) + 'kg hay + '
        + r1(s.out_fodder) + 'kg fodder + '
        + r1(s.out_concentrate) + 'kg concentrate'
        + (s.out_mixed > 0 ? ' + ' + r1(s.out_mixed) + 'kg in mixing' : '');

      html += '<tr title="' + title + '">' +
        '<td style="font-weight:500">' + ing.name + '</td>' +
        '<td>' + (ing.category ? '<span class="badge ' + (CAT_BADGE[ing.category] || 'badge-gray') + '">' + ing.category + '</span>' : '—') + '</td>' +
        '<td class="mono right">' + r1(totalIn).toLocaleString() + ' kg</td>' +
        '<td class="mono right">' + r1(totalOut).toLocaleString() + ' kg</td>' +
        '<td class="mono right ' + (s.in_adjusted > 0 ? 'inv-stock-pos' : s.in_adjusted < 0 ? 'inv-stock-low' : '') + '">' +
          (s.in_adjusted !== 0 ? (s.in_adjusted > 0 ? '+' : '') + r1(s.in_adjusted) + ' kg' : '—') + '</td>' +
        '<td class="mono right ' + cls + '" style="font-weight:500">' + r1(net).toLocaleString() + ' kg</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td><button class="btn btn-sm" onclick="openFiAdj(' + ing.id + ',\'' +
          ing.name.replace(/'/g, "\\'") + '\')">Adjust</button></td>' +
        '</tr>';
    });
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ============================================================
// 2. ACQUISITION LOG
// ============================================================
function renderFiAcqLog() {
  var tbl = document.getElementById('fi-acq-table');
  if (!tbl) return;

  document.getElementById('fi-acq-count').textContent =
    fiAcqRows.length + ' record' + (fiAcqRows.length !== 1 ? 's' : '');

  if (!fiAcqRows.length) {
    tbl.innerHTML = '<div class="empty">No acquisitions logged. Use the buttons above to add stock.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Ingredient</th><th>Category</th><th>Type</th>' +
    '<th class="right">Qty (kg)</th><th class="right">Total cost</th>' +
    '<th class="right">Cost / kg</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';

  fiAcqRows.forEach(function(r) {
    var ing = r.ingredients || {};
    if (String(fiAcqEditId) === String(r.id)) {
      html += '<tr class="ing-selected">' +
        '<td><input type="date" id="fi-pe-date" value="' + (r.date || '') + '" style="width:130px"></td>' +
        '<td style="font-weight:500">' + (ing.name || '—') + '</td>' +
        '<td>' + (ing.category ? '<span class="badge ' + (CAT_BADGE[ing.category] || 'badge-gray') + '">' + ing.category + '</span>' : '—') + '</td>' +
        '<td><select id="fi-pe-type" style="width:130px">' +
          ['purchased','produced','harvested','vet_supplied'].map(function(t) {
            return '<option value="' + t + '"' + (r.acquisition_type === t ? ' selected' : '') + '>' + (FI_ACQ_LABEL[t] || t) + '</option>';
          }).join('') + '</select></td>' +
        '<td class="right"><input type="number" id="fi-pe-qty" value="' + (r.quantity_kg != null ? r.quantity_kg : '') + '" min="0.001" step="0.1" style="width:75px" oninput="fiPeAutoCalc()"></td>' +
        '<td class="right"><input type="number" id="fi-pe-total" value="' + (r.total_cost_pkr != null ? r.total_cost_pkr : '') + '" min="0" step="1" style="width:90px" oninput="fiPeAutoCalc()"></td>' +
        '<td class="mono right" id="fi-pe-cpk">' + (r.cost_per_kg != null ? pkr(r.cost_per_kg) + '/kg' : '—') + '</td>' +
        '<td><input type="text" id="fi-pe-notes" value="' + (r.notes || '').replace(/"/g, '&quot;') + '" style="width:120px"></td>' +
        '<td><div style="display:flex;gap:6px;white-space:nowrap">' +
          '<button class="btn btn-sm btn-primary" onclick="saveFiAcqEdit(' + r.id + ')">Save</button>' +
          '<button class="btn btn-sm" onclick="cancelFiAcqEdit()">Cancel</button>' +
        '</div></td></tr>';
    } else {
      html += '<tr>' +
        '<td class="mono">' + fmtDate(r.date) + '</td>' +
        '<td style="font-weight:500">' + (ing.name || '—') + '</td>' +
        '<td>' + (ing.category ? '<span class="badge ' + (CAT_BADGE[ing.category] || 'badge-gray') + '">' + ing.category + '</span>' : '—') + '</td>' +
        '<td><span class="badge ' + (FI_ACQ_BADGE[r.acquisition_type] || 'badge-gray') + '">' + (FI_ACQ_LABEL[r.acquisition_type] || r.acquisition_type || '—') + '</span></td>' +
        '<td class="mono right">' + (r.quantity_kg != null ? r1(r.quantity_kg).toLocaleString() : '—') + '</td>' +
        '<td class="mono right">' + (r.total_cost_pkr != null ? pkr(r.total_cost_pkr) : '—') + '</td>' +
        '<td class="mono right">' + (r.cost_per_kg != null ? pkr(r.cost_per_kg) + '/kg' : '—') + '</td>' +
        '<td class="muted-cell" style="font-size:12px;max-width:160px">' + (r.notes || '') + '</td>' +
        '<td><div style="display:flex;gap:5px;white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="editFiAcq(' + r.id + ')">Edit</button>' +
          '<button class="btn btn-sm del-btn" onclick="deleteFiAcq(' + r.id + ')">Delete</button>' +
        '</div></td></tr>';
    }
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function editFiAcq(id)   { fiAcqEditId = id; renderFiAcqLog(); }
function cancelFiAcqEdit() { fiAcqEditId = null; renderFiAcqLog(); }

function fiPeAutoCalc() {
  var qty   = parseFloat((document.getElementById('fi-pe-qty')   || {}).value);
  var total = parseFloat((document.getElementById('fi-pe-total') || {}).value);
  var el    = document.getElementById('fi-pe-cpk');
  if (el && qty > 0 && !isNaN(total) && total > 0)
    el.textContent = pkr(total / qty) + '/kg';
}

async function saveFiAcqEdit(id) {
  var date  = (document.getElementById('fi-pe-date')  || {}).value;
  var type  = (document.getElementById('fi-pe-type')  || {}).value;
  var qty   = parseFloat((document.getElementById('fi-pe-qty')   || {}).value);
  var total = parseFloat((document.getElementById('fi-pe-total') || {}).value);
  var notes = ((document.getElementById('fi-pe-notes') || {}).value || '').trim() || null;
  if (!date || isNaN(qty) || qty <= 0) { alert('Date and quantity required.'); return; }
  try {
    await sbPatch('ingredient_acquisitions', id, {
      date: date, acquisition_type: type, quantity_kg: qty,
      total_cost_pkr: isNaN(total) ? null : total, notes: notes
    });
    fiAcqEditId = null;
    await loadIngredientInventory();
  } catch (err) { alert('Save failed: ' + err.message); }
}

async function deleteFiAcq(id) {
  if (!confirm('Delete this acquisition record?')) return;
  try {
    await sbDelete('ingredient_acquisitions', id);
    await loadIngredientInventory();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ============================================================
// 3. CONCENTRATE BATCH LOG
// ============================================================
function renderFiBatchLog() {
  var tbl = document.getElementById('fi-batch-table');
  if (!tbl) return;

  document.getElementById('fi-batch-count').textContent =
    fiBatchRows.length + ' batch' + (fiBatchRows.length !== 1 ? 'es' : '');

  if (!fiBatchRows.length) {
    tbl.innerHTML = '<div class="empty">No concentrate batches mixed yet.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Recipe</th><th>Output ingredient</th>' +
    '<th class="right">Produced</th><th>Worker</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';

  fiBatchRows.forEach(function(b) {
    var rec    = b.recipes || {};
    var outIng = rec.out_ing || {};
    html += '<tr>' +
      '<td class="mono">' + fmtDate(b.date) + '</td>' +
      '<td style="font-weight:500">' + (rec.name || '—') + '</td>' +
      '<td>' + (outIng.name ? '<span class="badge badge-lime">' + outIng.name + '</span>' : '<span class="badge badge-amber">Not set</span>') + '</td>' +
      '<td class="mono right">' + (b.qty_kg_produced != null ? r1(parseFloat(b.qty_kg_produced)).toLocaleString() + ' kg' : '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (b.workers ? b.workers.name : '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (b.notes || '') + '</td>' +
      '<td><button class="btn btn-sm del-btn" onclick="deleteFiBatch(' + b.id + ')">Delete</button></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function deleteFiBatch(id) {
  if (!confirm('Delete this batch? Ingredient stock will be recalculated. Cannot be undone.')) return;
  try {
    await sbDelete('concentrate_batches', id);  // cascade deletes batch_lines
    await loadIngredientInventory();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ============================================================
// ACQUISITION MODAL (purchase / harvest receipt)
// ============================================================
function openFiAcqModal(type) {
  // type: 'purchased' or 'harvested'
  var titleEl = document.getElementById('fi-acq-modal-title');
  if (titleEl) titleEl.textContent = type === 'harvested' ? 'Log harvest receipt' : 'Log purchase';

  // Show/hide cost fields (optional for harvest receipts)
  var costSection = document.getElementById('fi-acq-cost-section');
  if (costSection) costSection.style.display = type === 'harvested' ? 'none' : '';

  // Populate ingredient select
  var ingEl = document.getElementById('fi-acq-ing');
  if (ingEl) {
    ingEl.innerHTML = '<option value="">Select ingredient</option>' +
      fiIngredients.map(function(ing) {
        return '<option value="' + ing.id + '">' + ing.name +
          (ing.category ? ' (' + ing.category + ')' : '') + '</option>';
      }).join('');
  }

  // Set type
  var typeEl = document.getElementById('fi-acq-type');
  if (typeEl) typeEl.value = type;

  // Populate worker select
  var wkrEl = document.getElementById('fi-acq-worker');
  if (wkrEl) {
    wkrEl.innerHTML = '<option value="">— none —</option>' +
      fiWorkers.map(function(w) {
        return '<option value="' + w.id + '">' + w.name + '</option>';
      }).join('');
  }

  document.getElementById('fi-acq-date').value = todayISO();
  ['fi-acq-qty','fi-acq-total','fi-acq-notes'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('fi-acq-cpk-display').textContent = '';
  document.getElementById('fi-acq-status').textContent = '';
  document.getElementById('fi-acq-modal').style.display = 'flex';
}

function closeFiAcqModal() {
  document.getElementById('fi-acq-modal').style.display = 'none';
}

function fiAcqAutoCalc() {
  var qty   = parseFloat((document.getElementById('fi-acq-qty')   || {}).value);
  var total = parseFloat((document.getElementById('fi-acq-total') || {}).value);
  var el    = document.getElementById('fi-acq-cpk-display');
  if (el) el.textContent = (qty > 0 && !isNaN(total) && total > 0)
    ? '→ ' + pkr(total / qty) + ' / kg' : '';
}

async function submitFiAcq() {
  var statusEl = document.getElementById('fi-acq-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('fi-acq-date').value;
    var ingId  = document.getElementById('fi-acq-ing').value;
    var type   = document.getElementById('fi-acq-type').value || 'purchased';
    var qty    = parseFloat(document.getElementById('fi-acq-qty').value);
    var total  = parseFloat(document.getElementById('fi-acq-total').value);
    var worker = document.getElementById('fi-acq-worker').value;
    var notes  = (document.getElementById('fi-acq-notes').value || '').trim() || null;
    if (!date)             throw new Error('Date required.');
    if (!ingId)            throw new Error('Select an ingredient.');
    if (isNaN(qty) || qty <= 0) throw new Error('Quantity must be greater than zero.');
    var d = {
      date: date, ingredient_id: parseInt(ingId),
      acquisition_type: type, quantity_kg: qty,
      total_cost_pkr: isNaN(total) ? null : total,
      recorded_by: worker ? parseInt(worker) : null,
      notes: notes
    };
    await sbInsert('ingredient_acquisitions', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeFiAcqModal(); loadIngredientInventory(); }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// CONCENTRATE BATCH MODAL
// ============================================================
async function openFiBatchModal() {
  // Populate recipes
  var recEl = document.getElementById('fi-batch-recipe');
  if (recEl) {
    recEl.innerHTML = '<option value="">Select recipe</option>' +
      fiRecipes.map(function(r) {
        var outIng = r.output_ingredient_id
          ? (fiIngredients.find(function(i) { return i.id === r.output_ingredient_id; }) || {}).name
          : null;
        var suffix = outIng ? ' → ' + outIng : ' ⚠ no output set';
        return '<option value="' + r.id + '"' + (!r.output_ingredient_id ? ' style="color:var(--red)"' : '') + '>' +
          r.name + suffix + '</option>';
      }).join('');
  }

  // Populate workers
  var wkrEl = document.getElementById('fi-batch-worker');
  if (wkrEl) {
    wkrEl.innerHTML = '<option value="">— none —</option>' +
      fiWorkers.map(function(w) {
        return '<option value="' + w.id + '">' + w.name + '</option>';
      }).join('');
  }

  document.getElementById('fi-batch-date').value = todayISO();
  document.getElementById('fi-batch-qty').value  = '';
  document.getElementById('fi-batch-notes').value = '';
  document.getElementById('fi-batch-preview').innerHTML = '';
  document.getElementById('fi-batch-status').textContent = '';
  fiBatchRecipeLines = [];
  document.getElementById('fi-batch-modal').style.display = 'flex';
}

function closeFiBatchModal() {
  document.getElementById('fi-batch-modal').style.display = 'none';
}

async function fiBatchRecipeChanged() {
  var recId = document.getElementById('fi-batch-recipe').value;
  fiBatchRecipeLines = [];
  document.getElementById('fi-batch-preview').innerHTML = '';
  if (!recId) return;

  try {
    // Find the latest version of this recipe
    var vers = await sbGet('recipe_versions',
      'recipe_id=eq.' + recId + '&select=id&order=version_number.desc&limit=1');
    if (!vers.length) {
      // Try recipe_ingredients directly (flat structure)
      var lines = await sbGet('recipe_ingredients',
        'recipe_id=eq.' + recId +
        '&select=ingredient_id,inclusion_rate,ingredients(id,name)');
      fiBatchRecipeLines = lines;
    } else {
      var lines2 = await sbGet('recipe_ingredients',
        'recipe_version_id=eq.' + vers[0].id +
        '&select=ingredient_id,inclusion_rate,ingredients(id,name)');
      fiBatchRecipeLines = lines2;
    }
  } catch (err) {
    // Try flat recipe_ingredients
    try {
      var lines3 = await sbGet('recipe_ingredients',
        'recipe_id=eq.' + recId +
        '&select=ingredient_id,inclusion_rate,ingredients(id,name)');
      fiBatchRecipeLines = lines3;
    } catch (e) {
      document.getElementById('fi-batch-preview').innerHTML =
        '<div style="color:var(--red);font-size:13px">Could not load recipe ingredients: ' + e.message + '</div>';
      return;
    }
  }

  fiBatchUpdatePreview();
}

function fiBatchUpdatePreview() {
  var qty  = parseFloat(document.getElementById('fi-batch-qty').value);
  var prev = document.getElementById('fi-batch-preview');
  if (!fiBatchRecipeLines.length) { prev.innerHTML = ''; return; }

  var recipe = fiRecipes.find(function(r) {
    return String(r.id) === String(document.getElementById('fi-batch-recipe').value);
  });
  var outIng = recipe && recipe.output_ingredient_id
    ? fiIngredients.find(function(i) { return i.id === recipe.output_ingredient_id; })
    : null;

  if (!qty || isNaN(qty) || qty <= 0) {
    prev.innerHTML = '<div style="font-size:12px;color:var(--muted)">Enter quantity to see ingredient requirements.</div>';
    return;
  }

  var rows = '<div style="margin-top:12px"><div style="font-size:11px;font-weight:600;color:var(--muted);' +
    'text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Ingredients required</div>' +
    '<table style="width:100%;font-size:12px"><thead><tr>' +
    '<th style="text-align:left;padding:4px 8px">Ingredient</th>' +
    '<th style="text-align:right;padding:4px 8px">Rate</th>' +
    '<th style="text-align:right;padding:4px 8px">Needed</th>' +
    '<th style="text-align:right;padding:4px 8px">In stock</th>' +
    '<th style="text-align:right;padding:4px 8px">After</th>' +
    '</tr></thead><tbody>';

  var allOk = true;
  fiBatchRecipeLines.forEach(function(line) {
    var rate    = parseFloat(line.inclusion_rate) || 0;
    var needed  = qty * rate;
    var stock   = fiStockMap[line.ingredient_id] ? fiNetStock(fiStockMap[line.ingredient_id]) : 0;
    var after   = stock - needed;
    var ok      = after >= 0;
    if (!ok) allOk = false;
    var ingName = (line.ingredients || {}).name || '?';
    rows += '<tr style="' + (!ok ? 'background:#FEF2F2' : '') + '">' +
      '<td style="padding:4px 8px;font-weight:500">' + ingName + '</td>' +
      '<td style="padding:4px 8px;text-align:right;color:var(--muted)">' + (rate * 100).toFixed(1) + '%</td>' +
      '<td style="padding:4px 8px;text-align:right;font-family:var(--mono)">' + r1(needed) + ' kg</td>' +
      '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);' +
        (stock < needed ? 'color:var(--red)' : 'color:var(--green)') + '">' + r1(stock) + ' kg</td>' +
      '<td style="padding:4px 8px;text-align:right;font-family:var(--mono);' +
        (after < 0 ? 'color:var(--red);font-weight:500' : 'color:var(--muted)') + '">' + r1(after) + ' kg</td>' +
      '</tr>';
  });

  rows += '</tbody></table>';
  if (outIng) {
    var curConc = fiStockMap[outIng.id] ? fiNetStock(fiStockMap[outIng.id]) : 0;
    rows += '<div style="margin-top:10px;padding:8px 10px;background:var(--bg);border-radius:7px;font-size:12px">' +
      '<strong>' + outIng.name + '</strong> stock: ' + r1(curConc) + ' kg → ' +
      r1(curConc + qty) + ' kg after mixing</div>';
  }
  if (!allOk) {
    rows += '<div style="margin-top:8px;padding:8px 10px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:7px;font-size:12px;color:var(--red)">' +
      '⚠ Insufficient stock for one or more ingredients. Purchase more before mixing.</div>';
  }
  rows += '</div>';
  prev.innerHTML = rows;
}

async function submitFiBatch() {
  var statusEl = document.getElementById('fi-batch-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('fi-batch-date').value;
    var recId  = document.getElementById('fi-batch-recipe').value;
    var qty    = parseFloat(document.getElementById('fi-batch-qty').value);
    var worker = document.getElementById('fi-batch-worker').value;
    var notes  = (document.getElementById('fi-batch-notes').value || '').trim() || null;

    if (!date)              throw new Error('Date required.');
    if (!recId)             throw new Error('Select a recipe.');
    if (isNaN(qty)||qty<=0) throw new Error('Enter a valid quantity.');
    if (!fiBatchRecipeLines.length) throw new Error('Recipe has no ingredients. Check recipe setup.');

    var recipe = fiRecipes.find(function(r) { return String(r.id) === String(recId); });
    if (!recipe || !recipe.output_ingredient_id)
      throw new Error('This recipe has no output ingredient set. Go to Setup → Recipes and set one.');

    // Insert batch
    var batchResult = await sbInsert('concentrate_batches', [{
      date: date,
      recipe_id: parseInt(recId),
      qty_kg_produced: qty,
      notes: notes,
      recorded_by: worker ? parseInt(worker) : null
    }]);

    // Get the new batch id
    var batchId = batchResult && batchResult[0] && batchResult[0].id;
    if (!batchId) throw new Error('Batch saved but could not retrieve ID.');

    // Insert batch lines (ingredient consumption)
    var lines = fiBatchRecipeLines
      .filter(function(l) { return l.ingredient_id && parseFloat(l.inclusion_rate) > 0; })
      .map(function(l) {
        return {
          batch_id: batchId,
          ingredient_id: l.ingredient_id,
          qty_kg_used: parseFloat((qty * parseFloat(l.inclusion_rate)).toFixed(4))
        };
      });

    if (lines.length) await sbInsert('concentrate_batch_lines', lines);

    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeFiBatchModal(); loadIngredientInventory(); }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// STOCK ADJUSTMENT MODAL
// ============================================================
function openFiAdj(ingId, ingName) {
  fiAdjIngId = ingId;
  document.getElementById('fi-adj-title').textContent = 'Adjust stock — ' + ingName;
  document.getElementById('fi-adj-date').value  = todayISO();
  document.getElementById('fi-adj-delta').value = '';
  document.getElementById('fi-adj-reason').value = 'count';
  document.getElementById('fi-adj-notes').value = '';
  document.getElementById('fi-adj-status').textContent = '';
  document.getElementById('fi-adj-modal').style.display = 'flex';
}

function closeFiAdj() {
  document.getElementById('fi-adj-modal').style.display = 'none';
}

async function submitFiAdj() {
  var statusEl = document.getElementById('fi-adj-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('fi-adj-date').value;
    var delta  = parseFloat(document.getElementById('fi-adj-delta').value);
    var reason = document.getElementById('fi-adj-reason').value;
    var notes  = (document.getElementById('fi-adj-notes').value || '').trim() || null;
    if (!fiAdjIngId || !date || isNaN(delta) || delta === 0)
      throw new Error('Date and a non-zero delta are required.');
    await sbInsert('ingredient_stock_adjustments', [{
      ingredient_id: fiAdjIngId, date: date, delta_kg: delta,
      reason: reason, notes: notes
    }]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeFiAdj(); loadIngredientInventory(); }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
