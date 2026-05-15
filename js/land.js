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
var landFertApps      = [];
var landTests         = [];
var landCrops         = [];
var landHarvests      = [];
var landAllocations   = [];   // harvest_allocations — for badge/button on harvest rows
var landDestinations  = [];   // harvest_destinations — DB-managed, replaces hardcoded arrays
var landObservations  = [];
var landWatering      = [];
var landWaterTests    = [];
var landCropRegistry  = [];
var landWorkers       = [];
var landLocations     = [];
var landLoaded        = false;
var landActiveTab     = 'crops';
var obsExpandedCrops  = {};   // cropId → true when showing all observations (not truncated)
var landPlotObservations = []; // rows from plot_observations (plot-level, not crop-level)
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
      sbGet('fertilizers',          'select=id,name,type,unit,quantity_per_purchase_unit,reorder_point,supplier,ec_impact,notes,active&order=name'),
      sbGet('fertilizer_purchases', 'select=id,fertilizer_id,date,qty,cost_per_unit,supplier,notes&order=date.desc&limit=500'),
      safeFetch('fertilizer_applications',
        'select=id,date,kg_applied,application_method,water_source,notes,field_plot_id,fertilizer_id,worker_id,workers(name)&order=date.desc'),
      sbGet('soil_tests',
        'select=id,date,sample_date,report_date,test_type,is_baseline,sample_depth,lab_name,' +
        'ec_ms_cm,ph,organic_matter_pct,sar,rsc,esp,available_phosphorus_mg_kg,' +
        'potassium_mg_kg,calcium_mg_kg,magnesium_mg_kg,texture_class,notes,field_plot_id' +
        '&order=date.desc'),
      sbGet('plot_crops',
        'select=id,field_plot_id,crop_id,crop_name,role,status,health_status,germination_outcome,' +
        'pest_disease_flag,sow_date,expected_termination_date,termination_date,notes,harvest_type,crop_group_id' +
        '&order=sow_date.desc'),
      // New tables — safe fallback to [] on error
      safeFetch('crop_harvest_events',
        'select=id,crop_group_id,cut_number,date,quantity_kg,quality_notes,allocated,recorded_by,' +
        'workers!recorded_by(name)&order=date.desc'),
      safeFetch('crop_observations',
        'select=id,plot_crop_id,observed_at,health_status,pest_disease_flag,notes,recorded_by,' +
        'workers!recorded_by(name)&order=observed_at.desc'),
      safeFetch('watering_events',
        'select=id,date,field_plot_id,method,duration_hours,estimated_volume_litres,' +
        'water_source,recorded_by,notes,workers!recorded_by(name)&order=date.desc'),
      safeFetch('water_tests',
        'select=id,date,source,test_type,is_baseline,lab_name,ec_us_cm,ph,sar,rsc_meq_l,' +
        'bicarbonate_meq_l,sodium_meq_l,calcium_meq_l,magnesium_meq_l,notes&order=date.desc'),
      safeFetch('crops',
        'select=id,name,local_name,category,salt_tolerance,salt_tolerance_ec_threshold,' +
        'nitrogen_fixer,feeding_notes,notes,active,permitted_destinations&order=name'),
      sbGet('locations', 'select=id,name,location_type,active&order=name'),
      safeFetch('crop_groups', 'select=id,field_plot_id,name,is_stand,harvest_type,notes,ingredient_id,ingredients(id,name)&order=field_plot_id,name'),
      safeFetch('ingredients', 'select=id,name,category,source_type,feed_eligible&active=eq.true&order=name'),
      workers,
      safeFetch('harvest_allocations',
        'select=id,harvest_event_id,destination,quantity_kg,ingredient_id,crop_id'),
      safeFetch('harvest_destinations',
        'select=id,key,label,sort_order&active=eq.true&order=sort_order,label'),
      safeFetch('plot_observations',
        'select=id,field_plot_id,observed_at,notes,recorded_by,workers!recorded_by(name)&order=observed_at.desc')
    ]);

    landPlots         = r[0];
    landFerts         = r[1];
    landFertPurchases = r[2];
    landFertApps      = r[3];
    landTests         = r[4];
    landCrops         = r[5];
    landHarvests      = r[6];
    landObservations  = r[7];
    landWatering      = r[8];
    landWaterTests    = r[9];
    landCropRegistry  = r[10];
    landLocations     = r[11];
    landCropGroups    = r[12];
    landIngredients   = r[13];
    landWorkers       = r[14];
    landAllocations      = r[15] || [];
    landDestinations     = r[16] || [];
    landPlotObservations = r[17] || [];
    landLoaded        = true;

    if (loadingEl) loadingEl.innerHTML = '';

    populateLandDropdowns();
    renderLandFert();
    renderLandAppLog();
    renderLandTests();
    renderLandCrops();
    renderWateringLog();
    renderWaterTests();

    document.getElementById('land-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderAbbrevKey('abbrev-land', ['EC', 'SAR', 'OM', 'RSC', 'PKR', 'BSF', 'ESP']);
    // Always restore the active tab panel regardless of how loadLandPage was called
    if (typeof showLandTab === 'function') showLandTab(landActiveTab, null);
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
  ['land-app-plot-filter','land-test-plot-filter','land-water-plot-filter','lc-plot-filter'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.innerHTML = plotFilter;
  });

  // Fertilizer dropdowns — application form picker + filter
  var fertPickOpts = '<option value="">Select fertilizer *</option>' +
    landFerts.filter(function(f) { return f.active; }).map(function(f) {
      var su  = f.type === 'liquid' ? 'L' : 'kg';
      var pu  = f.type === 'liquid' ? 'container' : 'bag';
      var qpu = f.quantity_per_purchase_unit ? ' · ' + f.quantity_per_purchase_unit + ' ' + su + '/' + pu : '';
      return '<option value="' + f.id + '">' + f.name + qpu + '</option>';
    }).join('');
  var fertEl = document.getElementById('la-fert');
  if (fertEl) fertEl.innerHTML = fertPickOpts;

  var fertFilterOpts = '<option value="">All fertilizers</option>' +
    landFerts.filter(function(f) { return f.active; }).map(function(f) {
      return '<option value="' + f.id + '">' + f.name + '</option>';
    }).join('');
  var fertFilterEl = document.getElementById('land-app-fert-filter');
  if (fertFilterEl) fertFilterEl.innerHTML = fertFilterOpts;

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
  // ── Stock summary ─────────────────────────────────────────
  var stockByFert = {};
  landFerts.forEach(function(f) {
    stockByFert[f.id] = { purchasedKg: 0, appliedKg: 0, latestCostPerKg: null, latestCostDate: null };
  });

  landFertPurchases.forEach(function(pp) {
    var st = stockByFert[pp.fertilizer_id];
    if (!st || pp.qty == null) return;
    var fert = landFerts.find(function(f) { return f.id === pp.fertilizer_id; });
    var qpu  = fert && fert.quantity_per_purchase_unit ? parseFloat(fert.quantity_per_purchase_unit) : null;
    if (qpu) {
      st.purchasedKg += parseFloat(pp.qty) * qpu;
      if (pp.cost_per_unit != null) {
        var cpk = parseFloat(pp.cost_per_unit) / qpu;
        if (!st.latestCostDate || pp.date > st.latestCostDate) {
          st.latestCostPerKg = cpk;
          st.latestCostDate  = pp.date;
        }
      }
    }
  });

  landFertApps.forEach(function(a) {
    var st = a.fertilizer_id ? stockByFert[a.fertilizer_id] : null;
    if (st && a.kg_applied != null) st.appliedKg += parseFloat(a.kg_applied);
  });

  document.getElementById('land-fert-meta').textContent =
    landFerts.filter(function(f) { return f.active; }).length + ' active fertilizers';

  var tbl = document.getElementById('land-fert-table');
  if (!landFerts.length) {
    tbl.innerHTML = '<div class="empty">No fertilizers in registry. Add via Setup → Fertilizers.</div>';
  } else {
    var html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Fertilizer</th><th>Type</th><th>Unit</th>' +
      '<th class="right">Purchased</th><th class="right">Applied</th>' +
      '<th class="right">Stock</th><th class="right">Cost / kg</th><th>Status</th>' +
      '</tr></thead><tbody>';
    landFerts.filter(function(f) { return f.active; }).forEach(function(f) {
      var st    = stockByFert[f.id];
      var su    = f.type === 'liquid' ? 'L' : 'kg';
      var stock = st.purchasedKg - st.appliedKg;
      var noConv = !f.quantity_per_purchase_unit;
      var cls   = stock <= 0 ? 'inv-stock-zero'
        : (f.reorder_point != null && stock < parseFloat(f.reorder_point) ? 'inv-stock-low' : 'inv-stock-pos');
      var statusHtml = noConv
        ? '<span class="badge badge-amber" title="Set kg/bag in Setup → Fertilizers">⚠ No conversion</span>'
        : stock <= 0
          ? '<span class="badge badge-red">Out of stock</span>'
          : (f.reorder_point != null && stock < parseFloat(f.reorder_point)
              ? '<span class="badge badge-amber">Low</span>'
              : '<span class="badge badge-green">OK</span>');
      html += '<tr>' +
        '<td style="font-weight:500">' + f.name + '</td>' +
        '<td class="muted-cell">' + (f.type || '—') + '</td>' +
        '<td class="muted-cell">' + su + '</td>' +
        '<td class="mono right">' + r1(st.purchasedKg) + ' ' + su + '</td>' +
        '<td class="mono right">' + r1(st.appliedKg)   + ' ' + su + '</td>' +
        '<td class="mono right ' + cls + '">' + r1(stock) + ' ' + su + '</td>' +
        '<td class="mono right">' + (st.latestCostPerKg != null ? pkr(st.latestCostPerKg) + ' / ' + su : '—') + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    tbl.innerHTML = html;
  }

  // ── Purchase log ──────────────────────────────────────────
  var ptbl = document.getElementById('land-purch-table');
  document.getElementById('land-purch-count').textContent =
    landFertPurchases.length + ' purchase' + (landFertPurchases.length !== 1 ? 's' : '');

  if (!landFertPurchases.length) {
    ptbl.innerHTML = '<div class="empty">No purchases logged yet.</div>';
  } else {
    var phtml = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Date</th><th>Fertilizer</th>' +
      '<th class="right">Qty</th><th class="right">Total</th>' +
      '<th class="right">Cost / unit</th><th class="right">Cost / kg</th>' +
      '<th class="right">Total cost</th><th>Supplier</th><th>Notes</th><th></th>' +
      '</tr></thead><tbody>';
    landFertPurchases.forEach(function(p) {
      var fert = landFerts.find(function(f) { return f.id === p.fertilizer_id; });
      var su   = fert && fert.type === 'liquid' ? 'L' : 'kg';
      var pu   = fert && fert.type === 'liquid' ? 'container' : 'bag';
      var qpu  = fert && fert.quantity_per_purchase_unit ? parseFloat(fert.quantity_per_purchase_unit) : null;
      var qty  = p.qty != null ? parseFloat(p.qty) : null;
      var cpu  = p.cost_per_unit != null ? parseFloat(p.cost_per_unit) : null;
      var totalSU   = (qty != null && qpu != null) ? qty * qpu : null;
      var cpkg      = (cpu != null && qpu && qpu > 0) ? cpu / qpu : null;
      var totalCost = (qty != null && cpu != null) ? qty * cpu : null;
      phtml += '<tr>' +
        '<td class="mono">' + fmtDate(p.date) + '</td>' +
        '<td style="font-weight:500">' + (fert ? fert.name : '—') + '</td>' +
        '<td class="mono right">' + (qty != null ? r1(qty) + ' ' + pu + (qty !== 1 ? 's' : '') : '—') + '</td>' +
        '<td class="mono right">' + (totalSU != null ? r1(totalSU) + ' ' + su : '—') + '</td>' +
        '<td class="mono right">' + (cpu != null ? pkr(cpu) + ' / ' + pu : '—') + '</td>' +
        '<td class="mono right">' + (cpkg != null ? pkr(cpkg) + ' / ' + su : '—') + '</td>' +
        '<td class="mono right">' + (totalCost != null ? pkr(totalCost) : '—') + '</td>' +
        '<td class="muted-cell">' + (p.supplier || '—') + '</td>' +
        '<td class="muted-cell" style="font-size:12px">' + (p.notes || '') + '</td>' +
        '<td><button class="btn btn-sm del-btn" onclick="deleteLandFertPurchase(' + p.id + ')">Delete</button></td>' +
        '</tr>';
    });
    phtml += '</tbody></table></div>';
    ptbl.innerHTML = phtml;
  }
}

function renderLandFertChart() {
  var canvas = document.getElementById('land-fert-price-chart');
  if (!canvas) return;
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  landFertChart = null;

  // Build per-fertilizer series. If qpu is set, cost/kg = cost_per_unit / qpu.
  // If qpu is NOT set, treat cost_per_unit as already cost/kg.
  var byFert = {};
  landFertPurchases.forEach(function(pp) {
    if (pp.cost_per_unit == null) return;
    var fert = landFerts.find(function(f) { return f.id === pp.fertilizer_id; });
    if (!fert) return;
    var qpu  = fert.quantity_per_purchase_unit ? parseFloat(fert.quantity_per_purchase_unit) : null;
    var cpkg = qpu ? parseFloat(pp.cost_per_unit) / qpu : parseFloat(pp.cost_per_unit);
    var su   = fert.type === 'liquid' ? 'L' : 'kg';
    if (!byFert[fert.id]) byFert[fert.id] = { dates: [], labels: [], values: [], su: su, name: fert.name };
    byFert[fert.id].dates.push(pp.date);          // raw ISO for filtering
    byFert[fert.id].labels.push(fmtDate(pp.date)); // formatted for display
    byFert[fert.id].values.push(Math.round(cpkg));
  });

  // ── Populate fertilizer dropdown from all active fertilizers ─
  var filterEl = document.getElementById('land-chart-fert-filter');
  if (filterEl && filterEl.options.length === 0) {
    filterEl.innerHTML = landFerts.filter(function(f) { return f.active; }).map(function(f) {
      return '<option value="' + f.id + '">' + f.name + '</option>';
    }).join('');
    // Auto-select the first fertilizer that has purchase data
    var firstWithData = landFerts.filter(function(f) { return f.active; })
      .find(function(f) { return byFert[f.id] && byFert[f.id].values.length > 0; });
    if (firstWithData) filterEl.value = String(firstWithData.id);
  }
  var selectedId = filterEl ? filterEl.value : '';

  // ── Apply period filter ────────────────────────────────────
  var periodEl  = document.getElementById('land-chart-period');
  var periodDays = periodEl && periodEl.value ? parseInt(periodEl.value) : null;
  if (periodDays) {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);
    var cutoffISO = cutoff.toISOString().slice(0, 10);
    Object.keys(byFert).forEach(function(id) {
      var e = byFert[id];
      var kept = e.dates.map(function(d, i) { return { d: d, l: e.labels[i], v: e.values[i] }; })
        .filter(function(pt) { return pt.d >= cutoffISO; });
      e.dates  = kept.map(function(pt) { return pt.d; });
      e.labels = kept.map(function(pt) { return pt.l; });
      e.values = kept.map(function(pt) { return pt.v; });
    });
  }

  // ── Apply fertilizer filter ────────────────────────────────
  if (selectedId) {
    var filtered = {};
    if (byFert[selectedId]) filtered[selectedId] = byFert[selectedId];
    byFert = filtered;
  }

  // ── No-data overlay ────────────────────────────────────────
  var noDataEl = document.getElementById('land-chart-no-data');
  if (noDataEl) {
    var hasData = Object.keys(byFert).some(function(id) { return byFert[id].values.length > 0; });
    noDataEl.style.display = hasData ? 'none' : 'flex';
    noDataEl.textContent   = 'No cost data logged for this fertilizer' + (periodDays ? ' in this period.' : '.');
  }

  // Sort each series oldest-first (purchases are fetched date desc — reverse)
  Object.keys(byFert).forEach(function(id) {
    var e = byFert[id];
    // Zip, reverse (so oldest first), unzip
    var pairs = e.labels.map(function(l, i) { return [l, e.values[i]]; }).reverse();
    e.labels = pairs.map(function(p) { return p[0]; });
    e.values = pairs.map(function(p) { return p[1]; });
  });

  // ── Stats panel (computed after sort so values are oldest-first) ───
  var statsBody = document.getElementById('land-chart-stats-body');
  if (statsBody) {
    var allVals  = [];
    var latestVal = null;
    var su = selectedId && byFert[selectedId] ? byFert[selectedId].su : 'kg';
    Object.keys(byFert).forEach(function(id) {
      var vals = byFert[id].values; // oldest-first after sort
      vals.forEach(function(v) { if (v != null) allVals.push(v); });
      if (vals.length) latestVal = vals[vals.length - 1];
    });
    if (!allVals.length) {
      statsBody.innerHTML = '<span style="color:var(--faint)">No cost data for this fertilizer' + (periodDays ? ' in this period.' : '.') + '</span>';
    } else {
      var sorted = allVals.slice().sort(function(a, b) { return a - b; });
      var n      = sorted.length;
      var mean   = sorted.reduce(function(s, v) { return s + v; }, 0) / n;
      var med    = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
      function statRow(label, val) {
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">' +
          '<span style="color:var(--muted)">' + label + '</span>' +
          '<span style="font-weight:500">PKR ' + Math.round(val) + ' / ' + su + '</span></div>';
      }
      statsBody.innerHTML =
        statRow('Latest', latestVal) +
        statRow('Mean',   mean)      +
        statRow('Median', med)       +
        statRow('Min',    sorted[0]) +
        statRow('Max',    sorted[n - 1]) +
        '<div style="display:flex;justify-content:space-between;padding:5px 0">' +
          '<span style="color:var(--muted)">n (period)</span>' +
          '<span style="font-weight:500">' + n + '</span></div>';
    }
  }

  // Collect all unique labels in date order for the shared x-axis
  var allLabels = [];
  Object.keys(byFert).forEach(function(id) {
    byFert[id].labels.forEach(function(l) {
      if (allLabels.indexOf(l) === -1) allLabels.push(l);
    });
  });

  if (!allLabels.length) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;  // no-data overlay already shown above
  }

  var datasets = [];
  var idx = 0;
  Object.keys(byFert).forEach(function(id) {
    var entry = byFert[id];
    // Align values to allLabels — null where no data point
    var aligned = allLabels.map(function(lbl) {
      var pos = entry.labels.indexOf(lbl);
      return pos !== -1 ? entry.values[pos] : null;
    });
    datasets.push({
      label: entry.name + ' (PKR / ' + entry.su + ')',
      data: aligned,
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
      spanGaps: true, tension: 0.2, pointRadius: 4, borderWidth: 2
    });
    idx++;
  });

  landFertChart = new Chart(canvas, {
    type: 'line',
    data: { labels: allLabels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: {
          label: function(c) { return c.dataset.label + ': PKR ' + Math.round(c.parsed.y); }
        }}
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { color: '#E8E4DA' } },
        y: { ticks: { font: { size: 10 }, callback: function(v) { return 'PKR ' + v; } }, grid: { color: '#E8E4DA' } }
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
  if (f.style.display === 'block') {
    document.getElementById('la-date').value = todayISO();
    document.getElementById('la-bags').value = '';
    document.getElementById('la-kg').value   = '';
    checkFoliarWarning();
  }
}

function checkFoliarWarning() {
  var method = (document.getElementById('la-method') || {}).value || '';
  var wsrc   = (document.getElementById('la-wsrc')   || {}).value || '';
  var warn   = document.getElementById('la-foliar-warn');
  if (!warn) return;
  warn.style.display = (method === 'foliar_spray' && wsrc === 'tubewell') ? 'block' : 'none';
}

// Dual bags ↔ kg conversion for application form
function laCalcFromBags() {
  var fertId = document.getElementById('la-fert').value;
  var fert   = landFerts.find(function(f) { return String(f.id) === fertId; });
  var bags   = parseFloat(document.getElementById('la-bags').value);
  if (!fert || !fert.quantity_per_purchase_unit || isNaN(bags) || bags <= 0) return;
  var kg = bags * parseFloat(fert.quantity_per_purchase_unit);
  document.getElementById('la-kg').value = r1(kg);
}

function laCalcFromKg() {
  var fertId = document.getElementById('la-fert').value;
  var fert   = landFerts.find(function(f) { return String(f.id) === fertId; });
  var kg     = parseFloat(document.getElementById('la-kg').value);
  if (!fert || !fert.quantity_per_purchase_unit || isNaN(kg) || kg <= 0) return;
  var qpu  = parseFloat(fert.quantity_per_purchase_unit);
  document.getElementById('la-bags').value = r1(kg / qpu);
}

function laOnFertChange() {
  // When fertilizer changes, recalculate from bags if bags has a value
  var bags = parseFloat(document.getElementById('la-bags').value);
  if (!isNaN(bags) && bags > 0) laCalcFromBags(); else laCalcFromKg();
}

function renderLandAppLog() {
  var plotF = (document.getElementById('land-app-plot-filter')  || {}).value || '';
  var fertF = (document.getElementById('land-app-fert-filter')  || {}).value || '';
  var rows  = landFertApps.filter(function(r) {
    if (plotF && String(r.field_plot_id) !== plotF) return false;
    if (fertF && String(r.fertilizer_id) !== fertF) return false;
    return true;
  });
  rows.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
  document.getElementById('land-app-count').textContent =
    rows.length + ' record' + (rows.length !== 1 ? 's' : '');
  var tbl = document.getElementById('land-app-table');
  if (!rows.length) { tbl.innerHTML = '<div class="empty">No applications logged yet.</div>'; return; }
  var totalKg = rows.reduce(function(s, r) { return s + (parseFloat(r.kg_applied) || 0); }, 0);
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Plot</th><th>Fertilizer</th>' +
    '<th class="right">kg applied</th><th>Method</th><th>Water source</th>' +
    '<th>Worker</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var fert    = r.fertilizer_id ? landFerts.find(function(f) { return f.id === r.fertilizer_id; }) : null;
    var wsrcWarn = r.application_method === 'foliar_spray' && r.water_source === 'tubewell';
    html += '<tr>' +
      '<td class="mono">' + fmtDate(r.date) + '</td>' +
      '<td style="font-weight:500">' + plotName(r.field_plot_id) + '</td>' +
      '<td>' + (fert ? '<span class="badge badge-amber">' + fert.name + '</span>' : '—') + '</td>' +
      '<td class="mono right">' + (r.kg_applied != null ? Math.round(r.kg_applied).toLocaleString() + ' kg' : '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (r.application_method || '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' +
        (wsrcWarn ? '<span style="color:var(--red)">⚠ ' + (r.water_source || '—') + '</span>' : (r.water_source || '—')) + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (r.workers ? r.workers.name : '—') + '</td>' +
      '<td class="muted-cell" style="font-size:12px">' + (r.notes || '') + '</td>' +
      '<td><button class="btn btn-sm del-btn" onclick="deleteFertApp(' + r.id + ')">Delete</button></td>' +
      '</tr>';
  });
  html += '<tr style="background:var(--bg)"><td colspan="3" style="font-weight:500;padding:10px 18px">Total applied</td>' +
    '<td class="mono right" style="font-weight:500">' + Math.round(totalKg).toLocaleString() + ' kg</td>' +
    '<td colspan="5"></td></tr>';
  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function submitLandApp() {
  var statusEl = document.getElementById('la-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('la-date').value;
    var plotId = document.getElementById('la-plot').value;
    var fertId = document.getElementById('la-fert').value;
    var kg     = parseFloat(document.getElementById('la-kg').value);
    var method = document.getElementById('la-method').value;
    var wsrc   = document.getElementById('la-wsrc').value;
    var worker = document.getElementById('la-worker').value;
    var notes  = (document.getElementById('la-notes').value || '').trim();
    if (!date || !plotId)      throw new Error('Date and plot are required.');
    if (!fertId)               throw new Error('Select a fertilizer from the registry.');
    if (isNaN(kg) || kg <= 0) throw new Error('Enter a valid kg amount.');
    if (method === 'foliar_spray' && (!wsrc || wsrc === 'na'))
      throw new Error('Water source is required for foliar spray applications.');
    var d = {
      date: date, field_plot_id: parseInt(plotId),
      fertilizer_id: parseInt(fertId), kg_applied: kg
    };
    if (method) d.application_method = method;
    if (wsrc)   d.water_source       = wsrc;
    if (worker) d.worker_id          = parseInt(worker);
    if (notes)  d.notes              = notes;
    await sbInsert('fertilizer_applications', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('land-app-form').style.display = 'none';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function deleteFertApp(id) {
  if (!confirm('Delete this application record?')) return;
  try {
    await sbDelete('fertilizer_applications', id);
    await loadLandPage();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

async function deleteLandFertPurchase(id) {
  if (!confirm('Delete this purchase record?')) return;
  try {
    await sbDelete('fertilizer_purchases', id);
    await loadLandPage();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

async function submitLandFertPurchase() {
  var statusEl = document.getElementById('lp-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var fertId = document.getElementById('lp-fert').value;
    var date   = document.getElementById('lp-date').value;
    var bags   = parseFloat(document.getElementById('lp-qty').value);
    var kg     = parseFloat(document.getElementById('lp-kg').value);
    var fert   = landFerts.find(function(f) { return String(f.id) === fertId; });
    // Accept bags (preferred) or kg fallback. Convert kg→bags if qpu known.
    var qpu    = fert && fert.quantity_per_purchase_unit ? parseFloat(fert.quantity_per_purchase_unit) : null;
    var qty;
    if (!isNaN(bags) && bags > 0) {
      qty = bags;
    } else if (!isNaN(kg) && kg > 0 && qpu) {
      qty = kg / qpu;
    } else if (!isNaN(kg) && kg > 0) {
      // No qpu — store kg directly as qty (stock calc uses qpu; without it stock shows as 0)
      qty = kg;
    } else {
      qty = NaN;
    }
    if (!fertId || !date || isNaN(qty) || qty <= 0)
      throw new Error('Fertilizer, date, and quantity are required.');
    var d = { fertilizer_id: parseInt(fertId), date: date, qty: qty };
    var cost = document.getElementById('lp-cost').value;
    if (cost) d.cost_per_unit = parseFloat(cost);
    var sup = (document.getElementById('lp-supplier').value || '').trim();
    if (sup) d.supplier = sup;
    var notes = (document.getElementById('lp-notes').value || '').trim();
    if (notes) d.notes = notes;
    await sbInsert('fertilizer_purchases', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() {
      document.getElementById('land-purch-modal').style.display = 'none';
      loadLandPage();
    }, 700);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ── Purchase modal: bags ↔ kg auto-fill ──────────────────────
function _lpFert() {
  var fertId = document.getElementById('lp-fert').value;
  return landFerts.find(function(f) { return String(f.id) === fertId; }) || null;
}
function lpCalcFromBags() {
  var fert = _lpFert();
  var bags = parseFloat(document.getElementById('lp-qty').value);
  if (!fert || !fert.quantity_per_purchase_unit || isNaN(bags) || bags <= 0) return;
  document.getElementById('lp-kg').value = r1(bags * parseFloat(fert.quantity_per_purchase_unit));
  lpUpdateCostPreview();
}
function lpCalcFromKg() {
  var fert = _lpFert();
  var kg   = parseFloat(document.getElementById('lp-kg').value);
  if (!fert || !fert.quantity_per_purchase_unit || isNaN(kg) || kg <= 0) return;
  document.getElementById('lp-qty').value = r1(kg / parseFloat(fert.quantity_per_purchase_unit));
  lpUpdateCostPreview();
}
function lpUpdateCostPreview() {
  var fert  = _lpFert();
  var cost  = parseFloat(document.getElementById('lp-cost').value);
  var bags  = parseFloat(document.getElementById('lp-qty').value);
  var kg    = parseFloat(document.getElementById('lp-kg').value);
  var prev  = document.getElementById('lp-cost-preview');
  var prevT = document.getElementById('lp-cost-preview-text');
  if (!fert || isNaN(cost) || cost <= 0) { prev.style.display = 'none'; return; }
  var su    = fert.type === 'liquid' ? 'L' : 'kg';
  var parts = [];
  var qpu   = fert.quantity_per_purchase_unit ? parseFloat(fert.quantity_per_purchase_unit) : null;
  if (qpu && !isNaN(bags) && bags > 0) parts.push(pkr(cost / qpu) + ' / ' + su);
  if (!isNaN(bags) && bags > 0) parts.push(pkr(cost * bags) + ' total');
  if (parts.length) { prev.style.display = 'block'; prevT.textContent = '→  ' + parts.join('   ·   '); }
  else { prev.style.display = 'none'; }
}
function updateLandPurchLabels() {
  var fert     = _lpFert();
  var isLiquid = fert && fert.type === 'liquid';
  var pu = isLiquid ? 'container' : 'bag';
  document.getElementById('lp-qty-label').textContent  = 'Bags / containers';
  document.getElementById('lp-cost-label').textContent = 'Cost per ' + pu + ' (PKR)';
  // Recalculate whichever direction has data
  var bags = parseFloat(document.getElementById('lp-qty').value);
  if (!isNaN(bags) && bags > 0) lpCalcFromBags(); else lpCalcFromKg();
}
function openLandPurchModal() {
  var sel = document.getElementById('lp-fert');
  sel.innerHTML = '<option value="">Select fertilizer</option>' +
    landFerts.filter(function(f) { return f.active; }).map(function(f) {
      var su  = f.type === 'liquid' ? 'L' : 'kg';
      var pu  = f.type === 'liquid' ? 'container' : 'bag';
      var qpu = f.quantity_per_purchase_unit ? ' · ' + f.quantity_per_purchase_unit + ' ' + su + '/' + pu : '';
      return '<option value="' + f.id + '">' + f.name + qpu + '</option>';
    }).join('');
  document.getElementById('lp-date').value = todayISO();
  ['lp-qty','lp-kg','lp-cost','lp-supplier','lp-notes'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('lp-cost-label').textContent   = 'Cost per bag (PKR)';
  document.getElementById('lp-cost-preview').style.display = 'none';
  document.getElementById('lp-status').textContent       = '';
  document.getElementById('land-purch-modal').style.display = 'flex';
}
function closeLandPurchModal() {
  document.getElementById('land-purch-modal').style.display = 'none';
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
    // Reset visible toggle buttons too
    var btnNew = document.getElementById('lc-mode-btn-new');
    var btnEx  = document.getElementById('lc-mode-btn-existing');
    if (btnNew) { btnNew.classList.add('active'); }
    if (btnEx)  { btnEx.classList.remove('active'); }
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

// setCropGroupMode — called by the visible segmented toggle buttons.
// Syncs the hidden radio inputs (used by submit logic) and updates
// button active state, then delegates to toggleGroupMode.
function setCropGroupMode(mode) {
  // Sync hidden radios
  document.querySelectorAll('input[name="lc-group-mode"]').forEach(function(r) {
    r.checked = (r.value === mode);
  });
  // Update button states
  var btnNew = document.getElementById('lc-mode-btn-new');
  var btnEx  = document.getElementById('lc-mode-btn-existing');
  if (btnNew) btnNew.classList.toggle('active', mode === 'new');
  if (btnEx)  btnEx.classList.toggle('active', mode === 'existing');
  // Show/hide fields
  toggleGroupMode();
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

// Returns the inner HTML of the observations panel — used both on initial render
// and by refreshCropObs / toggleObsShowAll for in-place DOM updates.
function buildObsPanelContent(c, observations, showAll) {
  var TRUNCATE = 10;
  var total    = observations.length;
  if (!total) {
    return '<div class="muted-cell" style="font-size:12px">No observations logged yet.</div>';
  }
  var displayed = showAll ? observations : observations.slice(0, TRUNCATE);
  var html = '<table style="width:100%;font-size:12px"><thead><tr>' +
    '<th>Date</th><th>Health</th><th>Flag</th><th>Note</th><th>Worker</th><th></th>' +
    '</tr></thead><tbody>';
  displayed.forEach(function(o) {
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
      '<td><input type="text" id="oe-note-' + oid + '" value="' + (o.notes || '').replace(/"/g,'&quot;') + '" style="font-size:11px;width:100%;min-width:160px"></td>' +
      '<td class="muted-cell" style="white-space:nowrap">' + (o.workers ? o.workers.name : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" style="font-size:11px" onclick="patchObservation(' + oid + ',' + c.id + ')">Save</button>' +
        '<button class="btn btn-sm" style="font-size:11px;color:var(--red);margin-left:4px" onclick="deleteObservation(' + oid + ',' + c.id + ')">Delete</button>' +
        '<span id="oe-status-' + oid + '" style="font-size:10px;color:var(--muted);margin-left:4px"></span>' +
      '</td></tr>';
  });
  html += '</tbody></table>';
  // Show a toggle when there are more rows than the truncation limit
  if (total > TRUNCATE) {
    html += '<div style="padding:6px 0">' +
      '<button class="btn btn-sm" style="font-size:11px" onclick="toggleObsShowAll(' + c.id + ')">' +
      (showAll ? 'Show fewer' : 'Show all ' + total + ' observations') +
      '</button></div>';
  }
  return html;
}

function buildObsPanel(c, observations) {
  // Wrapper div uses obs-panel-{id} so toggleCropObs / refreshCropObs can target it
  return '<div id="obs-panel-' + c.id + '" style="display:none;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)">' +
    buildObsPanelContent(c, observations, false) +
    '</div>';
}

function buildObsForm(c, workers) {
  var html = '<div id="obs-form-' + c.id + '" style="display:none;padding:14px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  html += '<div style="font-size:12px;font-weight:500;margin-bottom:8px">Log observation — ' + getCropDisplayName(c) + '</div>';
  // 4-column grid: date, health (required), pest flag, worker
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px">';
  html += '<div><label style="font-size:11px;color:var(--muted)">Date</label>' +
    '<input type="date" id="of-date-' + c.id + '" value="' + todayISO() + '" style="width:100%"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Health status <span style="color:var(--red)">*</span></label>' +
    '<select id="of-health-' + c.id + '" style="width:100%">' +
    '<option value="">— select —</option>' +
    ['unknown','good','stressed','failing'].map(function(v) { return '<option value="' + v + '">' + v + '</option>'; }).join('') +
    '</select></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Pest / disease flag</label><select id="of-flag-' + c.id + '" style="width:100%"><option value="false">No</option><option value="true">Yes ⚠</option></select></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Worker</label><select id="of-worker-' + c.id + '" style="width:100%">' +
    '<option value="">—</option>' +
    workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
    '</select></div>';
  html += '</div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Note</label><input type="text" id="of-note-' + c.id + '" style="width:100%" placeholder="observations, growth stage, issues…"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px">';
  html += '<button class="btn btn-primary btn-sm" onclick="submitObservation(' + c.id + ')">Save observation</button>';
  html += '<button class="btn btn-sm" onclick="closeObsForm(' + c.id + ')">Cancel</button>';
  html += '<span id="of-status-' + c.id + '" style="font-size:12px;color:var(--muted);align-self:center"></span>';
  html += '</div></div>';
  return html;
}

function buildGroupHarvestForm(g, workers) {
  // Simple log form — no destination. Routing happens via the Allocate flow.
  var gid  = g.id;
  var html = '<div id="harvest-form-g' + gid + '" style="display:none;padding:14px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  html += '<div style="font-size:12px;font-weight:500;margin-bottom:8px">Log harvest</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px">';
  html += '<div><label style="font-size:11px;color:var(--muted)">Date</label>' +
    '<input type="date" id="hf-date-g' + gid + '" value="' + todayISO() + '" style="width:100%"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Quantity (kg)</label>' +
    '<input type="number" id="hf-kg-g' + gid + '" min="0" step="0.5" style="width:100%" placeholder="kg"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Quality notes</label>' +
    '<input type="text" id="hf-qual-g' + gid + '" style="width:100%" placeholder="optional"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Worker</label><select id="hf-worker-g' + gid + '" style="width:100%">' +
    '<option value="">—</option>' +
    workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
    '</select></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:4px">';
  html += '<button class="btn btn-primary btn-sm" onclick="submitHarvestEvent(' + gid + ')">Save harvest</button>';
  html += '<button class="btn btn-sm" onclick="document.getElementById(\'harvest-form-g' + gid + '\').style.display=\'none\'">Cancel</button>';
  html += '<span id="hf-status-g' + gid + '" style="font-size:12px;color:var(--muted);align-self:center"></span>';
  html += '</div></div>';
  return html;
}

// ============================================================
// UNALLOCATED HARVEST PANEL
// ============================================================
// Shows all harvest events that haven't been fully routed to a
// destination yet, so nothing falls through the cracks.
function renderUnallocatedPanel(allocMap) {
  var panel   = document.getElementById('land-unalloc-panel');
  var section = document.getElementById('land-alloc-section');
  var metaEl  = document.getElementById('land-alloc-meta');
  if (!panel) return;

  // Find every harvest that is not yet marked fully allocated
  var pending = landHarvests.filter(function(h) { return !h.allocated; });

  // Show or hide the entire pane — nothing pending means nothing to display
  if (section) section.style.display = pending.length ? 'block' : 'none';

  if (!pending.length) {
    panel.innerHTML = '';
    return;
  }

  if (metaEl) metaEl.textContent = pending.length + ' harvest' + (pending.length !== 1 ? 's' : '') + ' awaiting allocation';

  // Group pending harvests by crop group
  var byGroup = {};
  pending.forEach(function(h) {
    var gid = h.crop_group_id;
    if (!byGroup[gid]) byGroup[gid] = [];
    byGroup[gid].push(h);
  });

  var html = '<div style="border:1px solid var(--amber-bdr,#f5d78a);border-radius:8px;overflow:hidden">';
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="background:var(--amber-lt,#fdf8ec)">';
  html += '<th style="padding:8px 18px;text-align:left">Group / Crop</th>';
  html += '<th style="padding:8px 12px;text-align:left">Plot</th>';
  html += '<th style="padding:8px 12px">Date</th>';
  html += '<th style="padding:8px 12px;text-align:right">kg</th>';
  html += '<th style="padding:8px 12px;text-align:left">Allocated</th>';
  html += '<th style="padding:8px 18px"></th>';
  html += '</tr></thead><tbody>';

  Object.keys(byGroup).forEach(function(gid) {
    var g       = landCropGroups.find(function(x) { return x.id === parseInt(gid); });
    var gName   = g ? (g.name || plotName(g.field_plot_id)) : 'Group ' + gid;
    var gPlot   = g ? plotName(g.field_plot_id) : '—';
    var rows    = byGroup[gid];
    rows.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    rows.forEach(function(h) {
      var hKg       = parseFloat(h.quantity_kg) || 0;
      var allocKg   = allocMap[h.id] || 0;
      var remKg     = hKg - allocKg;
      var gNameSafe = gName.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      var badge     = allocKg > 0
        ? '<span class="badge badge-amber" style="font-size:10px">' + allocKg.toFixed(1) + '/' + hKg.toFixed(1) + ' kg</span>'
        : '<span class="badge badge-gray" style="font-size:10px">None</span>';
      html += '<tr style="border-top:1px solid var(--border-lt,#f0ece2)">';
      html += '<td style="padding:8px 18px;font-weight:500">' + gName + '</td>';
      html += '<td style="padding:8px 12px;color:var(--muted)">' + gPlot + '</td>';
      html += '<td style="padding:8px 12px;text-align:center">' + (h.date ? fmtDate(h.date) : '—') + '</td>';
      html += '<td style="padding:8px 12px;text-align:right">' + hKg.toFixed(1) + '</td>';
      html += '<td style="padding:8px 12px">' + badge + '</td>';
      html += '<td style="padding:8px 18px;text-align:right">';
      html += '<button class="btn btn-sm btn-primary" style="font-size:11px" ' +
        'onclick="openHarvestAllocModal(' + h.id + ',' + gid + ',' + hKg + ',\'' + gNameSafe + '\')">Allocate</button>';
      html += '</td></tr>';
    });
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

function renderLandCrops() {
  var activeOnly = !(document.getElementById('lc-show-all') || {}).checked;
  var plotF      = (document.getElementById('lc-plot-filter') || {}).value || '';
  var workers    = (typeof anSharedWorkers !== 'undefined' && anSharedWorkers.length) ? anSharedWorkers : landWorkers;

  // Build allocation map: harvest_event_id → total allocated kg
  var allocMap = {};
  landAllocations.forEach(function(a) {
    if (!allocMap[a.harvest_event_id]) allocMap[a.harvest_event_id] = 0;
    allocMap[a.harvest_event_id] += parseFloat(a.quantity_kg) || 0;
  });

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

  // ── UNALLOCATED HARVEST PANEL — always rendered above the group cards ──
  renderUnallocatedPanel(allocMap);

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
      members.forEach(function(c, ci) {
        var cObs  = landObservations.filter(function(o) { return o.plot_crop_id === c.id; });
        var cFeed = getCropFeedingNotes(c);
        // Stronger separator between crops (dashed) vs the card header border (solid) —
        // first item has no top border since the section header already provides one
        var sepStyle = ci === 0
          ? 'padding:6px 0 4px'
          : 'padding:10px 0 4px;border-top:1px dashed var(--border)';

        // Two-column layout: left grows freely (name + badges + safety note),
        // right stays fixed (action buttons). min-width:0 + overflow-wrap on the
        // left column ensures long safety notes wrap before reaching the buttons.
        html += '<div style="' + sepStyle + '">';
        html += '<div style="display:flex;align-items:' + (cFeed ? 'flex-start' : 'center') + ';gap:8px">';

        // Left column — name, badges, sow date, feed safety note
        html += '<div style="flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;display:flex;flex-direction:column;gap:3px">';
        html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
        html += '<span style="font-size:12px;font-weight:500">' + getCropDisplayName(c) + '</span>';
        if (c.role) html += '<span class="badge badge-gray" style="font-size:10px">' + (CROP_ROLE_LABELS[c.role] || c.role) + '</span>';
        if (c.health_status && c.health_status !== 'unknown') html += '<span class="badge ' + (HEALTH_BADGE[c.health_status] || 'badge-gray') + '" style="font-size:10px">' + c.health_status + '</span>';
        if (c.pest_disease_flag) html += '<span style="color:var(--red);font-size:11px">⚠</span>' +
          '<button class="btn btn-sm" style="font-size:10px;padding:1px 6px;color:var(--muted)" onclick="resolvePestFlag(' + c.id + ')">Resolve</button>';
        if (c.sow_date) html += '<span class="muted-cell" style="font-size:11px">Sown: ' + fmtDate(c.sow_date) + '</span>';
        html += '</div>';
        if (cFeed) html += '<div style="font-size:11px;color:var(--amber);overflow-wrap:break-word">⚠ ' + cFeed + '</div>';
        html += '</div>';

        // Right column — action buttons, no-wrap, always top-aligned when feed note present
        html += '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;padding-top:' + (cFeed ? '2px' : '0') + '">';
        html += '<button id="obs-btn-' + c.id + '" class="btn btn-sm" style="font-size:10px" onclick="toggleCropObs(' + c.id + ')">Obs (' + cObs.length + ')</button>';
        if (c.status === 'growing') {
          html += '<button class="btn btn-sm" style="font-size:10px" onclick="openObsForm(' + c.id + ')">+ Obs</button>';
          html += '<button class="btn btn-sm" style="font-size:10px;color:var(--muted)" onclick="terminateCrop(' + c.id + ')">End</button>';
        }
        html += '</div>';

        html += '</div>'; // end two-column row
        html += '</div>'; // end crop separator wrapper
        html += buildObsPanel(c, cObs);
        html += buildObsForm(c, workers);
      });
      html += '</div>';
    }

    // Pre-compute single-member obs once — used in both the actions bar button and the panel below
    var mObs = (!isMulti && members.length === 1)
      ? landObservations.filter(function(o) { return o.plot_crop_id === members[0].id; })
      : [];
    // Plot-level observations for this group's field plot
    var pObs = landPlotObservations.filter(function(o) { return o.field_plot_id === g.field_plot_id; });

    // ── ACTIONS BAR ──
    html += '<div class="crop-events-wrap">';
    html += '<button class="btn btn-sm" style="font-size:11px" onclick="toggleGroupHarvests(' + g.id + ')">Harvests (' + harvests.length + ')</button>';
    if (!isMulti && members.length === 1) {
      html += '<button id="obs-btn-' + members[0].id + '" class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="toggleCropObs(' + members[0].id + ')">Crop Obs (' + mObs.length + ')</button>';
    }
    // Plot-level obs button — always shown; these are whole-plot notes (emergence, conditions, etc.)
    html += '<button id="plot-obs-btn-' + g.id + '" class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="togglePlotObs(' + g.id + ',' + g.field_plot_id + ')">Plot Obs (' + pObs.length + ')</button>';
    if (anyGrowing) {
      html += '<button class="btn btn-sm btn-primary" style="font-size:11px;margin-left:6px" onclick="openGroupHarvestForm(' + g.id + ')">+ Log harvest</button>';
      html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="openPlotObsForm(' + g.id + ')">+ Plot Obs</button>';
      if (!isMulti && members.length === 1) {
        html += '<button class="btn btn-sm" style="font-size:11px;margin-left:6px" onclick="openObsForm(' + members[0].id + ')">+ Crop Obs</button>';
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
        '<th>Cut</th><th>Date</th><th class="right">kg</th><th>Quality</th><th>Allocation</th><th>Worker</th><th></th>' +
        '</tr></thead><tbody>';
      harvests.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      harvests.forEach(function(h) {
        var hid         = h.id;
        var hKg         = parseFloat(h.quantity_kg) || 0;
        var allocatedKg = allocMap[hid] || 0;
        var fullyAlloc  = h.allocated === true;
        var partAlloc   = !fullyAlloc && allocatedKg > 0;
        var allocBadge  = fullyAlloc
          ? '<span class="badge badge-green" style="font-size:10px">Allocated</span>'
          : (partAlloc
              ? '<span class="badge badge-amber" style="font-size:10px">Partial ' + allocatedKg.toFixed(1) + '/' + hKg.toFixed(1) + ' kg</span>'
              : '<span class="badge badge-gray" style="font-size:10px">Unallocated</span>');
        var gNameSafe = (g.name || 'Group').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var allocBtn = !fullyAlloc
          ? '<button class="btn btn-sm" style="font-size:10px;margin-left:4px" onclick="openHarvestAllocModal(' + hid + ',' + g.id + ',' + hKg + ',\'' + gNameSafe + '\')">Allocate</button>'
          : '';
        html += '<tr>' +
          '<td class="muted-cell">' + (h.cut_number || '—') + '</td>' +
          '<td><input type="date" id="he-date-' + hid + '" value="' + (h.date || '') + '" style="font-size:11px;width:100%"></td>' +
          '<td><input type="number" id="he-kg-' + hid + '" value="' + (hKg > 0 ? hKg.toFixed(1) : '') + '" min="0" step="0.5" style="font-size:11px;width:80px" placeholder="kg"></td>' +
          '<td><input type="text" id="he-qual-' + hid + '" value="' + (h.quality_notes || '').replace(/"/g,'&quot;') + '" style="font-size:11px;width:100%;min-width:120px" placeholder="—"></td>' +
          '<td style="white-space:nowrap">' + allocBadge + allocBtn + '</td>' +
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
    html += buildGroupHarvestForm(g, workers);

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

    // ── OBS PANELS / FORMS for single-member (mObs already computed above) ──
    if (!isMulti && members.length === 1) {
      html += buildObsPanel(members[0], mObs);
      html += buildObsForm(members[0], workers);
    }

    // ── PLOT-LEVEL OBS PANEL / FORM (pObs already computed above) ──
    html += buildPlotObsPanel(g, pObs);
    html += buildPlotObsForm(g, workers);

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
  var panelEl = document.getElementById('obs-panel-' + cropId);
  var formEl  = document.getElementById('obs-form-'  + cropId);
  if (!panelEl) return;
  var opening = panelEl.style.display === 'none';
  panelEl.style.display = opening ? 'block' : 'none';
  // Close the log form whenever the panel opens, to avoid both showing at once
  if (opening && formEl) formEl.style.display = 'none';
}
function openObsForm(cropId) {
  var formEl  = document.getElementById('obs-form-'  + cropId);
  var panelEl = document.getElementById('obs-panel-' + cropId);
  if (!formEl) return;
  // Close the obs panel when opening the log form
  if (panelEl) panelEl.style.display = 'none';
  formEl.style.display = 'block';
  formEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function closeObsForm(cropId) {
  var formEl = document.getElementById('obs-form-' + cropId);
  if (formEl) formEl.style.display = 'none';
}

// Re-fetches observations and the plot_crops record for a single crop and rebuilds
// the obs panel in-place, avoiding a full page reload for every obs action.
async function refreshCropObs(cropId, keepOpen) {
  try {
    var freshObs = await sbGet('crop_observations',
      'select=id,plot_crop_id,observed_at,health_status,pest_disease_flag,notes,recorded_by,' +
      'workers!recorded_by(name)&plot_crop_id=eq.' + cropId + '&order=observed_at.desc');
    // Splice fresh data into module state
    landObservations = landObservations
      .filter(function(o) { return o.plot_crop_id !== cropId; })
      .concat(freshObs);

    var freshCropRows = await sbGet('plot_crops',
      'select=id,field_plot_id,crop_id,crop_name,role,status,health_status,germination_outcome,' +
      'pest_disease_flag,sow_date,expected_termination_date,termination_date,notes,harvest_type,crop_group_id' +
      '&id=eq.' + cropId);
    if (freshCropRows && freshCropRows.length) {
      var idx = landCrops.findIndex(function(c) { return c.id === cropId; });
      if (idx >= 0) landCrops[idx] = freshCropRows[0];
    }

    // Rebuild panel content in-place
    var panelEl = document.getElementById('obs-panel-' + cropId);
    var c       = landCrops.find(function(x) { return x.id === cropId; });
    if (panelEl && c) {
      panelEl.innerHTML = buildObsPanelContent(c, freshObs, !!obsExpandedCrops[cropId]);
      if (keepOpen) panelEl.style.display = 'block';
    }

    // Update the count on the "Obs (N)" button if it is in the DOM
    var btnEl = document.getElementById('obs-btn-' + cropId);
    if (btnEl) btnEl.textContent = 'Observations (' + freshObs.length + ')';
  } catch (err) {
    console.error('refreshCropObs failed, falling back to full reload:', err);
    await loadLandPage();
  }
}

// Toggle between truncated (10) and full observation list without a network round-trip.
function toggleObsShowAll(cropId) {
  obsExpandedCrops[cropId] = !obsExpandedCrops[cropId];
  var panelEl = document.getElementById('obs-panel-' + cropId);
  if (!panelEl) return;
  var c   = landCrops.find(function(x) { return x.id === cropId; });
  var obs = landObservations.filter(function(o) { return o.plot_crop_id === cropId; });
  if (c) panelEl.innerHTML = buildObsPanelContent(c, obs, !!obsExpandedCrops[cropId]);
}

// ============================================================
// PLOT-LEVEL OBSERVATIONS
// ============================================================
// These are whole-plot notes independent of any specific crop:
// seed emergence events, general condition snapshots, pest
// sightings at the plot scale, irrigation observations, etc.
// Stored in plot_observations (field_plot_id, not plot_crop_id).

function buildPlotObsPanelContent(pObs, gId, plotId) {
  if (!pObs.length) {
    return '<div class="muted-cell" style="font-size:12px">No plot observations logged yet.</div>';
  }
  var html = '<table style="width:100%;font-size:12px"><thead><tr>' +
    '<th>Date</th><th>Notes</th><th>Worker</th><th></th>' +
    '</tr></thead><tbody>';
  pObs.forEach(function(o) {
    var oid = o.id;
    html += '<tr>' +
      '<td class="mono" style="white-space:nowrap">' + fmtDate((o.observed_at || '').slice(0, 10)) + '</td>' +
      '<td><input type="text" id="poe-note-' + oid + '" value="' + (o.notes || '').replace(/"/g, '&quot;') +
        '" style="font-size:11px;width:100%;min-width:200px"></td>' +
      '<td class="muted-cell" style="white-space:nowrap">' + (o.workers ? o.workers.name : '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-sm" style="font-size:11px" onclick="patchPlotObs(' + oid + ',' + gId + ',' + plotId + ')">Save</button>' +
        '<button class="btn btn-sm" style="font-size:11px;color:var(--red);margin-left:4px" onclick="deletePlotObs(' + oid + ',' + gId + ',' + plotId + ')">Delete</button>' +
        '<span id="poe-status-' + oid + '" style="font-size:10px;color:var(--muted);margin-left:4px"></span>' +
      '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildPlotObsPanel(g, pObs) {
  return '<div id="plot-obs-panel-' + g.id + '" style="display:none;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)">' +
    buildPlotObsPanelContent(pObs, g.id, g.field_plot_id) +
    '</div>';
}

function buildPlotObsForm(g, workers) {
  var gid    = g.id;
  var plotId = g.field_plot_id;
  var html   = '<div id="plot-obs-form-' + gid + '" style="display:none;padding:14px 18px;background:var(--bg);border-top:1px solid var(--border)">';
  html += '<div style="font-size:12px;font-weight:500;margin-bottom:8px">Log plot observation — ' + plotName(plotId) + '</div>';
  html += '<div style="display:grid;grid-template-columns:140px 1fr 140px;gap:8px;margin-bottom:8px">';
  html += '<div><label style="font-size:11px;color:var(--muted)">Date</label>' +
    '<input type="date" id="pof-date-' + gid + '" value="' + todayISO() + '" style="width:100%"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Notes <span style="color:var(--red)">*</span></label>' +
    '<input type="text" id="pof-note-' + gid + '" style="width:100%" placeholder="emergence, dry conditions, pest sighting, soil moisture…"></div>';
  html += '<div><label style="font-size:11px;color:var(--muted)">Worker</label>' +
    '<select id="pof-worker-' + gid + '" style="width:100%">' +
    '<option value="">—</option>' +
    workers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
    '</select></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:4px">';
  html += '<button class="btn btn-primary btn-sm" onclick="submitPlotObservation(' + gid + ',' + plotId + ')">Save observation</button>';
  html += '<button class="btn btn-sm" onclick="closePlotObsForm(' + gid + ')">Cancel</button>';
  html += '<span id="pof-status-' + gid + '" style="font-size:12px;color:var(--muted);align-self:center"></span>';
  html += '</div></div>';
  return html;
}

function togglePlotObs(gId, plotId) {
  var panelEl = document.getElementById('plot-obs-panel-' + gId);
  var formEl  = document.getElementById('plot-obs-form-'  + gId);
  if (!panelEl) return;
  var opening = panelEl.style.display === 'none';
  panelEl.style.display = opening ? 'block' : 'none';
  // Close the log form when the panel opens
  if (opening && formEl) formEl.style.display = 'none';
}

function openPlotObsForm(gId) {
  var formEl  = document.getElementById('plot-obs-form-'  + gId);
  var panelEl = document.getElementById('plot-obs-panel-' + gId);
  if (!formEl) return;
  if (panelEl) panelEl.style.display = 'none';
  formEl.style.display = 'block';
  formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePlotObsForm(gId) {
  var formEl = document.getElementById('plot-obs-form-' + gId);
  if (formEl) formEl.style.display = 'none';
}

// Re-fetches plot observations for a single plot and rebuilds the panel in-place.
async function refreshPlotObs(gId, plotId, keepOpen) {
  try {
    var freshObs = await sbGet('plot_observations',
      'select=id,field_plot_id,observed_at,notes,recorded_by,workers!recorded_by(name)' +
      '&field_plot_id=eq.' + plotId + '&order=observed_at.desc');
    // Splice fresh data into module state
    landPlotObservations = landPlotObservations
      .filter(function(o) { return o.field_plot_id !== plotId; })
      .concat(freshObs);
    // Rebuild panel
    var panelEl = document.getElementById('plot-obs-panel-' + gId);
    if (panelEl) {
      panelEl.innerHTML = buildPlotObsPanelContent(freshObs, gId, plotId);
      if (keepOpen) panelEl.style.display = 'block';
    }
    // Update button count
    var btnEl = document.getElementById('plot-obs-btn-' + gId);
    if (btnEl) btnEl.textContent = 'Plot Obs (' + freshObs.length + ')';
  } catch (err) {
    console.error('refreshPlotObs failed, falling back to full reload:', err);
    await loadLandPage();
  }
}

async function patchPlotObs(obsId, gId, plotId) {
  var statusEl = document.getElementById('poe-status-' + obsId);
  statusEl.textContent = '…'; statusEl.style.color = 'var(--muted)';
  try {
    var note = (document.getElementById('poe-note-' + obsId).value || '').trim();
    if (!note) throw new Error('Note cannot be empty.');
    await sbPatch('plot_observations', obsId, { notes: note });
    // Update module state in-place so a re-read is not needed
    var obs = landPlotObservations.find(function(o) { return o.id === obsId; });
    if (obs) obs.notes = note;
    statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 1500);
  } catch (err) {
    statusEl.textContent = 'Error'; statusEl.style.color = 'var(--red)';
    alert('Update failed: ' + err.message);
  }
}

async function deletePlotObs(obsId, gId, plotId) {
  if (!confirm('Delete this plot observation? This cannot be undone.')) return;
  try {
    await sbDelete('plot_observations', obsId);
    await refreshPlotObs(gId, plotId, true);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function submitPlotObservation(gId, plotId) {
  var statusEl = document.getElementById('pof-status-' + gId);
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date = document.getElementById('pof-date-'   + gId).value;
    var note = (document.getElementById('pof-note-'  + gId).value || '').trim();
    var wId  = document.getElementById('pof-worker-' + gId).value;
    if (!date) throw new Error('Date is required.');
    if (!note) throw new Error('Notes are required.');
    var d = { field_plot_id: plotId, observed_at: date, notes: note };
    if (wId) d.recorded_by = parseInt(wId);
    await sbInsert('plot_observations', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    closePlotObsForm(gId);
    await refreshPlotObs(gId, plotId, true);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
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
      health_status: 'unknown'
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
    var wId  = document.getElementById('hf-worker-g' + groupId).value;
    var qual = (document.getElementById('hf-qual-g' + groupId).value || '').trim();
    if (!date) throw new Error('Date required.');
    if (!kg || parseFloat(kg) <= 0) throw new Error('Quantity (kg) is required.');
    var prevCuts = landHarvests.filter(function(h) { return h.crop_group_id === groupId; }).length;
    var d = { crop_group_id: groupId, date: date, cut_number: prevCuts + 1, quantity_kg: parseFloat(kg) };
    if (wId)  d.recorded_by   = parseInt(wId);
    if (qual) d.quality_notes = qual;
    await sbInsert('crop_harvest_events', [d]);
    statusEl.textContent = 'Saved. Tap Allocate to route this harvest.';
    statusEl.style.color = 'var(--green)';
    await loadLandPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

async function submitObservation(cropId) {
  var statusEl = document.getElementById('of-status-' + cropId);
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var date   = document.getElementById('of-date-'   + cropId).value;
    var health = document.getElementById('of-health-' + cropId).value;
    var flag   = document.getElementById('of-flag-'   + cropId).value === 'true';
    var wId    = document.getElementById('of-worker-' + cropId).value;
    var note   = (document.getElementById('of-note-'  + cropId).value || '').trim();
    if (!date)   throw new Error('Date is required.');
    if (!health) throw new Error('Health status is required.');
    var d = { plot_crop_id: cropId, health_status: health, pest_disease_flag: flag,
              observed_at: date + 'T00:00:00.000Z' };
    if (note) d.notes       = note;
    if (wId)  d.recorded_by = parseInt(wId);
    await sbInsert('crop_observations', [d]);
    await sbPatch('plot_crops', cropId, { health_status: health, pest_disease_flag: flag });
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    closeObsForm(cropId);
    await refreshCropObs(cropId, true);
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
    await sbPatch('crop_observations', obsId, { health_status: health, pest_disease_flag: flag, notes: note || null });
    // Always sync plot_crops — the saved health/flag reflects current crop reality
    await sbPatch('plot_crops', cropId, { health_status: health, pest_disease_flag: flag });
    statusEl.textContent = '✓'; statusEl.style.color = 'var(--green)';
    await refreshCropObs(cropId, true);
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
    // Roll plot_crops back to the next most-recent obs so health badge stays accurate
    var remaining = landObservations
      .filter(function(o) { return o.plot_crop_id === cropId && o.id !== obsId; })
      .sort(function(a, b) { return (b.observed_at || '').localeCompare(a.observed_at || ''); });
    var next = remaining[0];
    await sbPatch('plot_crops', cropId, {
      health_status:     next ? next.health_status    : 'unknown',
      pest_disease_flag: next ? next.pest_disease_flag : false
    });
    await refreshCropObs(cropId, true);
  } catch (err) { alert('Delete failed: ' + err.message); }
}

async function patchHarvest(hid) {
  var statusEl = document.getElementById('he-status-' + hid);
  statusEl.textContent = '…'; statusEl.style.color = 'var(--muted)';
  try {
    var date = document.getElementById('he-date-' + hid).value;
    var kg   = document.getElementById('he-kg-'   + hid).value;
    var qual = (document.getElementById('he-qual-' + hid).value || '').trim();
    if (!date) throw new Error('Date is required.');
    await sbPatch('crop_harvest_events', hid, {
      date:          date,
      quantity_kg:   kg ? parseFloat(kg) : null,
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

// ============================================================
// PHASE 2: HARVEST ALLOCATION MODAL
// ============================================================
// State
var p2AllocHid            = null;   // harvest event id
var p2AllocGroupId        = null;   // crop group id
var p2AllocTotalKg        = 0;
var p2AllocRows           = [];     // [{id, destination, kg, ingredientId}]
var p2NextRowId           = 0;
var p2AllocPermittedDests = null;   // null = show all; array = filtered keys

function openHarvestAllocModal(hid, groupId, totalKg, groupName) {
  p2AllocHid     = hid;
  p2AllocGroupId = groupId;
  p2AllocTotalKg = totalKg;
  p2AllocRows    = [];
  p2NextRowId    = 0;

  // Derive permitted destinations from the crops in this group.
  // Union of permitted_destinations across all crops; null means show all.
  var groupCrops = landCrops.filter(function(c) { return c.crop_group_id === groupId; });
  var permitted  = {};
  var anySet     = false;
  groupCrops.forEach(function(c) {
    var reg = landCropRegistry.find(function(r) { return r.id === c.crop_id; });
    if (reg && reg.permitted_destinations && reg.permitted_destinations.length) {
      anySet = true;
      reg.permitted_destinations.forEach(function(k) { permitted[k] = true; });
    }
  });
  p2AllocPermittedDests = anySet ? Object.keys(permitted) : null;

  var el = document.getElementById('ha-modal-title');
  if (el) el.textContent = 'Allocate harvest — ' + groupName;

  var sumEl = document.getElementById('ha-total-kg');
  if (sumEl) sumEl.textContent = totalKg.toFixed(1) + ' kg total';

  document.getElementById('ha-status').textContent = '';
  p2AddAllocRow();
  p2UpdateRemaining();
  document.getElementById('harvest-alloc-modal').style.display = 'flex';
}

function closeHarvestAllocModal() {
  document.getElementById('harvest-alloc-modal').style.display = 'none';
}

function p2AddAllocRow() {
  var rid = p2NextRowId++;
  p2AllocRows.push({ id: rid, destination: '', kg: '', ingredientId: '' });
  p2RenderAllocRows();
}

function p2RemoveAllocRow(rid) {
  p2AllocRows = p2AllocRows.filter(function(r) { return r.id !== rid; });
  p2RenderAllocRows();
  p2UpdateRemaining();
}

// Returns the destinations list to show in the modal — filtered by permitted
// destinations if the crop has them set, otherwise all active destinations.
function p2GetVisibleDests() {
  if (!p2AllocPermittedDests) return landDestinations;
  return landDestinations.filter(function(d) {
    return p2AllocPermittedDests.indexOf(d.key) >= 0;
  });
}

function p2RenderAllocRows() {
  var container = document.getElementById('ha-rows');
  if (!container) return;

  var visibleDests = p2GetVisibleDests();

  // Only feed-eligible ingredients in the ingredient picker
  var feedIngs = landIngredients.filter(function(i) { return i.feed_eligible; });
  var ingOpts  = '<option value="">Select ingredient</option>' +
    feedIngs.map(function(i) {
      return '<option value="' + i.id + '">' + i.name +
        (i.category ? ' (' + i.category + ')' : '') + '</option>';
    }).join('');

  var html = '';
  p2AllocRows.forEach(function(row) {
    var destOpts = '<option value="">Select destination</option>' +
      visibleDests.map(function(d) {
        return '<option value="' + d.key + '"' + (row.destination === d.key ? ' selected' : '') + '>' + d.label + '</option>';
      }).join('');

    html += '<div class="ha-row" id="ha-row-' + row.id + '" style="display:grid;grid-template-columns:1fr 100px 1fr 80px;gap:8px;align-items:end;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border-lt,#ede9de)">';

    // Destination
    html += '<div><label style="font-size:11px;color:var(--muted)">Destination</label>' +
      '<select style="width:100%" onchange="p2RowDestChange(' + row.id + ',this.value)">' + destOpts + '</select></div>';

    // kg
    html += '<div><label style="font-size:11px;color:var(--muted)">kg</label>' +
      '<input type="number" value="' + row.kg + '" min="0.01" step="0.5" style="width:100%" placeholder="kg" ' +
      'oninput="p2RowKgChange(' + row.id + ',this.value)"></div>';

    // Ingredient (shown only for feed_inventory destination)
    var ingStyle = row.destination === 'feed_inventory' ? '' : 'visibility:hidden';
    html += '<div style="' + ingStyle + '"><label style="font-size:11px;color:var(--muted)">Ingredient</label>' +
      '<select id="ha-ing-' + row.id + '" style="width:100%">' + ingOpts + '</select></div>';

    // Remove button
    html += '<div><button class="btn btn-sm del-btn" style="width:100%" onclick="p2RemoveAllocRow(' + row.id + ')">Remove</button></div>';
    html += '</div>';
  });

  container.innerHTML = html;

  // Restore ingredient selections after re-render
  p2AllocRows.forEach(function(row) {
    var sel = document.getElementById('ha-ing-' + row.id);
    if (sel && row.ingredientId) sel.value = row.ingredientId;
  });
}

function p2RowDestChange(rid, dest) {
  var row = p2AllocRows.find(function(r) { return r.id === rid; });
  if (row) row.destination = dest;
  // Show/hide ingredient field — only relevant for feed inventory allocations
  var ingDiv = (document.getElementById('ha-ing-' + rid) || {}).parentElement;
  if (ingDiv) ingDiv.style.visibility = dest === 'feed_inventory' ? '' : 'hidden';
}

function p2RowKgChange(rid, val) {
  var row = p2AllocRows.find(function(r) { return r.id === rid; });
  if (row) row.kg = val;
  p2UpdateRemaining();
}

function p2UpdateRemaining() {
  var used = p2AllocRows.reduce(function(s, r) { return s + (parseFloat(r.kg) || 0); }, 0);
  var rem  = p2AllocTotalKg - used;
  var el   = document.getElementById('ha-remaining');
  if (el) {
    el.textContent = rem.toFixed(1) + ' kg remaining';
    el.style.color = rem < 0 ? 'var(--red)' : rem === 0 ? 'var(--green)' : 'var(--muted)';
  }
}

async function submitHarvestAlloc() {
  var statusEl = document.getElementById('ha-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    if (!p2AllocHid) throw new Error('No harvest event selected.');
    if (!p2AllocRows.length) throw new Error('Add at least one allocation row.');

    // Read current values from DOM
    p2AllocRows.forEach(function(row) {
      var ingEl = document.getElementById('ha-ing-' + row.id);
      if (ingEl) row.ingredientId = ingEl.value;
    });

    // Validate
    var totalUsed = 0;
    p2AllocRows.forEach(function(row, i) {
      var dest = row.destination;
      var kg   = parseFloat(row.kg);
      if (!dest) throw new Error('Row ' + (i + 1) + ': select a destination.');
      if (isNaN(kg) || kg <= 0) throw new Error('Row ' + (i + 1) + ': enter a valid quantity.');
      if (dest === 'feed_inventory' && !row.ingredientId)
        throw new Error('Row ' + (i + 1) + ': select an ingredient for feed inventory.');
      totalUsed += kg;
    });
    if (totalUsed > p2AllocTotalKg + 0.01)
      throw new Error('Total allocated (' + totalUsed.toFixed(1) + ' kg) exceeds harvest total (' + p2AllocTotalKg.toFixed(1) + ' kg).');

    // Find primary crop for seed allocations
    var primaryCrop = landCrops.find(function(c) {
      return c.crop_group_id === p2AllocGroupId && c.role === 'primary';
    }) || landCrops.find(function(c) { return c.crop_group_id === p2AllocGroupId; });
    var seedCropId = primaryCrop ? primaryCrop.crop_id : null;

    // Insert allocation rows and downstream records
    for (var i = 0; i < p2AllocRows.length; i++) {
      var row  = p2AllocRows[i];
      var dest = row.destination;
      var kg   = parseFloat(row.kg);
      var ingId = row.ingredientId ? parseInt(row.ingredientId) : null;

      // Insert harvest_allocation
      var allocResult = await sbInsert('harvest_allocations', [{
        harvest_event_id: p2AllocHid,
        destination:      dest,
        quantity_kg:      kg,
        ingredient_id:    dest === 'feed_inventory' ? ingId : null,
        crop_id:          dest === 'seed_stock'     ? seedCropId : null
      }]);

      // Downstream records
      if (dest === 'feed_inventory' && ingId) {
        // Create ingredient acquisition (feeds Phase 1 stock calc)
        await sbInsert('ingredient_acquisitions', [{
          ingredient_id:         ingId,
          acquisition_type:      'harvested',
          date:                  (landHarvests.find(function(h) { return h.id === p2AllocHid; }) || {}).date || todayISO(),
          quantity_kg:           kg,
          crop_harvest_event_id: p2AllocHid
        }]);
      }

      if (dest === 'external_processing' && allocResult && allocResult[0]) {
        // Create pending processing transaction (Phase 3 will complete this)
        await sbInsert('processing_transactions', [{
          harvest_allocation_id: allocResult[0].id,
          quantity_kg_sent:      kg,
          status:                'pending'
        }]);
      }
    }

    // Mark harvest as fully allocated if total used >= total kg
    var fullyAllocated = totalUsed >= p2AllocTotalKg - 0.01;
    if (fullyAllocated) {
      await sbPatch('crop_harvest_events', p2AllocHid, { allocated: true });
    }

    statusEl.textContent = fullyAllocated ? 'Fully allocated ✓' : 'Partial allocation saved.';
    statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeHarvestAllocModal(); loadLandPage(); }, 900);

  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.style.color = 'var(--red)';
  }
}
