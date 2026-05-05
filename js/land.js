// ============================================================
// land.js — Land section, 7 sub-tabs
//   1. Plots          — registry with code, name, type, area (ac+kanals), status
//   2. Fert Inventory — stock summary + price history chart
//   3. App Log        — gypsum + amendments, water source, foliar warning
//   4. Soil Tests     — field/lab split, baseline flag, expanded panel, delta
//   5. Crop Tracking  — registry-linked crops, harvest events, observations
//   6. Watering       — events log with auto-volume calc
//   7. Water Tests    — full panel, baseline flag, delta
//
// Depends on: shared.js (sbGet/sbPatch/sbInsert, fmtDate, pkr, r1, r2,
//             todayISO, renderAbbrevKey, CHART_COLORS, anSharedWorkers)
// ============================================================

// ---- State ----
var landCropGroups    = [];
var landIngredients   = [];
var landPlots         = [];
var landFerts         = [];
var landFertPurchases = [];
var landGypsum        = [];
var landAmendments    = [];
var landTests         = [];
var landCrops         = [];
var landHarvests      = [];
var landObservations  = [];
var landWatering      = [];
var landWaterTests    = [];
var landCropRegistry  = [];
var landWorkers       = [];
var landLocations     = [];
var landLoaded        = false;
var landActiveTab     = 'plots';
var landFertChart     = null;
var landTrendChart    = null;

// ---- Constants ----
var AMEND_LABELS = {
  gypsum:'Gypsum', compost:'Compost', bsf_frass:'BSF Frass',
  biochar:'Biochar', lime:'Lime', farmyard_manure:'Farmyard Manure', other:'Other'
};
var AMEND_BADGE = {
  gypsum:'badge-amber', compost:'badge-lime', bsf_frass:'badge-teal',
  biochar:'badge-gray', lime:'badge-blue', farmyard_manure:'badge-brown', other:'badge-gray'
};
var CROP_ROLE_LABELS = {
  primary:'Primary', companion:'Companion', cover_crop:'Cover crop',
  fodder:'Fodder', green_manure:'Green manure'
};
var HARVEST_TYPE_LABELS = {
  permanent:'Permanent', multi_harvest:'Multi-harvest', single_harvest:'Single harvest'
};
var HARVEST_TYPE_BADGE = {
  permanent:'badge-blue', multi_harvest:'badge-lime', single_harvest:'badge-amber'
};
var CROP_STATUS_BADGE = {
  growing:'badge-lime', terminated:'badge-gray', failed:'badge-red'
};
var HEALTH_BADGE = {
  good:'badge-green', stressed:'badge-amber', failing:'badge-red', unknown:'badge-gray'
};
// 1 kanal = 0.125 acres (standard Pakistani kanal)
function acresKanals(acres) {
  if (acres == null || acres === '') return '—';
  var a = parseFloat(acres);
  if (isNaN(a)) return '—';
  return a.toFixed(2) + ' ac / ' + (a * 8).toFixed(1) + ' K';
}
function plotDisplayName(p) {
  if (!p) return '—';
  return p.plot_name || (p.locations ? p.locations.name : 'Plot ' + p.id);
}
function plotName(plotId) {
  var p = landPlots.find(function(x) { return x.id === plotId; });
  return plotDisplayName(p);
}


// ============================================================
// TAB SWITCHING
// ============================================================
function showLandTab(tab, btn) {
  landActiveTab = tab;
  document.querySelectorAll('#page-land .land-tab').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-land .land-panel').forEach(function(p) { p.style.display = 'none'; });
  var panel = document.getElementById('land-panel-' + tab);
  if (panel) panel.style.display = 'block';
  // Render charts when their tab becomes visible (Chart.js needs visible canvas)
  if (tab === 'fert')  renderLandFertChart();
  if (tab === 'soil')  renderLandTrendChart();
}


// ============================================================
// DATA LOAD
// ============================================================
function safeFetch(table, query) {
  return sbGet(table, query).catch(function(err) {
    console.warn('Land: query failed for', table, '—', err.message);
    return [];
  });
}

async function loadLandPage() {
  var loadingEl = document.getElementById('land-plots-loading');
  if (loadingEl) loadingEl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var workers = (typeof anSharedWorkers !== 'undefined' && anSharedWorkers.length)
                  ? Promise.resolve(anSharedWorkers)
                  : sbGet('workers', 'select=id,name&active=eq.true&order=name').catch(function() { return []; });

    var r = await Promise.all([
      // Core tables — these must exist
      sbGet('field_plots',
        'select=id,plot_code,plot_name,plot_type,area_acres,area_unit,use_case,description,' +
        'status,irrigation_method,date_retired,notes,location_id,locations(id,name)' +
        '&order=plot_code'),
      sbGet('fertilizers',          'select=id,name,type,unit,supplier,ec_impact,notes,active&order=name'),
      sbGet('fertilizer_purchases', 'select=id,fertilizer_id,date,qty,cost_per_unit,supplier,notes&order=date.desc&limit=500'),
      sbGet('gypsum_applications',
        'select=id,date,kg_applied,method,water_source,notes,field_plot_id,fertilizer_id,workers(name)&order=date.desc'),
      sbGet('amendment_applications',
        'select=id,date,amendment_type,kg_applied,method,water_source,source,notes,field_plot_id,fertilizer_id,workers(name)&order=date.desc'),
      sbGet('soil_tests',
        'select=id,date,sample_date,report_date,test_type,is_baseline,sample_depth,lab_name,' +
        'ec_ms_cm,ph,organic_matter_pct,sar,rsc,esp,available_phosphorus_mg_kg,' +
        'potassium_mg_kg,calcium_mg_kg,magnesium_mg_kg,texture_class,notes,field_plot_id' +
        '&order=date.desc'),
      sbGet('plot_crops',
        'select=id,field_plot_id,crop_id,crop_name,role,status,health_status,germination_outcome,' +
        'pest_disease_flag,sow_date,expected_termination_date,termination_date,notes,active,harvest_type,crop_group_id' +
        '&order=sow_date.desc'),
      // New tables — safe fallback to [] on error
      safeFetch('crop_harvest_events',
        'select=id,crop_group_id,cut_number,date,quantity_kg,quality_notes,destination,recorded_by,' +
        'workers(name)&order=date.desc'),
      safeFetch('crop_observations',
        'select=id,plot_crop_id,observed_at,health_status,pest_disease_flag,note,recorded_by,' +
        'workers(name)&order=observed_at.desc'),
      safeFetch('watering_events',
        'select=id,date,field_plot_id,method,duration_hours,estimated_volume_litres,' +
        'water_source,recorded_by,notes,workers(name)&order=date.desc'),
      safeFetch('water_tests',
        'select=id,date,source,test_type,is_baseline,lab_name,ec_us_cm,ph,sar,rsc_meq_l,' +
        'bicarbonate_meq_l,sodium_meq_l,calcium_meq_l,magnesium_meq_l,notes&order=date.desc'),
      safeFetch('crops',
        'select=id,name,local_name,category,salt_tolerance,salt_tolerance_ec_threshold,' +
        'nitrogen_fixer,feeding_notes,notes,active&order=name'),
      sbGet('locations', 'select=id,name,location_type,active&order=name'),
      safeFetch('crop_groups', 'select=id,field_plot_id,name,is_stand,harvest_type,notes,ingredient_id,ingredients(id,name)&order=field_plot_id,name'),
      safeFetch('ingredients', 'select=id,name,source_type&active=eq.true&order=name'),
      workers
    ]);

    landPlots         = r[0];
    landFerts         = r[1];
    landFertPurchases = r[2];
    landGypsum        = r[3];
    landAmendments    = r[4];
    landTests         = r[5];
    landCrops         = r[6];
    landHarvests      = r[7];
    landObservations  = r[8];
    landWatering      = r[9];
    landWaterTests    = r[10];
    landCropRegistry  = r[11];
    landLocations     = r[12];
    landCropGroups    = r[13];
    landIngredients   = r[14];
    landWorkers       = r[15];
    landLoaded        = true;

    if (loadingEl) loadingEl.innerHTML = '';

    populateLandDropdowns();
    renderLandPlots();
    renderLandFert();
    renderLandAppLog();
    renderLandTests();
    renderLandCrops();
    renderWateringLog();
    renderWaterTests();

    document.getElementById('land-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderAbbrevKey('abbrev-land', ['EC', 'SAR', 'OM', 'RSC', 'PKR', 'BSF', 'ESP']);
  } catch (err) {
    if (loadingEl) loadingEl.innerHTML =
      '<div style="padding:22px;color:var(--red)"><strong>Error loading land data:</strong> ' + err.message +
      '<br><small style="color:var(--muted)">Check browser console for details (F12 → Console)</small></div>';
    console.error('loadLandPage failed:', err);
  }
}

function populateLandDropdowns() {
  // All locations for plot creation
  var locOpts = '<option value="">Select location</option>' +
    landLocations.filter(function(l) { return l.active !== false; }).map(function(l) {
      return '<option value="' + l.id + '">' + l.name + ' (' + l.location_type + ')</option>';
    }).join('');
  var locEl = document.getElementById('lp-loc');
  if (locEl) locEl.innerHTML = locOpts;

  // Plot dropdowns (forms + filters)
  var plotOpts = '<option value="">Select plot</option>' +
    landPlots.filter(function(p) { return p.status !== 'inactive'; }).map(function(p) {
      return '<option value="' + p.id + '">' + plotDisplayName(p) + '</option>';
    }).join('');
  var plotFilter = '<option value="">All plots</option>' +
    landPlots.filter(function(p) { return p.status !== 'inactive'; }).map(function(p) {
      return '<option value="' + p.id + '">' + plotDisplayName(p) + '</option>';
    }).join('');
  ['la-plot','lt-plot','lw-plot','lwt-plot-na'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.innerHTML = plotOpts;
  });
  // Crop form: location dropdown drives plot dropdown via filterCropPlotsByLocation()
  var cropLocOpts = '<option value="">Select location</option>' +
    landLocations.filter(function(l) { return l.active !== false; }).map(function(l) {
      return '<option value="' + l.id + '">' + l.name + '</option>';
    }).join('');
  var lcLocEl = document.getElementById('lc-location');
  if (lcLocEl) lcLocEl.innerHTML = cropLocOpts;
  var lcPlotEl = document.getElementById('lc-plot');
  if (lcPlotEl) lcPlotEl.innerHTML = '<option value="">Select location first</option>';
  // Group select — populated dynamically by filterGroupsByPlot()
  var lcGroupSel = document.getElementById('lc-group-select');
  if (lcGroupSel) lcGroupSel.innerHTML = '<option value="">Select plot first</option>';
  // Ingredient link dropdown for new group form
  var ingOpts = '<option value="">None (no stock tracking)</option>' +
    (landCropRegistry ? [] : []).join('') + // placeholder — populated from ingredients fetch
    '';
  var lcIngEl = document.getElementById('lc-ingredient');
  if (lcIngEl && landIngredients && landIngredients.length) {
    lcIngEl.innerHTML = '<option value="">None (no stock tracking)</option>' +
      landIngredients
        .filter(function(i) { return i.source_type === 'produced' || i.source_type === 'dual'; })
        .map(function(i) { return '<option value="' + i.id + '">' + i.name + '</option>'; }).join('');
  }
  ['land-app-plot-filter','land-test-plot-filter','land-water-plot-filter'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.innerHTML = plotFilter;
  });

  // Fertilizer dropdown for application log
  var fertOpts = '<option value="">— none —</option>' +
    landFerts.filter(function(f) { return f.active; }).map(function(f) {
      return '<option value="' + f.id + '">' + f.name + ' (' + f.unit + ')</option>';
    }).join('');
  var fertEl = document.getElementById('la-fert');
  if (fertEl) fertEl.innerHTML = fertOpts;

  // Crops registry dropdown for crop tracking
  var cropOpts = '<option value="">Select crop</option>' +
    landCropRegistry.filter(function(c) { return c.active; }).map(function(c) {
      return '<option value="' + c.id + '">' + c.name +
        (c.local_name ? ' (' + c.local_name + ')' : '') + '</option>';
    }).join('');
  var cropEl = document.getElementById('lc-crop');
  if (cropEl) cropEl.innerHTML = cropOpts;

  // Workers for app log / crop forms / watering
  var workers = (typeof anSharedWorkers !== 'undefined' && anSharedWorkers.length) ? anSharedWorkers : landWorkers;
  ['la-worker','lc-worker','lw-worker','lwt-worker'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">Select worker</option>' +
      workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('');
  });

  // Default dates
  ['la-date','lt-date','lt-sample-date','lc-sow','lw-date','lwt-date'].forEach(function(id) {
    var el = document.getElementById(id); if (el && !el.value) el.value = todayISO();
  });

  // Auto-suggest plot code
  var codeEl = document.getElementById('lp-code');
  if (codeEl && !codeEl.value) codeEl.value = suggestPlotCode();
}


// ============================================================
// TAB 1: PLOTS
// ============================================================
function suggestPlotCode() {
  var existing = landPlots.map(function(p) { return p.plot_code; }).filter(Boolean);
  var nums = existing.map(function(c) { return parseInt((c || '').replace(/\D/g, '')) || 0; });
  var next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return 'P' + String(next).padStart(2, '0');
}

function toggleLandPlotForm() {
  var f = document.getElementById('land-plot-form');
  var open = f.style.display === 'block';
  f.style.display = open ? 'none' : 'block';
  if (!open) {
    // Reset and auto-suggest code
    document.getElementById('lp-code').value = suggestPlotCode();
    document.getElementById('lp-name').value = '';
    document.getElementById('lp-area').value = '';
    document.getElementById('lp-status').textContent = '';
  }
}

function renderLandPlots() {
  var activeCount = landPlots.filter(function(p) { return p.status !== 'inactive'; }).length;
  var totalAcres  = landPlots
    .filter(function(p) { return p.status !== 'inactive'; })
    .reduce(function(s, p) { return s + (parseFloat(p.area_acres) || 0); }, 0);
  document.getElementById('land-plot-count').textContent =
    activeCount + ' active plot' + (activeCount !== 1 ? 's' : '') +
    (totalAcres ? ' · ' + totalAcres.toFixed(2) + ' ac / ' + (totalAcres * 8).toFixed(1) + ' K total' : '');

  var tbl = document.getElementById('land-plot-table');
  if (!landPlots.length) {
    tbl.innerHTML = '<div class="empty">No plots yet. Click + Add plot to start.</div>';
    return;
  }

  var USE_BADGE = {
    agricultural:'badge-green', fodder:'badge-lime', fallow:'badge-amber',
    pasture:'badge-lime', access:'badge-gray', infrastructure:'badge-blue',
    rehabilitation:'badge-amber', other:'badge-gray'
  };
  var PLOT_TYPE_LABELS = {
    field:'Field', linear:'Linear', edge:'Edge', infrastructure:'Infrastructure'
  };
  var IRR_LABELS = { flood:'Flood', furrow:'Furrow', drip:'Drip', none:'None' };

  var activePlots  = landPlots.filter(function(p) { return p.status !== 'inactive'; });
  var retiredPlots = landPlots.filter(function(p) { return p.status === 'inactive'; });
  var orderedPlots = activePlots.concat(retiredPlots);

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Code</th><th>Name</th><th>Location</th><th>Type</th>' +
    '<th class="right">Area</th><th>Use case</th><th>Irrigation</th>' +
    '<th>Status</th><th>Latest EC</th><th>Active crops</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';

  var retiredHeaderInserted = false;
  orderedPlots.forEach(function(p) {
    if (p.status === 'inactive' && !retiredHeaderInserted) {
      html += '<tr><td colspan="12" style="padding:6px 14px;background:var(--bg);' +
        'font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0.05em;' +
        'border-top:2px solid var(--border);text-transform:uppercase">' +
        'Retired plots</td></tr>';
      retiredHeaderInserted = true;
    }
    var locName    = p.locations ? p.locations.name : '—';
    var isInactive = p.status === 'inactive';
    var activeCrops = landCrops.filter(function(c) {
      return c.field_plot_id === p.id && c.status === 'growing';
    });
    var latestTest = landTests
      .filter(function(t) { return t.field_plot_id === p.id; })
      .sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); })[0];
    var ecVal = latestTest && latestTest.ec_ms_cm != null
      ? parseFloat(latestTest.ec_ms_cm).toFixed(2)
      : '—';
    var ecStyle = latestTest && latestTest.ec_ms_cm != null
      ? (latestTest.ec_ms_cm > 4 ? 'color:var(--red)' : latestTest.ec_ms_cm > 2 ? 'color:var(--amber)' : 'color:var(--green)')
      : '';

    html += '<tr style="' + (isInactive ? 'opacity:0.45' : '') + '">';
    html += '<td class="mono" style="font-size:12px;font-weight:500">' + (p.plot_code || '—') + '</td>';
    html += '<td style="font-weight:500"><input type="text" value="' + (p.plot_name || '').replace(/"/g, '&quot;') +
      '" style="width:100%;min-width:120px" placeholder="—" onchange="patchLandPlot(' + p.id + ',\'plot_name\',this.value||null)"></td>';
    html += '<td class="muted-cell" style="font-size:12px">' + locName + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (PLOT_TYPE_LABELS[p.plot_type] || p.plot_type || '—') + '</td>';
    html += '<td class="mono right" style="white-space:nowrap">' + acresKanals(p.area_acres) + '</td>';
    html += '<td><select onchange="patchLandPlot(' + p.id + ',\'use_case\',this.value||null)">' +
      ['','agricultural','fodder','fallow','pasture','rehabilitation','access','infrastructure','other'].map(function(u) {
        return '<option value="' + u + '"' + (p.use_case === u ? ' selected' : '') + '>' + (u ? u : '—') + '</option>';
      }).join('') + '</select></td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (IRR_LABELS[p.irrigation_method] || p.irrigation_method || '—') + '</td>';
    html += '<td>' + (isInactive
      ? '<span class="badge badge-gray">Inactive</span>'
      : '<span class="badge badge-green">Active</span>') + '</td>';
    html += '<td class="mono" style="' + ecStyle + '">' + ecVal + '</td>';
    html += '<td style="max-width:180px">' +
      (activeCrops.length
        ? activeCrops.map(function(c) {
            var cName = c.crop_id
              ? (landCropRegistry.find(function(r) { return r.id === c.crop_id; }) || {}).name || c.crop_name
              : c.crop_name;
            return '<span class="badge badge-lime" style="margin:1px">' + (cName || '?') + '</span>';
          }).join('')
        : '<span class="muted-cell" style="font-size:12px">—</span>') + '</td>';
    html += '<td><input type="text" value="' + (p.notes || '').replace(/"/g, '&quot;') +
      '" style="width:100%;min-width:120px" placeholder="—" onchange="patchLandPlot(' + p.id + ',\'notes\',this.value||null)"></td>';
    html += '<td>' + (!isInactive
      ? '<button class="btn btn-sm" style="font-size:11px;color:var(--muted)" onclick="retireLandPlot(' + p.id + ')">Retire</button>'
      : '') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function patchLandPlot(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('field_plots', id, d);
    var p = landPlots.find(function(x) { return x.id === id; });
    if (p) p[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    await loadLandPage();
  }
}

async function retireLandPlot(id) {
  if (!confirm('Mark this plot as inactive? This can be reversed manually in the database.')) return;
  try {
    await sbPatch('field_plots', id, { status: 'inactive', date_retired: todayISO() });
    await loadLandPage();
  } catch (err) { alert('Error: ' + err.message); }
}

async function submitLandPlot() {
  var statusEl = document.getElementById('lp-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var code     = (document.getElementById('lp-code').value || '').trim();
    var name     = (document.getElementById('lp-name').value || '').trim();
    var locId    = document.getElementById('lp-loc').value;
    var ptype    = document.getElementById('lp-type').value;
    var area     = document.getElementById('lp-area').value;
    var aunit    = document.getElementById('lp-aunit').value;
    var useCase  = document.getElementById('lp-use').value;
    var irr      = document.getElementById('lp-irr').value;
    var desc     = (document.getElementById('lp-desc').value || '').trim();
    var notes    = (document.getElementById('lp-notes').value || '').trim();
    if (!locId) throw new Error('Location is required.');
    var d = { location_id: parseInt(locId), status: 'active' };
    if (code)    d.plot_code         = code;
    if (name)    d.plot_name         = name;
    if (ptype)   d.plot_type         = ptype;
    if (area)    d.area_acres        = aunit === 'kanals'
                                       ? parseFloat(area) * 0.125
                                       : parseFloat(area);
    if (aunit)   d.area_unit         = aunit;
    if (useCase) d.use_case          = useCase;
    if (irr)     d.irrigation_method = irr;
    if (desc)    d.description       = desc;
    if (notes)   d.notes             = notes;
    await sbInsert('field_plots', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-plot-form').style.display = 'none';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}


// ============================================================
// TAB 2: FERTILIZER INVENTORY
// ============================================================
function renderLandFert() {
  document.getElementById('land-fert-meta').textContent =
    landFerts.length + ' fertilizer' + (landFerts.length !== 1 ? 's' : '') +
    ' · manage in Setup → Fertilizers';
  var tbl = document.getElementById('land-fert-table');
  if (!landFerts.length) {
    tbl.innerHTML = '<div class="empty">No fertilizers in registry. Add via Setup → Fertilizers.</div>';
    return;
  }
  var stockByFert = {};
  landFerts.forEach(function(f) {
    stockByFert[f.id] = { purchased: 0, applied: 0, latestPrice: null, latestPriceDate: null };
  });
  landFertPurchases.forEach(function(pp) {
    if (!stockByFert[pp.fertilizer_id]) return;
    stockByFert[pp.fertilizer_id].purchased += parseFloat(pp.qty) || 0;
    if (pp.cost_per_unit != null) {
      var s = stockByFert[pp.fertilizer_id];
      if (!s.latestPriceDate || pp.date > s.latestPriceDate) {
        s.latestPrice = parseFloat(pp.cost_per_unit);
        s.latestPriceDate = pp.date;
      }
    }
  });
  landGypsum.forEach(function(g) {
    if (g.fertilizer_id && stockByFert[g.fertilizer_id])
      stockByFert[g.fertilizer_id].applied += parseFloat(g.kg_applied) || 0;
  });
  landAmendments.forEach(function(a) {
    if (a.fertilizer_id && stockByFert[a.fertilizer_id])
      stockByFert[a.fertilizer_id].applied += parseFloat(a.kg_applied) || 0;
  });
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Fertilizer</th><th>Type</th><th>Unit</th><th>EC / Salt impact</th>' +
    '<th class="right">Purchased</th><th class="right">Applied</th>' +
    '<th class="right">Stock</th><th class="right">Latest price</th>' +
    '</tr></thead><tbody>';
  landFerts.forEach(function(f) {
    var st    = stockByFert[f.id];
    var stock = st.purchased - st.applied;
    var cls   = stock <= 0 ? 'inv-stock-zero' : (stock < 50 ? 'inv-stock-low' : 'inv-stock-pos');
    html += '<tr style="' + (!f.active ? 'opacity:0.5' : '') + '">' +
      '<td style="font-weight:500">' + f.name + '</td>' +
      '<td class="muted-cell">' + (f.type || '—') + '</td>' +
      '<td class="muted-cell">' + f.unit + '</td>' +
      '<td class="muted-cell" style="font-size:11px;max-width:160px">' + (f.ec_impact || '—') + '</td>' +
      '<td class="mono right">' + r1(st.purchased) + ' ' + f.unit + '</td>' +
      '<td class="mono right">' + r1(st.applied)   + ' ' + f.unit + '</td>' +
      '<td class="mono right ' + cls + '">' + r1(stock) + ' ' + f.unit + '</td>' +
      '<td class="mono right">' + (st.latestPrice != null ? pkr(st.latestPrice) + ' / ' + f.unit : '—') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function renderLandFertChart() {
  var canvas = document.getElementById('land-fert-price-chart');
  if (!canvas) return;
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  landFertChart = null;
  var byFert = {};
  landFertPurchases.forEach(function(pp) {
    if (pp.cost_per_unit == null) return;
    if (!byFert[pp.fertilizer_id]) byFert[pp.fertilizer_id] = [];
    byFert[pp.fertilizer_id].push({ x: pp.date, y: parseFloat(pp.cost_per_unit) });
  });
  Object.keys(byFert).forEach(function(id) {
    byFert[id].sort(function(a, b) { return a.x.localeCompare(b.x); });
  });
  var datasets = []; var idx = 0;
  landFerts.forEach(function(f) {
    var pts = byFert[f.id];
    if (!pts || !pts.length) return;
    datasets.push({
      label: f.name + ' (PKR / ' + f.unit + ')',
      data: pts,
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
      tension: 0.2, pointRadius: 3, borderWidth: 2
    });
    idx++;
  });
  if (!datasets.length) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  landFertChart = new Chart(canvas, {
    type: 'line', data: { datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: {
          title: function(items) { return fmtDate(items[0].parsed.x); },
          label: function(c) { return c.dataset.label + ': PKR ' + Math.round(c.parsed.y); }
        }}
      },
      scales: {
        x: { type: 'time', time: { unit: 'month' }, ticks: { font: { size: 10 } }, grid: { color: '#E8E4DA' } },
        y: { ticks: { font: { size: 10 }, callback: function(v) { return 'PKR ' + Math.round(v); } }, grid: { color: '#E8E4DA' } }
      }
    }
  });
}


// ============================================================
// TAB 3: APPLICATION LOG
// ============================================================
function toggleLandAppForm() {
  var f = document.getElementById('land-app-form');
  f.style.display = f.style.display === 'block' ? 'none' : 'block';
  if (f.style.display === 'block') checkFoliarWarning();
}

function checkFoliarWarning() {
  var method = (document.getElementById('la-method') || {}).value || '';
  var wsrc   = (document.getElementById('la-wsrc')   || {}).value || '';
  var warn   = document.getElementById('la-foliar-warn');
  if (!warn) return;
  warn.style.display = (method === 'foliar_spray' && wsrc === 'tubewell') ? 'block' : 'none';
}

function renderLandAppLog() {
  var plotF = (document.getElementById('land-app-plot-filter') || {}).value || '';
  var typeF = (document.getElementById('land-app-type-filter') || {}).value || '';
  var combined = [];
  landGypsum.forEach(function(r) {
    if (plotF && String(r.field_plot_id) !== plotF) return;
    if (typeF && typeF !== 'gypsum') return;
    combined.push({
      src: 'gypsum_applications', id: r.id, date: r.date,
      plot: plotName(r.field_plot_id), type: 'gypsum',
      kg: r.kg_applied, method: r.method, wsrc: r.water_source,
      fertilizer_id: r.fertilizer_id,
      worker: r.workers ? r.workers.name : null, notes: r.notes
    });
  });
  landAmendments.forEach(function(r) {
    if (plotF && String(r.field_plot_id) !== plotF) return;
    if (typeF && typeF !== 'gypsum' && r.amendment_type !== typeF) return;
    if (typeF === 'gypsum') return;
    combined.push({
      src: 'amendment_applications', id: r.id, date: r.date,
      plot: plotName(r.field_plot_id), type: r.amendment_type,
      kg: r.kg_applied, method: r.method, wsrc: r.water_source,
      fertilizer_id: r.fertilizer_id,
      worker: r.workers ? r.workers.name : null, notes: r.notes
    });
  });
  combined.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  document.getElementById('land-app-count').textContent =
    combined.length + ' record' + (combined.length !== 1 ? 's' : '');
  var tbl = document.getElementById('land-app-table');
  if (!combined.length) { tbl.innerHTML = '<div class="empty">No applications logged yet.</div>'; return; }
  var totalKg = combined.reduce(function(s, r) { return s + (parseFloat(r.kg) || 0); }, 0);
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Plot</th><th>Type</th><th>Method</th><th>Water source</th>' +
    '<th class="right">kg</th><th>Fertilizer</th><th>Worker</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  combined.forEach(function(r) {
    var fert = r.fertilizer_id ? landFerts.find(function(f) { return f.id === r.fertilizer_id; }) : null;
    var wsrcWarn = r.method === 'foliar_spray' && r.wsrc === 'tubewell';
    html += '<tr>';
    html += '<td class="mono">' + fmtDate(r.date) + '</td>';
    html += '<td style="font-weight:500">' + r.plot + '</td>';
    html += '<td><span class="badge ' + (AMEND_BADGE[r.type] || 'badge-gray') + '">' + (AMEND_LABELS[r.type] || r.type) + '</span></td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (r.method || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' +
      (wsrcWarn ? '<span style="color:var(--red)">⚠ ' + (r.wsrc || '—') + '</span>' : (r.wsrc || '—')) + '</td>';
    html += '<td class="mono right">' + (r.kg != null ? Math.round(r.kg).toLocaleString() + ' kg' : '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (fert ? fert.name : '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (r.worker || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (r.notes || '') + '</td>';
    html += '</tr>';
  });
  html += '<tr style="background:var(--bg)"><td colspan="5" style="font-weight:500;padding:10px 18px">Total applied</td>' +
    '<td class="mono right" style="font-weight:500">' + Math.round(totalKg).toLocaleString() + ' kg</td>' +
    '<td colspan="3"></td></tr>';
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function submitLandApp() {
  var statusEl = document.getElementById('la-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('la-date').value;
    var plotId = document.getElementById('la-plot').value;
    var type   = document.getElementById('la-type').value;
    var method = document.getElementById('la-method').value;
    var wsrc   = document.getElementById('la-wsrc').value;
    var fertId = document.getElementById('la-fert').value;
    var kg     = parseFloat(document.getElementById('la-kg').value);
    var source = (document.getElementById('la-source').value || '').trim();
    var worker = document.getElementById('la-worker').value;
    var notes  = (document.getElementById('la-notes').value || '').trim();
    if (!date || !plotId || isNaN(kg) || kg <= 0) throw new Error('Date, plot, and kg are required.');
    var d = { date: date, field_plot_id: parseInt(plotId), kg_applied: kg };
    if (method) d.method       = method;
    if (wsrc)   d.water_source = wsrc;
    if (fertId) d.fertilizer_id = parseInt(fertId);
    if (worker) d.recorded_by  = parseInt(worker);
    if (notes)  d.notes        = notes;
    if (type === 'gypsum') {
      await sbInsert('gypsum_applications', d);
    } else {
      d.amendment_type = type;
      if (source) d.source = source;
      await sbInsert('amendment_applications', d);
    }
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-app-form').style.display = 'none';
    ['la-kg','la-source','la-notes'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}


// ============================================================
// TAB 4: SOIL TESTS
// ============================================================
function switchSoilTestType(type) {
  document.getElementById('lt-field-fields').style.display = type === 'field' ? 'block' : 'none';
  document.getElementById('lt-lab-fields').style.display   = type === 'lab'   ? 'block' : 'none';
  document.getElementById('lt-type-val').value = type;
  document.querySelectorAll('#land-test-form .lt-type-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-type') === type);
  });
}

function toggleLandTestForm() {
  var f = document.getElementById('land-test-form');
  f.style.display = f.style.display === 'block' ? 'none' : 'block';
}

// Build per-plot baseline lookup from is_baseline=true records
function buildBaseline() {
  var bl = {};
  landTests.forEach(function(t) {
    if (!t.is_baseline) return;
    var pid = t.field_plot_id;
    if (!bl[pid]) bl[pid] = t;
  });
  return bl;
}

function deltaStr(curr, base, key, higherIsBetter) {
  if (curr[key] == null || !base || base[key] == null) return '';
  var d = parseFloat(curr[key]) - parseFloat(base[key]);
  if (Math.abs(d) < 0.0005) return '';
  var isGood = (d > 0) === higherIsBetter;
  return ' <span style="font-size:10px;color:' + (isGood ? 'var(--green)' : 'var(--red)') + '">' +
    (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(2) + '</span>';
}

function renderLandTests() {
  var plotF  = (document.getElementById('land-test-plot-filter') || {}).value || '';
  var rows   = landTests.filter(function(r) { return !plotF || String(r.field_plot_id) === plotF; });
  rows.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  document.getElementById('land-test-count').textContent =
    rows.length + ' test' + (rows.length !== 1 ? 's' : '') +
    (rows.some(function(r) { return r.is_baseline; }) ? ' (baseline flagged)' : '');
  var tbl = document.getElementById('land-test-table');
  if (!rows.length) { tbl.innerHTML = '<div class="empty">No soil tests logged yet.</div>'; return; }

  var baseline = buildBaseline();
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Plot</th><th>Type</th><th class="right">EC (mS/cm)</th>' +
    '<th class="right">pH</th><th class="right">OM (%)</th><th class="right">SAR</th>' +
    '<th class="right">RSC</th><th class="right">ESP</th>' +
    '<th class="right">P (mg/kg)</th><th class="right">K (mg/kg)</th>' +
    '<th>Depth</th><th>Lab</th><th>Notes</th>' +
    '</tr></thead><tbody>';

  rows.forEach(function(r) {
    var bl    = baseline[r.field_plot_id];
    var dDate = r.sample_date || r.date;
    var ecStyle = r.ec_ms_cm != null ? (r.ec_ms_cm > 4 ? 'color:var(--red)' : r.ec_ms_cm > 2 ? 'color:var(--amber)' : 'color:var(--green)') : '';
    var sarStyle = r.sar != null ? (r.sar > 12 ? 'color:var(--red)' : r.sar > 6 ? 'color:var(--amber)' : 'color:var(--green)') : '';
    html += '<tr' + (r.is_baseline ? ' style="background:var(--green-lt)"' : '') + '>';
    html += '<td class="mono">' + fmtDate(dDate) + (r.is_baseline ? ' <span class="badge badge-green" style="font-size:10px">Baseline</span>' : '') + '</td>';
    html += '<td style="font-weight:500">' + plotName(r.field_plot_id) + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.test_type || 'lab') + '</td>';
    html += '<td class="mono right" style="' + ecStyle + '">' + (r.ec_ms_cm != null ? parseFloat(r.ec_ms_cm).toFixed(2) + deltaStr(r, bl, 'ec_ms_cm', false) : '—') + '</td>';
    html += '<td class="mono right">' + (r.ph != null ? parseFloat(r.ph).toFixed(2) + deltaStr(r, bl, 'ph', false) : '—') + '</td>';
    html += '<td class="mono right">' + (r.organic_matter_pct != null ? parseFloat(r.organic_matter_pct).toFixed(3) + deltaStr(r, bl, 'organic_matter_pct', true) : '—') + '</td>';
    html += '<td class="mono right" style="' + sarStyle + '">' + (r.sar != null ? parseFloat(r.sar).toFixed(2) + deltaStr(r, bl, 'sar', false) : '—') + '</td>';
    html += '<td class="mono right">' + (r.rsc != null ? parseFloat(r.rsc).toFixed(2) : '—') + '</td>';
    html += '<td class="mono right">' + (r.esp != null ? parseFloat(r.esp).toFixed(1) + '%' : '—') + '</td>';
    html += '<td class="mono right">' + (r.available_phosphorus_mg_kg != null ? parseFloat(r.available_phosphorus_mg_kg).toFixed(1) : '—') + '</td>';
    html += '<td class="mono right">' + (r.potassium_mg_kg != null ? parseFloat(r.potassium_mg_kg).toFixed(0) : '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.sample_depth || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.lab_name || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.notes || '') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

function renderLandTrendChart() {
  var canvas = document.getElementById('land-trend-chart');
  if (!canvas) return;
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  landTrendChart = null;
  var metric = (document.getElementById('land-trend-metric') || {}).value || 'ec_ms_cm';
  var plotF  = (document.getElementById('land-test-plot-filter') || {}).value || '';
  var byPlot = {};
  landTests.forEach(function(t) {
    if (t[metric] == null) return;
    if (plotF && String(t.field_plot_id) !== plotF) return;
    if (!byPlot[t.field_plot_id]) byPlot[t.field_plot_id] = [];
    var d = t.sample_date || t.date;
    byPlot[t.field_plot_id].push({ x: d, y: parseFloat(t[metric]) });
  });
  Object.keys(byPlot).forEach(function(pid) {
    byPlot[pid].sort(function(a, b) { return a.x.localeCompare(b.x); });
  });
  var datasets = []; var idx = 0;
  Object.keys(byPlot).forEach(function(pid) {
    if (!byPlot[pid].length) return;
    datasets.push({
      label: plotName(parseInt(pid)),
      data: byPlot[pid],
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
      tension: 0.2, pointRadius: 4, borderWidth: 2
    });
    idx++;
  });
  if (!datasets.length) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  var label = ({ ec_ms_cm:'EC (mS/cm)', ph:'pH', organic_matter_pct:'OM (%)', sar:'SAR',
                 rsc:'RSC (meq/L)', available_phosphorus_mg_kg:'P (mg/kg)' })[metric] || metric;
  landTrendChart = new Chart(canvas, {
    type: 'line', data: { datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: {
          title: function(items) { return fmtDate(items[0].parsed.x); },
          label: function(c) { return c.dataset.label + ': ' + r2(c.parsed.y); }
        }}
      },
      scales: {
        x: { type: 'time', time: { unit: 'month' }, ticks: { font: { size: 10 } }, grid: { color: '#E8E4DA' } },
        y: { title: { display: true, text: label, font: { size: 11 }, color: 'var(--muted)' },
             ticks: { font: { size: 10 } }, grid: { color: '#E8E4DA' } }
      }
    }
  });
}

async function submitLandTest() {
  var statusEl = document.getElementById('lt-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var type     = (document.getElementById('lt-type-val').value || 'lab');
    var plotId   = document.getElementById('lt-plot').value;
    var isBase   = document.getElementById('lt-baseline').checked;
    if (!plotId) throw new Error('Plot is required.');

    var d = {
      field_plot_id: parseInt(plotId),
      test_type:     type,
      is_baseline:   isBase
    };
    // Shared fields
    var ec = document.getElementById('lt-ec').value;
    var ph = document.getElementById('lt-ph').value;
    var om = document.getElementById('lt-om').value;
    var sar = document.getElementById('lt-sar').value;
    if (ec)  d.ec_ms_cm             = parseFloat(ec);
    if (ph)  d.ph                   = parseFloat(ph);
    if (om)  d.organic_matter_pct   = parseFloat(om);
    if (sar) d.sar                  = parseFloat(sar);

    if (type === 'field') {
      var fdate = document.getElementById('lt-date').value;
      if (!fdate) throw new Error('Date is required.');
      d.date = fdate;
      var fnotes = (document.getElementById('lt-fnotes').value || '').trim();
      if (fnotes) d.notes = fnotes;
      if (!ec && !ph && !om && !sar) throw new Error('Enter at least one measurement.');
    } else {
      // Lab test
      var sdate = document.getElementById('lt-sample-date').value;
      var rdate = document.getElementById('lt-report-date').value;
      if (!sdate) throw new Error('Sample date is required.');
      d.date        = sdate;  // use sample_date as primary date for compat
      d.sample_date = sdate;
      if (rdate) d.report_date = rdate;
      var depth   = document.getElementById('lt-depth').value;
      var lab     = (document.getElementById('lt-lab').value || '').trim();
      var rsc     = document.getElementById('lt-rsc').value;
      var esp     = document.getElementById('lt-esp').value;
      var phos    = document.getElementById('lt-phos').value;
      var pot     = document.getElementById('lt-pot').value;
      var ca      = document.getElementById('lt-ca').value;
      var mg      = document.getElementById('lt-mg').value;
      var tex     = document.getElementById('lt-texture').value;
      var lnotes  = (document.getElementById('lt-lnotes').value || '').trim();
      if (depth) d.sample_depth              = depth;
      if (lab)   d.lab_name                  = lab;
      if (rsc)   d.rsc                       = parseFloat(rsc);
      if (esp)   d.esp                       = parseFloat(esp);
      if (phos)  d.available_phosphorus_mg_kg = parseFloat(phos);
      if (pot)   d.potassium_mg_kg           = parseFloat(pot);
      if (ca)    d.calcium_mg_kg             = parseFloat(ca);
      if (mg)    d.magnesium_mg_kg           = parseFloat(mg);
      if (tex)   d.texture_class             = tex;
      if (lnotes) d.notes                   = lnotes;
    }
    await sbInsert('soil_tests', d);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-test-form').style.display = 'none';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}


// ============================================================
// TAB 5: CROP TRACKING
// ============================================================
function toggleLandCropForm() {
  var f = document.getElementById('land-crop-form');
  var open = f.style.display === 'block';
  f.style.display = open ? 'none' : 'block';
  if (!open) {
    // Reset location/plot cascade
    var locEl = document.getElementById('lc-location');
    if (locEl) locEl.value = '';
    var plotEl = document.getElementById('lc-plot');
    if (plotEl) plotEl.innerHTML = '<option value="">Select location first</option>';
    // Reset group mode to new
    var newRadio = document.querySelector('input[name="lc-group-mode"][value="new"]');
    if (newRadio) { newRadio.checked = true; }
    toggleGroupMode();
    // Reset group fields
    var gnEl = document.getElementById('lc-group-name');   if (gnEl) gnEl.value = '';
    var gsEl = document.getElementById('lc-group-select'); if (gsEl) gsEl.innerHTML = '<option value="">Select plot first</option>';
    var htEl = document.getElementById('lc-harvest-type'); if (htEl) htEl.value = '';
    var isEl = document.getElementById('lc-is-stand');     if (isEl) isEl.checked = false;
    var ingEl = document.getElementById('lc-ingredient');  if (ingEl) ingEl.value = '';
    toggleCropEndDate();
    // Reset crop fields
    var sowEl = document.getElementById('lc-sow'); if (sowEl) sowEl.value = todayISO();
    ['lc-notes','lc-end'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var stEl = document.getElementById('lc-status'); if (stEl) stEl.textContent = '';
  }
}

function toggleGroupMode() {
  var mode = (document.querySelector('input[name="lc-group-mode"]:checked') || {}).value || 'new';
  var nf = document.getElementById('lc-new-group-fields');
  var ef = document.getElementById('lc-existing-group-fields');
  if (nf) nf.style.display = mode === 'new'      ? '' : 'none';
  if (ef) ef.style.display = mode === 'existing' ? '' : 'none';
}

function filterCropPlotsByLocation() {
  var locId  = (document.getElementById('lc-location') || {}).value || '';
  var plotEl = document.getElementById('lc-plot');
  if (!plotEl) return;
  if (!locId) {
    plotEl.innerHTML = '<option value="">Select location first</option>';
    return;
  }
  var filtered = landPlots.filter(function(p) {
    return p.status !== 'inactive' && String(p.location_id) === locId;
  });
  if (!filtered.length) {
    plotEl.innerHTML = '<option value="">No plots in this location</option>';
    return;
  }
  plotEl.innerHTML = '<option value="">Select plot</option>' +
    filtered.map(function(p) {
      return '<option value="' + p.id + '">' + plotDisplayName(p) + '</option>';
    }).join('');
  filterGroupsByPlot();
}

function filterGroupsByPlot() {
  var plotId = (document.getElementById('lc-plot') || {}).value || '';
  var sel = document.getElementById('lc-group-select');
  if (!sel) return;
  if (!plotId) {
    sel.innerHTML = '<option value="">Select plot first</option>';
    return;
  }
  var groups = landCropGroups.filter(function(g) { return String(g.field_plot_id) === plotId; });
  if (!groups.length) {
    sel.innerHTML = '<option value="">No groups on this plot yet</option>';
    return;
  }
  sel.innerHTML = '<option value="">Select group</option>' +
    groups.map(function(g) {
      var members = landCrops.filter(function(c) { return c.crop_group_id === g.id; })
        .map(getCropDisplayName).join(', ');
      return '<option value="' + g.id + '">' + g.name + (members ? ' (' + members + ')' : '') + '</option>';
    }).join('');
}

function suggestGroupName() {
  var nameEl = document.getElementById('lc-group-name');
  if (!nameEl || nameEl.value) return;
  var cropId = (document.getElementById('lc-crop') || {}).value;
  var reg    = cropId ? landCropRegistry.find(function(c) { return String(c.id) === cropId; }) : null;
  var sow    = (document.getElementById('lc-sow') || {}).value || '';
  nameEl.placeholder = (reg ? reg.name : 'Group') + (sow ? ' (' + sow.slice(0, 7) + ')' : '');
}

function toggleCropEndDate() {
  var ht   = (document.getElementById('lc-harvest-type') || {}).value || '';
  var wrap = document.getElementById('lc-end-wrap');
  if (!wrap) return;
  wrap.style.display = ht === 'permanent' ? 'none' : '';
  if (ht === 'permanent') {
    var endEl = document.getElementById('lc-end');
    if (endEl) endEl.value = '';
  }
}

function getCropDisplayName(cropRecord) {
  if (cropRecord.crop_id) {
    var reg = landCropRegistry.find(function(c) { return c.id === cropRecord.crop_id; });
    if (reg) return reg.name + (reg.local_name ? ' (' + reg.local_name + ')' : '');
  }
  return cropRecord.crop_name || '?';
}

function getCropFeedingNotes(cropRecord) {
  if (!cropRecord.crop_id) return null;
  var reg = landCropRegistry.find(function(c) { return c.id === cropRecord.crop_id; });
  return reg ? reg.feeding_notes : null;
}

// ---- Render helpers ----

function buildObsPanel(c, observations) {
  var html = '<div id="crop-obs-' + c.id + '" style="display:none;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  if (!observations.length) {
    html += '<div class="muted-cell" style="font-size:12px">No observations logged yet.</div>';
  } else {
    html += '<table style="width:100%;font-size:12px"><thead><tr>' +
      '<th>Date</th><th>Health</th><th>Flag</th><th>Note</th><th>Worker</th><th></th>' +
      '</tr></thead><tbody>';
    observations.slice(0, 10).forEach(function(o) {
      var oid = o.id;
      html += '<tr>' +
        '<td class="mono" style="white-space:nowrap">' + fmtDate((o.observed_at || '').slice(0, 10)) + '</td>' +
        '<td><select id="oe-health-' + oid + '" style="font-size:11px;width:100%">' +
          ['unknown','good','stressed','failing'].map(function(v) {
            return '<option value="' + v + '"' + (o.health_status === v ? ' selected' : '') + '>' + v + '</option>';
          }).join('') + '</select></td>' +
        '<td><select id="oe-flag-' + oid + '" style="font-size:11px;width:100%">' +
          '<option value="false"' + (!o.pest_disease_flag ? ' selected' : '') + '>No</option>' +
          '<option value="true"'  + ( o.pest_disease_flag ? ' selected' : '') + '>Yes ⚠</option>' +
        '</select></td>' +
        '<td><input type="text" id="oe-note-' + oid + '" value="' + (o.note || '').replace(/"/g,'&quot;') + '" style="font-size:11px;width:100%;min-width:160px"></td>' +
        '<td class="muted-cell" style="white-space:nowrap">' + (o.workers ? o.workers.name : '—') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm" style="font-size:11px" onclick="patchObservation(' + oid + ',' + c.id + ')">Save</button>' +
          '<button class="btn btn-sm" style="font-size:11px;color:var(--red);margin-left:4px" onclick="deleteObservation(' + oid + ',' + c.id + ')">Delete</button>' +
          '<span id="oe-status-' + oid + '" style="font-size:10px;color:var(--muted);margin-left:4px"></span>' +
        '</td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  return html;
}

function buildObsForm(c, workers) {
  var html = '<div id="obs-form-' + c.id + '" style="display:none;padding:14px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  html += '<div style="font-size:12px;font-weight:500;margin-bottom:8px">Log observation — ' + getCropDisplayName(c) + '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">';
  html += '<div><label style="font-size:11px;color:var(--muted)">Health status</label><select id="of-health-' + c.id + '" style="width:100%">' +
    ['unknown','good','stressed','failing'].map(function(v) { return '<option value="' + v + '">' + v + '</option>'; }).join('') + '</select></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Pest / disease flag</label><select id="of-flag-' + c.id + '" style="width:100%"><option value="false">No</option><option value="true">Yes ⚠</option></select></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Worker</label><select id="of-worker-' + c.id + '" style="width:100%">' +
    '<option value="">—</option>' +
    workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
    '</select></div>';
  html += '</div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Note</label><input type="text" id="of-note-' + c.id + '" style="width:100%" placeholder="observations, growth stage, issues…"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px">';
  html += '<button class="btn btn-primary btn-sm" onclick="submitObservation(' + c.id + ')">Save observation</button>';
  html += '<button class="btn btn-sm" onclick="document.getElementById(\'obs-form-' + c.id + '\').style.display=\'none\'">Cancel</button>';
  html += '<span id="of-status-' + c.id + '" style="font-size:12px;color:var(--muted);align-self:center"></span>';
  html += '</div></div>';
  return html;
}

function buildGroupHarvestForm(g, feedNotes, workers) {
  var gid = g.id;
  var fnStr = feedNotes.join('; ');
  var html = '<div id="harvest-form-g' + gid + '" style="display:none;padding:14px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  html += '<div style="font-size:12px;font-weight:500;margin-bottom:8px">Log harvest</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr) 1fr;gap:8px;margin-bottom:8px">';
  html += '<div><label style="font-size:11px;color:var(--muted)">Date</label><input type="date" id="hf-date-g' + gid + '" value="' + todayISO() + '" style="width:100%"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Quantity (kg)</label><input type="number" id="hf-kg-g' + gid + '" min="0" step="0.5" style="width:100%" placeholder="kg"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Destination</label><select id="hf-dest-g' + gid + '" style="width:100%" onchange="checkGroupFodderWarn(' + gid + ')">' +
    ['','goat_fodder','compost','bsf_feedstock','sale','soil_incorporation','other'].map(function(d) {
      return '<option value="' + d + '">' + (d || '— select —') + '</option>';
    }).join('') + '</select></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Worker</label><select id="hf-worker-g' + gid + '" style="width:100%">' +
    '<option value="">—</option>' +
    workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
    '</select></div>';
  html += '</div>';
  if (fnStr) {
    html += '<div id="fodder-warn-g' + gid + '" style="display:none;margin-bottom:8px;padding:8px 10px;' +
      'background:var(--amber-lt);border:1px solid var(--amber-bdr);border-radius:6px;font-size:12px;color:var(--amber)">⚠ ' + fnStr + '</div>';
  }
  html += '<div><label style="font-size:11px;color:var(--muted)">Quality notes</label><input type="text" id="hf-qual-g' + gid + '" style="width:100%" placeholder="optional"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px">';
  html += '<button class="btn btn-primary btn-sm" onclick="submitHarvestEvent(' + gid + ')">Save harvest</button>';
  html += '<button class="btn btn-sm" onclick="document.getElementById(\'harvest-form-g' + gid + '\').style.display=\'none\'">Cancel</button>';
  html += '<span id="hf-status-g' + gid + '" style="font-size:12px;color:var(--muted);align-self:center"></span>';
  html += '</div></div>';
  return html;
}

function renderLandCrops() {
  var activeOnly = !(document.getElementById('lc-show-all') || {}).checked;
  var plotF      = (document.getElementById('lc-plot-filter') || {}).value || '';
  var workers    = (typeof anSharedWorkers !== 'undefined' && anSharedWorkers.length) ? anSharedWorkers : landWorkers;

  var groups = landCropGroups.filter(function(g) {
    if (plotF && String(g.field_plot_id) !== plotF) return false;
    if (activeOnly) {
      var members = landCrops.filter(function(c) { return c.crop_group_id === g.id; });
      var anyActive = members.some(function(c) { return c.status !== 'terminated' && c.status !== 'failed'; });
      if (!anyActive) return false;
    }
    return true;
  });

  var activeGroupCount = landCropGroups.filter(function(g) {
    return landCrops.some(function(c) { return c.crop_group_id === g.id && c.status === 'growing'; });
  }).length;
  document.getElementById('land-crop-count').textContent =
    activeGroupCount + ' active · ' + landCropGroups.length + ' total groups';

  var tbl = document.getElementById('land-crop-table');
  if (!groups.length) { tbl.innerHTML = '<div class="empty">No crop records match current filter.</div>'; return; }

  var html = '';

  groups.forEach(function(g) {
    var members    = landCrops.filter(function(c) { return c.crop_group_id === g.id; });
    var harvests   = landHarvests.filter(function(h) { return h.crop_group_id === g.id; });
    var totalKg    = harvests.reduce(function(s, h) { return s + (parseFloat(h.quantity_kg) || 0); }, 0);
    var anyGrowing = members.some(function(c) { return c.status === 'growing'; });
    var allDone    = members.length > 0 && members.every(function(c) { return c.status === 'terminated' || c.status === 'failed'; });
    var groupStatus = anyGrowing ? 'growing' : (allDone ? 'terminated' : 'unknown');
    var isMulti    = members.length > 1;
    var feedNotes  = members.map(getCropFeedingNotes).filter(Boolean);
    var fnStr      = feedNotes.join('; ');

    html += '<div class="crop-card">';

    // ── HEADER ──
    html += '<div class="crop-card-hdr">';
    html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    if (isMulti) {
      html += '<span style="font-weight:500">' + (g.name || 'Unnamed group') + '</span>';
      if (g.is_stand) html += '<span class="badge badge-teal" style="font-size:10px">Stand</span>';
    } else if (members.length === 1) {
      html += '<span style="font-weight:500">' + getCropDisplayName(members[0]) + '</span>';
    } else {
      html += '<span style="font-weight:500;color:var(--muted)">' + (g.name || 'Empty group') + '</span>';
    }
    html += '<span class="badge ' + (CROP_STATUS_BADGE[groupStatus] || 'badge-gray') + '">' + groupStatus + '</span>';
    if (g.harvest_type) html += '<span class="badge ' + (HARVEST_TYPE_BADGE[g.harvest_type] || 'badge-gray') + '" style="font-size:10px">' + (HARVEST_TYPE_LABELS[g.harvest_type] || g.harvest_type) + '</span>';
    if (!isMulti && members.length === 1) {
      var m0 = members[0];
      if (m0.role) html += '<span class="badge badge-gray" style="font-size:10px">' + (CROP_ROLE_LABELS[m0.role] || m0.role) + '</span>';
      if (m0.health_status) html += '<span class="badge ' + (HEALTH_BADGE[m0.health_status] || 'badge-gray') + '" style="font-size:10px">' + m0.health_status + '</span>';
      if (m0.pest_disease_flag) html += '<span style="color:var(--red);font-size:12px">⚠ pest/disease flagged</span>' +
        '<button class="btn btn-sm" style="font-size:11px;color:var(--muted)" onclick="resolvePestFlag(' + m0.id + ')">Mark resolved</button>';
    }
    html += '</div>';
    html += '<div class="muted-cell" style="font-size:12px">' + plotName(g.field_plot_id) + '</div>';
    if (g.ingredients) {
      html += '<div style="font-size:11px;color:var(--muted)">→ ' + g.ingredients.name + '</div>';
    } else {
      html += '<button class="btn btn-sm" style="font-size:10px;color:var(--muted)" onclick="openSetIngredient(' + g.id + ')">Link ingredient</button>';
    }
    html += '</div>';

    // ── SINGLE MEMBER DETAIL ──
    if (!isMulti && members.length === 1) {
      var m0 = members[0];
      html += '<div class="crop-card-detail">';
      html += '<span>Sown: ' + (m0.sow_date ? fmtDate(m0.sow_date) : '—') + '</span>';
      if (m0.expected_termination_date) html += '<span>Expected end: ' + fmtDate(m0.expected_termination_date) + '</span>';
      if (m0.germination_outcome) html += '<span>Germination: ' + m0.germination_outcome + '</span>';
      if (totalKg > 0) html += '<span style="font-weight:500">Total harvested: ' + totalKg.toFixed(1) + ' kg</span>';
      if (m0.notes) html += '<span class="muted-cell">' + m0.notes + '</span>';
      html += '</div>';
      if (fnStr) html += '<div class="crop-feed-warn">⚠ ' + fnStr + '</div>';
    }

    // ── MULTI MEMBER LIST ──
    if (isMulti) {
      html += '<div style="padding:8px 18px 2px;border-top:1px solid var(--border)">';
      if (totalKg > 0) html += '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Total harvested: <strong>' + totalKg.toFixed(1) + ' kg</strong></div>';
      members.forEach(function(c) {
        var cObs    = landObservations.filter(function(o) { return o.plot_crop_id === c.id; });
        var cFeed   = getCropFeedingNotes(c);
        html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid var(--border-lt,#f0ece2)">';
        html += '<span style="font-size:12px;font-weight:500;min-width:120px">' + getCropDisplayName(c) + '</span>';
        if (c.role) html += '<span class="badge badge-gray" style="font-size:10px">' + (CROP_ROLE_LABELS[c.role] || c.role) + '</span>';
        if (c.health_status && c.health_status !== 'unknown') html += '<span class="badge ' + (HEALTH_BADGE[c.health_status] || 'badge-gray') + '" style="font-size:10px">' + c.health_status + '</span>';
        if (c.pest_disease_flag) html += '<span style="color:var(--red);font-size:11px">⚠</span>' +
          '<button class="btn btn-sm" style="font-size:10px;padding:1px 6px;color:var(--muted)" onclick="resolvePestFlag(' + c.id + ')">Resolve</button>';
        if (c.sow_date) html += '<span class="muted-cell" style="font-size:11px">Sown: ' + fmtDate(c.sow_date) + '</span>';
        html += '<div style="flex:1"></div>';
        html += '<button class="btn btn-sm" style="font-size:10px" onclick="toggleCropObs(' + c.id + ')">Obs (' + cObs.length + ')</button>';
        if (c.status === 'growing') {
          html += '<button class="btn btn-sm" style="font-size:10px;margin-left:4px" onclick="openObsForm(' + c.id + ')">+ Obs</button>';
          html += '<button class="btn btn-sm" style="font-size:10px;margin-left:4px;color:var(--muted)" onclick="terminateCrop(' + c.id + ')">End</button>';
        }
        html += '</div>';
        if (cFeed) html += '<div style="font-size:11px;color:var(--amber);padding:2px 0 4px 0">⚠ ' + cFeed + '</div>';
        html += buildObsPanel(c, cObs);
        html += buildObsForm(c, workers);
      });
      html += '</div>';
    }

    // ── ACTIONS BAR ──
    html += '<div class="crop-events-wrap">';
    html += '<button class="btn btn-sm" style="font-size:11px" onclick="toggleGroupHarvests(' + g.id + ')">Harvests (' + harvests.length + ')</button>';
    if (!isMulti && members.length === 1) {
      var mObs = landObservations.filter(function(o) { return o.plot_crop_id === members[0].id; });
      html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="toggleCropObs(' + members[0].id + ')">Observations (' + mObs.length + ')</button>';
    }
    if (anyGrowing) {
      html += '<button class="btn btn-sm btn-primary" style="font-size:11px;margin-left:6px" onclick="openGroupHarvestForm(' + g.id + ')">+ Log harvest</button>';
      if (!isMulti && members.length === 1) {
        html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="openObsForm(' + members[0].id + ')">+ Log observation</button>';
        html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px;color:var(--muted)" onclick="terminateCrop(' + members[0].id + ')">End crop</button>';
      } else if (isMulti) {
        html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px;color:var(--muted)" onclick="terminateGroup(' + g.id + ')">End group</button>';
      }
    }
    html += '</div>';

    // ── HARVEST LIST (group-level) ──
    html += '<div id="group-harvests-' + g.id + '" style="display:none;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)">';
    if (!harvests.length) {
      html += '<div class="muted-cell" style="font-size:12px">No harvests logged yet.</div>';
    } else {
      html += '<table style="width:100%;font-size:12px"><thead><tr>' +
        '<th>Harvest</th><th>Date</th><th class="right">kg</th><th>Destination</th><th>Quality</th><th>Worker</th><th></th>' +
        '</tr></thead><tbody>';
      harvests.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      harvests.forEach(function(h) {
        var hid = h.id;
        var isFodder = (h.destination || '') === 'goat_fodder';
        var fn = isFodder && fnStr ? ' <span style="color:var(--amber);font-size:10px" title="' + fnStr.replace(/"/g,'') + '">⚠</span>' : '';
        html += '<tr>' +
          '<td class="muted-cell">' + (h.cut_number || '—') + '</td>' +
          '<td><input type="date" id="he-date-' + hid + '" value="' + (h.date || '') + '" style="font-size:11px;width:100%"></td>' +
          '<td><input type="number" id="he-kg-' + hid + '" value="' + (h.quantity_kg != null ? parseFloat(h.quantity_kg).toFixed(1) : '') + '" min="0" step="0.5" style="font-size:11px;width:80px" placeholder="kg"></td>' +
          '<td><select id="he-dest-' + hid + '" style="font-size:11px;width:100%">' +
            ['','goat_fodder','compost','bsf_feedstock','sale','soil_incorporation','other'].map(function(d) {
              return '<option value="' + d + '"' + (h.destination === d ? ' selected' : '') + '>' + (d || '— select —') + '</option>';
            }).join('') +
          '</select>' + fn + '</td>' +
          '<td><input type="text" id="he-qual-' + hid + '" value="' + (h.quality_notes || '').replace(/"/g,'&quot;') + '" style="font-size:11px;width:100%;min-width:120px" placeholder="—"></td>' +
          '<td class="muted-cell" style="white-space:nowrap">' + (h.workers ? h.workers.name : '—') + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-sm" style="font-size:11px" onclick="patchHarvest(' + hid + ')">Save</button>' +
            '<button class="btn btn-sm" style="font-size:11px;color:var(--red);margin-left:4px" onclick="deleteHarvest(' + hid + ')">Delete</button>' +
            '<span id="he-status-' + hid + '" style="font-size:10px;color:var(--muted);margin-left:4px"></span>' +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // ── HARVEST FORM (group-level) ──
    html += buildGroupHarvestForm(g, feedNotes, workers);

    // ── SET INGREDIENT PANEL (hidden, shown via "Link ingredient" button) ──
    var ingOpts = '<option value="">None</option>' +
      landIngredients
        .filter(function(i) { return i.source_type === 'produced' || i.source_type === 'dual'; })
        .map(function(i) {
          return '<option value="' + i.id + '"' + (g.ingredient_id === i.id ? ' selected' : '') + '>' + i.name + '</option>';
        }).join('');
    html += '<div id="set-ing-' + g.id + '" style="display:none;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)">';
    html += '<div style="font-size:12px;font-weight:500;margin-bottom:6px">Link to ingredient for stock tracking</div>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<select id="ing-sel-' + g.id + '" style="font-size:12px;flex:1">' + ingOpts + '</select>';
    html += '<button class="btn btn-sm btn-primary" style="font-size:11px" onclick="saveGroupIngredient(' + g.id + ')">Save</button>';
    html += '<button class="btn btn-sm" style="font-size:11px" onclick="document.getElementById(\'set-ing-' + g.id + '\').style.display=\'none\'">Cancel</button>';
    html += '<span id="ing-status-' + g.id + '" style="font-size:11px;color:var(--muted)"></span>';
    html += '</div></div>';

    // ── OBS PANELS / FORMS for single-member ──
    if (!isMulti && members.length === 1) {
      var mObs = landObservations.filter(function(o) { return o.plot_crop_id === members[0].id; });
      html += buildObsPanel(members[0], mObs);
      html += buildObsForm(members[0], workers);
    }

    html += '</div>'; // end crop-card
  });

  tbl.innerHTML = html;
}

function toggleGroupHarvests(groupId) {
  var el = document.getElementById('group-harvests-' + groupId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function openSetIngredient(groupId) {
  var el = document.getElementById('set-ing-' + groupId);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
}

async function saveGroupIngredient(groupId) {
  var sel      = document.getElementById('ing-sel-' + groupId);
  var statusEl = document.getElementById('ing-status-' + groupId);
  var ingId    = sel ? (parseInt(sel.value) || null) : null;
  statusEl.textContent = '…'; statusEl.style.color = 'var(--muted)';
  try {
    await sbPatch('crop_groups', groupId, { ingredient_id: ingId });
    statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)';
    console.error('saveGroupIngredient:', err);
  }
}

function openGroupHarvestForm(groupId) {
  var el = document.getElementById('harvest-form-g' + groupId);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
}
function toggleCropObs(cropId) {
  var el = document.getElementById('crop-obs-' + cropId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function openObsForm(cropId) {
  var el = document.getElementById('obs-form-' + cropId);
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
}
function checkGroupFodderWarn(groupId) {
  var dest = (document.getElementById('hf-dest-g' + groupId) || {}).value || '';
  var warn = document.getElementById('fodder-warn-g' + groupId);
  if (warn) warn.style.display = dest === 'goat_fodder' ? 'block' : 'none';
}

async function terminateCrop(cropId) {
  if (!confirm('Mark this crop as terminated?')) return;
  try {
    await sbPatch('plot_crops', cropId, { status: 'terminated', termination_date: todayISO() });
    await loadLandPage();
  } catch (err) { alert('Error: ' + err.message); }
}

async function terminateGroup(groupId) {
  if (!confirm('End all crops in this group?')) return;
  try {
    var growing = landCrops.filter(function(c) { return c.crop_group_id === groupId && c.status === 'growing'; });
    await Promise.all(growing.map(function(c) {
      return sbPatch('plot_crops', c.id, { status: 'terminated', termination_date: todayISO() });
    }));
    await loadLandPage();
  } catch (err) { alert('Error: ' + err.message); }
}

async function submitLandCrop() {
  var statusEl = document.getElementById('lc-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var plotId    = document.getElementById('lc-plot').value;
    var cropId    = document.getElementById('lc-crop').value;
    var role      = document.getElementById('lc-role').value;
    var sow       = document.getElementById('lc-sow').value;
    var endDate   = document.getElementById('lc-end').value;
    var notes     = (document.getElementById('lc-notes').value || '').trim();
    var modeEl    = document.querySelector('input[name="lc-group-mode"]:checked');
    var groupMode = modeEl ? modeEl.value : 'new';
    if (!plotId) throw new Error('Plot is required.');
    if (!cropId) throw new Error('Crop is required.');

    var regCrop = landCropRegistry.find(function(c) { return String(c.id) === cropId; });
    var groupId;

    if (groupMode === 'existing') {
      var gSel = document.getElementById('lc-group-select');
      groupId = gSel ? parseInt(gSel.value) : null;
      if (!groupId) throw new Error('Select an existing group.');
    } else {
      var harvestType = document.getElementById('lc-harvest-type').value;
      var isStand     = document.getElementById('lc-is-stand').checked;
      var groupName   = (document.getElementById('lc-group-name').value || '').trim();
      var ingId       = parseInt((document.getElementById('lc-ingredient') || {}).value) || null;
      if (!harvestType) throw new Error('Crop type is required.');
      if (!groupName) groupName = (regCrop ? regCrop.name : 'Crop') + (sow ? ' (' + sow.slice(0, 7) + ')' : '');
      var gd = { field_plot_id: parseInt(plotId), name: groupName, is_stand: isStand, harvest_type: harvestType };
      if (ingId) gd.ingredient_id = ingId;
      var gRows = await sbInsert('crop_groups', [gd]);
      groupId = gRows[0].id;
    }

    var cd = {
      field_plot_id: parseInt(plotId),
      crop_group_id: groupId,
      crop_id:       parseInt(cropId),
      crop_name:     regCrop ? regCrop.name : '',
      role:          role || 'primary',
      status:        'growing',
      health_status: 'unknown',
      active:        true
    };
    if (sow)     cd.sow_date                 = sow;
    if (endDate) cd.expected_termination_date = endDate;
    if (notes)   cd.notes                    = notes;
    await sbInsert('plot_crops', [cd]);

    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-crop-form').style.display = 'none';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function submitHarvestEvent(groupId) {
  var statusEl = document.getElementById('hf-status-g' + groupId);
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date = document.getElementById('hf-date-g' + groupId).value;
    var kg   = document.getElementById('hf-kg-g'   + groupId).value;
    var dest = document.getElementById('hf-dest-g' + groupId).value;
    var wId  = document.getElementById('hf-worker-g' + groupId).value;
    var qual = (document.getElementById('hf-qual-g' + groupId).value || '').trim();
    if (!date) throw new Error('Date required.');
    var prevCuts = landHarvests.filter(function(h) { return h.crop_group_id === groupId; }).length;
    var d = { crop_group_id: groupId, date: date, cut_number: prevCuts + 1 };
    if (kg)   d.quantity_kg   = parseFloat(kg);
    if (dest) d.destination   = dest;
    if (wId)  d.recorded_by   = parseInt(wId);
    if (qual) d.quality_notes = qual;
    var rows = await sbInsert('crop_harvest_events', [d]);
    // Bridge: if group has ingredient_id, create matching acquisition
    var group = landCropGroups.find(function(g) { return g.id === groupId; });
    if (group && group.ingredient_id && rows && rows[0]) {
      var harvestId = rows[0].id;
      var aq = {
        ingredient_id:          group.ingredient_id,
        acquisition_type:       'harvested',
        date:                   date,
        quantity_kg:            parseFloat(kg) || 0,
        crop_harvest_event_id:  harvestId
      };
      if (wId) aq.recorded_by = parseInt(wId);
      await sbInsert('ingredient_acquisitions', [aq]);
    }
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function submitObservation(cropId) {
  var statusEl = document.getElementById('of-status-' + cropId);
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var health = document.getElementById('of-health-' + cropId).value;
    var flag   = document.getElementById('of-flag-' + cropId).value === 'true';
    var wId    = document.getElementById('of-worker-' + cropId).value;
    var note   = (document.getElementById('of-note-' + cropId).value || '').trim();
    var d = { plot_crop_id: cropId, pest_disease_flag: flag };
    if (health) d.health_status = health;
    if (note)   d.note          = note;
    if (wId)    d.recorded_by  = parseInt(wId);
    await sbInsert('crop_observations', [d]);
    await sbPatch('plot_crops', cropId, { health_status: health, pest_disease_flag: flag });
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function patchObservation(obsId, cropId) {
  var statusEl = document.getElementById('oe-status-' + obsId);
  statusEl.textContent = '…'; statusEl.style.color = 'var(--muted)';
  try {
    var health = document.getElementById('oe-health-' + obsId).value;
    var flag   = document.getElementById('oe-flag-'   + obsId).value === 'true';
    var note   = (document.getElementById('oe-note-'  + obsId).value || '').trim();
    await sbPatch('crop_observations', obsId, { health_status: health, pest_disease_flag: flag, note: note || null });
    var cropObs = landObservations.filter(function(o) { return o.plot_crop_id === cropId; });
    cropObs.sort(function(a, b) { return (b.observed_at || '').localeCompare(a.observed_at || ''); });
    if (cropObs.length && cropObs[0].id === obsId) {
      await sbPatch('plot_crops', cropId, { health_status: health, pest_disease_flag: flag });
    }
    statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)';
    console.error('patchObservation:', err);
  }
}

async function resolvePestFlag(cropId) {
  try {
    await sbPatch('plot_crops', cropId, { pest_disease_flag: false });
    await loadLandPage();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteObservation(obsId, cropId) {
  if (!confirm('Delete this observation? This cannot be undone.')) return;
  try {
    await sbDelete('crop_observations', obsId);
    await loadLandPage();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

async function patchHarvest(hid) {
  var statusEl = document.getElementById('he-status-' + hid);
  statusEl.textContent = '…'; statusEl.style.color = 'var(--muted)';
  try {
    var date = document.getElementById('he-date-' + hid).value;
    var kg   = document.getElementById('he-kg-'   + hid).value;
    var dest = document.getElementById('he-dest-' + hid).value;
    var qual = (document.getElementById('he-qual-' + hid).value || '').trim();
    if (!date) throw new Error('Date is required.');
    await sbPatch('crop_harvest_events', hid, {
      date:          date,
      quantity_kg:   kg   ? parseFloat(kg) : null,
      destination:   dest || null,
      quality_notes: qual || null
    });
    // Sync linked acquisition if one exists
    try {
      var linked = await sbGet('ingredient_acquisitions',
        'select=id&crop_harvest_event_id=eq.' + hid + '&limit=1');
      if (linked && linked.length) {
        await sbPatch('ingredient_acquisitions', linked[0].id, {
          date:        date,
          quantity_kg: kg ? parseFloat(kg) : null
        });
      }
    } catch (_) {} // don't fail the harvest patch if acquisition sync fails
    statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)';
    console.error('patchHarvest:', err);
  }
}

async function deleteHarvest(hid) {
  if (!confirm('Delete this harvest record? This cannot be undone.')) return;
  try {
    try {
      var linked = await sbGet('ingredient_acquisitions',
        'select=id&crop_harvest_event_id=eq.' + hid + '&limit=1');
      if (linked && linked.length) await sbDelete('ingredient_acquisitions', linked[0].id);
    } catch (_) {}
    await sbDelete('crop_harvest_events', hid);
    await loadLandPage();
  } catch (err) { alert('Delete failed: ' + err.message); }
}


// ============================================================
// TAB 6: WATERING
// ============================================================
var TUBEWELL_LPH = 18000; // default flow rate litres/hour — rough estimate, update in Setup

function toggleWateringForm() {
  var f = document.getElementById('land-water-form');
  f.style.display = f.style.display === 'block' ? 'none' : 'block';
}

function calcWateringVolume() {
  var dur = parseFloat((document.getElementById('lw-dur') || {}).value || '');
  var volEl = document.getElementById('lw-vol');
  if (!isNaN(dur) && dur > 0 && volEl) {
    volEl.placeholder = Math.round(dur * TUBEWELL_LPH).toLocaleString() + ' L (auto)';
  }
}

function renderWateringLog() {
  var plotF = (document.getElementById('land-water-plot-filter') || {}).value || '';
  var rows = landWatering.filter(function(r) {
    return !plotF || String(r.field_plot_id) === plotF;
  });
  document.getElementById('land-water-count').textContent =
    rows.length + ' event' + (rows.length !== 1 ? 's' : '');
  var tbl = document.getElementById('land-water-table');
  if (!rows.length) { tbl.innerHTML = '<div class="empty">No watering events logged yet.</div>'; return; }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Plot</th><th>Method</th><th>Source</th>' +
    '<th class="right">Duration (hrs)</th><th class="right">Volume (L)</th>' +
    '<th>Worker</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    html += '<tr>' +
      '<td class="mono">' + fmtDate(r.date) + '</td>' +
      '<td style="font-weight:500">' + (r.field_plot_id ? plotName(r.field_plot_id) : '— farm wide —') + '</td>' +
      '<td class="muted-cell">' + (r.method || '—') + '</td>' +
      '<td class="muted-cell">' + (r.water_source || '—') + '</td>' +
      '<td class="mono right">' + (r.duration_hours != null ? parseFloat(r.duration_hours).toFixed(1) : '—') + '</td>' +
      '<td class="mono right">' + (r.estimated_volume_litres != null ? Math.round(r.estimated_volume_litres).toLocaleString() : '—') + '</td>' +
      '<td class="muted-cell">' + (r.workers ? r.workers.name : '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (r.notes || '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function submitWatering() {
  var statusEl = document.getElementById('lw-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('lw-date').value;
    var plotId = document.getElementById('lw-plot').value;
    var method = document.getElementById('lw-method').value;
    var wsrc   = document.getElementById('lw-wsrc').value;
    var dur    = document.getElementById('lw-dur').value;
    var vol    = document.getElementById('lw-vol').value;
    var wId    = document.getElementById('lw-worker').value;
    var notes  = (document.getElementById('lw-notes').value || '').trim();
    if (!date || !method) throw new Error('Date and method are required.');
    var d = { date: date, method: method, water_source: wsrc || 'tubewell' };
    if (plotId) d.field_plot_id = parseInt(plotId);
    if (dur) {
      d.duration_hours = parseFloat(dur);
      if (!vol) d.estimated_volume_litres = Math.round(parseFloat(dur) * TUBEWELL_LPH);
    }
    if (vol)   d.estimated_volume_litres = parseFloat(vol);
    if (wId)   d.recorded_by = parseInt(wId);
    if (notes) d.notes = notes;
    await sbInsert('watering_events', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-water-form').style.display = 'none';
    ['lw-dur','lw-vol','lw-notes'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}


// ============================================================
// TAB 7: WATER TESTS
// ============================================================
function toggleWaterTestForm() {
  var f = document.getElementById('land-wtest-form');
  f.style.display = f.style.display === 'block' ? 'none' : 'block';
}

function buildWaterBaseline() {
  var bl = {};
  landWaterTests.forEach(function(t) {
    if (!t.is_baseline) return;
    var src = t.source || 'tubewell';
    if (!bl[src]) bl[src] = t;
  });
  return bl;
}

function wDelta(curr, base, key, higherIsBetter) {
  if (curr[key] == null || !base || base[key] == null) return '';
  var d = parseFloat(curr[key]) - parseFloat(base[key]);
  if (Math.abs(d) < 0.005) return '';
  var isGood = (d > 0) === higherIsBetter;
  return ' <span style="font-size:10px;color:' + (isGood ? 'var(--green)' : 'var(--red)') + '">' +
    (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(2) + '</span>';
}

function renderWaterTests() {
  document.getElementById('land-wtest-count').textContent =
    landWaterTests.length + ' test' + (landWaterTests.length !== 1 ? 's' : '');
  var tbl = document.getElementById('land-wtest-table');
  if (!landWaterTests.length) { tbl.innerHTML = '<div class="empty">No water tests logged yet.</div>'; return; }
  var baseline = buildWaterBaseline();
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Source</th><th>Type</th>' +
    '<th class="right">EC (µS/cm)</th><th class="right">pH</th>' +
    '<th class="right">SAR</th><th class="right">RSC (meq/L)</th>' +
    '<th class="right">HCO₃</th><th class="right">Na</th>' +
    '<th class="right">Ca</th><th class="right">Mg</th>' +
    '<th>Lab</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  landWaterTests.forEach(function(r) {
    var bl = baseline[r.source || 'tubewell'];
    var ecStyle  = r.ec_us_cm != null ? (r.ec_us_cm > 3000 ? 'color:var(--red)' : r.ec_us_cm > 1500 ? 'color:var(--amber)' : 'color:var(--green)') : '';
    var sarStyle = r.sar != null ? (r.sar > 18 ? 'color:var(--red)' : r.sar > 10 ? 'color:var(--amber)' : 'color:var(--green)') : '';
    var rscStyle = r.rsc_meq_l != null ? (r.rsc_meq_l > 5 ? 'color:var(--red)' : r.rsc_meq_l > 2.5 ? 'color:var(--amber)' : 'color:var(--green)') : '';
    html += '<tr' + (r.is_baseline ? ' style="background:var(--green-lt)"' : '') + '>';
    html += '<td class="mono">' + fmtDate(r.date) + (r.is_baseline ? ' <span class="badge badge-green" style="font-size:10px">Baseline</span>' : '') + '</td>';
    html += '<td class="muted-cell">' + (r.source || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.test_type || '—') + '</td>';
    html += '<td class="mono right" style="' + ecStyle  + '">' + (r.ec_us_cm   != null ? Math.round(r.ec_us_cm) + wDelta(r, bl, 'ec_us_cm', false) : '—') + '</td>';
    html += '<td class="mono right">' + (r.ph != null ? parseFloat(r.ph).toFixed(1) : '—') + '</td>';
    html += '<td class="mono right" style="' + sarStyle + '">' + (r.sar       != null ? parseFloat(r.sar).toFixed(2)       + wDelta(r, bl, 'sar', false) : '—') + '</td>';
    html += '<td class="mono right" style="' + rscStyle + '">' + (r.rsc_meq_l != null ? parseFloat(r.rsc_meq_l).toFixed(2) + wDelta(r, bl, 'rsc_meq_l', false) : '—') + '</td>';
    html += '<td class="mono right">' + (r.bicarbonate_meq_l != null ? parseFloat(r.bicarbonate_meq_l).toFixed(2) : '—') + '</td>';
    html += '<td class="mono right">' + (r.sodium_meq_l      != null ? parseFloat(r.sodium_meq_l).toFixed(2)      : '—') + '</td>';
    html += '<td class="mono right">' + (r.calcium_meq_l     != null ? parseFloat(r.calcium_meq_l).toFixed(2)     : '—') + '</td>';
    html += '<td class="mono right">' + (r.magnesium_meq_l   != null ? parseFloat(r.magnesium_meq_l).toFixed(2)   : '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.lab_name || '—') + '</td>';
    html += '<td class="muted-cell" style="font-size:11px">' + (r.notes    || '') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function submitWaterTest() {
  var statusEl = document.getElementById('lwt-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('lwt-date').value;
    var source = document.getElementById('lwt-source').value;
    var ttype  = document.getElementById('lwt-type').value;
    var isBase = document.getElementById('lwt-baseline').checked;
    if (!date) throw new Error('Date is required.');
    var d = { date: date, source: source || 'tubewell', test_type: ttype || 'lab', is_baseline: isBase };
    var fields = { 'lwt-ec':'ec_us_cm','lwt-ph':'ph','lwt-sar':'sar','lwt-rsc':'rsc_meq_l',
                   'lwt-bicarb':'bicarbonate_meq_l','lwt-na':'sodium_meq_l',
                   'lwt-ca':'calcium_meq_l','lwt-mg':'magnesium_meq_l' };
    Object.keys(fields).forEach(function(elId) {
      var el = document.getElementById(elId);
      if (el && el.value) d[fields[elId]] = parseFloat(el.value);
    });
    var lab   = (document.getElementById('lwt-lab').value   || '').trim(); if (lab)   d.lab_name = lab;
    var notes = (document.getElementById('lwt-notes').value || '').trim(); if (notes) d.notes    = notes;
    await sbInsert('water_tests', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-wtest-form').style.display = 'none';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
