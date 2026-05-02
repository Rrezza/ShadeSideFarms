// ============================================================
// finance_expenses.js — Farm Expenses page
// ============================================================

var feExpenses   = [];
var feEditId     = null;
var feFilterCat  = 'all';
var feFilterFrom = '';
var feFilterTo   = '';

var FE_CATS = [
  { value: 'feed',                label: 'Feed',               badge: 'badge-amber'  },
  { value: 'veterinary',          label: 'Veterinary',         badge: 'badge-red'    },
  { value: 'day_labor',           label: 'Day Labor',          badge: 'badge-teal'   },
  { value: 'fuel',                label: 'Fuel',               badge: 'badge-brown'  },
  { value: 'infrastructure',      label: 'Infrastructure',     badge: 'badge-blue'   },
  { value: 'capital_expenditure', label: 'Capital Expenditure',badge: 'badge-green'  },
  { value: 'other',               label: 'Other',              badge: 'badge-gray'   }
];

function feCatLabel(v) {
  var c = FE_CATS.find(function(x) { return x.value === v; });
  return c ? c.label : v;
}
function feCatBadge(v) {
  var c = FE_CATS.find(function(x) { return x.value === v; });
  return c ? c.badge : 'badge-gray';
}

// ============================================================
// LOAD
// ============================================================
async function loadFarmExpensesPage() {
  var el = document.getElementById('farmexpenses-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();

    feExpenses = await sbGet('farm_expenses',
      'select=id,date,category,description,amount_pkr,paid_to,recorded_by,' +
      'notes,workers(name)&order=date.desc,id.desc&limit=500');

    renderFarmExpensesPage();
    renderAbbrevKey('abbrev-farmexpenses', ['PKR']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

// ============================================================
// RENDER
// ============================================================
function renderFarmExpensesPage() {
  var el = document.getElementById('farmexpenses-content');
  if (!el) return;

  // Default filter: current month
  if (!feFilterFrom && !feFilterTo) {
    var now = new Date();
    feFilterFrom = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    var lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    feFilterTo   = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  }

  el.innerHTML =
    feRenderAddForm() +
    feRenderFilters() +
    feRenderSummary() +
    feRenderLog();
}

// ============================================================
// ADD / EDIT FORM
// ============================================================
function feRenderAddForm() {
  var catOpts = FE_CATS.map(function(c) {
    return '<option value="' + c.value + '">' + c.label + '</option>';
  }).join('');

  var workerOpts = '<option value="">— select —</option>' +
    anSharedWorkers.map(function(w) {
      return '<option value="' + w.id + '">' + w.name + '</option>';
    }).join('');

  return (
    '<div class="section">' +
      '<div class="section-hdr">' +
        '<h2>Add expense</h2>' +
      '</div>' +
      '<div style="padding:16px 22px">' +
        '<div style="display:grid;grid-template-columns:140px 1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="hf-field"><label>Date</label>' +
            '<input type="date" id="fe-date" value="' + todayISO() + '"></div>' +
          '<div class="hf-field"><label>Category</label>' +
            '<select id="fe-cat">' + catOpts + '</select></div>' +
          '<div class="hf-field"><label>Amount (PKR)</label>' +
            '<input type="number" id="fe-amount" min="0" step="1" placeholder="e.g. 5000"></div>' +
          '<div class="hf-field"><label>Paid to</label>' +
            '<input type="text" id="fe-paidto" placeholder="Vendor / person (optional)"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="hf-field"><label>Description</label>' +
            '<input type="text" id="fe-desc" placeholder="What was this expense for?"></div>' +
          '<div class="hf-field"><label>Recorded by</label>' +
            '<select id="fe-worker">' + workerOpts + '</select></div>' +
        '</div>' +
        '<div class="hf-field" style="margin-bottom:14px"><label>Notes (optional)</label>' +
          '<input type="text" id="fe-notes" placeholder="Optional"></div>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          '<button class="btn btn-primary btn-sm" onclick="feSubmit()">Save expense</button>' +
          '<span id="fe-status" style="font-size:13px;color:var(--muted)"></span>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ============================================================
// FILTERS
// ============================================================
function feRenderFilters() {
  var catButtons = '<button class="btn btn-sm' + (feFilterCat === 'all' ? ' btn-primary' : '') +
    '" onclick="feSetCat(\'all\')" style="margin-right:4px">All</button>' +
    FE_CATS.map(function(c) {
      var active = feFilterCat === c.value ? ' btn-primary' : '';
      return '<button class="btn btn-sm' + active + '" onclick="feSetCat(\'' + c.value + '\')" style="margin-right:4px">' + c.label + '</button>';
    }).join('');

  return (
    '<div class="section">' +
      '<div class="section-hdr"><h2>Filter</h2></div>' +
      '<div style="padding:12px 22px;display:flex;flex-wrap:wrap;align-items:center;gap:16px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<label style="font-size:12px;color:var(--muted)">From</label>' +
          '<input type="date" id="fe-from" value="' + feFilterFrom + '" onchange="feApplyFilters()" style="font-size:13px">' +
          '<label style="font-size:12px;color:var(--muted)">To</label>' +
          '<input type="date" id="fe-to" value="' + feFilterTo + '" onchange="feApplyFilters()" style="font-size:13px">' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:0">' + catButtons + '</div>' +
      '</div>' +
    '</div>'
  );
}

function feSetCat(cat) {
  feFilterCat = cat;
  feApplyFilters();
}

function feApplyFilters() {
  var fromEl = document.getElementById('fe-from');
  var toEl   = document.getElementById('fe-to');
  if (fromEl) feFilterFrom = fromEl.value;
  if (toEl)   feFilterTo   = toEl.value;

  var summaryEl = document.getElementById('fe-summary-wrap');
  var logEl     = document.getElementById('fe-log-wrap');
  if (summaryEl) summaryEl.outerHTML = feRenderSummary();
  if (logEl)     logEl.outerHTML     = feRenderLog();
}

// ============================================================
// FILTERED SUBSET
// ============================================================
function feFiltered() {
  return feExpenses.filter(function(e) {
    if (feFilterCat !== 'all' && e.category !== feFilterCat) return false;
    if (feFilterFrom && e.date < feFilterFrom) return false;
    if (feFilterTo   && e.date > feFilterTo)   return false;
    return true;
  });
}

// ============================================================
// SUMMARY CARDS
// ============================================================
function feRenderSummary() {
  var rows = feFiltered();
  var total = rows.reduce(function(s, e) { return s + parseFloat(e.amount_pkr || 0); }, 0);

  // Totals by category
  var bycat = {};
  FE_CATS.forEach(function(c) { bycat[c.value] = 0; });
  rows.forEach(function(e) {
    if (bycat[e.category] !== undefined) bycat[e.category] += parseFloat(e.amount_pkr || 0);
  });

  var catCards = FE_CATS
    .filter(function(c) { return bycat[c.value] > 0; })
    .map(function(c) {
      return (
        '<div class="metric-card">' +
          '<div class="m-label">' + c.label + '</div>' +
          '<div class="m-value" style="font-size:20px">' + pkr(bycat[c.value]) + '</div>' +
          '<div class="m-sub">' + rows.filter(function(e) { return e.category === c.value; }).length + ' entries</div>' +
        '</div>'
      );
    }).join('');

  var periodLabel = (feFilterFrom && feFilterTo)
    ? fmtDate(feFilterFrom) + ' – ' + fmtDate(feFilterTo)
    : 'All time';

  return (
    '<div id="fe-summary-wrap">' +
      '<div class="section">' +
        '<div class="section-hdr"><h2>Summary</h2><span class="section-meta">' + periodLabel + '</span></div>' +
        '<div style="padding:16px 22px">' +
          '<div class="metric-card" style="margin-bottom:16px;background:var(--green-lt);border-color:var(--green-bdr)">' +
            '<div class="m-label">Total expenses</div>' +
            '<div class="m-value" style="color:var(--green)">' + pkr(total) + '</div>' +
            '<div class="m-sub">' + rows.length + ' entries</div>' +
          '</div>' +
          (catCards
            ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">' + catCards + '</div>'
            : '<div style="font-size:13px;color:var(--faint)">No expenses in this period.</div>') +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ============================================================
// LOG TABLE
// ============================================================
function feRenderLog() {
  var rows = feFiltered();

  if (!rows.length) {
    return (
      '<div id="fe-log-wrap">' +
        '<div class="section">' +
          '<div class="section-hdr"><h2>Expense log</h2></div>' +
          '<div class="empty">No expenses match the current filter.</div>' +
        '</div>' +
      '</div>'
    );
  }

  var tbody = rows.map(function(e) {
    if (feEditId === e.id) return feEditRow(e);
    var workerName = e.workers ? e.workers.name : '—';
    return (
      '<tr>' +
        '<td>' + fmtDate(e.date) + '</td>' +
        '<td><span class="badge ' + feCatBadge(e.category) + '">' + feCatLabel(e.category) + '</span></td>' +
        '<td>' + (e.description || '—') + '</td>' +
        '<td class="mono right">' + pkr(parseFloat(e.amount_pkr)) + '</td>' +
        '<td>' + (e.paid_to || '—') + '</td>' +
        '<td>' + workerName + '</td>' +
        '<td style="color:var(--faint);font-size:12px">' + (e.notes || '') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="feStartEdit(' + e.id + ')">Edit</button> ' +
          '<button class="btn btn-sm" style="color:var(--red)" onclick="feDelete(' + e.id + ')">Delete</button>' +
        '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<div id="fe-log-wrap">' +
      '<div class="section">' +
        '<div class="section-hdr"><h2>Expense log</h2>' +
          '<span class="section-meta">' + rows.length + ' entries</span>' +
        '</div>' +
        '<div style="overflow-x:auto">' +
          '<table><thead><tr>' +
            '<th>Date</th><th>Category</th><th>Description</th>' +
            '<th class="right">Amount</th><th>Paid to</th><th>Recorded by</th>' +
            '<th>Notes</th><th></th>' +
          '</tr></thead>' +
          '<tbody>' + tbody + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>'
  );
}

// ============================================================
// INLINE EDIT ROW
// ============================================================
function feEditRow(e) {
  var catOpts = FE_CATS.map(function(c) {
    return '<option value="' + c.value + '"' + (e.category === c.value ? ' selected' : '') + '>' + c.label + '</option>';
  }).join('');

  var workerOpts = '<option value="">—</option>' +
    anSharedWorkers.map(function(w) {
      return '<option value="' + w.id + '"' + (e.recorded_by === w.id ? ' selected' : '') + '>' + w.name + '</option>';
    }).join('');

  return (
    '<tr style="background:var(--bg)">' +
      '<td><input type="date" id="fee-date" value="' + (e.date || '') + '" style="width:130px"></td>' +
      '<td><select id="fee-cat">' + catOpts + '</select></td>' +
      '<td><input type="text" id="fee-desc" value="' + (e.description || '').replace(/"/g, '&quot;') + '" placeholder="Description" style="width:100%"></td>' +
      '<td><input type="number" id="fee-amount" value="' + (e.amount_pkr || '') + '" min="0" step="1" style="width:110px"></td>' +
      '<td><input type="text" id="fee-paidto" value="' + (e.paid_to || '').replace(/"/g, '&quot;') + '" style="width:120px"></td>' +
      '<td><select id="fee-worker">' + workerOpts + '</select></td>' +
      '<td><input type="text" id="fee-notes" value="' + (e.notes || '').replace(/"/g, '&quot;') + '" style="width:140px"></td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-primary btn-sm" onclick="feSaveEdit(' + e.id + ')">Save</button> ' +
        '<button class="btn btn-sm" onclick="feCancelEdit()">Cancel</button>' +
      '</td>' +
    '</tr>'
  );
}

function feStartEdit(id) {
  feEditId = id;
  var logEl = document.getElementById('fe-log-wrap');
  if (logEl) logEl.outerHTML = feRenderLog();
}

function feCancelEdit() {
  feEditId = null;
  var logEl = document.getElementById('fe-log-wrap');
  if (logEl) logEl.outerHTML = feRenderLog();
}

// ============================================================
// SUBMIT
// ============================================================
async function feSubmit() {
  var st = document.getElementById('fe-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('fe-date').value;
    var cat    = document.getElementById('fe-cat').value;
    var amount = document.getElementById('fe-amount').value;
    if (!date)   throw new Error('Date required.');
    if (!cat)    throw new Error('Category required.');
    if (!amount || parseFloat(amount) <= 0) throw new Error('Amount required.');

    var d = {
      date:        date,
      category:    cat,
      amount_pkr:  parseFloat(amount)
    };
    var desc   = document.getElementById('fe-desc').value.trim();
    var paidto = document.getElementById('fe-paidto').value.trim();
    var wkr    = document.getElementById('fe-worker').value;
    var notes  = document.getElementById('fe-notes').value.trim();
    if (desc)   d.description  = desc;
    if (paidto) d.paid_to      = paidto;
    if (wkr)    d.recorded_by  = parseInt(wkr);
    if (notes)  d.notes        = notes;

    var saved = await sbInsert('farm_expenses', d);
    feExpenses.unshift(saved[0] || d);

    // Reset form
    document.getElementById('fe-date').value   = todayISO();
    document.getElementById('fe-cat').value    = FE_CATS[0].value;
    document.getElementById('fe-amount').value = '';
    document.getElementById('fe-desc').value   = '';
    document.getElementById('fe-paidto').value = '';
    document.getElementById('fe-worker').value = '';
    document.getElementById('fe-notes').value  = '';
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    setTimeout(function() { if (st) st.textContent = ''; }, 2500);

    // Reload from DB to get joined worker name
    feExpenses = await sbGet('farm_expenses',
      'select=id,date,category,description,amount_pkr,paid_to,recorded_by,' +
      'notes,workers(name)&order=date.desc,id.desc&limit=500');

    var summaryEl = document.getElementById('fe-summary-wrap');
    var logEl     = document.getElementById('fe-log-wrap');
    if (summaryEl) summaryEl.outerHTML = feRenderSummary();
    if (logEl)     logEl.outerHTML     = feRenderLog();

  } catch(err) {
    st.textContent = err.message; st.style.color = 'var(--red)';
  }
}

// ============================================================
// SAVE EDIT
// ============================================================
async function feSaveEdit(id) {
  try {
    var date   = document.getElementById('fee-date').value;
    var cat    = document.getElementById('fee-cat').value;
    var amount = document.getElementById('fee-amount').value;
    if (!date || !cat || !amount) throw new Error('Date, category and amount required.');

    var patch = {
      date:       date,
      category:   cat,
      amount_pkr: parseFloat(amount)
    };
    var desc   = document.getElementById('fee-desc').value.trim();
    var paidto = document.getElementById('fee-paidto').value.trim();
    var wkr    = document.getElementById('fee-worker').value;
    var notes  = document.getElementById('fee-notes').value.trim();
    patch.description = desc   || null;
    patch.paid_to     = paidto || null;
    patch.recorded_by = wkr    ? parseInt(wkr) : null;
    patch.notes       = notes  || null;

    await sbPatch('farm_expenses', id, patch);

    feEditId = null;
    feExpenses = await sbGet('farm_expenses',
      'select=id,date,category,description,amount_pkr,paid_to,recorded_by,' +
      'notes,workers(name)&order=date.desc,id.desc&limit=500');

    var summaryEl = document.getElementById('fe-summary-wrap');
    var logEl     = document.getElementById('fe-log-wrap');
    if (summaryEl) summaryEl.outerHTML = feRenderSummary();
    if (logEl)     logEl.outerHTML     = feRenderLog();

  } catch(err) {
    alert('Save failed: ' + err.message);
  }
}

// ============================================================
// DELETE
// ============================================================
async function feDelete(id) {
  if (!confirm('Delete this expense? This cannot be undone.')) return;
  try {
    await sbDelete('farm_expenses', id);
    feExpenses = feExpenses.filter(function(e) { return e.id !== id; });
    var summaryEl = document.getElementById('fe-summary-wrap');
    var logEl     = document.getElementById('fe-log-wrap');
    if (summaryEl) summaryEl.outerHTML = feRenderSummary();
    if (logEl)     logEl.outerHTML     = feRenderLog();
  } catch(err) {
    alert('Error: ' + err.message);
  }
}
