// ============================================================
// overview.js — Dashboard landing page (Plot Overview)
// ============================================================
//
// Read-only summary view. One card per active plot showing:
//   - Header: code, name, area, status, location
//   - Currently growing: active crop groups + members
//   - Recent activity: last fertilizer, watering, soil test, harvest, pest flags
//   - Totals: cumulative water, fertilizer, harvest (all time on plot)
//   - Quick links: jump to relevant Land tab pre-filtered to this plot
//
// Filters out infrastructure and access plots.
// Depends on: shared.js (sbGet, fmtDate, pkr, r1, todayISO)
// ============================================================

// Use cases that count as "active land management"
var OV_INCLUDE_USE_CASES = [
  'agricultural', 'fodder', 'pasture', 'fallow', 'rehabilitation', 'hedgerow'
];

// State
var ovPlots         = [];
var ovCrops         = [];
var ovCropGroups    = [];
var ovHarvests      = [];
var ovObservations  = [];
var ovFertApps      = [];
var ovWatering      = [];
var ovSoilTests     = [];
var ovFerts         = [];
var ovCropRegistry  = [];

function safeFetchOv(table, query) {
  return sbGet(table, query).catch(function(err) {
    console.warn('Overview: query failed for', table, '—', err.message);
    return [];
  });
}

async function loadOverviewPage() {
  var loadingEl = document.getElementById('ov-content');
  if (loadingEl) loadingEl.innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('field_plots',
        'select=id,plot_code,plot_name,plot_type,area_acres,area_unit,use_case,description,' +
        'status,irrigation_method,location_id,locations(id,name)&order=plot_code'),
      safeFetchOv('plot_crops',
        'select=id,field_plot_id,crop_id,crop_name,role,status,health_status,pest_disease_flag,' +
        'sow_date,termination_date,harvest_type,crop_group_id&order=sow_date.desc'),
      safeFetchOv('crop_groups',
        'select=id,field_plot_id,name,is_stand,harvest_type,ingredient_id&order=field_plot_id'),
      safeFetchOv('crop_harvest_events',
        'select=id,crop_group_id,date,quantity_kg,destination&order=date.desc'),
      safeFetchOv('crop_observations',
        'select=id,plot_crop_id,observed_at,health_status,pest_disease_flag,note&order=observed_at.desc'),
      safeFetchOv('fertilizer_applications',
        'select=id,date,kg_applied,fertilizer_id,field_plot_id,application_method&order=date.desc'),
      safeFetchOv('watering_events',
        'select=id,date,field_plot_id,duration_hours,estimated_volume_litres,method&order=date.desc'),
      safeFetchOv('soil_tests',
        'select=id,date,field_plot_id,is_baseline,ec_ms_cm,ph,organic_matter_pct,sar&order=date.desc'),
      safeFetchOv('fertilizers', 'select=id,name,type&order=name'),
      safeFetchOv('crops', 'select=id,name,local_name&active=eq.true&order=name')
    ]);

    ovPlots         = r[0];
    ovCrops         = r[1];
    ovCropGroups    = r[2];
    ovHarvests      = r[3];
    ovObservations  = r[4];
    ovFertApps      = r[5];
    ovWatering      = r[6];
    ovSoilTests     = r[7];
    ovFerts         = r[8];
    ovCropRegistry  = r[9];

    renderOverview();

    var updEl = document.getElementById('ov-updated');
    if (updEl) updEl.textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    if (loadingEl) loadingEl.innerHTML =
      '<div style="padding:22px;color:var(--red)"><strong>Error loading overview:</strong> ' + err.message + '</div>';
    console.error('loadOverviewPage failed:', err);
  }
}

function ovBaselineFor(plotId) {
  var baseline = ovSoilTests.find(function(t) {
    return t.field_plot_id === plotId && t.is_baseline;
  });
  return baseline || null;
}

function ovDelta(curr, base) {
  if (curr == null || base == null) return '';
  var d = curr - base;
  var sign = d > 0 ? '+' : '';
  return ' <span style="color:var(--faint);font-size:11px">(' + sign + d.toFixed(2) + ')</span>';
}

function ovCropDisplayName(c) {
  if (c.crop_id) {
    var reg = ovCropRegistry.find(function(r) { return r.id === c.crop_id; });
    if (reg) return reg.name + (reg.local_name ? ' (' + reg.local_name + ')' : '');
  }
  return c.crop_name || 'Unnamed';
}

function renderOverview() {
  var content = document.getElementById('ov-content');
  if (!content) return;

  // Filter to active land management plots
  var plots = ovPlots.filter(function(p) {
    if (p.status === 'inactive') return false;
    var uc = (p.use_case || '').toLowerCase();
    if (!uc) return true; // unset = include by default
    return OV_INCLUDE_USE_CASES.indexOf(uc) !== -1;
  });

  if (!plots.length) {
    content.innerHTML = '<div class="empty" style="padding:40px;text-align:center">' +
      'No active plots to display. Add plots in <a href="#" onclick="goToPage(\'setupplots\');return false;">Setup → Plots</a>.' +
      '</div>';
    return;
  }

  // Sort by plot_code
  plots.sort(function(a, b) {
    return (a.plot_code || '').localeCompare(b.plot_code || '');
  });

  var html = '<div class="ov-grid">';
  plots.forEach(function(p) {
    html += renderOvCard(p);
  });
  html += '</div>';
  content.innerHTML = html;
}

function renderOvCard(p) {
  var area  = parseFloat(p.area_acres) || 0;
  var areaStr = area > 0 ? area.toFixed(2) + ' ac · ' + (area * 8).toFixed(1) + ' K' : '—';
  var statusBadge = p.status === 'active'
    ? '<span class="ov-badge ov-badge-green">Active</span>'
    : (p.status === 'rehabilitation'
        ? '<span class="ov-badge ov-badge-amber">Rehab</span>'
        : '<span class="ov-badge ov-badge-gray">' + (p.status || '—') + '</span>');
  var useBadge = p.use_case
    ? '<span class="ov-badge ov-badge-blue">' + p.use_case + '</span>'
    : '';

  // ── Currently growing ────────────────────────────────────
  var activeCrops = ovCrops.filter(function(c) {
    return c.field_plot_id === p.id && c.status !== 'terminated' && c.status !== 'failed';
  });
  var groupsOnPlot = ovCropGroups.filter(function(g) { return g.field_plot_id === p.id; });
  var growingHtml = '';
  if (activeCrops.length === 0) {
    growingHtml = '<div class="ov-empty-line">No active crops</div>';
  } else {
    // Group crops by their crop_group_id
    var byGroup = {};
    activeCrops.forEach(function(c) {
      var gid = c.crop_group_id || 'ungrouped';
      if (!byGroup[gid]) byGroup[gid] = [];
      byGroup[gid].push(c);
    });
    Object.keys(byGroup).forEach(function(gid) {
      var grp = groupsOnPlot.find(function(g) { return String(g.id) === String(gid); });
      var members = byGroup[gid];
      var grpName = grp ? grp.name : (members.length > 1 ? 'Mixed planting' : '');
      if (grpName) {
        growingHtml += '<div class="ov-crop-group">' +
          '<span class="ov-crop-grp-name">' + grpName + '</span>' +
          ' <span class="ov-crop-count">· ' + members.length + ' crop' + (members.length !== 1 ? 's' : '') + '</span>' +
          '</div>';
      }
      members.slice(0, 4).forEach(function(c) {
        var days = c.sow_date
          ? Math.floor((new Date() - new Date(c.sow_date)) / (1000 * 60 * 60 * 24))
          : null;
        var healthDot = c.pest_disease_flag
          ? '<span class="ov-pest-dot" title="Pest / disease flag">⚠</span> '
          : '';
        growingHtml += '<div class="ov-crop-member">' + healthDot +
          ovCropDisplayName(c) +
          (days != null ? '<span class="ov-crop-days"> · day ' + days + '</span>' : '') +
          '</div>';
      });
      if (members.length > 4) {
        growingHtml += '<div class="ov-crop-member ov-faint">+ ' + (members.length - 4) + ' more</div>';
      }
    });
  }

  // ── Recent activity (last item per category) ──────────────
  var lastFert = ovFertApps.find(function(a) { return a.field_plot_id === p.id; });
  var lastFertHtml = '—';
  if (lastFert) {
    var fert = ovFerts.find(function(f) { return f.id === lastFert.fertilizer_id; });
    lastFertHtml = fmtDate(lastFert.date) + ' · ' +
      (fert ? fert.name : 'Unknown') + ' · ' +
      Math.round(parseFloat(lastFert.kg_applied) || 0) + ' kg';
  }

  var lastWater = ovWatering.find(function(w) { return w.field_plot_id === p.id; });
  var lastWaterHtml = '—';
  if (lastWater) {
    var vol = parseFloat(lastWater.estimated_volume_litres);
    lastWaterHtml = fmtDate(lastWater.date) +
      (vol ? ' · ' + Math.round(vol).toLocaleString() + ' L' : '') +
      (lastWater.duration_hours ? ' · ' + lastWater.duration_hours + 'hr' : '');
  }

  var lastTest = ovSoilTests.find(function(t) { return t.field_plot_id === p.id; });
  var baseline = ovBaselineFor(p.id);
  var lastTestHtml = '—';
  if (lastTest) {
    var parts = [fmtDate(lastTest.date)];
    if (lastTest.ec_ms_cm != null)
      parts.push('EC ' + parseFloat(lastTest.ec_ms_cm).toFixed(2) +
        (baseline && !lastTest.is_baseline ? ovDelta(parseFloat(lastTest.ec_ms_cm), parseFloat(baseline.ec_ms_cm)) : ''));
    if (lastTest.ph != null)
      parts.push('pH ' + parseFloat(lastTest.ph).toFixed(1));
    if (lastTest.organic_matter_pct != null)
      parts.push('OM ' + parseFloat(lastTest.organic_matter_pct).toFixed(2) + '%');
    lastTestHtml = parts.join(' · ');
  }

  // Last harvest from any group on this plot
  var groupIds = groupsOnPlot.map(function(g) { return g.id; });
  var lastHarvest = ovHarvests.find(function(h) { return groupIds.indexOf(h.crop_group_id) !== -1; });
  var lastHarvestHtml = '—';
  if (lastHarvest) {
    lastHarvestHtml = fmtDate(lastHarvest.date) +
      (lastHarvest.quantity_kg != null ? ' · ' + Math.round(parseFloat(lastHarvest.quantity_kg)) + ' kg' : '') +
      (lastHarvest.destination ? ' · ' + lastHarvest.destination : '');
  }

  // Active pest flags from observations
  var activePestObs = ovObservations.filter(function(o) {
    if (!o.pest_disease_flag) return false;
    var crop = ovCrops.find(function(c) { return c.id === o.plot_crop_id; });
    return crop && crop.field_plot_id === p.id;
  });

  // ── Cumulative totals ─────────────────────────────────────
  var totalWaterL = ovWatering
    .filter(function(w) { return w.field_plot_id === p.id; })
    .reduce(function(s, w) { return s + (parseFloat(w.estimated_volume_litres) || 0); }, 0);
  var totalFertKg = ovFertApps
    .filter(function(a) { return a.field_plot_id === p.id; })
    .reduce(function(s, a) { return s + (parseFloat(a.kg_applied) || 0); }, 0);
  var totalHarvestKg = ovHarvests
    .filter(function(h) { return groupIds.indexOf(h.crop_group_id) !== -1; })
    .reduce(function(s, h) { return s + (parseFloat(h.quantity_kg) || 0); }, 0);

  // ── Build the card ────────────────────────────────────────
  var locName = p.locations ? p.locations.name : '';
  var pestWarning = activePestObs.length > 0
    ? '<div class="ov-pest-warning">⚠ ' + activePestObs.length + ' active pest/disease flag' +
      (activePestObs.length > 1 ? 's' : '') + '</div>'
    : '';

  return '<div class="ov-card">' +
    // Header
    '<div class="ov-card-hdr">' +
      '<div>' +
        '<div class="ov-card-code">' + (p.plot_code || 'P?') +
          (p.plot_name ? ' · ' + p.plot_name : '') +
        '</div>' +
        '<div class="ov-card-meta">' + areaStr +
          (locName ? ' · ' + locName : '') +
          (p.irrigation_method ? ' · ' + p.irrigation_method : '') +
        '</div>' +
      '</div>' +
      '<div class="ov-card-badges">' + statusBadge + ' ' + useBadge + '</div>' +
    '</div>' +

    pestWarning +

    // Currently growing
    '<div class="ov-section">' +
      '<div class="ov-section-label">Currently Growing</div>' +
      growingHtml +
    '</div>' +

    // Recent activity
    '<div class="ov-section">' +
      '<div class="ov-section-label">Recent Activity</div>' +
      '<div class="ov-row"><span class="ov-row-label">Fertilizer</span><span class="ov-row-val">' + lastFertHtml + '</span></div>' +
      '<div class="ov-row"><span class="ov-row-label">Watering</span><span class="ov-row-val">' + lastWaterHtml + '</span></div>' +
      '<div class="ov-row"><span class="ov-row-label">Soil test</span><span class="ov-row-val">' + lastTestHtml + '</span></div>' +
      '<div class="ov-row"><span class="ov-row-label">Harvest</span><span class="ov-row-val">' + lastHarvestHtml + '</span></div>' +
    '</div>' +

    // Totals
    '<div class="ov-section">' +
      '<div class="ov-section-label">Cumulative</div>' +
      '<div class="ov-row"><span class="ov-row-label">Total water</span><span class="ov-row-val">' +
        (totalWaterL > 0 ? Math.round(totalWaterL).toLocaleString() + ' L' : '—') + '</span></div>' +
      '<div class="ov-row"><span class="ov-row-label">Total fertilizer</span><span class="ov-row-val">' +
        (totalFertKg > 0 ? Math.round(totalFertKg).toLocaleString() + ' kg' : '—') + '</span></div>' +
      '<div class="ov-row"><span class="ov-row-label">Total harvest</span><span class="ov-row-val">' +
        (totalHarvestKg > 0 ? Math.round(totalHarvestKg).toLocaleString() + ' kg' : '—') + '</span></div>' +
    '</div>' +

    // Quick links
    '<div class="ov-actions">' +
      '<button class="btn btn-sm" onclick="ovGoToPlot(\'land-app\',' + p.id + ')">Log application</button>' +
      '<button class="btn btn-sm" onclick="ovGoToPlot(\'land-water\',' + p.id + ')">Log watering</button>' +
      '<button class="btn btn-sm" onclick="ovGoToPlot(\'land-crops\',' + p.id + ')">Crop history</button>' +
    '</div>' +

  '</div>';
}

// Navigate to a Land sub-page and pre-filter to a specific plot
function ovGoToPlot(landPage, plotId) {
  // Navigate via the existing sidebar nav
  var btn = document.querySelector('.nav-item[data-page="' + landPage + '"]');
  if (btn) btn.click();
  // The land page handles plot pre-filtering on its own filters via sessionStorage
  try {
    sessionStorage.setItem('ov_target_plot', String(plotId));
  } catch (_) {}
}
