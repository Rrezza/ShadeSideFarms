// ============================================================
// setup_species.js v17 — Species page
// ============================================================

// SPECIES PAGE
// ============================================================
var speciesData = [];
var speciesEditId = null;

// Re-fetch the shared species cache (used by intake, feed, pregnancy checks…)
// with the same columns loadSharedAnimalData() loads — gestation_days included,
// or pregnancy due dates would silently fall back to the 150-day default.
function refreshSharedSpecies() {
  if (typeof anSharedLoaded === 'undefined' || !anSharedLoaded) return;
  sbGet('species', 'select=id,common_name,gestation_days&order=common_name').then(function(r) { anSharedSpecies = r; });
}

async function loadSpeciesPage() {
  // Build page structure if HTML wasn't updated
  var pageEl = document.getElementById('page-species');
  if (!pageEl) {
    pageEl = document.createElement('div');
    pageEl.id = 'page-species';
    pageEl.className = 'page active';
    pageEl.innerHTML =
      '<div class="page-hdr"><h1>Species</h1><button class="refresh-btn" onclick="loadSpeciesPage()">↻ Refresh</button></div>' +
      '<div class="section">' +
        '<div class="section-hdr">' +
          '<h2>Farm species</h2>' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<span class="section-meta" id="species-count"></span>' +
            '<button class="btn btn-primary btn-sm" onclick="toggleSpeciesForm()">+ Add species</button>' +
          '</div>' +
        '</div>' +
        '<div id="species-add-form" style="display:none;padding:18px 22px;background:var(--bg);border-bottom:1px solid var(--border)">' +
          '<div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px;max-width:640px;margin-bottom:12px">' +
            '<div class="fc-field"><label>Common name <span style="color:var(--red)">*</span></label><input type="text" id="nsf-name" placeholder="e.g. Goat"></div>' +
            '<div class="fc-field"><label>Notes</label><input type="text" id="nsf-notes" placeholder="Optional"></div>' +
            '<div class="fc-field"><label>Gestation (days)</label><input type="number" id="nsf-gestation" min="1" step="1" placeholder="e.g. 150"></div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;align-items:center">' +
            '<button class="btn btn-primary" onclick="submitSpecies()">Save</button>' +
            '<button class="btn" onclick="toggleSpeciesForm()">Cancel</button>' +
            '<span id="nsf-status" style="font-size:13px;color:var(--muted)"></span>' +
          '</div>' +
        '</div>' +
        '<div id="species-table"><div class="loading">Loading…</div></div>' +
      '</div>';
    var main = document.querySelector('.content') || document.querySelector('main');
    if (main) main.appendChild(pageEl); else document.body.appendChild(pageEl);
  }

  var tbl = document.getElementById('species-table');
  if (!tbl) return;
  tbl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    speciesData = await sbGet('species', 'select=id,common_name,gestation_days,notes&order=common_name');
    var countEl = document.getElementById('species-count');
    if (countEl) countEl.textContent = speciesData.length + ' species';
    renderSpeciesTable();
  } catch (err) {
    tbl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function renderSpeciesTable() {
  var tbl = document.getElementById('species-table');
  if (!tbl) return;
  if (!speciesData.length) {
    tbl.innerHTML = '<div class="empty">No species yet. Click "+ Add species" to add one.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Common name</th><th class="right">Gestation (days)</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';
  speciesData.forEach(function(s) {
    if (speciesEditId === s.id) {
      html += '<tr class="ing-selected">' +
        '<td><input type="text" id="se-name-' + s.id + '" value="' + s.common_name.replace(/"/g, '&quot;') + '" style="width:100%" ' +
          'onkeydown="if(event.key===\'Enter\')saveSpecies(' + s.id + ');if(event.key===\'Escape\')cancelSpeciesEdit();"></td>' +
        '<td class="right"><input type="number" id="se-gest-' + s.id + '" min="1" step="1" value="' + (s.gestation_days || '') + '" style="width:80px;text-align:right" placeholder="—" ' +
          'onkeydown="if(event.key===\'Enter\')saveSpecies(' + s.id + ');if(event.key===\'Escape\')cancelSpeciesEdit();"></td>' +
        '<td><input type="text" id="se-notes-' + s.id + '" value="' + (s.notes || '').replace(/"/g, '&quot;') + '" style="width:100%" placeholder="—" ' +
          'onkeydown="if(event.key===\'Enter\')saveSpecies(' + s.id + ');if(event.key===\'Escape\')cancelSpeciesEdit();"></td>' +
        '<td><div style="display:flex;gap:6px">' +
          '<button class="btn btn-sm btn-primary" onclick="saveSpecies(' + s.id + ')">Save</button>' +
          '<button class="btn btn-sm" onclick="cancelSpeciesEdit()">Cancel</button>' +
        '</div></td>' +
      '</tr>';
    } else {
      html += '<tr>' +
        '<td style="font-weight:500">' + s.common_name + '</td>' +
        '<td class="mono right">' + (s.gestation_days || '\u2014') + '</td>' +
        '<td class="muted-cell" style="font-size:12px">' + (s.notes || '') + '</td>' +
        '<td><div style="display:flex;gap:6px">' +
          '<button class="btn btn-sm" onclick="startSpeciesEdit(' + s.id + ')">Edit</button>' +
          '<button class="btn btn-sm del-btn" onclick="deleteSpecies(' + s.id + ',\'' + s.common_name.replace(/'/g,"\\'") + '\')">Delete</button>' +
        '</div></td>' +
      '</tr>';
    }
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
  if (speciesEditId !== null) {
    setTimeout(function() {
      var el = document.getElementById('se-name-' + speciesEditId);
      if (el) { el.focus(); el.select(); }
    }, 30);
  }
}

function toggleSpeciesForm() {
  var formEl = document.getElementById('species-add-form');
  if (!formEl) return;
  if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }
  var nameEl = document.getElementById('nsf-name');
  var notesEl = document.getElementById('nsf-notes');
  var statusEl = document.getElementById('nsf-status');
  if (nameEl) nameEl.value = '';
  if (notesEl) notesEl.value = '';
  var gestEl = document.getElementById('nsf-gestation'); if (gestEl) gestEl.value = '';
  if (statusEl) statusEl.textContent = '';
  formEl.style.display = 'block';
  if (nameEl) nameEl.focus();
}

async function submitSpecies() {
  var name    = ((document.getElementById('nsf-name')  || {}).value || '').trim();
  var notes   = ((document.getElementById('nsf-notes') || {}).value || '').trim() || null;
  var gest    = parseInt((document.getElementById('nsf-gestation') || {}).value) || null;
  var statusEl = document.getElementById('nsf-status');
  if (!name) { if (statusEl) statusEl.textContent = 'Name required.'; return; }
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbInsert('species', { common_name: name, notes: notes, gestation_days: gest });
    if (statusEl) statusEl.textContent = 'Saved ✓';
    document.getElementById('species-add-form').style.display = 'none';
    loadSpeciesPage();
    // Refresh the shared species cache so recipe and animal dropdowns reflect the new species
    refreshSharedSpecies();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

function startSpeciesEdit(id) {
  speciesEditId = id;
  renderSpeciesTable();
}

function cancelSpeciesEdit() {
  speciesEditId = null;
  renderSpeciesTable();
}

async function saveSpecies(id) {
  var nameEl  = document.getElementById('se-name-'  + id);
  var notesEl = document.getElementById('se-notes-' + id);
  var name  = nameEl  ? nameEl.value.trim()  : null;
  var notes = notesEl ? notesEl.value.trim() : null;
  var gestEl = document.getElementById('se-gest-' + id);
  var gest  = gestEl ? (parseInt(gestEl.value) || null) : null;
  if (!name) { alert('Name cannot be blank.'); if (nameEl) nameEl.focus(); return; }
  speciesEditId = null;
  try {
    await sbPatch('species', id, { common_name: name, notes: notes || null, gestation_days: gest });
    var s = speciesData.find(function(x) { return x.id === id; });
    if (s) { s.common_name = name; s.notes = notes || null; s.gestation_days = gest; }
    renderSpeciesTable();
    // Refresh the shared species cache so recipe and animal dropdowns reflect the change
    refreshSharedSpecies();
  } catch (err) {
    alert('Save failed: ' + err.message);
    loadSpeciesPage();
  }
}

// ============================================================
