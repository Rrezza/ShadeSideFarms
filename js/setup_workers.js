// ============================================================
// setup_workers.js v17 — Workers page
// ============================================================

// WORKERS
// ============================================================
var workersData = [];

async function loadWorkersPage() {
  var tbl = document.getElementById('workers-table');
  if (tbl) tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    workersData = await sbGet('workers',
      'select=id,name,worker_type,daily_rate_pkr,active,notes&order=name');
    var activeCount = workersData.filter(function(w) { return w.active; }).length;
    document.getElementById('workers-count').textContent =
      workersData.length + ' worker' + (workersData.length !== 1 ? 's' : '') +
      ' · ' + activeCount + ' active';
    document.getElementById('workers-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderWorkersTable();
  } catch (err) {
    if (tbl) tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderWorkersTable() {
  var tbl = document.getElementById('workers-table');
  var WTYPE_LABELS = { permanent: 'Permanent', part_time: 'Part-time', day_labor: 'Day labor' };

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th style="min-width:180px">Name</th>' +
    '<th>Type</th>' +
    '<th style="min-width:120px">Daily rate (PKR)</th>' +
    '<th>Active</th>' +
    '<th style="min-width:220px">Notes</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  workersData.forEach(function(w) {
    var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); };
    html += '<tr style="' + (!w.active ? 'opacity:0.5' : '') + '">';
    html += '<td><input type="text" value="' + esc(w.name) +
      '" style="width:100%" onchange="patchWorker(' + w.id + ',\'name\',this.value.trim())"></td>';
    html += '<td><select style="width:100%" onchange="patchWorker(' + w.id + ',\'worker_type\',this.value)">' +
      ['permanent','part_time','day_labor'].map(function(v) {
        return '<option value="' + v + '"' + (w.worker_type === v ? ' selected' : '') + '>' + WTYPE_LABELS[v] + '</option>';
      }).join('') + '</select></td>';
    html += '<td><input type="number" value="' + (w.daily_rate_pkr != null ? w.daily_rate_pkr : '') +
      '" style="width:100%" min="0" step="50" placeholder="—"' +
      ' onchange="patchWorker(' + w.id + ',\'daily_rate_pkr\',this.value===\'\'?null:parseFloat(this.value))"></td>';
    html += '<td style="text-align:center"><input type="checkbox" ' + (w.active ? 'checked' : '') +
      ' onchange="patchWorker(' + w.id + ',\'active\',this.checked)"></td>';
    html += '<td><input type="text" value="' + esc(w.notes) +
      '" style="width:100%" placeholder="—"' +
      ' onchange="patchWorker(' + w.id + ',\'notes\',this.value.trim()||null)"></td>';
    html += '<td><button class="btn btn-sm del-btn" onclick="deleteWorker(' + w.id + ',\'' + (w.name || '').replace(/'/g,"\\'") + '\')">Delete</button></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += buildWorkerAddRow();
  tbl.innerHTML = html;
}

function buildWorkerAddRow() {
  return '<div style="padding:18px 22px;border-top:1px solid var(--border);background:var(--bg)">' +
    '<div style="font-size:12px;font-weight:500;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Add worker</div>' +
    '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr;gap:10px;margin-bottom:12px">' +
    '<div><label style="font-size:11px;color:var(--muted)">Name (required)</label>' +
    '<input type="text" id="nw-name" style="width:100%" placeholder="e.g. Ali Hassan"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Type</label>' +
    '<select id="nw-type" style="width:100%">' +
    '<option value="permanent">Permanent</option>' +
    '<option value="part_time">Part-time</option>' +
    '<option value="day_labor">Day labor</option>' +
    '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Daily rate (PKR)</label>' +
    '<input type="number" id="nw-rate" min="0" step="50" style="width:100%" placeholder="—"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Notes</label>' +
    '<input type="text" id="nw-notes" style="width:100%" placeholder="role, contact…"></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
    '<button class="btn btn-primary btn-sm" onclick="submitNewWorker()">Add worker</button>' +
    '<span id="nw-status" style="font-size:12px;color:var(--muted)"></span>' +
    '</div></div>';
}

async function patchWorker(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('workers', id, d);
    var w = workersData.find(function(x) { return x.id === id; });
    if (w) w[field] = value;
    // Refresh count
    var activeCount = workersData.filter(function(w) { return w.active; }).length;
    var el = document.getElementById('workers-count');
    if (el) el.textContent = workersData.length + ' worker' + (workersData.length !== 1 ? 's' : '') +
      ' · ' + activeCount + ' active';
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadWorkersPage();
  }
}

async function submitNewWorker() {
  var statusEl = document.getElementById('nw-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var name = (document.getElementById('nw-name').value || '').trim();
    if (!name) throw new Error('Name is required.');
    var d = {
      name:        name,
      worker_type: document.getElementById('nw-type').value,
      active:      true
    };
    var rate  = document.getElementById('nw-rate').value;
    var notes = (document.getElementById('nw-notes').value || '').trim();
    if (rate)  d.daily_rate_pkr = parseFloat(rate);
    if (notes) d.notes          = notes;
    await sbInsert('workers', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadWorkersPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}


// ============================================================
