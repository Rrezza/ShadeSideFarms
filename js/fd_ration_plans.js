// fd_ration_plans.js v21
// Ration plans setup page with integrated modeller
// Replaces: fd_ration_plans.js v20 + Ration Setup tab (fd_feed.js rationsetup section)
// Depends on: shared.js
// ============================================================

var rpEditPlanId     = null;
var rpAllRecipes     = [];
var rpAllRoughage    = [];
var rpRoughagePrices = {};
var rpModelWeight    = 20;

// ============================================================
// PAGE LOAD
// ============================================================
async function loadRationPlansPage() {
  var el = document.getElementById('rp-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var results = await Promise.all([
      sbGet('ration_plans',
        'select=id,name,active,notes&order=name'),
      sbGet('recipes', 'active=eq.true&select=id,name&order=name'),
      sbGet('ingredients',
        'active=eq.true&select=id,name,category,dry_matter_pct,crude_protein_pct_dm,' +
        'metabolizable_energy_mj_kg&order=name'),
      sbGet('ingredient_acquisitions',
        'acquisition_type=eq.purchased&cost_per_kg=not.is.null' +
        '&select=ingredient_id,cost_per_kg,date&order=date.desc&limit=500')
    ]);
    var plans    = results[0];
    rpAllRecipes = results[1];
    var allIngs  = results[2];
    var prices   = results[3];
    rpAllRoughage    = allIngs.filter(function(i) { return i.category === 'roughage'; });
    rpRoughagePrices = {};
    prices.forEach(function(p) {
      if (!rpRoughagePrices[p.ingredient_id]) rpRoughagePrices[p.ingredient_id] = p;
    });
    var activePlans   = plans.filter(function(p) { return p.active; });
    var inactivePlans = plans.filter(function(p) { return !p.active; });
    var html =
      // Form section — inputs + modeller open here
      '<div class="section" id="rp-form-section">' +
        '<div class="section-hdr"><h2>New / edit ration plan</h2>' +
          '<button class="btn btn-primary btn-sm" onclick="rpOpenForm(null)">+ New plan</button>' +
        '</div>' +
        '<div id="rp-form-wrap"><div style="padding:12px 22px;font-size:13px;color:var(--muted)">Click + New plan or Edit on a plan below to begin.</div></div>' +
      '</div>' +
      // Active plans list
      '<div class="section">' +
        '<div class="section-hdr"><h2>Saved ration plans</h2></div>' +
        '<div id="rp-active-list"><div class="loading">Loading plans...</div></div>' +
      '</div>';
    if (inactivePlans.length) {
      html += '<div class="section"><div class="section-hdr"><h2>Inactive plans</h2></div>' +
        '<div id="rp-inactive-list"><div class="loading">Loading...</div></div></div>';
    }
    html += '<div id="abbrev-rationplans"></div>';
    el.innerHTML = html;
    renderAbbrevKey('abbrev-rationplans', ['DM', 'DMI', 'CP', 'ME', 'PKR']);
    // Render lists (async due to version fetch)
    rpRenderPlanList(activePlans, 'rp-active-list', false);
    if (inactivePlans.length) rpRenderPlanList(inactivePlans, 'rp-inactive-list', true);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

async function rpRenderPlanList(plans, containerId, inactive) {
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!plans.length) {
    container.innerHTML = '<div class="empty">No ' + (inactive ? 'inactive' : 'active') + ' ration plans.</div>';
    return;
  }
  var planIds  = plans.map(function(p) { return p.id; });
  var versions = await sbGet('ration_plan_versions',
    'ration_plan_id=in.(' + planIds.join(',') + ')' +
    '&select=id,ration_plan_id,version_number,effective_date,' +
    'dmi_pct_body_weight,concentrate_pct_dmi,hay_pct_dmi,green_fodder_pct_dmi,' +
    'hay_ingredient_id,green_fodder_ingredient_id,concentrate_recipe_id,' +
    'recipes(name),hay_ing:ingredients!hay_ingredient_id(name),' +
    'fodder_ing:ingredients!green_fodder_ingredient_id(name)' +
    '&order=version_number.desc');
  var latestVer = {};
  versions.forEach(function(v) { if (!latestVer[v.ration_plan_id]) latestVer[v.ration_plan_id] = v; });
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Name</th>' +
    '<th class="right">DMI%</th><th class="right">Conc.</th><th class="right">Hay</th><th class="right">Fodder</th>' +
    '<th>Hay source</th><th>Fodder source</th><th>Concentrate recipe</th><th>Ver.</th><th></th>' +
    '</tr></thead><tbody>';
  plans.forEach(function(p) {
    var v = latestVer[p.id];
    html += '<tr>' +
      '<td style="font-weight:500">' + p.name + '</td>' +
      '<td class="mono right">' + (v ? r1(parseFloat(v.dmi_pct_body_weight)) + '%' : '\u2014') + '</td>' +
      '<td class="mono right">' + (v ? r1(parseFloat(v.concentrate_pct_dmi)) + '%' : '\u2014') + '</td>' +
      '<td class="mono right">' + (v ? r1(parseFloat(v.hay_pct_dmi)) + '%' : '\u2014') + '</td>' +
      '<td class="mono right">' + (v ? r1(parseFloat(v.green_fodder_pct_dmi)) + '%' : '\u2014') + '</td>' +
      '<td class="muted-cell">' + (v && v.hay_ing ? v.hay_ing.name : '\u2014') + '</td>' +
      '<td class="muted-cell">' + (v && v.fodder_ing ? v.fodder_ing.name : '\u2014') + '</td>' +
      '<td class="muted-cell">' + (v && v.recipes ? v.recipes.name : '\u2014') + '</td>' +
      '<td class="mono">' + (v ? 'v' + v.version_number : '\u2014') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="rpOpenForm(' + p.id + ')">Edit</button> ' +
        (p.active
          ? '<button class="btn btn-sm" style="color:var(--muted)" onclick="rpSetActive(' + p.id + ',false)">Deactivate</button>'
          : '<button class="btn btn-sm" onclick="rpSetActive(' + p.id + ',true)">Reactivate</button>') +
      '</td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}


// ============================================================
// FORM
// ============================================================
async function rpOpenForm(planId) {
  rpEditPlanId = planId;
  var wrap = document.getElementById('rp-form-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading" style="padding:16px 22px">Loading...</div>';
  var plan = null; var version = null;
  if (planId) {
    var rows = await sbGet('ration_plans', 'id=eq.' + planId + '&select=id,name,notes&limit=1');
    plan = rows.length ? rows[0] : null;
    var vers = await sbGet('ration_plan_versions',
      'ration_plan_id=eq.' + planId +
      '&select=id,version_number,dmi_pct_body_weight,concentrate_pct_dmi,hay_pct_dmi,' +
      'green_fodder_pct_dmi,concentrate_recipe_id,hay_ingredient_id,green_fodder_ingredient_id,notes' +
      '&order=version_number.desc&limit=1');
    version = vers.length ? vers[0] : null;
  }
  var recipeOpts = '<option value="">\u2014 none \u2014</option>' +
    rpAllRecipes.map(function(r) {
      return '<option value="' + r.id + '"' + (version && version.concentrate_recipe_id === r.id ? ' selected' : '') + '>' + r.name + '</option>';
    }).join('');
  var mkRoughageOpts = function(selId) {
    return '<option value="">\u2014 select \u2014</option>' +
      rpAllRoughage.map(function(i) {
        return '<option value="' + i.id + '"' + (selId && String(i.id) === String(selId) ? ' selected' : '') + '>' + i.name + '</option>';
      }).join('');
  };
  wrap.innerHTML =
    '<div style="padding:16px 22px;border-bottom:1px solid var(--border)">' +
    '<h3 style="margin:0 0 14px;font-size:15px">' + (planId ? 'Edit ration plan \u2014 creates new version' : 'New ration plan') + '</h3>' +
    
      // LEFT — inputs
      '<div>' +
        '<div class="hf-grid">' +
          '<div class="hf-field" style="grid-column:span 2"><label>Plan name</label>' +
            '<input type="text" id="rp-name" value="' + (plan ? plan.name : '') + '" placeholder="e.g. Beetal Early Cycle"></div>' +
          '<div class="hf-field"><label>Concentrate recipe</label>' +
            '<select id="rp-recipe" onchange="rpRunModeller()">' + recipeOpts + '</select></div>' +
          '<div class="hf-field"><label>Hay source</label>' +
            '<select id="rp-hay-ing" onchange="rpRunModeller()">' + mkRoughageOpts(version && version.hay_ingredient_id) + '</select></div>' +
          '<div class="hf-field"><label>Green fodder source</label>' +
            '<select id="rp-fod-ing" onchange="rpRunModeller()">' + mkRoughageOpts(version && version.green_fodder_ingredient_id) + '</select></div>' +
          '<div class="hf-field"><label>Total DMI (% of live weight)</label>' +
            '<input type="number" id="rp-dmi" min="0.5" max="10" step="0.1" ' +
            'value="' + (version ? version.dmi_pct_body_weight : '') + '" placeholder="e.g. 3.5" oninput="rpUpdateSplitSum();rpRunModeller()"></div>' +
          '<div class="hf-field">' +
            '<label>Split % <span id="rp-split-sum" style="font-size:11px;font-weight:400;margin-left:4px"></span></label>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">' +
              '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Concentrate</div>' +
                '<input type="number" id="rp-conc-pct" min="0" max="100" step="1" value="' + (version ? version.concentrate_pct_dmi : '') + '" placeholder="40" oninput="rpUpdateSplitSum();rpRunModeller()"></div>' +
              '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Hay</div>' +
                '<input type="number" id="rp-hay-pct" min="0" max="100" step="1" value="' + (version ? version.hay_pct_dmi : '') + '" placeholder="30" oninput="rpUpdateSplitSum();rpRunModeller()"></div>' +
              '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Green fodder</div>' +
                '<input type="number" id="rp-fod-pct" min="0" max="100" step="1" value="' + (version ? version.green_fodder_pct_dmi : '') + '" placeholder="30" oninput="rpUpdateSplitSum();rpRunModeller()"></div>' +
            '</div>' +
          '</div>' +
          (planId
            ? '<div class="hf-field" style="grid-column:span 2"><label>Reason for change</label>' +
                '<input type="text" id="rp-reason" placeholder="e.g. Seasonal fodder change to sesbania"></div>'
            : '') +
          '<div class="hf-field" style="grid-column:span 2"><label>Notes (optional)</label>' +
            '<input type="text" id="rp-notes" value="' + (version ? (version.notes || '') : '') + '"></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:12px">' +
          '<button class="btn btn-primary btn-sm" onclick="rpSubmitForm()">Save</button>' +
          '<button class="btn btn-sm" onclick="rpCloseForm()">Cancel</button>' +
          '<span id="rp-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
        '</div>' +
      '</div>' +

      // RIGHT — modeller
      '<div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<span style="font-size:13px;font-weight:500">Modeller</span>' +
          '<label style="font-size:12px;color:var(--muted)">Test weight</label>' +
          '<input type="number" id="rp-model-wt" value="' + rpModelWeight + '" min="1" max="200" step="1" style="width:70px" oninput="rpRunModeller()">' +
          '<span style="font-size:12px;color:var(--muted)">kg</span>' +
        '</div>' +
        '<div id="rp-modeller-panel"><div style="font-size:12px;color:var(--faint)">Fill in the form to see projections.</div></div>' +
      '</div>' +

    '</div>';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  rpUpdateSplitSum();
  rpRunModeller();
}

function rpCloseForm() {
  var wrap = document.getElementById('rp-form-wrap');
  if (wrap) { wrap.innerHTML = '<div style="padding:12px 22px;font-size:13px;color:var(--muted)">Click + New plan or Edit on a plan below to begin.</div>'; }
  rpEditPlanId = null;
}

function rpUpdateSplitSum() {
  var el = document.getElementById('rp-split-sum');
  if (!el) return;
  var c   = parseFloat(document.getElementById('rp-conc-pct') ? document.getElementById('rp-conc-pct').value : '') || 0;
  var h   = parseFloat(document.getElementById('rp-hay-pct')  ? document.getElementById('rp-hay-pct').value  : '') || 0;
  var f   = parseFloat(document.getElementById('rp-fod-pct')  ? document.getElementById('rp-fod-pct').value  : '') || 0;
  var sum = c + h + f;
  var ok  = Math.abs(sum - 100) < 0.1;
  el.textContent = '(sum: ' + r1(sum) + '%)';
  el.style.color = ok ? 'var(--green)' : '#C8A800';
}


// ============================================================
// LIVE MODELLER
// ============================================================
async function rpRunModeller() {
  var panel = document.getElementById('rp-modeller-panel');
  if (!panel) return;
  var dmi     = parseFloat(document.getElementById('rp-dmi')      ? document.getElementById('rp-dmi').value      : '') || 0;
  var concPct = parseFloat(document.getElementById('rp-conc-pct') ? document.getElementById('rp-conc-pct').value : '') || 0;
  var hayPct  = parseFloat(document.getElementById('rp-hay-pct')  ? document.getElementById('rp-hay-pct').value  : '') || 0;
  var fodPct  = parseFloat(document.getElementById('rp-fod-pct')  ? document.getElementById('rp-fod-pct').value  : '') || 0;
  var wtEl    = document.getElementById('rp-model-wt');
  var testWt  = wtEl ? (parseFloat(wtEl.value) || rpModelWeight) : rpModelWeight;
  rpModelWeight = testWt;
  var recipeId = document.getElementById('rp-recipe')  ? document.getElementById('rp-recipe').value  : '';
  var hayIngId = document.getElementById('rp-hay-ing') ? document.getElementById('rp-hay-ing').value : '';
  var fodIngId = document.getElementById('rp-fod-ing') ? document.getElementById('rp-fod-ing').value : '';
  if (!dmi || Math.abs(concPct + hayPct + fodPct - 100) >= 0.1) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--faint)">Complete DMI% and splits (must sum to 100%) to see projections.</div>';
    return;
  }

  // Concentrate nutritional data
  var concData = null; var concMissing = [];
  if (recipeId) {
    try {
      var vers = await sbGet('recipe_versions',
        'recipe_id=eq.' + recipeId + '&select=id&order=version_number.desc&limit=1');
      if (vers.length) {
        var ri = await sbGet('recipe_ingredients',
          'recipe_version_id=eq.' + vers[0].id +
          '&select=inclusion_rate,ingredients(id,name,dry_matter_pct,crude_protein_pct_dm,metabolizable_energy_mj_kg)');
        var ingIds = ri.map(function(r) { return r.ingredients && r.ingredients.id; }).filter(Boolean);
        var priceRows = ingIds.length ? await sbGet('ingredient_acquisitions',
          'ingredient_id=in.(' + ingIds.join(',') + ')&acquisition_type=eq.purchased' +
          '&cost_per_kg=not.is.null&select=ingredient_id,cost_per_kg&order=date.desc&limit=500') : [];
        var lp = {}; priceRows.forEach(function(p) { if (!lp[p.ingredient_id]) lp[p.ingredient_id] = p; });
        var bDm = 0, bCp = 0, bMe = 0, bCost = 0;
        var okDm = true, okCp = true, okMe = true, okCost = true;
        ri.forEach(function(row) {
          var ing = row.ingredients; var inc = parseFloat(row.inclusion_rate);
          if (!ing) return;
          if (ing.dry_matter_pct != null)          bDm   += inc * parseFloat(ing.dry_matter_pct) / 100; else { okDm   = false; concMissing.push(ing.name + ' (DM%)'); }
          if (ing.crude_protein_pct_dm != null)    bCp   += inc * parseFloat(ing.crude_protein_pct_dm);  else { okCp   = false; concMissing.push(ing.name + ' (CP%)'); }
          if (ing.metabolizable_energy_mj_kg != null) bMe += inc * parseFloat(ing.metabolizable_energy_mj_kg); else { okMe = false; concMissing.push(ing.name + ' (ME)'); }
          var pr = lp[ing.id];
          if (pr) bCost += inc * parseFloat(pr.cost_per_kg); else { okCost = false; concMissing.push(ing.name + ' (price)'); }
        });
        concMissing = concMissing.filter(function(v, i, a) { return a.indexOf(v) === i; });
        concData = {
          dmFrac:       okDm   ? bDm  : null,
          cpPct:        okCp   ? bCp  : null,
          meMj:         okMe   ? bMe  : null,
          costPerKgAf:  (okCost && okDm && bDm > 0) ? bCost / bDm : null
        };
      }
    } catch(e) { console.warn('Modeller error:', e); }
  }

  var hayIng   = hayIngId ? rpAllRoughage.find(function(i) { return String(i.id) === String(hayIngId); }) : null;
  var fodIng   = fodIngId ? rpAllRoughage.find(function(i) { return String(i.id) === String(fodIngId); }) : null;
  var hayPrice = hayIngId ? rpRoughagePrices[hayIngId] : null;
  var fodPrice = fodIngId ? rpRoughagePrices[fodIngId] : null;

  // Quantities
  var totalDmi   = testWt * dmi / 100;
  var concDmKg   = totalDmi * concPct / 100;
  var hayDmKg    = totalDmi * hayPct  / 100;
  var fodDmKg    = totalDmi * fodPct  / 100;
  var concDmFrac = (concData && concData.dmFrac) ? concData.dmFrac : 0.88;
  var hayDmFrac  = (hayIng && hayIng.dry_matter_pct)  ? parseFloat(hayIng.dry_matter_pct)  / 100 : null;
  var fodDmFrac  = (fodIng && fodIng.dry_matter_pct)  ? parseFloat(fodIng.dry_matter_pct)  / 100 : null;
  var concAf     = concDmKg / concDmFrac;
  var hayAf      = hayDmFrac  ? hayDmKg  / hayDmFrac  : null;
  var fodAf      = fodDmFrac  ? fodDmKg  / fodDmFrac  : null;

  // Blended nutrition (DMI-weighted)
  var cpParts = [], meParts = [];
  if (concData && concData.cpPct != null) cpParts.push({ w: concPct / 100, v: concData.cpPct });
  if (hayIng && hayIng.crude_protein_pct_dm != null)       cpParts.push({ w: hayPct / 100, v: parseFloat(hayIng.crude_protein_pct_dm) });
  if (fodIng && fodIng.crude_protein_pct_dm != null)       cpParts.push({ w: fodPct / 100, v: parseFloat(fodIng.crude_protein_pct_dm) });
  if (concData && concData.meMj != null)                   meParts.push({ w: concPct / 100, v: concData.meMj });
  if (hayIng && hayIng.metabolizable_energy_mj_kg != null) meParts.push({ w: hayPct / 100, v: parseFloat(hayIng.metabolizable_energy_mj_kg) });
  if (fodIng && fodIng.metabolizable_energy_mj_kg != null) meParts.push({ w: fodPct / 100, v: parseFloat(fodIng.metabolizable_energy_mj_kg) });
  var blendedCp = cpParts.length ? cpParts.reduce(function(s, p) { return s + p.w * p.v; }, 0) : null;
  var blendedMe = meParts.length ? meParts.reduce(function(s, p) { return s + p.w * p.v; }, 0) : null;

  // Cost
  var costParts = [];
  if (concData && concData.costPerKgAf != null) costParts.push(concAf * concData.costPerKgAf);
  if (hayAf != null && hayPrice)  costParts.push(hayAf * parseFloat(hayPrice.cost_per_kg));
  if (fodAf != null && fodPrice)  costParts.push(fodAf * parseFloat(fodPrice.cost_per_kg));
  var totalCost = costParts.length === 3 ? costParts.reduce(function(s, v) { return s + v; }, 0) : null;

  // Missing data warnings
  var warnings = [];
  if (!recipeId) warnings.push('No concentrate recipe selected — nutritional analysis unavailable.');
  if (concMissing.length) warnings.push('Missing data in concentrate ingredients: ' + concMissing.join(', ') + '. Update these in the Ingredients setup page.');
  if (!hayIngId) warnings.push('No hay source selected — hay nutritional profile unavailable.');
  else {
    var hm = [];
    if (!hayIng || hayIng.dry_matter_pct == null)             hm.push('DM%');
    if (!hayIng || hayIng.crude_protein_pct_dm == null)       hm.push('CP%');
    if (!hayIng || hayIng.metabolizable_energy_mj_kg == null) hm.push('ME');
    if (!hayPrice)                                             hm.push('price');
    if (hm.length) warnings.push((hayIng ? hayIng.name : 'Hay') + ' is missing: ' + hm.join(', ') + '. Update this ingredient in the Ingredients setup page.');
  }
  if (!fodIngId) warnings.push('No green fodder source selected — fodder nutritional profile unavailable.');
  else {
    var fm = [];
    if (!fodIng || fodIng.dry_matter_pct == null)             fm.push('DM%');
    if (!fodIng || fodIng.crude_protein_pct_dm == null)       fm.push('CP%');
    if (!fodIng || fodIng.metabolizable_energy_mj_kg == null) fm.push('ME');
    if (!fodPrice)                                             fm.push('price');
    if (fm.length) warnings.push((fodIng ? fodIng.name : 'Green fodder') + ' is missing: ' + fm.join(', ') + '. Update this ingredient in the Ingredients setup page.');
  }

  var warnHtml = warnings.length
    ? '<div style="background:var(--amber-lt);border:1px solid var(--amber-bdr);border-radius:8px;' +
        'padding:8px 12px;margin-bottom:12px;font-size:11px">' +
        '<strong style="color:#C8A800">\u26a0 Incomplete data</strong>' +
        '<ul style="margin:4px 0 0;padding-left:16px">' +
        warnings.map(function(w) { return '<li style="margin-bottom:2px">' + w + '</li>'; }).join('') +
        '</ul></div>'
    : '';

  var fv = function(v, unit) {
    if (v == null) return '<span style="color:var(--faint)">\u2014</span>';
    return r1(v) + (unit ? '\u202f' + unit : '');
  };

  var cpAdeq = '', meAdeq = '';
  if (blendedCp != null) {
    if (blendedCp >= 14)      cpAdeq = ' <span style="color:var(--green);font-size:11px">\u2713</span>';
    else if (blendedCp >= 12) cpAdeq = ' <span style="color:#C8A800;font-size:11px">\u26a0</span>';
    else                       cpAdeq = ' <span style="color:var(--red);font-size:11px">\u2717</span>';
  }
  if (blendedMe != null) {
    if (blendedMe >= 9.0)      meAdeq = ' <span style="color:var(--green);font-size:11px">\u2713</span>';
    else if (blendedMe >= 8.5) meAdeq = ' <span style="color:#C8A800;font-size:11px">\u26a0</span>';
    else                        meAdeq = ' <span style="color:var(--red);font-size:11px">\u2717</span>';
  }

  panel.innerHTML = warnHtml +
    '<div style="font-size:12px;font-weight:500;margin-bottom:6px">Daily targets \u2014 ' + testWt + '\u202fkg animal</div>' +
    '<div style="overflow-x:auto"><table style="font-size:12px"><thead><tr>' +
      '<th>Feed type</th><th class="right">DM (kg)</th><th class="right">As-fed (kg)</th>' +
      '<th class="right">CP%</th><th class="right">ME (MJ/kg)</th><th class="right">Cost (PKR)</th>' +
    '</tr></thead><tbody>' +
    '<tr><td>Concentrate</td>' +
      '<td class="mono right">' + fv(concDmKg) + '</td>' +
      '<td class="mono right">' + fv(concAf)   + '</td>' +
      '<td class="mono right">' + fv(concData ? concData.cpPct : null) + '</td>' +
      '<td class="mono right">' + fv(concData ? concData.meMj  : null) + '</td>' +
      '<td class="mono right">' + fv(concData && concData.costPerKgAf ? concAf * concData.costPerKgAf : null) + '</td>' +
    '</tr>' +
    '<tr><td>' + (hayIng ? hayIng.name : 'Hay') + '</td>' +
      '<td class="mono right">' + fv(hayDmKg) + '</td>' +
      '<td class="mono right">' + fv(hayAf)   + '</td>' +
      '<td class="mono right">' + fv(hayIng ? hayIng.crude_protein_pct_dm : null) + '</td>' +
      '<td class="mono right">' + fv(hayIng ? hayIng.metabolizable_energy_mj_kg : null) + '</td>' +
      '<td class="mono right">' + fv(hayAf && hayPrice ? hayAf * parseFloat(hayPrice.cost_per_kg) : null) + '</td>' +
    '</tr>' +
    '<tr><td>' + (fodIng ? fodIng.name : 'Green fodder') + '</td>' +
      '<td class="mono right">' + fv(fodDmKg) + '</td>' +
      '<td class="mono right">' + fv(fodAf)   + '</td>' +
      '<td class="mono right">' + fv(fodIng ? fodIng.crude_protein_pct_dm : null) + '</td>' +
      '<td class="mono right">' + fv(fodIng ? fodIng.metabolizable_energy_mj_kg : null) + '</td>' +
      '<td class="mono right">' + fv(fodAf && fodPrice ? fodAf * parseFloat(fodPrice.cost_per_kg) : null) + '</td>' +
    '</tr>' +
    '<tr style="font-weight:600;background:var(--bg)"><td>Total</td>' +
      '<td class="mono right">' + fv(totalDmi) + '</td>' +
      '<td class="mono right"><span style="color:var(--faint)">\u2014</span></td>' +
      '<td class="mono right">' + fv(blendedCp) + cpAdeq + '</td>' +
      '<td class="mono right">' + fv(blendedMe) + meAdeq + '</td>' +
      '<td class="mono right">' + fv(totalCost) + '</td>' +
    '</tr></tbody></table></div>' +
    (blendedCp != null || blendedMe != null
      ? '<div style="font-size:11px;color:var(--faint);margin-top:6px">' +
          'CP: \u226514% adequate \u00b7 12\u201314% marginal \u00b7 &lt;12% deficient. ' +
          'ME: \u22659.0 adequate \u00b7 8.5\u20139.0 borderline \u00b7 &lt;8.5 low.' +
        '</div>' : '') +
    '<div style="font-size:10px;color:var(--faint);margin-top:8px;border-top:1px solid var(--border);padding-top:6px">' +
      'Conc. DM: ' + (concData && concData.dmFrac ? r1(concData.dmFrac * 100) + '% (blended)' : '88% default') +
      (hayIng && hayIng.dry_matter_pct ? ' \u00b7 ' + hayIng.name + ' DM: ' + hayIng.dry_matter_pct + '%' : '') +
      (fodIng && fodIng.dry_matter_pct ? ' \u00b7 ' + fodIng.name + ' DM: ' + fodIng.dry_matter_pct + '%' : '') +
    '</div>';
}


// ============================================================
// FORM SUBMIT
// ============================================================
async function rpSubmitForm() {
  var st = document.getElementById('rp-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var name      = document.getElementById('rp-name').value.trim();
    var dmi       = parseFloat(document.getElementById('rp-dmi').value);
    var concPct   = parseFloat(document.getElementById('rp-conc-pct').value);
    var hayPct    = parseFloat(document.getElementById('rp-hay-pct').value);
    var fodPct    = parseFloat(document.getElementById('rp-fod-pct').value);
    var recipeId  = document.getElementById('rp-recipe').value;
    var hayIngId  = document.getElementById('rp-hay-ing').value;
    var fodIngId  = document.getElementById('rp-fod-ing').value;
    var reasonEl  = document.getElementById('rp-reason');
    var reason    = reasonEl ? reasonEl.value.trim() : '';
    var notes     = document.getElementById('rp-notes').value.trim();
    if (!name)      throw new Error('Name required.');
    if (isNaN(dmi) || dmi <= 0) throw new Error('DMI% required.');
    if (isNaN(concPct) || isNaN(hayPct) || isNaN(fodPct)) throw new Error('All three split percentages required.');
    if (Math.abs(concPct + hayPct + fodPct - 100) >= 0.1) throw new Error('Split percentages must sum to 100%.');
    var planId = rpEditPlanId;
    if (!planId) {
      var planRow = await sbInsert('ration_plans', [{ name: name, active: true, notes: notes || null }]);
      planId = planRow[0].id;
    } else {
      await sbPatch('ration_plans', planId, { name: name, notes: notes || null });
    }
    var existingVers = await sbGet('ration_plan_versions',
      'ration_plan_id=eq.' + planId + '&select=version_number&order=version_number.desc&limit=1');
    var nextVer = existingVers.length ? existingVers[0].version_number + 1 : 1;
    var vd = {
      ration_plan_id:       planId,
      version_number:       nextVer,
      effective_date:       todayISO(),
      dmi_pct_body_weight:  dmi,
      concentrate_pct_dmi:  concPct,
      hay_pct_dmi:          hayPct,
      green_fodder_pct_dmi: fodPct,
      reason_for_change:    reason || null,
      notes:                notes  || null
    };
    if (recipeId) vd.concentrate_recipe_id     = parseInt(recipeId);
    if (hayIngId) vd.hay_ingredient_id          = parseInt(hayIngId);
    if (fodIngId) vd.green_fodder_ingredient_id = parseInt(fodIngId);
    await sbInsert('ration_plan_versions', [vd]);
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    setTimeout(function() { rpCloseForm(); loadRationPlansPage(); }, 600);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

async function rpSetActive(planId, active) {
  if (!confirm(active ? 'Reactivate this plan?' : 'Deactivate this plan?')) return;
  try {
    await sbPatch('ration_plans', planId, { active: active });
    loadRationPlansPage();
  } catch(err) { alert('Error: ' + err.message); }
}
