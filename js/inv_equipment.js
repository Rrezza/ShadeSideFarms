// ============================================================
// inv_equipment.js — Inventory › Tools & Equipment
// Equipment (durable items): name, category, quantity, condition, purchase
// date and cost, plus a repair / maintenance log with costs. Totals show what
// is invested in equipment and spent keeping it running.
// The page's second section, Consumables (fuel, twine, feed bags…), is the
// shared stock ledger in health_meds.js (loadFarmSupplies, #fsup-content).
// Equipment is added and edited here — there is no Setup page for it.
// Depends on: shared.js, health_meds.js (medEsc, loadFarmSupplies)
// Reads/writes: tools, tool_repairs
// ============================================================

var eqTools      = [];         // tools rows (active + retired)
var eqRepairs    = [];         // tool_repairs rows, newest first
var eqEditId     = null;       // tool being edited in the form (null = adding)
var eqFormOpen   = false;
var eqExpanded   = new Set();  // tool ids with their repair log open

var EQ_CONDITIONS = [
  ['new', 'New'], ['good', 'Good'], ['fair', 'Fair'], ['needs_repair', 'Needs repair'], ['broken', 'Broken']
];
var EQ_CONDITION_BADGE = { new: 'badge-green', good: 'badge-green', fair: 'badge-amber', needs_repair: 'badge-red', broken: 'badge-red' };

async function loadEquipmentPage() {
  var el = document.getElementById('equip-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await loadModule('health_meds');
    var r = await Promise.all([
      sbGet('tools', 'select=*&order=name'),
      sbGet('tool_repairs', 'select=*&order=date.desc,id.desc')
    ]);
    eqTools = r[0];
    eqRepairs = r[1];
    renderEquipment();
    // Consumables section (shared ledger) renders into its own container
    loadFarmSupplies();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function eqRepairsFor(toolId) {
  return eqRepairs.filter(function(r) { return r.tool_id === toolId; });
}

function eqRepairTotal(toolId) {
  return eqRepairsFor(toolId).reduce(function(s, r) { return s + (r.cost_pkr != null ? Number(r.cost_pkr) : 0); }, 0);
}

function eqConditionLabel(c) {
  var hit = EQ_CONDITIONS.find(function(x) { return x[0] === c; });
  return hit ? hit[1] : (c || '—');
}

function renderEquipment() {
  var active = eqTools.filter(function(t) { return t.active; });
  var invested = active.reduce(function(s, t) { return s + (t.purchase_cost_pkr != null ? Number(t.purchase_cost_pkr) : 0); }, 0);
  var repairs = eqRepairs.reduce(function(s, r) { return s + (r.cost_pkr != null ? Number(r.cost_pkr) : 0); }, 0);
  var attention = active.filter(function(t) { return t.condition === 'needs_repair' || t.condition === 'broken'; }).length;

  var html =
    '<div class="metrics-row">' +
      '<div class="metric-card"><div class="m-label">Equipment items</div><div class="m-value">' +
        active.reduce(function(s, t) { return s + (t.quantity || 1); }, 0) + '</div>' +
        '<div class="m-sub">' + active.length + ' kind' + (active.length !== 1 ? 's' : '') +
        (attention ? ' &middot; <span style="color:var(--red)">' + attention + ' need' + (attention === 1 ? 's' : '') + ' repair</span>' : '') + '</div></div>' +
      '<div class="metric-card"><div class="m-label">Invested in equipment</div><div class="m-value">' + pkr(invested) + '</div>' +
        '<div class="m-sub">purchase cost of items in use</div></div>' +
      '<div class="metric-card"><div class="m-label">Spent on repairs</div><div class="m-value">' + pkr(repairs) + '</div>' +
        '<div class="m-sub">all repair &amp; maintenance logged</div></div>' +
    '</div>' +
    '<div class="section">' +
      '<div class="section-hdr"><h2>Equipment</h2>' +
      '<button class="btn btn-sm btn-primary" onclick="openEquipForm(null)">+ Add equipment</button></div>' +
      '<div id="eq-form-wrap"></div>' +
      '<div id="eq-table"></div>' +
    '</div>';
  document.getElementById('equip-content').innerHTML = html;
  if (eqFormOpen) renderEquipForm();
  renderEquipTable();
}

function renderEquipTable() {
  var tbl = document.getElementById('eq-table');
  if (!eqTools.length) {
    tbl.innerHTML = '<div class="empty">No equipment yet. Use + Add equipment to record tools and machines.</div>';
    return;
  }
  // In-use first (by category, then name); retired at the bottom
  var rows = eqTools.slice().sort(function(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    var ca = (a.category || '￿').toLowerCase(), cb = (b.category || '￿').toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var colCount = 8;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Item</th><th class="right">Qty</th><th>Condition</th><th>Purchased</th>' +
    '<th class="right">Cost</th><th class="right">Repairs</th><th>Notes</th><th>Actions</th>' +
    '</tr></thead><tbody>';
  var retiredHeader = false;
  rows.forEach(function(t) {
    if (!t.active && !retiredHeader) {
      html += '<tr><td colspan="' + colCount + '" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">Retired equipment</td></tr>';
      retiredHeader = true;
    }
    var reps = eqRepairsFor(t.id);
    var repTotal = eqRepairTotal(t.id);
    html += '<tr' + (!t.active ? ' style="opacity:0.5"' : '') + '>' +
      '<td style="font-weight:500">' + medEsc(t.name) +
        (t.category ? '<div style="font-size:11px;color:var(--muted);font-weight:400">' + medEsc(t.category) + '</div>' : '') + '</td>' +
      '<td class="mono right">' + (t.quantity || 1) + '</td>' +
      '<td>' + (t.condition ? '<span class="badge ' + (EQ_CONDITION_BADGE[t.condition] || 'badge-gray') + '">' + eqConditionLabel(t.condition) + '</span>' : '—') + '</td>' +
      '<td class="mono">' + fmtDate(t.purchase_date) + '</td>' +
      '<td class="mono right">' + (t.purchase_cost_pkr != null ? pkr(t.purchase_cost_pkr) : '—') + '</td>' +
      '<td class="mono right">' + (reps.length ? reps.length + ' &middot; ' + pkr(repTotal) : '—') + '</td>' +
      '<td class="muted-cell">' + (t.notes ? medEsc(t.notes) : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="toggleEquipRepairs(' + t.id + ')">' + (eqExpanded.has(t.id) ? 'Hide repairs' : 'Repairs') + '</button> ' +
        '<button class="btn btn-sm" onclick="openEquipForm(' + t.id + ')">Edit</button> ' +
        (t.active
          ? '<button class="btn btn-sm" onclick="setEquipActive(' + t.id + ',false)">Retire</button>'
          : '<button class="btn btn-sm" onclick="setEquipActive(' + t.id + ',true)">Reactivate</button>') +
        ' <button class="btn btn-sm btn-danger" onclick="deleteEquip(' + t.id + ')">Delete</button>' +
      '</td></tr>';
    if (eqExpanded.has(t.id)) {
      html += '<tr class="grp-expand-row"><td colspan="' + colCount + '" style="padding:0">' + renderEquipRepairs(t) + '</td></tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

// ---- Repair / maintenance log (expandable row) ----
function toggleEquipRepairs(id) {
  if (eqExpanded.has(id)) eqExpanded.delete(id); else eqExpanded.add(id);
  renderEquipTable();
}

function renderEquipRepairs(t) {
  var reps = eqRepairsFor(t.id);
  var html = '<div style="padding:10px 22px 14px;background:var(--bg)"><table><thead><tr>' +
    '<th>Date</th><th>What was done</th><th class="right">Cost</th><th></th></tr></thead><tbody>';
  reps.forEach(function(r) {
    html += '<tr><td class="mono">' + fmtDate(r.date) + '</td>' +
      '<td>' + medEsc(r.description) + '</td>' +
      '<td class="mono right">' + (r.cost_pkr != null ? pkr(r.cost_pkr) : '—') + '</td>' +
      '<td><button class="btn btn-sm btn-danger" onclick="deleteEquipRepair(' + r.id + ')">Delete</button></td></tr>';
  });
  // Add-repair row
  html += '<tr style="background:var(--surface)">' +
    '<td><input type="date" id="eqr-date-' + t.id + '" value="' + todayISO() + '"></td>' +
    '<td><input type="text" id="eqr-desc-' + t.id + '" placeholder="e.g. Blade sharpened" style="min-width:220px"></td>' +
    '<td class="right"><input type="number" id="eqr-cost-' + t.id + '" min="0" step="1" placeholder="PKR" style="width:100px;text-align:right"></td>' +
    '<td><button class="btn btn-sm btn-primary" onclick="addEquipRepair(' + t.id + ')">Add</button></td></tr>';
  html += '</tbody></table></div>';
  return html;
}

async function addEquipRepair(toolId) {
  var date = document.getElementById('eqr-date-' + toolId).value;
  var desc = document.getElementById('eqr-desc-' + toolId).value.trim();
  var cost = document.getElementById('eqr-cost-' + toolId).value;
  if (!date || !desc) { alert('Enter the date and what was done.'); return; }
  try {
    await sbInsert('tool_repairs', [{ tool_id: toolId, date: date, description: desc, cost_pkr: cost === '' ? null : parseFloat(cost) }]);
    await eqRefresh();
  } catch(err) { alert('Save failed: ' + err.message); }
}

async function deleteEquipRepair(id) {
  if (!confirm('Delete this repair entry?')) return;
  try {
    await sbDelete('tool_repairs', id);
    await eqRefresh();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

// ---- Add / edit form ----
function openEquipForm(id) {
  eqEditId = id;
  eqFormOpen = true;
  renderEquipForm();
  document.getElementById('eq-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEquipForm() {
  eqEditId = null;
  eqFormOpen = false;
  document.getElementById('eq-form-wrap').innerHTML = '';
}

function renderEquipForm() {
  var t = eqEditId !== null ? eqTools.find(function(x) { return x.id === eqEditId; }) : null;
  var v = function(k, d) { return t && t[k] != null ? medEsc(t[k]) : (d || ''); };
  var cond = t ? (t.condition || '') : 'good';
  // Suggest categories already in use so they stay consistent
  var cats = [];
  eqTools.forEach(function(x) { if (x.category && cats.indexOf(x.category) < 0) cats.push(x.category); });
  ['Hand tools', 'Machinery', 'Irrigation', 'Animal handling', 'Vehicles'].forEach(function(c) { if (cats.indexOf(c) < 0) cats.push(c); });

  document.getElementById('eq-form-wrap').innerHTML =
    '<div class="health-form-box open" style="margin:16px 22px">' +
      '<div style="font-weight:500;margin-bottom:12px">' + (t ? 'Edit ' + medEsc(t.name) : 'New equipment') + '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Name *</label><input type="text" id="eqf-name" value="' + v('name') + '" placeholder="e.g. Chaff cutter"></div>' +
        '<div class="hf-field"><label>Category</label><input type="text" id="eqf-category" list="eqf-cat-list" value="' + v('category') + '" placeholder="e.g. Machinery">' +
          '<datalist id="eqf-cat-list">' + cats.map(function(c) { return '<option value="' + medEsc(c) + '">'; }).join('') + '</datalist></div>' +
        '<div class="hf-field"><label>Quantity</label><input type="number" id="eqf-qty" min="1" step="1" value="' + v('quantity', '1') + '"></div>' +
      '</div>' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Condition</label><select id="eqf-condition">' +
          '<option value="">—</option>' +
          EQ_CONDITIONS.map(function(c) { return '<option value="' + c[0] + '"' + (cond === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="hf-field"><label>Purchase date</label><input type="date" id="eqf-date" value="' + v('purchase_date') + '"></div>' +
        '<div class="hf-field"><label>Total cost (PKR)</label><input type="number" id="eqf-cost" min="0" step="1" value="' + v('purchase_cost_pkr') + '" placeholder="For all of them"></div>' +
      '</div>' +
      '<div class="hf-grid" style="grid-template-columns:1fr"><div class="hf-field"><label>Notes</label>' +
        '<input type="text" id="eqf-notes" value="' + v('notes') + '" placeholder="Optional — model, supplier, warranty"></div></div>' +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="submitEquip()">' + (t ? 'Save changes' : 'Add equipment') + '</button>' +
        '<button class="btn" onclick="closeEquipForm()">Cancel</button>' +
        '<span id="eqf-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';
}

async function submitEquip() {
  var st = document.getElementById('eqf-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var txt = function(id) { return document.getElementById(id).value.trim() || null; };
    var cost = document.getElementById('eqf-cost').value;
    var d = {
      name:              txt('eqf-name'),
      category:          txt('eqf-category'),
      quantity:          Math.max(1, parseInt(document.getElementById('eqf-qty').value) || 1),
      condition:         document.getElementById('eqf-condition').value || null,
      purchase_date:     document.getElementById('eqf-date').value || null,
      purchase_cost_pkr: cost === '' ? null : parseFloat(cost),
      notes:             txt('eqf-notes')
    };
    if (!d.name) throw new Error('Name is required.');
    if (eqEditId !== null) await sbPatch('tools', eqEditId, d);
    else await sbInsert('tools', [d]);
    closeEquipForm();
    await eqRefresh();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

async function setEquipActive(id, active) {
  try {
    await sbPatch('tools', id, { active: active });
    await eqRefresh();
  } catch(err) { alert('Error: ' + err.message); }
}

async function deleteEquip(id) {
  var t = eqTools.find(function(x) { return x.id === id; });
  var n = eqRepairsFor(id).length;
  if (!confirm('Delete ' + (t ? t.name : 'this item') + (n ? ' and its ' + n + ' repair entr' + (n === 1 ? 'y' : 'ies') : '') +
    '? This cannot be undone. (Retire keeps its history instead.)')) return;
  try {
    await sbDelete('tools', id);   // repairs cascade
    eqExpanded.delete(id);
    await eqRefresh();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

// Re-fetch equipment and repairs, keeping the consumables section as it is
async function eqRefresh() {
  var r = await Promise.all([
    sbGet('tools', 'select=*&order=name'),
    sbGet('tool_repairs', 'select=*&order=date.desc,id.desc')
  ]);
  eqTools = r[0];
  eqRepairs = r[1];
  renderEquipment();
}
