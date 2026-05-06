// ============================================================
// setup_plots.js — Plot registry (Setup section)
// ============================================================
//
// Plot definition / configuration. Moved from Land tab → Setup
// because plots are configured once and rarely change.
//
// Fields: plot code, name, type, area (acres + kanals),
//         use case, irrigation, location, notes.
// Inline editable. Soft-retire via Retire button.
//
// Depends on: shared.js, setup_shared.js
// ============================================================

var spPlots         = [];
var spLocations     = [];
var spCrops         = [];      // active plot_crops, for "active crops" column
var spCropRegistry  = [];      // crops table for crop name lookup
var spTests         = [];      // soil tests for latest EC column

var SP_USE_BADGE = {
  agricultural:'badge-green', fodder:'badge-lime', fallow:'badge-amber',
  pasture:'badge-lime', access:'badge-gray', infrastructure:'badge-blue',
  rehabilitation:'badge-amber', hedgerow:'badge-teal', other:'badge-gray'
};
var SP_PLOT_TYPE_LABELS = {
  field:'Field', linear:'Linear', edge:'Edge', infrastructure:'Infrastructure'
};
var SP_IRR_LABELS = { flood:'Flood', furrow:'Furrow', drip:'Drip', none:'None' };

function spAcresKanals(acres) {
  if (acres == null || acres === '') return '—';
  var a = parseFloat(acres);
  if (isNaN(a)) return '—';
  return a.toFixed(2) + ' ac / ' + (a * 8).toFixed(1) + ' K';
}

function spSafeFetch(table, query) {
  return sbGet(table, query).catch(function(err) {
    console.warn('Plots: query failed for', table, '—', err.message);
    return [];
  });
}

async function loadSetupPlotsPage() {
  document.getElementById('sp-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    var r = await Promise.all([
      sbGet('field_plots',
        'select=id,plot_code,plot_name,plot_type,area_acres,area_unit,use_case,description,' +
        'status,irrigation_method,date_retired,notes,location_id,locations(id,name)' +
        '&order=plot_code'),
      sbGet('locations', 'select=id,name,location_type,active&order=name'),
      spSafeFetch('plot_crops',
        'select=id,field_plot_id,crop_id,crop_name,status,sow_date'),
      spSafeFetch('crops',  'select=id,name,local_name&active=eq.true&order=name'),
      spSafeFetch('soil_tests', 'select=id,date,field_plot_id,ec_ms_cm&order=date.desc')
    ]);
    spPlots        = r[0];
    spLocations    = r[1];
    spCrops        = r[2];
    spCropRegistry = r[3];
    spTests        = r[4];
    spPopulateDropdowns();
    renderSpPlots();
    renderAbbrevKey('abbrev-setup-plots', ['EC']);
  } catch (err) {
    document.getElementById('sp-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function spPopulateDropdowns() {
  var locOpts = '<option value="">Select location</option>' +
    spLocations.filter(function(l) { return l.active !== false; }).map(function(l) {
      return '<option value="' + l.id + '">' + l.name + ' (' + l.location_type + ')</option>';
    }).join('');
  var locEl = document.getElementById('sp-loc');
  if (locEl) locEl.innerHTML = locOpts;

  var codeEl = document.getElementById('sp-code');
  if (codeEl && !codeEl.value) codeEl.value = spSuggestCode();
}

function spSuggestCode() {
  var existing = spPlots.map(function(p) { return p.plot_code; }).filter(Boolean);
  var nums = existing.map(function(c) { return parseInt((c || '').replace(/\D/g, '')) || 0; });
  var next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return 'P' + String(next).padStart(2, '0');
}

function toggleSpForm() {
  var f = document.getElementById('sp-form');
  var open = f.style.display === 'block';
  f.style.display = open ? 'none' : 'block';
  if (!open) {
    document.getElementById('sp-code').value = spSuggestCode();
    document.getElementById('sp-name').value = '';
    document.getElementById('sp-area').value = '';
    document.getElementById('sp-status').textContent = '';
  }
}

function renderSpPlots() {
  var activeCount = spPlots.filter(function(p) { return p.status !== 'inactive'; }).length;
  var totalAcres  = spPlots
    .filter(function(p) { return p.status !== 'inactive'; })
    .reduce(function(s, p) { return s + (parseFloat(p.area_acres) || 0); }, 0);
  document.getElementById('sp-count').textContent =
    activeCount + ' active plot' + (activeCount !== 1 ? 's' : '') +
    (totalAcres ? ' · ' + totalAcres.toFixed(2) + ' ac / ' + (totalAcres * 8).toFixed(1) + ' K total' : '');

  var tbl = document.getElementById('sp-table');
  if (!spPlots.length) {
    tbl.innerHTML = '<div class="empty">No plots yet. Click + Add plot to start.</div>';
    return;
  }

  var activePlots  = spPlots.filter(function(p) { return p.status !== 'inactive'; });
  var retiredPlots = spPlots.filter(function(p) { return p.status === 'inactive'; });
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
    var activeCrops = spCrops.filter(function(c) {
      return c.field_plot_id === p.id && c.status === 'growing';
    });
    var latestTest = spTests
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
      '" style="width:100%;min-width:120px" placeholder="—" onchange="patchSpPlot(' + p.id + ',\'plot_name\',this.value||null)"></td>';
    html += '<td class="muted-cell" style="font-size:12px">' + locName + '</td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (SP_PLOT_TYPE_LABELS[p.plot_type] || p.plot_type || '—') + '</td>';
    html += '<td class="mono right" style="white-space:nowrap">' + spAcresKanals(p.area_acres) + '</td>';
    html += '<td><select onchange="patchSpPlot(' + p.id + ',\'use_case\',this.value||null)">' +
      ['','agricultural','fodder','fallow','pasture','rehabilitation','hedgerow','access','infrastructure','other'].map(function(u) {
        return '<option value="' + u + '"' + (p.use_case === u ? ' selected' : '') + '>' + (u ? u : '—') + '</option>';
      }).join('') + '</select></td>';
    html += '<td class="muted-cell" style="font-size:12px">' + (SP_IRR_LABELS[p.irrigation_method] || p.irrigation_method || '—') + '</td>';
    html += '<td>' + (isInactive
      ? '<span class="badge badge-gray">Inactive</span>'
      : '<span class="badge badge-green">Active</span>') + '</td>';
    html += '<td class="mono" style="' + ecStyle + '">' + ecVal + '</td>';
    html += '<td style="max-width:180px">' +
      (activeCrops.length
        ? activeCrops.map(function(c) {
            var cName = c.crop_id
              ? (spCropRegistry.find(function(r) { return r.id === c.crop_id; }) || {}).name || c.crop_name
              : c.crop_name;
            return '<span class="badge badge-lime" style="margin:1px">' + (cName || '?') + '</span>';
          }).join('')
        : '<span class="muted-cell" style="font-size:12px">—</span>') + '</td>';
    html += '<td><input type="text" value="' + (p.notes || '').replace(/"/g, '&quot;') +
      '" style="width:100%;min-width:120px" placeholder="—" onchange="patchSpPlot(' + p.id + ',\'notes\',this.value||null)"></td>';
    html += '<td>' + (!isInactive
      ? '<button class="btn btn-sm" style="font-size:11px;color:var(--muted)" onclick="retireSpPlot(' + p.id + ')">Retire</button>'
      : '') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  tbl.innerHTML = html;
}

async function patchSpPlot(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('field_plots', id, d);
    var p = spPlots.find(function(x) { return x.id === id; });
    if (p) p[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    await loadSetupPlotsPage();
  }
}

async function retireSpPlot(id) {
  if (!confirm('Mark this plot as inactive? This can be reversed manually in the database.')) return;
  try {
    await sbPatch('field_plots', id, { status: 'inactive', date_retired: todayISO() });
    await loadSetupPlotsPage();
  } catch (err) { alert('Error: ' + err.message); }
}

async function submitSpPlot() {
  var statusEl = document.getElementById('sp-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var code     = (document.getElementById('sp-code').value || '').trim();
    var name     = (document.getElementById('sp-name').value || '').trim();
    var locId    = document.getElementById('sp-loc').value;
    var ptype    = document.getElementById('sp-type').value;
    var area     = document.getElementById('sp-area').value;
    var aunit    = document.getElementById('sp-aunit').value;
    var useCase  = document.getElementById('sp-use').value;
    var irr      = document.getElementById('sp-irr').value;
    var desc     = (document.getElementById('sp-desc').value || '').trim();
    var notes    = (document.getElementById('sp-notes').value || '').trim();
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
    document.getElementById('sp-form').style.display = 'none';
    await loadSetupPlotsPage();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}
