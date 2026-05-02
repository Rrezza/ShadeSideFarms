// ============================================================
// setup_locations.js v17 — Locations page
// ============================================================

// LOCATIONS
// ============================================================
var locationsData = [];

async function loadLocationsPage() {
  var tbl = document.getElementById('locations-table');
  if (tbl) tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    locationsData = await sbGet('locations',
      'select=id,name,location_type,shed_id,area_acres,capacity_animals,active,notes&order=location_type,name');
    var activeCount = locationsData.filter(function(l) { return l.active; }).length;
    document.getElementById('locations-count').textContent =
      locationsData.length + ' location' + (locationsData.length !== 1 ? 's' : '') +
      ' · ' + activeCount + ' active';
    document.getElementById('locations-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderLocationsTable();
  } catch (err) {
    if (tbl) tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderLocationsTable() {
  var tbl = document.getElementById('locations-table');
  var LTYPE_LABELS = {
    pen:'Pen', quarantine:'Quarantine', bsf_area:'BSF area',
    field_plot:'Field plot', shed:'Shed', storage:'Storage',
    pond:'Pond', other:'Other'
  };
  var LTYPE_BADGE = {
    pen:'badge-green', quarantine:'badge-red', bsf_area:'badge-teal',
    field_plot:'badge-lime', shed:'badge-gray', storage:'badge-blue',
    pond:'badge-blue', other:'badge-gray'
  };

  // Build shed options for parent dropdown
  var shedOpts = '<option value="">— none —</option>' +
    locationsData.filter(function(l) { return l.location_type === 'shed'; }).map(function(l) {
      return '<option value="' + l.id + '">' + l.name + '</option>';
    }).join('');

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th style="min-width:180px">Name</th>' +
    '<th>Type</th>' +
    '<th>Parent shed</th>' +
    '<th style="min-width:90px">Area (acres)</th>' +
    '<th style="min-width:80px">Capacity</th>' +
    '<th style="min-width:220px">Notes</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  var activeLocations  = locationsData.filter(function(l) { return l.active; });
  var retiredLocations = locationsData.filter(function(l) { return !l.active; });
  var orderedLocations = activeLocations.concat(retiredLocations);
  var retiredHeaderInserted = false;

  orderedLocations.forEach(function(l) {
    if (!l.active && !retiredHeaderInserted) {
      html += '<tr><td colspan="7" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">' +
        'Retired locations</td></tr>';
      retiredHeaderInserted = true;
    }
    var esc = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); };
    html += '<tr style="' + (!l.active ? 'opacity:0.5' : '') + '">';
    html += '<td><input type="text" value="' + esc(l.name) +
      '" style="width:100%" onchange="patchLocation(' + l.id + ',\'name\',this.value.trim())"></td>';
    html += '<td>' +
      '<select style="width:100%" onchange="patchLocation(' + l.id + ',\'location_type\',this.value)">' +
      ['pen','quarantine','bsf_area','field_plot','shed','storage','pond','other'].map(function(v) {
        return '<option value="' + v + '"' + (l.location_type === v ? ' selected' : '') + '>' + (LTYPE_LABELS[v] || v) + '</option>';
      }).join('') + '</select></td>';
    html += '<td><select style="width:100%;min-width:120px" onchange="patchLocation(' + l.id + ',\'shed_id\',this.value?parseInt(this.value):null)">' +
      shedOpts.replace('value="' + l.shed_id + '"', 'value="' + l.shed_id + '" selected') +
      '</select></td>';
    html += '<td><input type="number" value="' + (l.area_acres != null ? l.area_acres : '') +
      '" style="width:100%" min="0" step="0.01" placeholder="—"' +
      ' onchange="patchLocation(' + l.id + ',\'area_acres\',this.value===\'\'?null:parseFloat(this.value))"></td>';
    html += '<td><input type="number" value="' + (l.capacity_animals != null ? l.capacity_animals : '') +
      '" style="width:100%" min="0" step="1" placeholder="—"' +
      ' onchange="patchLocation(' + l.id + ',\'capacity_animals\',this.value===\'\'?null:parseInt(this.value))"></td>';
    html += '<td><input type="text" value="' + esc(l.notes) +
      '" style="width:100%" placeholder="—"' +
      ' onchange="patchLocation(' + l.id + ',\'notes\',this.value.trim()||null)"></td>';
    html += '<td>' + (l.active
      ? '<button class="btn btn-sm" style="font-size:11px;color:var(--muted)" onclick="retireLocation(' + l.id + ',\'' + (l.name || '').replace(/'/g,"\\'") + '\')">Retire</button>'
      : '<button class="btn btn-sm" style="font-size:11px" onclick="reactivateLocation(' + l.id + ')">Reactivate</button>'
    ) + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += buildLocationAddRow(shedOpts);
  tbl.innerHTML = html;
}

function buildLocationAddRow(shedOpts) {
  return '<div style="padding:18px 22px;border-top:1px solid var(--border);background:var(--bg)">' +
    '<div style="font-size:12px;font-weight:500;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Add location</div>' +
    '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
    '<div><label style="font-size:11px;color:var(--muted)">Name (required)</label>' +
    '<input type="text" id="nl-name" style="width:100%" placeholder="e.g. Goat Pen A"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Type</label>' +
    '<select id="nl-type" style="width:100%">' +
    '<option value="pen">Pen</option>' +
    '<option value="quarantine">Quarantine</option>' +
    '<option value="bsf_area">BSF area</option>' +
    '<option value="field_plot">Field plot</option>' +
    '<option value="shed">Shed</option>' +
    '<option value="storage">Storage</option>' +
    '<option value="pond">Pond</option>' +
    '<option value="other">Other</option>' +
    '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Parent shed</label>' +
    '<select id="nl-shed" style="width:100%">' + shedOpts + '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Area (acres)</label>' +
    '<input type="number" id="nl-area" min="0" step="0.01" style="width:100%" placeholder="—"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">Capacity (animals)</label>' +
    '<input type="number" id="nl-cap" min="0" step="1" style="width:100%" placeholder="—"></div>' +
    '</div>' +
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">Notes</label>' +
    '<input type="text" id="nl-notes" style="width:100%;max-width:500px" placeholder="description, GPS ref, current use…"></div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
    '<button class="btn btn-primary btn-sm" onclick="submitNewLocation()">Add location</button>' +
    '<span id="nl-status" style="font-size:12px;color:var(--muted)"></span>' +
    '</div></div>';
}

async function patchLocation(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('locations', id, d);
    var l = locationsData.find(function(x) { return x.id === id; });
    if (l) l[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadLocationsPage();
  }
}

async function submitNewLocation() {
  var statusEl = document.getElementById('nl-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var name = (document.getElementById('nl-name').value || '').trim();
    if (!name) throw new Error('Name is required.');
    var d = {
      name:          name,
      location_type: document.getElementById('nl-type').value,
      active:        true
    };
    var shedId = document.getElementById('nl-shed').value;
    var area   = document.getElementById('nl-area').value;
    var cap    = document.getElementById('nl-cap').value;
    var notes  = (document.getElementById('nl-notes').value || '').trim();
    if (shedId) d.shed_id          = parseInt(shedId);
    if (area)   d.area_acres       = parseFloat(area);
    if (cap)    d.capacity_animals = parseInt(cap);
    if (notes)  d.notes            = notes;
    await sbInsert('locations', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadLocationsPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
