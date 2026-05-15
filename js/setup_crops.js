// ============================================================
// setup_crops.js v17 — Crops registry page
// ============================================================

// CROPS REGISTRY
// ============================================================
var cropRegData  = [];
var cropDestData = [];   // harvest_destinations — loaded alongside crops

var CROP_CAT_LABELS = {
  fodder:'Fodder', vegetable:'Vegetable', cover_crop:'Cover crop',
  green_manure:'Green manure', fruit_tree:'Fruit tree', herb:'Herb', other:'Other'
};

async function loadCropsPage() {
  var tbl = document.getElementById('crops-table');
  if (tbl) tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var results = await Promise.all([
      sbGet('crops',
        'select=id,name,local_name,category,salt_tolerance,salt_tolerance_ec_threshold,' +
        'nitrogen_fixer,feeding_notes,typical_duration_days,notes,active,permitted_destinations&order=name'),
      sbGet('harvest_destinations',
        'select=id,key,label,sort_order&active=eq.true&order=sort_order,label')
        .catch(function() { return []; })
    ]);
    cropRegData  = results[0];
    cropDestData = results[1];
    document.getElementById('crops-count').textContent =
      cropRegData.length + ' crop' + (cropRegData.length !== 1 ? 's' : '') +
      ' · ' + cropRegData.filter(function(c) { return c.active; }).length + ' active';
    document.getElementById('crops-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderCropsTable();
    renderAbbrevKey('abbrev-crops', ['EC']);
  } catch (err) {
    if (tbl) tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderCropsTable() {
  var tbl = document.getElementById('crops-table');
  if (!cropRegData.length) {
    tbl.innerHTML = '<div class="empty" style="padding:22px">No crops in registry. Use the form below to add one.</div>';
    tbl.innerHTML += buildCropAddRow();
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th style="min-width:160px">Name</th>' +
    '<th style="min-width:110px">Local name</th>' +
    '<th>Category</th>' +
    '<th>Salt tolerance</th>' +
    '<th style="min-width:80px">EC threshold</th>' +
    '<th>N-fixer</th>' +
    '<th style="min-width:80px">Days</th>' +
    '<th style="min-width:220px">Feeding safety notes</th>' +
    '<th style="min-width:180px">Permitted destinations <span style="font-size:10px;font-weight:400;color:var(--muted)">(leave blank = all)</span></th>' +
    '<th style="min-width:180px">Notes</th>' +
    '<th>Active</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  cropRegData.forEach(function(c) {
    var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); };
    html += '<tr style="vertical-align:top' + (!c.active ? ';opacity:0.5' : '') + '">';
    html += '<td><input type="text" value="' + esc(c.name) +
      '" style="width:100%" onchange="patchCrop(' + c.id + ',\'name\',this.value.trim())"></td>';
    html += '<td><input type="text" value="' + esc(c.local_name) +
      '" style="width:100%" placeholder="—" onchange="patchCrop(' + c.id + ',\'local_name\',this.value.trim()||null)"></td>';
    html += '<td><select style="width:100%" onchange="patchCrop(' + c.id + ',\'category\',this.value||null)">' +
      ['','fodder','vegetable','cover_crop','green_manure','fruit_tree','herb','other'].map(function(v) {
        return '<option value="' + v + '"' + (c.category === v ? ' selected' : '') + '>' + (CROP_CAT_LABELS[v] || (v || '—')) + '</option>';
      }).join('') + '</select></td>';
    html += '<td><select style="width:100%" onchange="patchCrop(' + c.id + ',\'salt_tolerance\',this.value||null)">' +
      ['','viable','marginal','not_viable'].map(function(v) {
        return '<option value="' + v + '"' + (c.salt_tolerance === v ? ' selected' : '') + '>' + (v || '—') + '</option>';
      }).join('') + '</select></td>';
    html += '<td><input type="number" value="' + (c.salt_tolerance_ec_threshold != null ? c.salt_tolerance_ec_threshold : '') +
      '" style="width:100%" step="0.1" min="0" placeholder="—" onchange="patchCrop(' + c.id + ',\'salt_tolerance_ec_threshold\',this.value===\'\'?null:parseFloat(this.value))"></td>';
    html += '<td style="text-align:center;padding-top:10px"><input type="checkbox" ' + (c.nitrogen_fixer ? 'checked' : '') +
      ' onchange="patchCrop(' + c.id + ',\'nitrogen_fixer\',this.checked)"></td>';
    html += '<td><input type="number" value="' + (c.typical_duration_days != null ? c.typical_duration_days : '') +
      '" style="width:100%" min="0" placeholder="—" onchange="patchCrop(' + c.id + ',\'typical_duration_days\',this.value===\'\'?null:parseInt(this.value))"></td>';
    html += '<td><textarea style="width:100%;min-height:52px;font-size:12px;resize:vertical" placeholder="e.g. Wilt 24–48 hrs before feeding…"' +
      ' onchange="patchCrop(' + c.id + ',\'feeding_notes\',this.value.trim()||null)">' + esc(c.feeding_notes) + '</textarea></td>';
    // Permitted destinations — checkboxes driven by the harvest_destinations table
    var permitted = c.permitted_destinations || [];
    var destChecks = cropDestData.map(function(d) {
      var checked = permitted.indexOf(d.key) >= 0;
      return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;cursor:pointer">' +
        '<input type="checkbox" ' + (checked ? 'checked' : '') +
        ' onchange="toggleCropDest(' + c.id + ',\'' + d.key + '\',this.checked)"> ' +
        d.label + '</label>';
    }).join('');
    html += '<td style="vertical-align:top;min-width:180px">' +
      '<div style="display:flex;flex-direction:column;gap:3px;padding-top:4px">' +
      (destChecks || '<span style="font-size:11px;color:var(--muted)">No destinations set</span>') +
      '</div></td>';
    html += '<td><textarea style="width:100%;min-height:52px;font-size:12px;resize:vertical" placeholder="—"' +
      ' onchange="patchCrop(' + c.id + ',\'notes\',this.value.trim()||null)">' + esc(c.notes) + '</textarea></td>';
    html += '<td style="text-align:center;padding-top:10px"><input type="checkbox" ' + (c.active ? 'checked' : '') +
      ' onchange="patchCrop(' + c.id + ',\'active\',this.checked)"></td>';
    html += '<td style="padding-top:6px"><button class="btn btn-sm del-btn" onclick="deleteCrop(' + c.id + ',\'' + (c.name || '').replace(/'/g,"\\'") + '\')">Delete</button></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += buildCropAddRow();
  tbl.innerHTML = html;
}

function buildCropAddRow() {
  return '<div style="padding:18px 22px;border-top:1px solid var(--border);background:var(--bg)">' +
    '<div style="font-size:12px;font-weight:500;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Add new crop</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
    '<div><label style="font-size:11px;color:var(--muted)">Name (required)</label><input type="text" id="nc-name" placeholder="e.g. Bajra (Pearl Millet)" style="width:100%"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Local name</label><input type="text" id="nc-local" placeholder="e.g. باجرہ" style="width:100%"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Category</label>' +
    '<select id="nc-cat" style="width:100%"><option value="">—</option>' +
    ['fodder','vegetable','cover_crop','green_manure','fruit_tree','herb','other'].map(function(v) {
      return '<option value="' + v + '">' + (CROP_CAT_LABELS[v] || v) + '</option>';
    }).join('') + '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Salt tolerance</label>' +
    '<select id="nc-salt" style="width:100%"><option value="">—</option><option value="viable">Viable</option><option value="marginal">Marginal</option><option value="not_viable">Not viable</option></select></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
    '<div><label style="font-size:11px;color:var(--muted)">EC threshold (mS/cm)</label><input type="number" id="nc-ec" min="0" step="0.1" style="width:100%" placeholder="—"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Duration (days)</label><input type="number" id="nc-days" min="0" style="width:100%" placeholder="—"></div>' +
    '<div style="padding-top:16px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="nc-nfix"> Nitrogen fixer</label></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
    '<div><label style="font-size:11px;color:var(--muted)">Feeding safety notes <span style="color:var(--amber)">⚠</span></label>' +
    '<textarea id="nc-feed" rows="2" style="width:100%" placeholder="Safety flags for goat fodder use…"></textarea></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Notes</label>' +
    '<textarea id="nc-notes" rows="2" style="width:100%" placeholder="General notes…"></textarea></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
    '<button class="btn btn-primary btn-sm" onclick="submitNewCrop()">Add crop</button>' +
    '<span id="nc-status" style="font-size:12px;color:var(--muted)"></span>' +
    '</div></div>';
}

async function patchCrop(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('crops', id, d);
    var c = cropRegData.find(function(x) { return x.id === id; });
    if (c) c[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadCropsPage();
  }
}

// Toggle a single destination key in the crop's permitted_destinations array.
// Reads the current array from local state, modifies it, then patches.
async function toggleCropDest(cropId, destKey, checked) {
  var c = cropRegData.find(function(x) { return x.id === cropId; });
  if (!c) return;
  var current = (c.permitted_destinations || []).slice();
  var idx = current.indexOf(destKey);
  if (checked && idx < 0)  current.push(destKey);
  if (!checked && idx >= 0) current.splice(idx, 1);
  await patchCrop(cropId, 'permitted_destinations', current);
}

async function submitNewCrop() {
  var statusEl = document.getElementById('nc-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var name = (document.getElementById('nc-name').value || '').trim();
    if (!name) throw new Error('Name is required.');
    var d = {
      name:           name,
      local_name:     (document.getElementById('nc-local').value || '').trim() || null,
      category:       document.getElementById('nc-cat').value   || null,
      salt_tolerance: document.getElementById('nc-salt').value  || null,
      nitrogen_fixer: document.getElementById('nc-nfix').checked,
      feeding_notes:  (document.getElementById('nc-feed').value  || '').trim() || null,
      notes:          (document.getElementById('nc-notes').value || '').trim() || null,
      active:         true
    };
    var ecV   = document.getElementById('nc-ec').value;
    var daysV = document.getElementById('nc-days').value;
    if (ecV)   d.salt_tolerance_ec_threshold = parseFloat(ecV);
    if (daysV) d.typical_duration_days       = parseInt(daysV);
    await sbInsert('crops', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadCropsPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
