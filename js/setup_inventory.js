// ============================================================
// setup_inventory.js v19 — Inventory page
// ============================================================
//
// Feed ingredients are now tracked in Feed → Ingredient Inventory
// (fd_inventory.js). This page shows fertilizer stock only.
//
// Fertilizers:
//   Stock = sum(fertilizer_purchases.qty × quantity_per_purchase_unit)
//           − sum(gypsum_applications.kg_applied)
//           − sum(amendment_applications.kg_applied)
//   Unit: kg for solids, L for liquids (derived from type).
//   Reorder warning shown when stock < reorder_point.
// ============================================================

var invFertStock  = {};   // fertilizer_id  → { purchased, applied }
var invFertList   = [];

async function loadInventoryPage() {
  document.getElementById('inv-ing-table').innerHTML  = '<div class="loading">Loading…</div>';
  document.getElementById('inv-fert-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('fertilizers',
        'active=eq.true&select=id,name,type,quantity_per_purchase_unit,reorder_point&order=name'),
      sbGet('fertilizer_purchases',
        'select=fertilizer_id,qty'),
      sbGet('fertilizer_applications',
        'select=fertilizer_id,kg_applied')
    ]);

    invFertList = r[0];

    // ── Fertilizer stock ──────────────────────────────────────
    // Build a lookup of quantity_per_purchase_unit by fertilizer_id
    var qpuMap = {};
    invFertList.forEach(function(f) {
      invFertStock[f.id] = { purchased: 0, applied: 0 };
      qpuMap[f.id] = f.quantity_per_purchase_unit != null
        ? parseFloat(f.quantity_per_purchase_unit) : null;
    });

    // Purchases: qty is in purchase units (bags / containers)
    // Multiply by quantity_per_purchase_unit to get kg or L
    r[1].forEach(function(p) {
      if (!invFertStock[p.fertilizer_id] || p.qty == null) return;
      var qpu = qpuMap[p.fertilizer_id];
      if (qpu != null) {
        invFertStock[p.fertilizer_id].purchased += parseFloat(p.qty) * qpu;
      } else {
        // No conversion factor set yet — store raw qty as fallback
        // so the row still shows something rather than 0
        invFertStock[p.fertilizer_id].purchased += parseFloat(p.qty);
      }
    });

    // Applications are always recorded in kg / L (no conversion needed)
    r[2].forEach(function(a) {
      if (a.fertilizer_id && invFertStock[a.fertilizer_id] && a.kg_applied != null)
        invFertStock[a.fertilizer_id].applied += parseFloat(a.kg_applied);
    });

    renderInvIng();
    renderInvFert();
    renderAbbrevKey('abbrev-inventory', ['PKR']);
  } catch (err) {
    document.getElementById('inv-ing-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

// ============================================================
// INGREDIENT STOCK TABLE — moved to fd_inventory.js
// ============================================================
function renderInvIng() {
  var tbl = document.getElementById('inv-ing-table');
  if (tbl) tbl.innerHTML =
    '<div style="padding:18px 22px;font-size:13px;color:var(--muted)">' +
    'Ingredient stock is now tracked in ' +
    '<a href="#" onclick="showPage(\'inginventory\',null);return false;" ' +
    'style="color:var(--accent);font-weight:500">Feed \u2192 Ingredient Inventory</a>. ' +
    'That page shows real-time stock accounting for purchases, harvest receipts, ' +
    'concentrate batches, and feeding events.</div>';
}

// ============================================================
// FERTILIZER STOCK TABLE
// ============================================================
function renderInvFert() {
  var tbl = document.getElementById('inv-fert-table');
  if (!invFertList.length) {
    tbl.innerHTML = '<div class="empty">No active fertilizers.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Fertilizer</th>' +
    '<th>Unit</th>' +
    '<th class="right">Purchased</th>' +
    '<th class="right">Applied</th>' +
    '<th class="right">Current stock</th>' +
    '<th>Status</th>' +
    '</tr></thead><tbody>';

  invFertList.forEach(function(f) {
    var st    = invFertStock[f.id] || { purchased: 0, applied: 0 };
    var stock = st.purchased - st.applied;
    var su    = f.type === 'liquid' ? 'L' : 'kg';
    var noConv = f.quantity_per_purchase_unit == null;

    var stockCls = stock <= 0 ? 'inv-stock-zero'
      : (f.reorder_point != null && stock < f.reorder_point ? 'inv-stock-low'
      : 'inv-stock-pos');

    // Status badge
    var statusHtml = '';
    if (noConv) {
      statusHtml = '<span class="badge badge-amber" title="Set kg/bag in the registry to get accurate stock">⚠ No conversion set</span>';
    } else if (stock <= 0) {
      statusHtml = '<span class="badge badge-red">Out of stock</span>';
    } else if (f.reorder_point != null && stock < f.reorder_point) {
      statusHtml = '<span class="badge badge-amber">Low — reorder ≤ ' +
        r1(f.reorder_point) + ' ' + su + '</span>';
    } else {
      statusHtml = '<span class="badge badge-green">OK</span>';
    }

    html += '<tr>' +
      '<td style="font-weight:500">' + f.name + '</td>' +
      '<td class="muted-cell">' + su + '</td>' +
      '<td class="mono right">' + r1(st.purchased).toLocaleString() + ' ' + su + '</td>' +
      '<td class="mono right">' + r1(st.applied).toLocaleString()   + ' ' + su + '</td>' +
      '<td class="mono right ' + stockCls + '">' + r1(stock).toLocaleString() + ' ' + su + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}
