// ============================================================
// fd_feed.js v17 — Concentrate info, feed modeller, cost calculator, ration save/load, cost projections
// ============================================================

// ============================================================
// CONCENTRATE INFORMATION
// ============================================================

async function loadRecipes() {
  var r = await sbGet('recipes', 'active=eq.true&select=id,name,species(common_name)&order=name');
  var sel = document.getElementById('recipe-select');
  if (!sel) return;
  sel.innerHTML = r.map(function(x) {
    return '<option value="' + x.id + '">' + x.name +
           ' (' + (x.species ? x.species.common_name : '') + ')</option>';
  }).join('');
}

function openModal(ingId, ingName) {
  modalIngId = ingId;
  document.getElementById('modal-desc').textContent = 'No purchase price recorded for "' + ingName + '".';
  document.getElementById('modal-date').value = todayISO();
  document.getElementById('modal-price').value = '';
  document.getElementById('price-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('price-modal').style.display = 'none';
  modalIngId = null;
}

async function saveModalPrice() {
  var price = parseFloat(document.getElementById('modal-price').value);
  var date  = document.getElementById('modal-date').value;
  if (!price || !date) { alert('Price and date are both required.'); return; }
  try {
    await sbInsert('ingredient_acquisitions', {
      ingredient_id: modalIngId,
      acquisition_type: 'purchased',
      date: date,
      quantity_kg: 1,
      total_cost_pkr: price,
      recorded_by: 4
    });
    closeModal();
    loadFeedCost();
  } catch (err) { alert('Save failed: ' + err.message); }
}

async function loadFeedCost() {
  var recipeSel = document.getElementById('recipe-select');
  if (!recipeSel) return;
  if (!recipeSel.value) {
    if (recipeSel.options.length === 0) { try { await loadRecipes(); } catch (e) { /* ignore */ } }
    if (!recipeSel.value && recipeSel.options.length > 0) recipeSel.value = recipeSel.options[0].value;
    if (!recipeSel.value) return;
  }
  var recipeId = recipeSel.value;
  document.getElementById('feed-metrics').innerHTML = '<div class="loading">Loading…</div>';
  document.getElementById('breakdown-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    var versions = await sbGet('recipe_versions',
      'recipe_id=eq.' + recipeId +
      '&select=id,version_number,effective_date&order=version_number.desc&limit=1');
    if (!versions.length) {
      document.getElementById('feed-metrics').innerHTML = '<div class="loading">No recipe versions found.</div>';
      return;
    }
    var ver = versions[0];
    document.getElementById('recipe-version-label').textContent =
      'Version ' + ver.version_number + ' — effective ' + fmtDate(ver.effective_date);
    var ri = await sbGet('recipe_ingredients',
      'recipe_version_id=eq.' + ver.id +
      '&select=inclusion_rate,ingredients(id,name,category,source_type,is_substitutable,' +
      'crude_protein_pct_dm,metabolizable_energy_mj_kg,crude_fat_pct_dm,ndf_pct_dm,' +
      'calcium_pct_dm,phosphorus_pct_dm)');
    currentRecipeIngs = ri.map(function(row) { return row.ingredients; }).filter(Boolean);
    var ingIds = ri.map(function(row) { return row.ingredients && row.ingredients.id; }).filter(Boolean);
    if (!ingIds.length) {
      document.getElementById('feed-metrics').innerHTML = '<div class="loading">No ingredients in this recipe version.</div>';
      return;
    }
    var idList = ingIds.join(',');
    var allLatest = await sbGet('ingredient_acquisitions',
      'ingredient_id=in.(' + idList + ')&acquisition_type=eq.purchased&cost_per_kg=not.is.null' +
      '&select=ingredient_id,cost_per_kg,date&order=date.desc&limit=500');
    var lp = {};
    allLatest.forEach(function(row) { if (!lp[row.ingredient_id]) lp[row.ingredient_id] = row; });

    var since = new Date(); since.setDate(since.getDate() - 90);
    var sinceStr = since.toISOString().slice(0, 10);
    var acq90 = await sbGet('ingredient_acquisitions',
      'ingredient_id=in.(' + idList + ')&acquisition_type=eq.purchased&cost_per_kg=not.is.null' +
      '&date=gte.' + sinceStr + '&select=ingredient_id,cost_per_kg');
    var tots = {}, cnts = {};
    acq90.forEach(function(row) {
      tots[row.ingredient_id] = (tots[row.ingredient_id] || 0) + parseFloat(row.cost_per_kg);
      cnts[row.ingredient_id] = (cnts[row.ingredient_id] || 0) + 1;
    });
    var avg90 = {};
    Object.keys(tots).forEach(function(id) { avg90[id] = tots[id] / cnts[id]; });

    var cpk = 0, a90 = 0, latestDate = null, miss = 0;
    ri.forEach(function(row) {
      var ing = row.ingredients;
      if (!ing || ing.source_type === 'vet_supplied') return;
      var p = lp[ing.id];
      if (p) {
        cpk += parseFloat(p.cost_per_kg) * parseFloat(row.inclusion_rate);
        if (!latestDate || p.date > latestDate) latestDate = p.date;
      } else miss++;
      var a = avg90[ing.id];
      if (a) a90 += a * parseFloat(row.inclusion_rate);
      else if (p) a90 += parseFloat(p.cost_per_kg) * parseFloat(row.inclusion_rate);
    });
    currentConcentrateCPK = cpk;

    var cpe = document.getElementById('fc-conc-price');
    if (cpe && cpk > 0) {
      cpe.value = Math.round(cpk * 100) / 100;
      document.getElementById('fc-conc-price-hint').textContent =
        'Auto-filled from ' + (latestDate ? fmtDate(latestDate) : 'current') + ' recipe prices';
    }

    document.getElementById('feed-metrics').innerHTML =
      '<div class="metric-card highlight"><div class="m-label">Current cost per kilogram</div>' +
        '<div class="m-value">' + pkr(cpk) + '</div>' +
        '<div class="m-sub">' + (miss > 0
          ? '⚠ ' + miss + ' ingredient' + (miss > 1 ? 's' : '') + ' missing prices'
          : 'Based on most recent purchase prices') + '</div></div>' +
      '<div class="metric-card"><div class="m-label">Full batch (102 kg)</div>' +
        '<div class="m-value">' + pkr(cpk * 102) + '</div>' +
        '<div class="m-sub">At current prices</div></div>' +
      '<div class="metric-card"><div class="m-label">90-day average per kilogram</div>' +
        '<div class="m-value">' + pkr(a90) + '</div>' +
        '<div class="m-sub">' + (a90 > cpk ? '▼ cheaper than average'
          : a90 < cpk ? '▲ pricier than average' : 'at average') + '</div></div>';
    document.getElementById('feed-updated').textContent =
      latestDate ? 'Prices current as of ' + fmtDate(latestDate) : '';

    var tbody = '';
    ri.forEach(function(row) {
      var ing = row.ingredients; if (!ing) return;
      var ip = parseFloat(row.inclusion_rate) * 100;
      var p  = lp[ing.id];
      var isVet = ing.source_type === 'vet_supplied';
      var pc, cc;
      if (isVet) {
        pc = '<span class="muted-cell">vet supplied</span>';
        cc = '<span class="muted-cell">—</span>';
      } else if (p) {
        pc = pkr(p.cost_per_kg);
        cc = pkr(parseFloat(p.cost_per_kg) * parseFloat(row.inclusion_rate));
      } else {
        pc = '<span class="warn-cell" onclick="openModal(' + ing.id + ',\'' +
             ing.name.replace(/'/g, "\\'") + '\')">⚠ No price — click to enter</span>';
        cc = '<span class="muted-cell">—</span>';
      }
      tbody += '<tr><td>' + ing.name + '</td>' +
               '<td><div style="display:flex;align-items:center;gap:8px">' +
               '<div class="incl-bar-bg"><div class="incl-bar-fill" style="width:' +
               Math.min(Math.round(ip / 20 * 100), 100) + '%"></div></div>' +
               '<span class="mono">' + pct(ip) + '</span></div></td>' +
               '<td class="mono right">' + pc + '</td>' +
               '<td class="mono right">' + cc + '</td>' +
               '<td class="muted-cell">' + (p ? fmtDate(p.date) : '—') + '</td>' +
               '<td>' + (ing.is_substitutable
                 ? '<span style="font-size:11px;color:var(--lime)">substitutable</span>'
                 : '<span style="font-size:11px;color:var(--faint)">fixed</span>') + '</td></tr>';
    });
    document.getElementById('breakdown-table').innerHTML =
      '<table><thead><tr><th>Ingredient</th><th>Inclusion rate</th>' +
      '<th class="right">Price per kilogram</th><th class="right">Cost contribution</th>' +
      '<th>Last priced</th><th>Role</th></tr></thead><tbody>' + tbody + '</tbody></table>';

    renderConcNutrition(ri, lp);
    renderAbbrevKey('abbrev-feed', ['CP', 'ME', 'DM', 'NDF', 'Ca', 'P', 'PKR']);
  } catch (err) {
    document.getElementById('feed-metrics').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderConcNutrition(ri, latestPrices) {
  var nutrSection = document.getElementById('conc-nutr-section');
  var nutrBody    = document.getElementById('conc-nutr-body');
  var nutrMeta    = document.getElementById('conc-nutr-meta');
  var fields = [
    { key:'crude_protein_pct_dm',       label:'Crude protein',          unit:'% DM',     ref:14,  refLabel:'min 14% for lean gain' },
    { key:'metabolizable_energy_mj_kg', label:'Metabolizable energy',   unit:'MJ/kg DM', ref:9.0, refLabel:'min 9.0 MJ adequate' },
    { key:'crude_fat_pct_dm',           label:'Crude fat',              unit:'% DM',     ref:null,refLabel:'' },
    { key:'ndf_pct_dm',                 label:'Neutral detergent fiber',unit:'% DM',     ref:null,refLabel:'' },
    { key:'calcium_pct_dm',             label:'Calcium',                unit:'% DM',     ref:0.4, refLabel:'min 0.4%' },
    { key:'phosphorus_pct_dm',          label:'Phosphorus',             unit:'% DM',     ref:0.3, refLabel:'min 0.3%' }
  ];
  var hasData = false;
  ri.forEach(function(row) {
    var ing = row.ingredients; if (!ing) return;
    fields.forEach(function(f) { if (ing[f.key] != null) hasData = true; });
  });
  nutrSection.style.display = 'block';
  if (!hasData) {
    nutrMeta.textContent = 'No nutritional data entered yet';
    nutrBody.innerHTML = '<div style="padding:20px 22px;font-size:13px;color:var(--faint)">' +
      'No nutritional values entered for the ingredients in this recipe. ' +
      'Go to <strong>Ingredients</strong> to add crude protein, metabolizable energy, and other values.</div>';
    return;
  }
  var blended = {}, coverage = {};
  fields.forEach(function(f) { blended[f.key] = 0; coverage[f.key] = 0; });
  var totalIncl = 0;
  ri.forEach(function(row) {
    var ing = row.ingredients;
    if (!ing || ing.source_type === 'vet_supplied') return;
    var incl = parseFloat(row.inclusion_rate);
    totalIncl += incl;
    fields.forEach(function(f) {
      if (ing[f.key] != null) { blended[f.key] += ing[f.key] * incl; coverage[f.key] += incl; }
    });
  });
  fields.forEach(function(f) {
    if (coverage[f.key] > 0) blended[f.key] = blended[f.key] / coverage[f.key];
    else blended[f.key] = null;
  });

  // Push blended values to ration setup concentrate card
  var concCPEl = document.getElementById('fc-conc-cp');
  var concMEEl = document.getElementById('fc-conc-me');
  var concHintEl = document.getElementById('fc-conc-price-hint');
  if (concCPEl && blended.crude_protein_pct_dm != null) concCPEl.value = Math.round(blended.crude_protein_pct_dm * 10) / 10;
  if (concMEEl && blended.metabolizable_energy_mj_kg != null) concMEEl.value = Math.round(blended.metabolizable_energy_mj_kg * 10) / 10;
  if (concHintEl && (blended.crude_protein_pct_dm != null || blended.metabolizable_energy_mj_kg != null)) {
    var parts = [];
    if (blended.crude_protein_pct_dm != null) parts.push('CP ' + Math.round(blended.crude_protein_pct_dm * 10) / 10 + '% DM');
    if (blended.metabolizable_energy_mj_kg != null) parts.push('ME ' + Math.round(blended.metabolizable_energy_mj_kg * 10) / 10 + ' MJ/kg DM');
    var existingHint = concHintEl.textContent;
    var priceNote = existingHint && existingHint.indexOf('Auto-filled') >= 0 ? existingHint : '';
    concHintEl.innerHTML = (priceNote ? priceNote + '<br>' : '') +
      '<span style="color:var(--teal);font-size:10px">Nutritional values auto-filled from recipe: ' + parts.join(', ') + '</span>';
  }
  if (typeof calcFeedCost === 'function') calcFeedCost();

  var currentCPK2 = currentConcentrateCPK || 0;
  var cpk_per_cp = (blended.crude_protein_pct_dm && blended.crude_protein_pct_dm > 0 && currentCPK2 > 0)
    ? currentCPK2 / (blended.crude_protein_pct_dm / 100) : null;
  var cpk_per_me = (blended.metabolizable_energy_mj_kg && blended.metabolizable_energy_mj_kg > 0 && currentCPK2 > 0)
    ? currentCPK2 / blended.metabolizable_energy_mj_kg : null;
  var missingPct = totalIncl > 0
    ? Math.round((1 - Math.min.apply(null, fields.map(function(f) { return coverage[f.key] / totalIncl; }))) * 100)
    : 100;
  nutrMeta.textContent = missingPct > 10
    ? 'Partial data — ' + missingPct + '% of inclusion rate has missing nutritional values'
    : 'Based on full ingredient data';

  var html = '<div class="nutr-grid">';
  html += '<div><div style="font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px">Blended concentrate composition</div>';
  html += '<table class="nutr-table"><thead><tr><th>Nutrient</th><th class="nutr-val">Value</th><th class="nutr-val">Coverage</th></tr></thead><tbody>';
  fields.forEach(function(f) {
    var val = blended[f.key];
    var cov = coverage[f.key] > 0 ? Math.round(coverage[f.key] / totalIncl * 100) + '%' : '—';
    var valStr = val != null ? val.toFixed(2) + ' ' + f.unit : '<span style="color:var(--faint)">no data</span>';
    var flag = '';
    if (val != null && f.ref != null) {
      if (f.key === 'crude_protein_pct_dm') {
        flag = val >= 14 ? '<span class="nutr-flag-ok">✓</span>' : val >= 12 ? '<span class="nutr-flag-warn">⚠</span>' : '<span class="nutr-flag-bad">✗</span>';
      } else if (f.key === 'metabolizable_energy_mj_kg') {
        flag = val >= 9.0 ? '<span class="nutr-flag-ok">✓</span>' : val >= 8.5 ? '<span class="nutr-flag-warn">⚠</span>' : '<span class="nutr-flag-bad">✗</span>';
      } else {
        flag = val >= f.ref ? '<span class="nutr-flag-ok">✓</span>' : '<span class="nutr-flag-warn">⚠</span>';
      }
    }
    html += '<tr><td>' + f.label + (flag ? ' ' + flag : '') + '</td><td class="nutr-val">' + valStr + '</td><td class="nutr-val" style="color:var(--faint)">' + cov + '</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div><div style="font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px">Cost per unit of nutrient</div>';
  html += '<table class="nutr-table" style="margin-bottom:16px"><thead><tr><th>Metric</th><th class="nutr-val">Value</th></tr></thead><tbody>';
  html += '<tr><td>PKR per kg of crude protein</td><td class="nutr-val">' + (cpk_per_cp ? pkr(cpk_per_cp) + ' / kg CP' : '<span style="color:var(--faint)">no CP data</span>') + '</td></tr>';
  html += '<tr><td>PKR per MJ metabolizable energy</td><td class="nutr-val">' + (cpk_per_me ? pkr(cpk_per_me) + ' / MJ ME' : '<span style="color:var(--faint)">no ME data</span>') + '</td></tr>';
  html += '</tbody></table>';
  var cp = blended.crude_protein_pct_dm, me = blended.metabolizable_energy_mj_kg;
  if (cp != null || me != null) {
    html += '<div class="nutr-summary-card"><h3>Concentrate adequacy notes</h3>';
    if (cp != null) {
      html += '<p style="font-size:13px;line-height:1.5;color:var(--text);margin-bottom:8px">' +
        (cp >= 14 ? '✓ CP ' + cp.toFixed(1) + '% meets minimum 14% threshold for lean growth in Beetal.' :
         cp >= 12 ? '⚠ CP ' + cp.toFixed(1) + '% is marginal — supplementation or higher-protein ingredient substitution warranted.' :
                    '✗ CP ' + cp.toFixed(1) + '% is deficient. Reformulate before use.') + '</p>';
    }
    if (me != null) {
      html += '<p style="font-size:13px;line-height:1.5;color:var(--text)">' +
        (me >= 9.0 ? '✓ ME ' + me.toFixed(1) + ' MJ/kg meets minimum 9.0 MJ/kg threshold.' :
         me >= 8.5 ? '⚠ ME ' + me.toFixed(1) + ' MJ/kg is borderline.' :
                     '✗ ME ' + me.toFixed(1) + ' MJ/kg is low energy for fattening.') + '</p>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  nutrBody.innerHTML = html;
}

// ============================================================
// RATION SETUP / FEED MODELLER
// ============================================================

async function loadFeedModeller() {
  try {
    var roughageIngs = await sbGet('ingredients',
      'active=eq.true&category=in.(roughage,grain,protein,other)' +
      '&select=id,name,category,dry_matter_pct,crude_protein_pct_dm,metabolizable_energy_mj_kg&order=category,name');
    fcRoughageIngs = roughageIngs;

    var ingIds = roughageIngs.map(function(i) { return i.id; });
    if (ingIds.length) {
      var prices = await sbGet('ingredient_acquisitions',
        'ingredient_id=in.(' + ingIds.join(',') + ')&acquisition_type=eq.purchased' +
        '&cost_per_kg=not.is.null&select=ingredient_id,cost_per_kg,date&order=date.desc&limit=500');
      var pr = {};
      prices.forEach(function(p) { if (!pr[p.ingredient_id]) pr[p.ingredient_id] = p; });
      fcRoughagePrices = pr;
    }

    // Populate hay and fodder ingredient selectors
    ['hay', 'fodder'].forEach(function(type) {
      var sel = document.getElementById('fc-' + type + '-ing');
      if (!sel) return;
      var curVal = sel.value;
      sel.innerHTML = '<option value="">— select —</option>';
      roughageIngs.forEach(function(i) {
        sel.innerHTML += '<option value="' + i.id + '"' + (String(i.id) === curVal ? ' selected' : '') + '>' +
          i.name + ' (' + (i.category || 'other') + ')</option>';
      });
    });

    // Populate concentrate recipe selector — always refresh
    var concSel = document.getElementById('fc-conc-recipe');
    if (concSel) {
      var prevVal = concSel.value;
      concSel.innerHTML = '<option value="">— select recipe —</option>';
      try {
        var concRecipes = await sbGet('recipes', 'active=eq.true&select=id,name,species(common_name)&order=name');
        concRecipes.forEach(function(r) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.name + (r.species ? ' (' + r.species.common_name + ')' : '');
          concSel.appendChild(opt);
        });
        // Restore previous selection if still valid
        if (prevVal) concSel.value = prevVal;
      } catch (e) {
        console.warn('Could not load concentrate recipes:', e.message);
      }
    }

    // Auto-fill hay/fodder if not already selected
    var hayEl = document.getElementById('fc-hay-ing');
    var fodEl = document.getElementById('fc-fodder-ing');
    roughageIngs.forEach(function(i) {
      var n = i.name.toLowerCase();
      if (n.indexOf('hay') >= 0 && hayEl && !hayEl.value) {
        hayEl.value = i.id; onRoughageSelect('hay');
      }
      if ((n.indexOf('fodder') >= 0 || n.indexOf('green') >= 0) && fodEl && !fodEl.value) {
        fodEl.value = i.id; onRoughageSelect('fodder');
      }
    });

    // Auto-fill concentrate price from last loadFeedCost if available
    if (currentConcentrateCPK) {
      var cpriceEl = document.getElementById('fc-conc-price');
      if (cpriceEl && !cpriceEl.value) cpriceEl.value = Math.round(currentConcentrateCPK * 100) / 100;
    }

    document.getElementById('fc-updated').textContent =
      'Prices loaded ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    calcFeedCost();
    loadRationRecipes();
    renderAbbrevKey('abbrev-rationsetup', ['DM', 'DMI', 'FCR', 'CP', 'ME', 'PKR']);
  } catch (err) {
    console.error('Modeller load error:', err);
  }
}

function onRoughageSelect(type) {
  var ingEl   = document.getElementById('fc-' + type + '-ing');
  if (!ingEl) return;
  var ingId   = ingEl.value;
  if (!ingId) return;
  var ing     = fcRoughageIngs.find(function(i) { return String(i.id) === ingId; });
  var priceEl = document.getElementById('fc-' + type + '-price');
  var dmEl    = document.getElementById('fc-' + type + '-dm');
  var hintEl  = document.getElementById('fc-' + type + '-price-hint');
  var cpEl    = document.getElementById('fc-' + type + '-cp');
  var meEl    = document.getElementById('fc-' + type + '-me');
  if (ing && ing.dry_matter_pct && dmEl) dmEl.value = ing.dry_matter_pct;
  if (ing && cpEl) { if (ing.crude_protein_pct_dm != null) cpEl.value = ing.crude_protein_pct_dm; else cpEl.value = ''; }
  if (ing && meEl) { if (ing.metabolizable_energy_mj_kg != null) meEl.value = ing.metabolizable_energy_mj_kg; else meEl.value = ''; }
  var pr = fcRoughagePrices[ingId];
  if (pr && priceEl) { priceEl.value = pr.cost_per_kg; if (hintEl) hintEl.className = 'fc-hint ok'; }
  else if (priceEl) { priceEl.value = ''; if (hintEl) hintEl.className = 'fc-hint warn'; }
  if (hintEl) {
    var primary = pr ? 'Price: ' + fmtDate(pr.date) : 'No purchase price — enter market equivalent';
    var nutr = [];
    if (ing && ing.crude_protein_pct_dm != null) nutr.push('CP ' + ing.crude_protein_pct_dm + '% DM');
    if (ing && ing.metabolizable_energy_mj_kg != null) nutr.push('ME ' + ing.metabolizable_energy_mj_kg + ' MJ/kg');
    hintEl.innerHTML =
      (pr ? '<span>' + primary + '</span>' : '<span style="color:var(--amber)">' + primary + '</span>') +
      (nutr.length ? ' <span style="color:var(--teal);font-size:10px">' + nutr.join(' · ') + ' (auto-filled)</span>' : '');
  }
  if (ing) {
    var nm = ing.name;
    ['rs-' + type + '-name', 'rs-' + type + '-wk-name', 'rs-' + type + '-cyc-name',
     type === 'hay' ? 'split-legend-hay' : 'split-legend-fod'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.textContent = nm;
    });
  }
  calcFeedCost();
}

async function onConcRecipeSelect() {
  var sel = document.getElementById('fc-conc-recipe');
  if (!sel || !sel.value) return;
  var recipeId = sel.value;
  var hintEl   = document.getElementById('fc-conc-price-hint');
  if (hintEl) hintEl.textContent = 'Loading…';

  try {
    var versions = await sbGet('recipe_versions',
      'recipe_id=eq.' + recipeId + '&select=id,version_number,effective_date&order=version_number.desc&limit=1');
    if (!versions.length) { if (hintEl) hintEl.textContent = 'No versions found.'; return; }
    var ver = versions[0];

    var ri = await sbGet('recipe_ingredients',
      'recipe_version_id=eq.' + ver.id +
      '&select=inclusion_rate,ingredients(id,name,source_type,dry_matter_pct,crude_protein_pct_dm,metabolizable_energy_mj_kg)');

    var ingIds = ri.map(function(r) { return r.ingredients && r.ingredients.id; }).filter(Boolean);
    var lp = {};
    if (ingIds.length) {
      var prices = await sbGet('ingredient_acquisitions',
        'ingredient_id=in.(' + ingIds.join(',') + ')&acquisition_type=eq.purchased&cost_per_kg=not.is.null' +
        '&select=ingredient_id,cost_per_kg,date&order=date.desc&limit=200');
      prices.forEach(function(p) { if (!lp[p.ingredient_id]) lp[p.ingredient_id] = p; });
    }

    var cpk = 0, cpTotal = 0, meTotal = 0, cpCov = 0, meCov = 0;
    ri.forEach(function(row) {
      var ing = row.ingredients; if (!ing || ing.source_type === 'vet_supplied') return;
      var incl = parseFloat(row.inclusion_rate);
      var p = lp[ing.id];
      if (p) cpk += parseFloat(p.cost_per_kg) * incl;
      if (ing.crude_protein_pct_dm != null) { cpTotal += ing.crude_protein_pct_dm * incl; cpCov += incl; }
      if (ing.metabolizable_energy_mj_kg != null) { meTotal += ing.metabolizable_energy_mj_kg * incl; meCov += incl; }
    });

    var avgCP = cpCov > 0 ? cpTotal / cpCov : null;
    var avgME = meCov > 0 ? meTotal / meCov : null;

    var priceEl = document.getElementById('fc-conc-price');
    var cpEl    = document.getElementById('fc-conc-cp');
    var meEl    = document.getElementById('fc-conc-me');

    if (priceEl && cpk > 0) priceEl.value = Math.round(cpk * 100) / 100;
    if (cpEl && avgCP != null) cpEl.value = Math.round(avgCP * 10) / 10;
    if (meEl && avgME != null) meEl.value = Math.round(avgME * 10) / 10;
    currentConcentrateCPK = cpk || null;

    if (hintEl) {
      var parts = [];
      if (avgCP != null) parts.push('CP ' + Math.round(avgCP * 10) / 10 + '% DM');
      if (avgME != null) parts.push('ME ' + Math.round(avgME * 10) / 10 + ' MJ/kg DM');
      hintEl.innerHTML = 'v' + ver.version_number + ' · ' + fmtDate(ver.effective_date) +
        (parts.length ? ' <span style="color:var(--teal);font-size:10px">' + parts.join(' · ') + '</span>' : '');
    }
    calcFeedCost();
  } catch (err) {
    if (hintEl) hintEl.textContent = 'Error loading recipe: ' + err.message;
    console.error('onConcRecipeSelect error:', err);
  }
}

// ============================================================
// calcFeedCost
// ============================================================
function calcFeedCost() {
  function num(id, fallback) {
    var el = document.getElementById(id); if (!el) return fallback;
    var v = parseFloat(el.value);
    return isNaN(v) ? fallback : v;
  }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  function dash() { return '—'; }
  function fmtKg(n) { return n == null ? dash() : (n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : r1(n).toLocaleString()) + ' kg'; }
  function fmtPkr(n) { return n == null ? dash() : pkr(n); }

  var concSplit  = num('fc-conc-split',   0);
  var haySplit   = num('fc-hay-split',    0);
  var fodSplit   = num('fc-fodder-split', 0);
  var dmiPct     = num('fc-dmi-pct',      4.5);
  var fcr        = num('fc-fcr',          6.0);
  var concPrice  = num('fc-conc-price',   null);
  var concDM     = num('fc-conc-dm',      88);
  var concCP     = num('fc-conc-cp',      null);
  var concME     = num('fc-conc-me',      null);
  var hayPrice   = num('fc-hay-price',    null);
  var hayDM      = num('fc-hay-dm',       85);
  var hayCP      = num('fc-hay-cp',       null);
  var hayME      = num('fc-hay-me',       null);
  var fodPrice   = num('fc-fodder-price', null);
  var fodDM      = num('fc-fodder-dm',    18);
  var fodCP      = num('fc-fodder-cp',    null);
  var fodME      = num('fc-fodder-me',    null);
  var avgWeight  = num('fc-avg-weight',   null);
  var targetWeight = num('fc-target-weight', null);

  var splitSum = concSplit + haySplit + fodSplit;
  var safe = splitSum > 0 ? splitSum : 100;
  var concBar = document.getElementById('split-bar-conc');
  var hayBar  = document.getElementById('split-bar-hay');
  var fodBar  = document.getElementById('split-bar-fod');
  if (concBar) { concBar.style.width = (concSplit / safe * 100) + '%'; concBar.textContent = concSplit > 5 ? r1(concSplit) + '%' : ''; }
  if (hayBar)  { hayBar.style.width  = (haySplit  / safe * 100) + '%'; hayBar.textContent  = haySplit  > 5 ? r1(haySplit)  + '%' : ''; }
  if (fodBar)  { fodBar.style.width  = (fodSplit  / safe * 100) + '%'; fodBar.textContent  = fodSplit  > 5 ? r1(fodSplit)  + '%' : ''; }
  var splitSumEl = document.getElementById('fc-split-sum');
  if (splitSumEl) {
    if (Math.abs(splitSum - 100) < 0.05) {
      splitSumEl.textContent = 'Splits sum to 100%'; splitSumEl.className = 'section-meta split-sum-ok';
    } else {
      splitSumEl.textContent = 'Splits sum to ' + r1(splitSum) + '% (should be 100%)'; splitSumEl.className = 'section-meta split-sum-bad';
    }
  }

  var totalDmAnimal = (avgWeight != null && dmiPct > 0) ? avgWeight * dmiPct / 100 : null;
  var dailyGainKg = (totalDmAnimal != null && fcr > 0) ? totalDmAnimal / fcr : null;
  setText('fc-gain-display', dailyGainKg != null ? Math.round(dailyGainKg * 1000) + ' g/day' : dash());

  var headCount = (typeof fcPenStats !== 'undefined' && fcPenStats && fcPenStats.headCount) ? fcPenStats.headCount : null;

  function compute(splitPct, dmPct, price) {
    if (totalDmAnimal == null || splitPct == null) return null;
    var dmA = totalDmAnimal * splitPct / 100;
    var freshA = (dmPct && dmPct > 0) ? dmA / (dmPct / 100) : null;
    var costA  = (freshA != null && price != null) ? freshA * price : null;
    var freshP = (freshA != null && headCount) ? freshA * headCount : null;
    var costP  = (costA  != null && headCount) ? costA  * headCount : null;
    return { dmA: dmA, freshA: freshA, costA: costA, freshP: freshP, costP: costP };
  }
  var conc = compute(concSplit, concDM, concPrice);
  var hay  = compute(haySplit,  hayDM,  hayPrice);
  var fod  = compute(fodSplit,  fodDM,  fodPrice);

  function setDaily(prefix, c) {
    setText('rs-' + prefix + '-dm',     c ? fmtKg(c.dmA)    : dash());
    setText('rs-' + prefix + '-fresh',  c ? fmtKg(c.freshA) : dash());
    setText('rs-' + prefix + '-pen',    c && c.freshP != null ? fmtKg(c.freshP) : dash());
    setText('rs-' + prefix + '-cost-a', c ? fmtPkr(c.costA) : dash());
    setText('rs-' + prefix + '-cost-p', c && c.costP  != null ? fmtPkr(c.costP)  : dash());
  }
  setDaily('conc', conc); setDaily('hay', hay); setDaily('fodder', fod);

  function sum(arr, key) {
    var s = 0, any = false;
    arr.forEach(function(x) { if (x && x[key] != null) { s += x[key]; any = true; } });
    return any ? s : null;
  }
  var totDm    = sum([conc, hay, fod], 'dmA');
  var totFresh = sum([conc, hay, fod], 'freshA');
  var totCostA = sum([conc, hay, fod], 'costA');
  var totFreshP = sum([conc, hay, fod], 'freshP');
  var totCostP  = sum([conc, hay, fod], 'costP');
  setText('rs-total-dm',     totDm    != null ? fmtKg(totDm)    : dash());
  setText('rs-total-fresh',  totFresh != null ? fmtKg(totFresh) : dash());
  setText('rs-total-pen',    totFreshP != null ? fmtKg(totFreshP) : dash());
  setText('rs-total-cost-a', totCostA != null ? fmtPkr(totCostA) : dash());
  setText('rs-total-cost-p', totCostP != null ? fmtPkr(totCostP) : dash());

  function setWeek(prefix, c) {
    setText('rs-' + prefix + '-wk-g',  c && c.freshA != null ? fmtKg(c.freshA * 7) : dash());
    setText('rs-' + prefix + '-wk-p',  c && c.freshP != null ? fmtKg(c.freshP * 7) : dash());
    setText('rs-' + prefix + '-wk-ca', c && c.costA  != null ? fmtPkr(c.costA  * 7) : dash());
    setText('rs-' + prefix + '-wk-cp', c && c.costP  != null ? fmtPkr(c.costP  * 7) : dash());
  }
  setWeek('conc', conc); setWeek('hay', hay); setWeek('fodder', fod);
  setText('rs-total-wk-g',  totFresh  != null ? fmtKg(totFresh  * 7) : dash());
  setText('rs-total-wk-p',  totFreshP != null ? fmtKg(totFreshP * 7) : dash());
  setText('rs-total-wk-ca', totCostA  != null ? fmtPkr(totCostA * 7) : dash());
  setText('rs-total-wk-cp', totCostP  != null ? fmtPkr(totCostP * 7) : dash());

  var cycleDays = null;
  if (avgWeight != null && targetWeight != null && dailyGainKg && targetWeight > avgWeight) {
    cycleDays = Math.ceil((targetWeight - avgWeight) / dailyGainKg);
  }
  function setCyc(prefix, c) {
    if (!cycleDays) { ['cyc-g','cyc-p','cyc-ca','cyc-cp'].forEach(function(s) { setText('rs-' + prefix + '-' + s, dash()); }); return; }
    setText('rs-' + prefix + '-cyc-g',  c && c.freshA != null ? fmtKg(c.freshA * cycleDays) : dash());
    setText('rs-' + prefix + '-cyc-p',  c && c.freshP != null ? fmtKg(c.freshP * cycleDays) : dash());
    setText('rs-' + prefix + '-cyc-ca', c && c.costA  != null ? fmtPkr(c.costA  * cycleDays) : dash());
    setText('rs-' + prefix + '-cyc-cp', c && c.costP  != null ? fmtPkr(c.costP  * cycleDays) : dash());
  }
  setCyc('conc', conc); setCyc('hay', hay); setCyc('fodder', fod);
  if (cycleDays) {
    setText('rs-total-cyc-g',  totFresh  != null ? fmtKg(totFresh  * cycleDays) : dash());
    setText('rs-total-cyc-p',  totFreshP != null ? fmtKg(totFreshP * cycleDays) : dash());
    setText('rs-total-cyc-ca', totCostA  != null ? fmtPkr(totCostA * cycleDays) : dash());
    setText('rs-total-cyc-cp', totCostP  != null ? fmtPkr(totCostP * cycleDays) : dash());
  } else {
    ['rs-total-cyc-g','rs-total-cyc-p','rs-total-cyc-ca','rs-total-cyc-cp'].forEach(function(id) { setText(id, dash()); });
  }

  var nutrSection = document.getElementById('fc-nutrition-section');
  var nutrBody    = document.getElementById('fc-nutrition-body');
  var nutrMeta    = document.getElementById('fc-nutr-meta');
  if (nutrSection && nutrBody) {
    var rationCP = null, rationME = null;
    if (totDm && totDm > 0) {
      var cpSum = 0, cpCov = 0, meSum = 0, meCov = 0;
      [{ c: conc, cp: concCP, me: concME }, { c: hay, cp: hayCP, me: hayME }, { c: fod, cp: fodCP, me: fodME }]
        .forEach(function(row) {
          if (!row.c || row.c.dmA == null) return;
          if (row.cp != null) { cpSum += row.cp * row.c.dmA; cpCov += row.c.dmA; }
          if (row.me != null) { meSum += row.me * row.c.dmA; meCov += row.c.dmA; }
        });
      if (cpCov > 0) rationCP = cpSum / cpCov;
      if (meCov > 0) rationME = meSum / meCov;
    }
    if (rationCP == null && rationME == null) {
      nutrSection.style.display = 'none';
    } else {
      nutrSection.style.display = 'block';
      var cpFlag = '', meFlag = '';
      if (rationCP != null) {
        cpFlag = rationCP >= 14 ? '<span class="nutr-flag-ok">✓ adequate</span>' :
                 rationCP >= 12 ? '<span class="nutr-flag-warn">⚠ marginal</span>' :
                                  '<span class="nutr-flag-bad">✗ deficient</span>';
      }
      if (rationME != null) {
        meFlag = rationME >= 9.0 ? '<span class="nutr-flag-ok">✓ adequate</span>' :
                 rationME >= 8.5 ? '<span class="nutr-flag-warn">⚠ borderline</span>' :
                                   '<span class="nutr-flag-bad">✗ low</span>';
      }
      var nh = '<table class="nutr-table" style="max-width:520px"><thead><tr><th>Nutrient</th><th class="nutr-val">Whole-ration value</th><th>Adequacy</th></tr></thead><tbody>';
      nh += '<tr><td>Crude protein</td><td class="nutr-val">' + (rationCP != null ? rationCP.toFixed(2) + '% DM' : '—') + '</td><td>' + cpFlag + '</td></tr>';
      nh += '<tr><td>Metabolizable energy</td><td class="nutr-val">' + (rationME != null ? rationME.toFixed(2) + ' MJ/kg DM' : '—') + '</td><td>' + meFlag + '</td></tr>';
      nh += '</tbody></table>';
      nh += '<div style="font-size:11px;color:var(--faint);margin-top:10px;line-height:1.5">Whole-ration values weighted by each component\'s DM share.</div>';
      nutrBody.innerHTML = nh;
      if (nutrMeta) nutrMeta.textContent = 'Whole-ration profile';
    }
  }

  var cycleEl = document.getElementById('fc-cycle-table');
  if (cycleEl) {
    if (!cycleDays || totCostA == null) {
      cycleEl.innerHTML = '<div class="empty">Select a pen and complete avg/target weight + ration prices to see cycle summary.</div>';
    } else {
      var totalGainKg   = targetWeight - avgWeight;
      var costPerKgGain = totCostA * cycleDays / totalGainKg;
      var costPerKgFeed = totCostA / (totFresh || 1);
      var ch = '<table class="cycle-table">';
      ch += '<tr class="section-break"><td colspan="2">Cycle parameters</td></tr>';
      ch += '<tr><td class="c-label">Starting weight (avg)</td><td class="c-val">' + r1(avgWeight) + ' kg</td></tr>';
      ch += '<tr><td class="c-label">Target sale weight</td><td class="c-val">' + r1(targetWeight) + ' kg</td></tr>';
      ch += '<tr><td class="c-label">Daily gain (FCR-derived)</td><td class="c-val">' + Math.round(dailyGainKg * 1000) + ' g/day</td></tr>';
      ch += '<tr><td class="c-label">Cycle length</td><td class="c-val">' + cycleDays + ' days</td></tr>';
      ch += '<tr class="section-break"><td colspan="2">Per animal</td></tr>';
      ch += '<tr><td class="c-label">Total weight gain</td><td class="c-val">' + r1(totalGainKg) + ' kg</td></tr>';
      ch += '<tr><td class="c-label">Total feed cost</td><td class="c-val">' + pkr(totCostA * cycleDays) + '</td></tr>';
      ch += '<tr class="total-row"><td class="c-label">Cost per kg live-weight gain</td><td class="c-val">' + pkr(costPerKgGain) + ' / kg gain</td></tr>';
      ch += '<tr><td class="c-label">Cost per kg feed (fresh)</td><td class="c-val">' + pkr(costPerKgFeed) + ' / kg feed</td></tr>';
      if (headCount) {
        ch += '<tr class="section-break"><td colspan="2">Whole pen (' + headCount + ' animals)</td></tr>';
        ch += '<tr><td class="c-label">Total feed cost across cycle</td><td class="c-val">' + pkr(totCostP * cycleDays) + '</td></tr>';
        ch += '<tr><td class="c-label">Total fresh feed across cycle</td><td class="c-val">' + r1(totFreshP * cycleDays).toLocaleString() + ' kg</td></tr>';
      }
      ch += '</table>';
      cycleEl.innerHTML = ch;
    }
  }
}

// ============================================================
// RATION SAVE / LOAD
// ============================================================

async function saveRation() {
  var nameEl   = document.getElementById('ration-save-name');
  var statusEl = document.getElementById('ration-save-status');
  var name = nameEl ? (nameEl.value || '').trim() : '';
  if (!name) { if (statusEl) statusEl.textContent = 'Enter a name for this ration.'; return; }

  function getVal(id) { var el = document.getElementById(id); if (!el) return null; var v = parseFloat(el.value); return isNaN(v) ? null : v; }
  function getSel(id) { var el = document.getElementById(id); return el && el.value ? el.value : null; }

  var data = {
    name: name,
    concentrate_recipe_id: getSel('fc-conc-recipe') ? parseInt(getSel('fc-conc-recipe')) : null,
    hay_ingredient_id:     getSel('fc-hay-ing')     ? parseInt(getSel('fc-hay-ing'))     : null,
    fodder_ingredient_id:  getSel('fc-fodder-ing')  ? parseInt(getSel('fc-fodder-ing'))  : null,
    conc_split_pct: getVal('fc-conc-split'),
    hay_split_pct:  getVal('fc-hay-split'),
    fod_split_pct:  getVal('fc-fodder-split'),
    dmi_pct:        getVal('fc-dmi-pct'),
    fcr:            getVal('fc-fcr'),
    active: true
  };

  if (statusEl) statusEl.textContent = 'Saving…';
  try {
    await sbInsert('ration_recipes', data);
    if (statusEl) statusEl.textContent = 'Saved ✓';
    if (nameEl) nameEl.value = '';
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 3000);
    loadRationRecipes();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

async function loadRationRecipes() {
  var listEl = document.getElementById('saved-rations-list');
  if (!listEl) return;
  try {
    var rations = await sbGet('ration_recipes',
      'active=eq.true&select=id,name,conc_split_pct,hay_split_pct,fod_split_pct,dmi_pct,fcr&order=name');
    if (!rations.length) {
      listEl.innerHTML = '<div style="font-size:13px;color:var(--faint);padding:14px 0">No saved rations yet.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Name</th><th class="right">Conc %</th><th class="right">Hay %</th>' +
      '<th class="right">Fodder %</th><th class="right">DMI %</th><th class="right">FCR</th><th></th></tr></thead><tbody>';
    rations.forEach(function(r) {
      html += '<tr>' +
        '<td style="font-weight:500">' + r.name + '</td>' +
        '<td class="mono right">' + (r.conc_split_pct != null ? r.conc_split_pct : '—') + '</td>' +
        '<td class="mono right">' + (r.hay_split_pct  != null ? r.hay_split_pct  : '—') + '</td>' +
        '<td class="mono right">' + (r.fod_split_pct  != null ? r.fod_split_pct  : '—') + '</td>' +
        '<td class="mono right">' + (r.dmi_pct != null ? r.dmi_pct : '—') + '</td>' +
        '<td class="mono right">' + (r.fcr    != null ? r.fcr     : '—') + '</td>' +
        '<td><div style="display:flex;gap:8px">' +
          '<button class="btn btn-sm" onclick="loadRationFromSaved(' + r.id + ')">Load</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteRationRecipe(' + r.id + ')">×</button>' +
        '</div></td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    listEl.innerHTML = html;
  } catch (err) {
    listEl.innerHTML = '<div style="font-size:13px;color:var(--red)">' + err.message + '</div>';
  }
}

async function loadRationFromSaved(rationId) {
  try {
    var rations = await sbGet('ration_recipes', 'id=eq.' + rationId + '&select=*');
    if (!rations.length) return;
    var r = rations[0];
    function setVal(id, val) { var el = document.getElementById(id); if (el && val != null) el.value = val; }
    if (r.concentrate_recipe_id) {
      setVal('fc-conc-recipe', r.concentrate_recipe_id);
      await onConcRecipeSelect();
    }
    if (r.hay_ingredient_id)    { setVal('fc-hay-ing',    r.hay_ingredient_id);    onRoughageSelect('hay'); }
    if (r.fodder_ingredient_id) { setVal('fc-fodder-ing', r.fodder_ingredient_id); onRoughageSelect('fodder'); }
    setVal('fc-conc-split',   r.conc_split_pct);
    setVal('fc-hay-split',    r.hay_split_pct);
    setVal('fc-fodder-split', r.fod_split_pct);
    setVal('fc-dmi-pct',      r.dmi_pct);
    setVal('fc-fcr',          r.fcr);
    calcFeedCost();
  } catch (err) { alert('Load error: ' + err.message); }
}

async function deleteRationRecipe(rationId) {
  if (!confirm('Delete this saved ration?')) return;
  try { await sbPatch('ration_recipes', rationId, { active: false }); loadRationRecipes(); }
  catch (err) { alert('Error: ' + err.message); }
}

// ============================================================
// COST PROJECTIONS
// ============================================================

async function onProjPenChange() {
  var val       = document.getElementById('proj-pen-select').value;
  var summaryEl = document.getElementById('proj-pen-summary');
  var metaEl    = document.getElementById('proj-pen-meta');
  if (!val) { summaryEl.textContent = ''; if (metaEl) metaEl.textContent = ''; return; }
  if (val === 'all') {
    try {
      var allAnimals = await sbGet('animals',
        'status=eq.active&select=id,farm_id,entry_weight_kg,date_of_arrival,animal_weights(weight_kg,date)');
      var today = new Date();
      var weights = [], days = [];
      allAnimals.forEach(function(a) {
        var w = null;
        if (a.animal_weights && a.animal_weights.length) {
          var s = a.animal_weights.slice().sort(function(x, y) { return new Date(y.date) - new Date(x.date); });
          w = parseFloat(s[0].weight_kg);
        } else if (a.entry_weight_kg) w = parseFloat(a.entry_weight_kg);
        if (w != null) weights.push(w);
        if (a.date_of_arrival) {
          var d = Math.round((today - new Date(a.date_of_arrival)) / 864e5);
          if (d > 0) days.push(d);
        }
      });
      var avgW = weights.length ? weights.reduce(function(s, v) { return s + v; }, 0) / weights.length : null;
      var avgD = days.length    ? days.reduce(function(s, v) { return s + v; }, 0) / days.length     : 0;
      fcPenStats = { headCount: allAnimals.length, avgEntryWeight: null, avgCurrentWeight: avgW, avgDaysOnFarm: Math.round(avgD), observedDailyGainG: null, obsInsufficient: false, animals: allAnimals };
      if (avgW) document.getElementById('fc-avg-weight').value = Math.round(avgW * 10) / 10;
      summaryEl.textContent = allAnimals.length + ' active animals across all pens' + (avgW ? ' — avg ' + Math.round(avgW * 10) / 10 + ' kg' : '');
      if (metaEl) metaEl.textContent = allAnimals.length + ' animals — whole farm view';
      calcFeedCost();
    } catch (err) { console.error(err); }
    return;
  }
  try {
    var animals = await sbGet('animals',
      'current_location_id=eq.' + val + '&status=eq.active' +
      '&select=id,farm_id,entry_weight_kg,date_of_arrival,animal_weights(weight_kg,date)');
    var today2 = new Date();
    var entryW = [], curW = [], days2 = [];
    animals.forEach(function(a) {
      if (a.entry_weight_kg != null) entryW.push(parseFloat(a.entry_weight_kg));
      var w = null;
      if (a.animal_weights && a.animal_weights.length) {
        var s = a.animal_weights.slice().sort(function(x, y) { return new Date(y.date) - new Date(x.date); });
        w = parseFloat(s[0].weight_kg);
      } else if (a.entry_weight_kg) w = parseFloat(a.entry_weight_kg);
      if (w != null) curW.push(w);
      if (a.date_of_arrival) { var d = Math.round((today2 - new Date(a.date_of_arrival)) / 864e5); if (d > 0) days2.push(d); }
    });
    var avgEntry = entryW.length ? entryW.reduce(function(s, v) { return s + v; }, 0) / entryW.length : null;
    var avgCur   = curW.length   ? curW.reduce(function(s, v) { return s + v; }, 0) / curW.length     : null;
    var avgDays  = days2.length  ? days2.reduce(function(s, v) { return s + v; }, 0) / days2.length   : 0;
    var obsG = null, obsIns = false;
    if (avgEntry != null && avgCur != null && avgDays >= 7) {
      var gk = avgCur - avgEntry; if (gk > 0) obsG = gk / avgDays * 1000; else obsIns = true;
    } else if (avgDays > 0 && avgDays < 7) obsIns = true;
    fcPenStats = { headCount: animals.length, avgEntryWeight: avgEntry, avgCurrentWeight: avgCur, avgDaysOnFarm: Math.round(avgDays), observedDailyGainG: obsG, obsInsufficient: obsIns, animals: animals };
    if (avgCur) document.getElementById('fc-avg-weight').value = Math.round(avgCur * 10) / 10;
    var sel = document.getElementById('proj-pen-select');
    var penName = sel.options[sel.selectedIndex].text;
    summaryEl.textContent = animals.length + ' animals' + (avgCur ? ' — avg ' + Math.round(avgCur * 10) / 10 + ' kg' : '') + (avgDays ? ' — ' + Math.round(avgDays) + ' days on farm' : '');
    if (metaEl) metaEl.textContent = penName + ' — ' + animals.length + ' animals';
    calcFeedCost();
  } catch (err) { console.error(err); }
}

async function loadProjectionsPage() {
  try {
    var pens = await sbGet('locations', 'location_type=eq.pen&active=eq.true&select=id,name&order=name');
    var sel  = document.getElementById('proj-pen-select');
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">— select pen —</option><option value="all">All pens (whole farm)</option>';
      pens.forEach(function(p) {
        sel.innerHTML += '<option value="' + p.id + '"' + (String(p.id) === cur ? ' selected' : '') + '>' + p.name + '</option>';
      });
      if (cur) onProjPenChange(); else calcFeedCost();
    }
    renderAbbrevKey('abbrev-projections', ['DM', 'DMI', 'FCR', 'CP', 'ME', 'PKR']);
  } catch (err) { console.error(err); }
}
