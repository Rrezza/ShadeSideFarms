// ============================================================
// fd_recipes.js v17 — Recipe setup page
// ============================================================

// ============================================================
// RECIPE SETUP (new in v17)
// ============================================================

// ============================================================
// RECIPE DETAIL — inline expand on click
// ============================================================
var rsDetailCache = {};   // recipeId → { lines: [...] } or { error: '...' }

var RS_NUTR = [
  { key: 'crude_protein_pct_dm',       label: 'Crude protein',   unit: '% DM',     ref: 14,  refDir: 'min' },
  { key: 'crude_fat_pct_dm',           label: 'Crude fat',       unit: '% DM',     ref: null, refDir: null },
  { key: 'ndf_pct_dm',                 label: 'Fiber (NDF)',     unit: '% DM',     ref: null, refDir: null },
  { key: 'metabolizable_energy_mj_kg', label: 'ME',              unit: 'MJ/kg DM', ref: 9.0, refDir: 'min' }
];

async function toggleRecipeDetail(recipeId) {
  var detailRow = document.getElementById('rsd-' + recipeId);
  var btn       = document.getElementById('rsd-btn-' + recipeId);
  if (!detailRow) return;

  var visible = detailRow.style.display !== 'none';
  if (visible) {
    detailRow.style.display = 'none';
    if (btn) btn.textContent = '▾ Details';
    return;
  }

  if (btn) btn.textContent = 'Loading…';

  if (!rsDetailCache[recipeId]) {
    try {
      var vers = await sbGet('recipe_versions',
        'recipe_id=eq.' + recipeId + '&select=id&order=version_number.desc&limit=1');
      if (!vers.length) {
        rsDetailCache[recipeId] = { lines: [], error: 'No version found.' };
      } else {
        var lines = await sbGet('recipe_ingredients',
          'recipe_version_id=eq.' + vers[0].id +
          '&select=inclusion_rate,' +
          'ingredients(id,name,category,crude_protein_pct_dm,crude_fat_pct_dm,' +
          'ndf_pct_dm,metabolizable_energy_mj_kg,calcium_pct_dm,phosphorus_pct_dm)' +
          '&order=inclusion_rate.desc');
        rsDetailCache[recipeId] = { lines: lines };
      }
    } catch (e) {
      rsDetailCache[recipeId] = { lines: [], error: e.message };
    }
  }

  // Build blended nutritional values
  var data = rsDetailCache[recipeId];
  var blended = {}; var coverage = {};
  RS_NUTR.forEach(function(f) { blended[f.key] = 0; coverage[f.key] = 0; });
  if (data.lines) {
    data.lines.forEach(function(row) {
      var ing = row.ingredients; if (!ing) return;
      var incl = parseFloat(row.inclusion_rate) || 0;
      RS_NUTR.forEach(function(f) {
        if (ing[f.key] != null) { blended[f.key] += ing[f.key] * incl; coverage[f.key] += incl; }
      });
    });
  }
  RS_NUTR.forEach(function(f) {
    blended[f.key] = coverage[f.key] > 0 ? blended[f.key] / coverage[f.key] : null;
  });
  var hasNutr = RS_NUTR.some(function(f) { return blended[f.key] != null; });

  var html = '';
  if (data.error) {
    html = '<div style="padding:14px 18px;color:var(--red)">' + data.error + '</div>';
  } else if (!data.lines || !data.lines.length) {
    html = '<div style="padding:14px 18px;color:var(--faint)">No ingredients in this recipe version.</div>';
  } else {
    html = '<div style="padding:14px 18px 18px;background:var(--bg);border-top:1px solid var(--border);' +
           'display:grid;grid-template-columns:1.4fr 1fr;gap:24px">';

    // Ingredient inclusion table
    html += '<div>';
    html += '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;' +
            'letter-spacing:0.06em;margin-bottom:8px">Ingredient inclusion</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr>' +
            '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);color:var(--muted)">Ingredient</th>' +
            '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);color:var(--muted)">%</th>';
    if (hasNutr) {
      html += '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);color:var(--muted)">CP %DM</th>';
      html += '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);color:var(--muted)">Fat %DM</th>';
    }
    html += '</tr></thead><tbody>';
    data.lines.forEach(function(row) {
      var ing  = row.ingredients || {};
      var incl = parseFloat(row.inclusion_rate) || 0;
      html += '<tr>' +
        '<td style="padding:4px 6px;font-weight:500">' + (ing.name || '?') + '</td>' +
        '<td style="padding:4px 6px;text-align:right;font-family:var(--mono)">' +
          (incl * 100).toFixed(1) + '%</td>';
      if (hasNutr) {
        html += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--muted)">' +
          (ing.crude_protein_pct_dm != null ? ing.crude_protein_pct_dm.toFixed(1) : '—') + '</td>';
        html += '<td style="padding:4px 6px;text-align:right;font-family:var(--mono);color:var(--muted)">' +
          (ing.crude_fat_pct_dm != null ? ing.crude_fat_pct_dm.toFixed(1) : '—') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Nutritional summary
    html += '<div>';
    html += '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;' +
            'letter-spacing:0.06em;margin-bottom:8px">Blended profile</div>';
    if (!hasNutr) {
      html += '<div style="font-size:12px;color:var(--faint)">No nutritional values on file for this ' +
              'recipe\'s ingredients.<br>Add them in <strong>Setup → Ingredients</strong>.</div>';
    } else {
      RS_NUTR.forEach(function(f) {
        if (blended[f.key] == null) return;
        var val  = blended[f.key];
        var flag = '';
        if (f.ref != null && f.refDir === 'min') {
          flag = val >= f.ref
            ? ' <span style="color:var(--green);font-size:10px">✓ ≥' + f.ref + '</span>'
            : ' <span style="color:var(--amber);font-size:10px">⚠ target ≥' + f.ref + '</span>';
        }
        html += '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
                'padding:5px 0;border-bottom:1px solid var(--border-lt,#ede9de);font-size:13px">' +
                '<span style="color:var(--muted)">' + f.label + '</span>' +
                '<span style="font-family:var(--mono);font-weight:500">' +
                val.toFixed(1) + ' ' + f.unit + flag + '</span></div>';
      });
    }
    html += '</div>';
    html += '</div>';
  }

  detailRow.innerHTML = '<td colspan="7" style="padding:0">' + html + '</td>';
  detailRow.style.display = '';
  if (btn) btn.textContent = '▴ Details';
}

async function loadRecipeSetup() {
  var listEl = document.getElementById('recipe-list-table');
  var metaEl = document.getElementById('recipe-list-meta');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading">Loading…</div>';

  try {
    var recipes = await sbGet('recipes',
      'active=eq.true&select=id,name,species(id,common_name),output_ingredient_id,' +
      'out_ing:ingredients!output_ingredient_id(id,name)&order=name');
    if (metaEl) metaEl.textContent = recipes.length + ' recipe' + (recipes.length !== 1 ? 's' : '');

    if (!recipes.length) {
      listEl.innerHTML = '<div class="empty">No concentrate recipes yet. Click "+ New recipe" to create one.</div>';
      return;
    }

    var recipeIds = recipes.map(function(r) { return r.id; });
    var versions = await sbGet('recipe_versions',
      'recipe_id=in.(' + recipeIds.join(',') + ')&select=id,recipe_id,version_number,effective_date&order=version_number.desc');
    var latestVer = {};
    versions.forEach(function(v) { if (!latestVer[v.recipe_id]) latestVer[v.recipe_id] = v; });

    var verIds = Object.values(latestVer).map(function(v) { return v.id; });
    var ingCountMap = {};
    if (verIds.length) {
      var ingCountRows = await sbGet('recipe_ingredients',
        'recipe_version_id=in.(' + verIds.join(',') + ')&select=recipe_version_id,ingredient_id,ingredients(name)');
      ingCountRows.forEach(function(r) {
        if (!ingCountMap[r.recipe_version_id]) ingCountMap[r.recipe_version_id] = [];
        if (r.ingredients && r.ingredients.name) ingCountMap[r.recipe_version_id].push(r.ingredients.name);
      });
    }

    var html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Name</th><th>Species</th><th>Output ingredient</th><th>Ingredients</th><th>Version</th><th>Effective</th><th></th>' +
      '</tr></thead><tbody>';
    recipes.forEach(function(r) {
      var ver = latestVer[r.id];
      var ingNames = ver ? (ingCountMap[ver.id] || []) : [];
      var outIng = r.out_ing;
      var outBadge = outIng
        ? '<span class="badge badge-lime">' + outIng.name + '</span>'
        : '<span class="badge badge-amber" title="Set this so concentrate batches can track stock">⚠ Not set</span>';
      html += '<tr>' +
        '<td style="font-weight:500">' + r.name + '</td>' +
        '<td>' + (r.species ? r.species.common_name : '<span style="color:var(--faint)">—</span>') + '</td>' +
        '<td>' + outBadge + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' +
          (ingNames.length ? ingNames.join(', ') : '<span style="color:var(--faint)">no ingredients</span>') + '</td>' +
        '<td class="mono">' + (ver ? 'v' + ver.version_number : '—') + '</td>' +
        '<td class="mono">' + (ver ? fmtDate(ver.effective_date) : '—') + '</td>' +
        '<td><div style="display:flex;gap:6px">' +
          '<button id="rsd-btn-' + r.id + '" class="btn btn-sm" ' +
            'onclick="toggleRecipeDetail(' + r.id + ')">▾ Details</button>' +
          '<button class="btn btn-sm" onclick="openEditRecipeForm(' + r.id + ')">Edit / new version</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deactivateRecipe(' + r.id + ')">Remove</button>' +
        '</div></td>' +
      '</tr>' +
      '<tr id="rsd-' + r.id + '" style="display:none"><td colspan="7" style="padding:0"></td></tr>';
    });
    html += '</tbody></table></div>';
    listEl.innerHTML = html;
  } catch (err) {
    listEl.innerHTML = '<div style="padding:20px 22px;font-size:13px;color:var(--red)">Error loading recipes: ' + err.message + '</div>';
    console.error('loadRecipeSetup error:', err);
  }
}


async function _ensureRecipeIngredients() {
  if (rsAllIngredients.length) return;
  try {
    rsAllIngredients = await sbGet('ingredients', 'active=eq.true&select=id,name,category&order=category,name');
  } catch (e) { rsAllIngredients = []; }
}

function _populateOutputIngSelect() {
  var sel = document.getElementById('rf-output-ing');
  if (!sel) return;
  sel.innerHTML = '<option value="">— none selected —</option>' +
    rsAllIngredients.map(function(i) {
      return '<option value="' + i.id + '">' + i.name +
        (i.category ? ' (' + i.category + ')' : '') + '</option>';
    }).join('');
}

async function _loadSpeciesIntoSelect(selEl) {
  if (!selEl) return;
  selEl.innerHTML = '<option value="">Loading…</option>';
  try {
    var specs = await sbGet('species', 'select=id,common_name&order=common_name');
    if (!specs.length) {
      selEl.innerHTML = '<option value="">No species found in database</option>';
      return;
    }
    selEl.innerHTML = '<option value="">— select species —</option>';
    specs.forEach(function(s) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.common_name;
      selEl.appendChild(o);
    });
  } catch (e) {
    selEl.innerHTML = '<option value="">Error loading species: ' + e.message + '</option>';
    console.error('Species load failed:', e);
  }
}

async function openNewRecipeForm() {
  rfEditRecipeId = null;
  document.getElementById('recipe-form-title').textContent = 'New concentrate recipe';
  document.getElementById('rf-name').value = '';
  document.getElementById('recipe-ing-rows').innerHTML = '';
  document.getElementById('rf-status').textContent = '';
  document.getElementById('recipe-incl-sum').textContent = '';
  rfIngRows = [];
  rfRowCounter = 0;
  document.getElementById('recipe-form-section').style.display = 'block';
  document.getElementById('recipe-form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Load species and ingredients in parallel
  await Promise.all([
    _loadSpeciesIntoSelect(document.getElementById('rf-species')),
    _ensureRecipeIngredients(),
    addRecipeIngRow()
  ]);
  _populateOutputIngSelect();
  document.getElementById('rf-output-ing').value = '';
}

async function openEditRecipeForm(recipeId) {
  rfEditRecipeId = recipeId;
  document.getElementById('recipe-form-title').textContent = 'Edit recipe — creates new version';
  document.getElementById('rf-status').textContent = '';
  document.getElementById('recipe-ing-rows').innerHTML = '';
  rfIngRows = []; rfRowCounter = 0;
  document.getElementById('recipe-form-section').style.display = 'block';
  document.getElementById('recipe-form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    await _ensureRecipeIngredients();
    var recipes = await sbGet('recipes',
      'id=eq.' + recipeId + '&select=id,name,species_id,output_ingredient_id');
    if (!recipes.length) return;
    var recipe = recipes[0];
    document.getElementById('rf-name').value = recipe.name;

    // Load species and ingredients in parallel then restore values
    await Promise.all([
      _loadSpeciesIntoSelect(document.getElementById('rf-species')),
      _ensureRecipeIngredients()
    ]);
    if (recipe.species_id) document.getElementById('rf-species').value = recipe.species_id;
    _populateOutputIngSelect();
    if (recipe.output_ingredient_id)
      document.getElementById('rf-output-ing').value = recipe.output_ingredient_id;

    var versions = await sbGet('recipe_versions',
      'recipe_id=eq.' + recipeId + '&select=id&order=version_number.desc&limit=1');
    if (versions.length) {
      var ings = await sbGet('recipe_ingredients',
        'recipe_version_id=eq.' + versions[0].id +
        '&select=ingredient_id,inclusion_rate&order=ingredient_id');
      ings.forEach(function(row) {
        addRecipeIngRow(row.ingredient_id, row.inclusion_rate);
      });
    }
    if (!rfIngRows.length) addRecipeIngRow();
  } catch (err) {
    document.getElementById('rf-status').textContent = 'Error loading recipe: ' + err.message;
    console.error('openEditRecipeForm error:', err);
  }
}

async function addRecipeIngRow(ingId, inclRate) {
  await _ensureRecipeIngredients();
  var rowId = 'rf-row-' + (++rfRowCounter);
  var opts = '<option value="">— select ingredient —</option>' +
    rsAllIngredients.map(function(i) {
      return '<option value="' + i.id + '"' + (String(i.id) === String(ingId) ? ' selected' : '') + '>' +
        i.name + ' (' + (i.category || 'other') + ')</option>';
    }).join('');
  var pctVal = inclRate != null ? Math.round(parseFloat(inclRate) * 10000) / 100 : '';

  var row = document.createElement('div');
  row.id = rowId;
  row.style.cssText = 'display:flex;gap:10px;align-items:center';
  row.innerHTML =
    '<select style="flex:2;min-width:0" class="rf-ing-sel" onchange="updateInclSum()">' + opts + '</select>' +
    '<div style="display:flex;align-items:center;gap:5px">' +
      '<input type="number" style="width:75px" min="0" max="100" step="0.1" ' +
        'value="' + pctVal + '" placeholder="%" class="rf-incl-inp" oninput="updateInclSum()">' +
      '<span style="font-size:12px;color:var(--muted)">%</span>' +
    '</div>' +
    '<button class="btn btn-sm btn-danger" onclick="removeRecipeIngRow(\'' + rowId + '\')">×</button>';
  document.getElementById('recipe-ing-rows').appendChild(row);
  rfIngRows.push(rowId);
  updateInclSum();
}

function removeRecipeIngRow(rowId) {
  var el = document.getElementById(rowId);
  if (el) el.remove();
  rfIngRows = rfIngRows.filter(function(id) { return id !== rowId; });
  updateInclSum();
}

function updateInclSum() {
  var total = 0;
  document.querySelectorAll('.rf-incl-inp').forEach(function(inp) {
    var v = parseFloat(inp.value); if (!isNaN(v)) total += v;
  });
  var el = document.getElementById('recipe-incl-sum');
  if (!el) return;
  var rounded = Math.round(total * 10) / 10;
  var ok = Math.abs(total - 100) < 0.6;
  el.textContent = 'Inclusion rates sum: ' + rounded + '%' + (ok ? ' ✓' : ' — must equal 100%');
  el.style.color = ok ? 'var(--green)' : 'var(--amber)';
}

function closeRecipeForm() {
  document.getElementById('recipe-form-section').style.display = 'none';
  rfEditRecipeId = null;
  rfIngRows = [];
}

async function submitConcentrateRecipe() {
  var name      = (document.getElementById('rf-name')       || {}).value || '';
  var speciesId = (document.getElementById('rf-species')    || {}).value || '';
  var outIngId  = (document.getElementById('rf-output-ing') || {}).value || '';
  var statusEl  = document.getElementById('rf-status');

  name = name.trim();
  if (!name)     { statusEl.textContent = 'Recipe name required.'; return; }
  if (!speciesId) { statusEl.textContent = 'Species required.'; return; }

  // Collect ingredient rows
  var selEls  = document.querySelectorAll('.rf-ing-sel');
  var inclEls = document.querySelectorAll('.rf-incl-inp');
  var ingData = [];
  var total   = 0;
  for (var i = 0; i < selEls.length; i++) {
    var ingId   = selEls[i].value;
    var inclPct = parseFloat(inclEls[i] ? inclEls[i].value : '');
    if (!ingId || isNaN(inclPct) || inclPct <= 0) continue;
    ingData.push({ ingredient_id: parseInt(ingId), inclusion_rate: inclPct / 100 });
    total += inclPct;
  }
  if (!ingData.length) { statusEl.textContent = 'Add at least one ingredient.'; return; }
  if (Math.abs(total - 100) > 1) {
    statusEl.textContent = 'Inclusion rates must sum to 100% (currently ' + Math.round(total * 10) / 10 + '%).';
    return;
  }

  statusEl.textContent = 'Saving…';
  try {
    var recipeId;
    if (rfEditRecipeId) {
      await sbPatch('recipes', rfEditRecipeId, {
        name: name,
        species_id: parseInt(speciesId),
        output_ingredient_id: outIngId ? parseInt(outIngId) : null
      });
      recipeId = rfEditRecipeId;
    } else {
      var newRecipe = await sbInsert('recipes', {
        name: name,
        species_id: parseInt(speciesId),
        output_ingredient_id: outIngId ? parseInt(outIngId) : null,
        active: true
      });
      recipeId = newRecipe[0].id;
    }

    var existingVers = await sbGet('recipe_versions',
      'recipe_id=eq.' + recipeId + '&select=version_number&order=version_number.desc&limit=1');
    var nextVer = existingVers.length ? existingVers[0].version_number + 1 : 1;

    var newVer = await sbInsert('recipe_versions', {
      recipe_id: recipeId,
      version_number: nextVer,
      effective_date: todayISO()
    });
    var verId = newVer[0].id;

    for (var j = 0; j < ingData.length; j++) {
      await sbInsert('recipe_ingredients', {
        recipe_version_id: verId,
        ingredient_id: ingData[j].ingredient_id,
        inclusion_rate: ingData[j].inclusion_rate
      });
    }

    statusEl.textContent = rfEditRecipeId ? 'New version saved ✓' : 'Recipe created ✓';
    setTimeout(function() { closeRecipeForm(); loadRecipeSetup(); }, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
}

async function deactivateRecipe(recipeId) {
  if (!confirm('Remove this recipe? It will be hidden from all dropdowns. This does not delete historical data.')) return;
  try {
    await sbPatch('recipes', recipeId, { active: false });
    loadRecipeSetup();
  } catch (err) { alert('Error: ' + err.message); }
}

