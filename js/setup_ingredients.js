// ============================================================
// setup_ingredients.js v17 — Ingredients page
// ============================================================

// INGREDIENTS (carry from v15)
// ============================================================
var NUT_FIELDS = [
  { key:'dry_matter_pct',             label:'Dry matter (%)' },
  { key:'crude_protein_pct_dm',       label:'Crude protein (% DM)' },
  { key:'metabolizable_energy_mj_kg', label:'Metabolizable energy (MJ/kg DM)' },
  { key:'crude_fat_pct_dm',           label:'Crude fat (% DM)' },
  { key:'ndf_pct_dm',                 label:'Neutral detergent fiber (% DM)' }
];
var CATS = ['grain','protein','roughage','mineral','supplement','complete_feed','other'];
var SRCS = ['purchased','produced','vet_supplied','dual'];
var ingData = [];
var ingSortCol = 'name';
var ingSortDir = 'asc';
var selectedIngId = null;
var ingEditNameId = null;     // which row has its name in edit mode

async function loadIngredients() {
  var el = document.getElementById('ingredients-table');
  el.innerHTML = '<div class="loading">Loading…</div>';

  // Inject "+ New ingredient" button and form container if not already present.
  // ing-add-form and button are hardcoded in the HTML — no dynamic injection needed.

  try {
    ingData = await sbGet('ingredients', 'select=*&order=name');
    document.getElementById('ing-count').textContent = ingData.length + ' ingredients';
    selectedIngId = null;
    document.getElementById('similarity-panel-container').innerHTML = '';
    renderIngredientsTable();
    renderAbbrevKey('abbrev-ingredients', ['DM', 'CP', 'ME', 'NDF']);
  } catch (err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function sortIngredients(col) {
  if (ingSortCol === col) ingSortDir = ingSortDir === 'asc' ? 'desc' : 'asc';
  else { ingSortCol = col; ingSortDir = 'asc'; }
  renderIngredientsTable();
}

function getSorted() {
  var col = ingSortCol, dir = ingSortDir === 'asc' ? 1 : -1;
  return ingData.slice().sort(function(a, b) {
    var av = a[col], bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
  });
}

function thS(col, label) {
  var a = ingSortCol === col;
  return '<th class="sortable' + (a ? ' sort-' + ingSortDir : '') + '" onclick="sortIngredients(\'' + col + '\')">' + label + '</th>';
}

function renderIngredientsTable() {
  var sorted = getSorted();
  var nutH = NUT_FIELDS.map(function(f) { return thS(f.key, f.label); }).join('');
  var tbody = sorted.map(function(ing) {
    var sel = selectedIngId === ing.id;
    var co = CATS.map(function(c) { return '<option value="' + c + '"' + (ing.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    var so = SRCS.map(function(s) { return '<option value="' + s + '"' + (ing.source_type === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    var nc = NUT_FIELDS.map(function(f) {
      return '<td><input type="number" min="0" step="0.01" value="' + (ing[f.key] != null ? ing[f.key] : '') +
             '" placeholder="—" style="width:80px;text-align:right" onchange="patchIng(' + ing.id + ',\'' + f.key + '\',this.value===\'\'?null:parseFloat(this.value))"></td>';
    }).join('');

    // Name cell — edit mode or view mode
    var nameCell;
    if (ingEditNameId === ing.id) {
      nameCell = '<td style="min-width:160px">' +
        '<div style="display:flex;gap:5px;align-items:center">' +
          '<input type="text" id="ing-name-edit-' + ing.id + '" value="' + ing.name.replace(/"/g, '&quot;') + '" ' +
            'style="flex:1;font-weight:500" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();saveIngName(' + ing.id + ');}if(event.key===\'Escape\')cancelEditIngName();">' +
          '<button class="btn btn-sm btn-primary" onclick="saveIngName(' + ing.id + ')">✓</button>' +
          '<button class="btn btn-sm" onclick="cancelEditIngName()">✕</button>' +
        '</div>' +
      '</td>';
    } else {
      nameCell = '<td style="min-width:160px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px">' +
          '<span style="font-weight:500;cursor:pointer" onclick="selectIngredient(' + ing.id + ')" title="Click to find similar">' +
            ing.name + (sel ? ' <span style="font-size:10px;color:var(--green)">(selected)</span>' : '') +
          '</span>' +
          '<button class="btn-link" style="font-size:14px;padding:0 2px;opacity:0.5;flex-shrink:0" ' +
            'onclick="startEditIngName(' + ing.id + ')" title="Edit name">✎</button>' +
        '</div>' +
      '</td>';
    }

    // Notes cell — inline text input
    var notesCell = '<td><input type="text" value="' + (ing.notes || '').replace(/"/g, '&quot;') + '" ' +
      'placeholder="—" style="width:120px;font-size:12px" ' +
      'onchange="patchIng(' + ing.id + ',\'notes\',this.value.trim()||null)"></td>';

    return '<tr class="' + (sel ? 'ing-selected' : '') + '" style="' + (!ing.active ? 'opacity:0.5' : '') + '">' +
      nameCell +
      '<td><select onchange="patchIng(' + ing.id + ',\'category\',this.value)">' + co + '</select></td>' +
      '<td><select onchange="patchIng(' + ing.id + ',\'source_type\',this.value)">' + so + '</select></td>' +
      '<td style="text-align:center"><input type="checkbox" ' + (ing.active ? 'checked' : '') +
        ' onchange="patchIng(' + ing.id + ',\'active\',this.checked)"></td>' +
      nc + notesCell +
      '<td><button class="btn btn-sm del-btn" onclick="deleteIngredient(' + ing.id + ',\'' + ing.name.replace(/'/g,"\\'") + '\')">Delete</button></td>' +
      '</tr>';
  }).join('');
  document.getElementById('ingredients-table').innerHTML =
    '<div style="overflow-x:auto"><table><thead><tr>' +
      thS('name', 'Ingredient name') + thS('category', 'Category') + thS('source_type', 'Source type') +
      '<th>Active</th>' + nutH + '<th>Notes</th><th></th></tr></thead><tbody>' + tbody + '</tbody></table></div>';

  // Re-focus and select the name input if in edit mode
  if (ingEditNameId !== null) {
    setTimeout(function() {
      var el = document.getElementById('ing-name-edit-' + ingEditNameId);
      if (el) { el.focus(); el.select(); }
    }, 30);
  }
}

function selectIngredient(id) {
  if (selectedIngId === id) {
    selectedIngId = null;
    document.getElementById('similarity-panel-container').innerHTML = '';
    renderIngredientsTable();
    return;
  }
  selectedIngId = id;
  renderIngredientsTable();
  renderSimilarityPanel();
}

function renderSimilarityPanel() {
  var ref = ingData.find(function(i) { return i.id === selectedIngId; });
  if (!ref) return;
  var dc = NUT_FIELDS.map(function(f) {
    return '<label><input type="checkbox" value="' + f.key + '" onchange="runSimilarity()" checked><span>' + f.label + '</span></label>';
  }).join('');
  document.getElementById('similarity-panel-container').innerHTML =
    '<div class="similarity-panel"><h3>Find similar ingredients</h3>' +
    '<div class="sim-ref">Reference: <strong>' + ref.name + '</strong></div>' +
    '<div class="sim-dims" id="sim-dims">' + dc + '</div>' +
    '<div id="sim-results"></div></div>';
  runSimilarity();
}

function runSimilarity() {
  var ref = ingData.find(function(i) { return i.id === selectedIngId; });
  if (!ref) return;
  var dims = Array.prototype.slice.call(document.querySelectorAll('#sim-dims input:checked'))
    .map(function(el) { return el.value; });
  var re = document.getElementById('sim-results');
  if (!dims.length) {
    re.innerHTML = '<div style="font-size:13px;color:var(--faint)">Select at least one dimension.</div>';
    return;
  }
  var ranges = {};
  dims.forEach(function(d) {
    var vals = ingData.map(function(i) { return i[d]; }).filter(function(v) { return v != null; });
    var sp = vals.length >= 2 ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : 0;
    ranges[d] = sp > 0 ? sp : null;
  });
  var scored = ingData.filter(function(i) { return i.id !== selectedIngId; }).map(function(ing) {
    var tot = 0, u = 0, m = 0;
    dims.forEach(function(d) {
      var rv = ref[d], cv = ing[d];
      if (rv == null || cv == null) { m++; return; }
      if (!ranges[d]) { u++; return; }
      tot += Math.abs(rv - cv) / ranges[d];
      u++;
    });
    if (!u) return null;
    return { ing: ing, dist: tot / u, used: u, missing: m, total: dims.length };
  }).filter(Boolean).sort(function(a, b) { return a.dist - b.dist; }).slice(0, 8);
  if (!scored.length) {
    re.innerHTML = '<div style="font-size:13px;color:var(--faint)">No comparable ingredients found.</div>';
    return;
  }
  var mx = Math.max.apply(null, scored.map(function(s) { return s.dist; }).concat([0.01]));
  var dH = NUT_FIELDS.filter(function(f) { return dims.indexOf(f.key) >= 0; })
    .map(function(f) { return '<th>' + f.label + '</th>'; }).join('');
  var rRow = '<tr style="background:var(--green-lt)">' +
    '<td style="font-weight:500">' + ref.name + ' <span style="font-size:10px;color:var(--green)">reference</span></td>' +
    '<td>—</td>' +
    NUT_FIELDS.filter(function(f) { return dims.indexOf(f.key) >= 0; }).map(function(f) {
      return '<td class="mono">' + (ref[f.key] != null ? Number(ref[f.key]).toFixed(2) : '—') + '</td>';
    }).join('') + '</tr>';
  var rows = scored.map(function(s) {
    var sim = Math.max(0, Math.round((1 - s.dist / mx) * 100));
    var note = s.missing > 0 ? ' <span style="font-size:10px;color:var(--faint)">(' + s.missing + '/' + s.total + ' missing)</span>' : '';
    var cells = NUT_FIELDS.filter(function(f) { return dims.indexOf(f.key) >= 0; }).map(function(f) {
      var rv = ref[f.key], cv = s.ing[f.key];
      if (cv == null) return '<td class="muted-cell">—</td>';
      var diff = rv != null ? cv - rv : null;
      var col = diff == null ? '' : (Math.abs(diff) < 0.5 ? 'color:var(--green)' : Math.abs(diff) < 2 ? 'color:var(--amber)' : 'color:var(--red)');
      var sign = diff != null && diff > 0 ? '+' : '';
      return '<td class="mono">' + Number(cv).toFixed(2) +
             (diff != null ? ' <span style="font-size:10px;' + col + '">' + sign + diff.toFixed(2) + '</span>' : '') + '</td>';
    }).join('');
    return '<tr><td style="font-weight:500">' + s.ing.name + (!s.ing.active ? '<span style="font-size:10px;color:var(--faint)"> inactive</span>' : '') + note + '</td>' +
      '<td><span class="sim-score-bar" style="width:' + sim + 'px"></span><span style="font-size:12px;color:var(--muted)">' + sim + '%</span></td>' + cells + '</tr>';
  }).join('');
  re.innerHTML = '<div style="overflow-x:auto"><table><thead><tr><th>Ingredient</th><th>Similarity</th>' + dH + '</tr></thead><tbody>' +
    rRow + rows + '</tbody></table></div>' +
    '<div style="font-size:12px;color:var(--faint);padding:10px 0">Green = within 0.5, amber = within 2.0, red = greater than 2.0.</div>';
}

async function patchIng(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('ingredients', id, d);
    var i = ingData.find(function(x) { return x.id === id; }); if (i) i[field] = value;
    if (selectedIngId) runSimilarity();
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadIngredients();
  }
}

// ---- Inline name editing ----

function startEditIngName(id) {
  ingEditNameId = id;
  renderIngredientsTable();
}

function cancelEditIngName() {
  ingEditNameId = null;
  renderIngredientsTable();
}

async function saveIngName(id) {
  var el = document.getElementById('ing-name-edit-' + id);
  if (!el) return;
  var newName = el.value.trim();
  if (!newName) { alert('Name cannot be blank.'); el.focus(); return; }
  ingEditNameId = null;
  await patchIng(id, 'name', newName);
}

// ---- Add new ingredient form ----

function toggleIngForm() {
  var formEl = document.getElementById('ing-add-form');
  if (!formEl) return;
  if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }

  var catOpts = CATS.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  var srcOpts = SRCS.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');

  formEl.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">' +
      '<div class="fc-field" style="grid-column:span 2"><label>Name <span style="color:var(--red)">*</span></label>' +
        '<input type="text" id="nif-name" placeholder="e.g. Maize grain"></div>' +
      '<div class="fc-field"><label>Category <span style="color:var(--red)">*</span></label>' +
        '<select id="nif-cat"><option value="">— select —</option>' + catOpts + '</select></div>' +
      '<div class="fc-field"><label>Source type <span style="color:var(--red)">*</span></label>' +
        '<select id="nif-src"><option value="">— select —</option>' + srcOpts + '</select></div>' +
      '<div class="fc-field"><label>Unit</label>' +
        '<input type="text" id="nif-unit" value="kg" placeholder="kg"></div>' +
      '<div class="fc-field" style="grid-column:span 3"><label>Notes</label>' +
        '<input type="text" id="nif-notes" placeholder="Optional"></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center">' +
      '<button class="btn btn-primary" onclick="submitIngredient()">Save ingredient</button>' +
      '<button class="btn" onclick="toggleIngForm()">Cancel</button>' +
      '<span id="nif-status" style="font-size:13px;color:var(--muted)"></span>' +
    '</div>';
  formEl.style.display = 'block';
  document.getElementById('nif-name').focus();
}

async function submitIngredient() {
  var name    = ((document.getElementById('nif-name')  || {}).value || '').trim();
  var cat     = (document.getElementById('nif-cat')    || {}).value;
  var src     = (document.getElementById('nif-src')    || {}).value;
  var unit    = ((document.getElementById('nif-unit')  || {}).value || '').trim() || 'kg';
  var notes   = ((document.getElementById('nif-notes') || {}).value || '').trim() || null;
  var statusEl = document.getElementById('nif-status');

  if (!name)  { if (statusEl) statusEl.textContent = 'Name required.'; return; }
  if (!cat)   { if (statusEl) statusEl.textContent = 'Category required.'; return; }
  if (!src)   { if (statusEl) statusEl.textContent = 'Source type required.'; return; }

  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbInsert('ingredients', { name: name, category: cat, source_type: src, unit: unit, notes: notes, active: true });
    if (statusEl) statusEl.textContent = 'Saved ✓';
    document.getElementById('ing-add-form').style.display = 'none';
    loadIngredients();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

// ============================================================
