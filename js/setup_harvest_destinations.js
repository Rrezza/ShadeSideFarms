// ============================================================
// setup_harvest_destinations.js — Harvest destinations registry
//
// Manages the harvest_destinations table. Rows here drive the
// destination dropdown in the harvest allocation modal, and are
// the source of truth for permitted_destinations on crops.
//
// Depends on: shared.js (sbGet, sbInsert, sbPatch, sbDelete)
// ============================================================

var hdData = [];   // loaded rows from harvest_destinations

async function loadHarvestDestinationsPage() {
  var tbl = document.getElementById('hd-table');
  if (tbl) tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    hdData = await sbGet('harvest_destinations',
      'select=id,key,label,sort_order,active&order=sort_order,label');
    document.getElementById('hd-count').textContent =
      hdData.length + ' destination' + (hdData.length !== 1 ? 's' : '') +
      ' · ' + hdData.filter(function(d) { return d.active; }).length + ' active';
    renderHarvestDestinationsTable();
  } catch (err) {
    if (tbl) tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderHarvestDestinationsTable() {
  var tbl = document.getElementById('hd-table');
  if (!tbl) return;
  if (!hdData.length) {
    tbl.innerHTML = '<div class="empty" style="padding:22px">No destinations yet.</div>';
    tbl.innerHTML += buildHdAddRow();
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th style="min-width:160px">Key (internal)</th>' +
    '<th style="min-width:200px">Label (shown to users)</th>' +
    '<th style="min-width:80px">Sort order</th>' +
    '<th>Active</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  hdData.forEach(function(d) {
    var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); };
    html += '<tr style="vertical-align:middle' + (!d.active ? ';opacity:0.5' : '') + '">';
    // Key is immutable after creation — changing it would break existing allocation records
    html += '<td><code style="font-size:12px;color:var(--muted)">' + esc(d.key) + '</code></td>';
    html += '<td><input type="text" value="' + esc(d.label) + '" style="width:100%" ' +
      'onchange="patchHd(' + d.id + ',\'label\',this.value.trim())"></td>';
    html += '<td><input type="number" value="' + (d.sort_order != null ? d.sort_order : 0) + '" ' +
      'min="0" step="10" style="width:80px" ' +
      'onchange="patchHd(' + d.id + ',\'sort_order\',parseInt(this.value)||0)"></td>';
    html += '<td style="text-align:center"><input type="checkbox" ' + (d.active ? 'checked' : '') +
      ' onchange="patchHd(' + d.id + ',\'active\',this.checked)"></td>';
    html += '<td><span id="hd-status-' + d.id + '" style="font-size:11px;color:var(--muted)"></span></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += buildHdAddRow();
  tbl.innerHTML = html;
}

function buildHdAddRow() {
  return '<div style="padding:18px 22px;border-top:1px solid var(--border);background:var(--bg)">' +
    '<div style="font-size:12px;font-weight:500;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Add new destination</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 80px;gap:10px;margin-bottom:12px">' +
    '<div><label style="font-size:11px;color:var(--muted)">Key <span style="color:var(--red)">*</span>' +
      '<span style="font-weight:400"> — lowercase, underscores only, e.g. household_use</span></label>' +
      '<input type="text" id="hd-new-key" placeholder="e.g. household_use" style="width:100%" ' +
      'oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,\'_\')"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Label <span style="color:var(--red)">*</span></label>' +
      '<input type="text" id="hd-new-label" placeholder="e.g. Household use" style="width:100%"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Sort order</label>' +
      '<input type="number" id="hd-new-sort" value="0" min="0" step="10" style="width:100%"></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
    '<button class="btn btn-primary btn-sm" onclick="submitNewHd()">Add destination</button>' +
    '<span id="hd-new-status" style="font-size:12px;color:var(--muted)"></span>' +
    '</div></div>';
}

async function patchHd(id, field, value) {
  var statusEl = document.getElementById('hd-status-' + id);
  try {
    var patch = {}; patch[field] = value;
    await sbPatch('harvest_destinations', id, patch);
    var row = hdData.find(function(d) { return d.id === id; });
    if (row) row[field] = value;
    if (statusEl) { statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)'; }
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 1500);
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)'; }
    alert('Update failed: ' + err.message);
    loadHarvestDestinationsPage();
  }
}

async function submitNewHd() {
  var statusEl = document.getElementById('hd-new-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var key   = (document.getElementById('hd-new-key').value   || '').trim();
    var label = (document.getElementById('hd-new-label').value || '').trim();
    var sort  = parseInt(document.getElementById('hd-new-sort').value) || 0;
    if (!key)   throw new Error('Key is required.');
    if (!label) throw new Error('Label is required.');
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error('Key must be lowercase letters, numbers, and underscores only.');
    if (hdData.some(function(d) { return d.key === key; }))
      throw new Error('Key "' + key + '" already exists.');
    await sbInsert('harvest_destinations', [{ key: key, label: label, sort_order: sort, active: true }]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadHarvestDestinationsPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
// ============================================================
