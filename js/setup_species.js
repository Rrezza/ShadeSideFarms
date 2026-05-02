// ============================================================
// setup_species.js v17 — Species page
// ============================================================

// SPECIES PAGE
// ============================================================
var speciesData = [];
var speciesEditId = null;

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
          '<div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;max-width:480px;margin-bottom:12px">' +
            '<div class="fc-field"><label>Common name <span style="color:var(--red)">*</span></label><input type="text" id="nsf-name" placeholder="e.g. Goat"></div>' +
            '<div class="fc-field"><label>Notes</label><input type="text" id="nsf-notes" placeholder="Optional"></div>' +
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
    speciesData = await sbGet('species', 'select=id,common_name,notes&order=common_name');
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
    '<th>Common name</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';
  speciesData.forEach(function(s) {
    if (speciesEditId === s.id) {
      html += '<tr class="ing-selected">' +
        '<td><input type="text" id="se-name-' + s.id + '" value="' + s.common_name.replace(/"/g, '&quot;') + '" style="width:100%" ' +
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
  if (statusEl) statusEl.textContent = '';
  formEl.style.display = 'block';
  if (nameEl) nameEl.focus();
}

async function submitSpecies() {
  var name    = ((document.getElementById('nsf-name')  || {}).value || '').trim();
  var notes   = ((document.getElementById('nsf-notes') || {}).value || '').trim() || null;
  var statusEl = document.getElementById('nsf-status');
  if (!name) { if (statusEl) statusEl.textContent = 'Name required.'; return; }
  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbInsert('species', { common_name: name, notes: notes });
    if (statusEl) statusEl.textContent = 'Saved ✓';
    document.getElementById('species-add-form').style.display = 'none';
    loadSpeciesPage();
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
  if (!name) { alert('Name cannot be blank.'); if (nameEl) nameEl.focus(); return; }
  speciesEditId = null;
  try {
    await sbPatch('species', id, { common_name: name, notes: notes || null });
    var s = speciesData.find(function(x) { return x.id === id; });
    if (s) { s.common_name = name; s.notes = notes || null; }
    renderSpeciesTable();
    // Refresh the shared species cache so recipe and animal dropdowns reflect the change
    if (typeof loadSharedAnimalData === 'function' && anSharedLoaded) {
      sbGet('species', 'select=id,common_name&order=common_name').then(function(r) { anSharedSpecies = r; });
    }
  } catch (err) {
    alert('Save failed: ' + err.message);
    loadSpeciesPage();
  }
}

// ============================================================
