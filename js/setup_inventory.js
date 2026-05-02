// ============================================================
// setup_inventory.js v17 — Inventory page
// ============================================================

// INVENTORY PAGE
// Two sections:
//   1. Feed ingredients — manual stock = sum(ingredient_acquisitions.quantity_kg)
//      + sum(ingredient_stock_adjustments.delta_kg). User adjusts via modal.
//   2. Fertilizers — auto-calc = sum(fertilizer_purchases.qty)
//      − sum applied (gypsum_applications + amendment_applications where fertilizer_id matches).
// ============================================================
var invIngStock      = {};   // ingredient_id -> {purchased, adjusted, total}
var invFertStock     = {};   // fertilizer_id -> {purchased, applied, stock}
var invIngList       = [];   // [{id,name,category}]
var invFertList      = [];
var stockAdjIngId    = null;

async function loadInventoryPage() {
  document.getElementById('inv-ing-table').innerHTML  = '<div class="loading">Loading…</div>';
  document.getElementById('inv-fert-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('ingredients',                    'active=eq.true&select=id,name,category&order=category,name'),
      sbGet('ingredient_acquisitions',        'select=ingredient_id,quantity_kg'),
      sbGet('ingredient_stock_adjustments',   'select=ingredient_id,delta_kg'),
      sbGet('fertilizers',                    'active=eq.true&select=id,name,unit&order=name'),
      sbGet('fertilizer_purchases',           'select=fertilizer_id,qty'),
      sbGet('gypsum_applications',            'select=fertilizer_id,kg_applied'),
      sbGet('amendment_applications',         'select=fertilizer_id,kg_applied')
    ]);
    invIngList   = r[0];
    invFertList  = r[3];

    // Ingredient stock
    invIngStock = {};
    invIngList.forEach(function(i) { invIngStock[i.id] = { purchased: 0, adjusted: 0 }; });
    r[1].forEach(function(a) {
      if (invIngStock[a.ingredient_id] && a.quantity_kg != null) {
        invIngStock[a.ingredient_id].purchased += parseFloat(a.quantity_kg);
      }
    });
    r[2].forEach(function(a) {
      if (invIngStock[a.ingredient_id] && a.delta_kg != null) {
        invIngStock[a.ingredient_id].adjusted += parseFloat(a.delta_kg);
      }
    });

    // Fertilizer stock
    invFertStock = {};
    invFertList.forEach(function(f) { invFertStock[f.id] = { purchased: 0, applied: 0 }; });
    r[4].forEach(function(p) {
      if (invFertStock[p.fertilizer_id] && p.qty != null) {
        invFertStock[p.fertilizer_id].purchased += parseFloat(p.qty);
      }
    });
    r[5].forEach(function(g) {
      if (g.fertilizer_id && invFertStock[g.fertilizer_id] && g.kg_applied != null) {
        invFertStock[g.fertilizer_id].applied += parseFloat(g.kg_applied);
      }
    });
    r[6].forEach(function(a) {
      if (a.fertilizer_id && invFertStock[a.fertilizer_id] && a.kg_applied != null) {
        invFertStock[a.fertilizer_id].applied += parseFloat(a.kg_applied);
      }
    });

    renderInvIng();
    renderInvFert();
    renderAbbrevKey('abbrev-inventory', ['PKR']);
  } catch (err) {
    document.getElementById('inv-ing-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderInvIng() {
  var tbl = document.getElementById('inv-ing-table');
  if (!invIngList.length) {
    tbl.innerHTML = '<div class="empty">No ingredients.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Ingredient</th><th>Category</th>' +
    '<th class="right">Total purchased (kg)</th>' +
    '<th class="right">Net adjustments (kg)</th>' +
    '<th class="right">Current stock (kg)</th><th></th>' +
    '</tr></thead><tbody>';
  invIngList.forEach(function(i) {
    var st = invIngStock[i.id] || { purchased: 0, adjusted: 0 };
    var stock = st.purchased + st.adjusted;
    var stockClass = stock <= 0 ? 'inv-stock-zero' : (stock < 10 ? 'inv-stock-low' : 'inv-stock-pos');
    html += '<tr>' +
      '<td style="font-weight:500">' + i.name + '</td>' +
      '<td>' + (i.category
        ? '<span class="badge ' + (CAT_BADGE[i.category] || 'badge-gray') + '">' + i.category + '</span>'
        : '<span class="muted-cell">—</span>') + '</td>' +
      '<td class="mono right">' + r1(st.purchased).toLocaleString() + '</td>' +
      '<td class="mono right">' + (st.adjusted > 0 ? '+' : '') + r1(st.adjusted).toLocaleString() + '</td>' +
      '<td class="mono right ' + stockClass + '">' + r1(stock).toLocaleString() + ' kg</td>' +
      '<td><button class="btn btn-sm" onclick="openStockAdjModal(' + i.id + ',\'' +
        i.name.replace(/'/g, "\\'") + '\')">Adjust</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function renderInvFert() {
  var tbl = document.getElementById('inv-fert-table');
  if (!invFertList.length) {
    tbl.innerHTML = '<div class="empty">No active fertilizers.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Fertilizer</th><th>Unit</th>' +
    '<th class="right">Total purchased</th>' +
    '<th class="right">Total applied</th>' +
    '<th class="right">Current stock</th>' +
    '</tr></thead><tbody>';
  invFertList.forEach(function(f) {
    var st = invFertStock[f.id] || { purchased: 0, applied: 0 };
    var stock = st.purchased - st.applied;
    var stockClass = stock <= 0 ? 'inv-stock-zero' : (stock < 50 ? 'inv-stock-low' : 'inv-stock-pos');
    html += '<tr>' +
      '<td style="font-weight:500">' + f.name + '</td>' +
      '<td class="muted-cell">' + f.unit + '</td>' +
      '<td class="mono right">' + r1(st.purchased).toLocaleString() + ' ' + f.unit + '</td>' +
      '<td class="mono right">' + r1(st.applied).toLocaleString() + ' ' + f.unit + '</td>' +
      '<td class="mono right ' + stockClass + '">' + r1(stock).toLocaleString() + ' ' + f.unit + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function openStockAdjModal(ingId, ingName) {
  stockAdjIngId = ingId;
  document.getElementById('stock-adj-title').textContent = 'Adjust stock — ' + ingName;
  document.getElementById('stock-adj-desc').textContent =
    'Use a positive delta to add stock (e.g. found extra during count); negative to remove (used for feeding, spoilage).';
  document.getElementById('sa-date').value = todayISO();
  document.getElementById('sa-delta').value = '';
  document.getElementById('sa-reason').value = 'count';
  document.getElementById('sa-notes').value = '';
  document.getElementById('sa-status').textContent = '';
  document.getElementById('stock-adj-modal').style.display = 'flex';
}
function closeStockAdjModal() { document.getElementById('stock-adj-modal').style.display = 'none'; }
async function submitStockAdj() {
  var statusEl = document.getElementById('sa-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date  = document.getElementById('sa-date').value;
    var delta = parseFloat(document.getElementById('sa-delta').value);
    var reason = document.getElementById('sa-reason').value;
    var notes = document.getElementById('sa-notes').value.trim();
    if (!stockAdjIngId || !date || isNaN(delta) || delta === 0)
      throw new Error('Date and a non-zero delta are required.');
    var d = {
      ingredient_id: stockAdjIngId, date: date,
      delta_kg: delta, reason: reason
    };
    if (notes) d.notes = notes;
    await sbInsert('ingredient_stock_adjustments', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeStockAdjModal(); loadInventoryPage(); }, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
