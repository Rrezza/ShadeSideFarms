// an_weights.js v18
// Weight tracking page — rebuilt
// Depends on: shared.js, an_helpers.js
// Changes from v17:
//   - Calendar axis removed entirely (weeks since arrival only)
//   - Two separate charts merged into one unified chart section
//   - Individual/Groups mode toggle replaces separate sections
//   - Y-axis toggle: Weight / ADG / FCR (FCR disabled pending feeding events)
//   - Rolling ADG (not cumulative); starts at week 1, entry = baseline
//   - Animal selector moved to left sidebar (1/6 width, checkboxes)
//   - Group avg toggle in sidebar (individual mode)
//   - Groups mode sidebar: group checklist
//   - Individual animal history absorbed as collapsed summary below chart
//   - Outlier strip at top of page (IQR method, amber/red severity)
//   - Log table: initial weight + days on farm columns, overdue flag,
//     clickable farm ID to load animal in chart
//   - wtAllWeights now includes bcs_score
// ============================================================

// ---- Module state ----
var wtChart        = null;
var wtChartMode    = 'individual';
var wtYAxis        = 'weight';
var wtShowGroupAvg = true;
var wtAllWeights   = {};    // animal_id -> [{date, weight_kg, bcs_score}] asc
var wtOutlierData      = {};    // animal_id -> {weight, weightReasons, adg, adgReasons, groupName, groupId}
var wtOutlierStats     = { groups: {}, totalFlagged: 0 }; // per-group fence data for display
var wtOutlierDimension = 'weight'; // 'weight' | 'adg' | 'fcr'
var WT_MILD_COLOR      = '#C8A800'; // yellow — intentionally distinct from var(--amber) which renders brown


// ============================================================
// PAGE LOAD
// ============================================================
async function loadWeightTrackingPage() {
  var el = document.getElementById('wt-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();

    var allW = await sbGet('animal_weights',
      'select=animal_id,weight_kg,bcs_score,date&order=date.asc&limit=5000');
    wtAllWeights = {};
    allW.forEach(function(w) {
      if (!wtAllWeights[w.animal_id]) wtAllWeights[w.animal_id] = [];
      wtAllWeights[w.animal_id].push({
        date: w.date,
        weight_kg: parseFloat(w.weight_kg),
        bcs_score: w.bcs_score
      });
    });

    var activeGroups = anSharedGroups.filter(function(g) { return g.status === 'active'; });
    var grpOpts = '<option value="">All groups</option>' +
      activeGroups.map(function(g) {
        return '<option value="' + g.id + '">' + g.name + '</option>';
      }).join('');

    var html =
      // Outlier strip — populated by renderWTOutlierStrip()
      '<div id="wt-outlier-strip"></div>' +

      // ── Log weights ──────────────────────────────────────
      '<div class="section" id="wt-log-section">' +
        '<div class="section-hdr"><h2>Log weights</h2>' +
          '<div style="display:flex;gap:10px;align-items:center">' +
            '<label style="font-size:13px;color:var(--muted)">Group</label>' +
            '<select id="wt-log-group" onchange="onWTLogGroupChange()">' + grpOpts + '</select>' +
            '<label style="font-size:13px;color:var(--muted)">Purpose</label>' +
            '<select id="wt-log-purpose" onchange="renderWeightLogTable()">' +
              '<option value="">All</option>' +
              '<option value="meat" selected>Meat</option>' +
              '<option value="breeder">Breeder</option>' +
              '<option value="learning">Learning</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div id="wt-log-table"><div class="loading">Loading...</div></div>' +
        '<div style="padding:12px 22px;border-top:1px solid var(--border);display:flex;gap:10px">' +
          '<button class="btn btn-primary btn-sm" onclick="saveAllWeights()">Save all weights</button>' +
          '<span id="wt-save-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
        '</div>' +
        // History panel — appears here when a farm ID is clicked
        '<div id="wt-history-wrap" style="display:none;border-top:1px solid var(--border);padding:12px 22px 16px"></div>' +
      '</div>' +

      // ── Unified chart ─────────────────────────────────────
      '<div class="section">' +
        '<div class="section-hdr"><h2>Weight chart</h2>' +
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +

            // Mode toggle
            '<div style="display:flex">' +
              '<button id="wt-mode-ind" class="btn btn-sm active" ' +
                'onclick="setWTMode(\'individual\')" ' +
                'style="border-radius:6px 0 0 6px;margin:0">Individual</button>' +
              '<button id="wt-mode-grp" class="btn btn-sm" ' +
                'onclick="setWTMode(\'groups\')" ' +
                'style="border-radius:0 6px 6px 0;margin:0;border-left:0">Groups</button>' +
            '</div>' +

            // Y-axis toggle
            '<div style="display:flex;margin-left:8px">' +
              '<button id="wt-y-weight" class="btn btn-sm active" ' +
                'onclick="setWTYAxis(\'weight\')" ' +
                'style="border-radius:6px 0 0 6px;margin:0">Weight</button>' +
              '<button id="wt-y-adg" class="btn btn-sm" ' +
                'onclick="setWTYAxis(\'adg\')" ' +
                'style="border-radius:0;margin:0;border-left:0">ADG</button>' +
              '<button id="wt-y-fcr" class="btn btn-sm" disabled ' +
                'title="Available once feeding events are logged" ' +
                'style="border-radius:0 6px 6px 0;margin:0;border-left:0;' +
                       'opacity:0.4;cursor:not-allowed">FCR</button>' +
            '</div>' +

            // Chart group selector (independent, pre-populates from log table)
            '<label style="font-size:13px;color:var(--muted);margin-left:8px">Group</label>' +
            '<select id="wt-chart-group" onchange="renderWTSidebar();renderWTChart()">' +
              grpOpts +
            '</select>' +

          '</div>' +
        '</div>' + // end section-hdr

        // Chart body: sidebar + canvas
        '<div style="display:flex;min-height:340px">' +
          '<div id="wt-sidebar" ' +
            'style="width:16.666%;min-width:120px;max-width:180px;' +
                   'border-right:1px solid var(--border);padding:10px;' +
                   'overflow-y:auto;max-height:380px;box-sizing:border-box;' +
                   'font-size:12px">' +
          '</div>' +
          '<div style="flex:1;position:relative;padding:12px 18px 12px 14px;min-height:320px">' +
            '<canvas id="wt-chart"></canvas>' +
          '</div>' +
        '</div>' +

        // History panel lives in the log section above; nothing here
      '</div>' + // end chart section

      '<div id="abbrev-wt"></div>';

    document.getElementById('wt-content').innerHTML = html;

    // Pre-populate chart group from log table default
    var logGrp = document.getElementById('wt-log-group');
    var chartGrp = document.getElementById('wt-chart-group');
    if (logGrp && chartGrp && logGrp.value) chartGrp.value = logGrp.value;

    computeWTOutliers();
    renderWTOutlierStrip();
    renderWeightLogTable();
    renderWTSidebar();
    renderWTChart();
    renderAbbrevKey('abbrev-wt', ['BCS', 'ADG', 'FCR']);

  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}


// ============================================================
// LOG WEIGHTS TABLE
// ============================================================
function onWTLogGroupChange() {
  var logGrp = document.getElementById('wt-log-group');
  var chartGrp = document.getElementById('wt-chart-group');
  if (logGrp && chartGrp) chartGrp.value = logGrp.value;
  renderWeightLogTable();
  renderWTSidebar();
  renderWTChart();
}

function renderWeightLogTable() {
  var el = document.getElementById('wt-log-table');
  if (!el) return;
  var grpId   = document.getElementById('wt-log-group') ? document.getElementById('wt-log-group').value : '';
  var purpose = document.getElementById('wt-log-purpose') ? document.getElementById('wt-log-purpose').value : '';
  var today   = new Date();

  var animals = anSharedAnimals.filter(function(a) {
    return a.status === 'active' || a.status === 'quarantine';
  });
  if (grpId) {
    var ids = getGroupAnimalIds(parseInt(grpId));
    animals = animals.filter(function(a) { return ids.indexOf(a.id) >= 0; });
  }
  if (purpose) animals = animals.filter(function(a) { return a.purpose === purpose; });

  if (!animals.length) {
    el.innerHTML = '<div class="empty">No animals match the current filter.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Farm ID</th><th>Group</th><th>Breed</th>' +
    '<th class="right">Entry wt</th>' +
    '<th class="right">Last wt</th>' +
    '<th class="right">Days on farm</th>' +
    '<th>Last weighed</th>' +
    '<th>New weight (kg)</th>' +
    '<th>BCS (1–5)</th>' +
    '</tr></thead><tbody>';

  animals.forEach(function(a) {
    var lw         = getLatestWeight(a.id);
    var grpName    = getGroupName(getAnimalGroupId(a.id));
    var entryWtTxt = a.entry_weight_kg != null ? r1(parseFloat(a.entry_weight_kg)) + ' kg' : '\u2014';
    var lastWtTxt  = lw ? r1(parseFloat(lw.weight_kg)) + ' kg' : '\u2014';
    var daysOnFarm = a.date_of_arrival
      ? Math.round((today - new Date(a.date_of_arrival + 'T00:00:00')) / 864e5)
      : null;

    // Overdue flag: check group's weigh_in_reminder_days
    var overdueFlag = '';
    if (lw) {
      var grpId2 = getAnimalGroupId(a.id);
      var grpObj = grpId2 ? anSharedGroups.find(function(g) { return g.id === grpId2; }) : null;
      if (grpObj && grpObj.weigh_in_reminder_days) {
        var daysSince = Math.round((today - new Date(lw.date + 'T00:00:00')) / 864e5);
        if (daysSince > grpObj.weigh_in_reminder_days) {
          overdueFlag = ' <span style="color:var(--amber);font-size:11px" ' +
            'title="' + daysSince + ' days since last weigh-in (threshold: ' +
            grpObj.weigh_in_reminder_days + 'd)">⚠ ' + daysSince + 'd</span>';
        }
      }
    }

    // Outlier indicator — respects active dimension
    var outlier = getActiveOutlier(a.id);
    var rowBg = '';
    var outlierDot = '';
    if (outlier) {
      var isExtreme = outlier.severity === 'extreme';
      var outColor  = isExtreme ? 'var(--red)' : WT_MILD_COLOR;
      rowBg      = isExtreme ? 'background:rgba(220,50,47,0.06)' : 'background:rgba(200,168,0,0.06)';
      outlierDot = ' <span style="color:' + outColor + ';font-size:11px" ' +
        'title="' + wtOutlierDimension.toUpperCase() + ' outlier: ' + outlier.reasons.join(', ') + '">&#9679;</span>';
    }

    html += '<tr id="wt-row-' + a.id + '" style="' + rowBg + '">' +
      '<td style="font-weight:500">' +
        '<a href="#" onclick="event.preventDefault();wtSelectAnimal(' + a.id + ')" ' +
          'style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--muted)">' +
          a.farm_id + (a.name ? ' <span style="color:var(--faint)">(' + a.name + ')</span>' : '') +
        '</a>' + outlierDot +
      '</td>' +
      '<td class="muted-cell">' + grpName + '</td>' +
      '<td class="muted-cell">' + (a.breed || '\u2014') + '</td>' +
      '<td class="mono right">' + entryWtTxt + '</td>' +
      '<td class="mono right">' + lastWtTxt + '</td>' +
      '<td class="mono right">' + (daysOnFarm != null ? daysOnFarm : '\u2014') + '</td>' +
      '<td class="mono">' + (lw ? fmtDate(lw.date) : '\u2014') + overdueFlag + '</td>' +
      '<td><input type="number" class="wt-new-input" data-animal-id="' + a.id + '" ' +
        'min="0" step="0.1" style="width:90px" placeholder="kg"></td>' +
      '<td><input type="number" class="wt-bcs-input" data-animal-id="' + a.id + '" ' +
        'min="1" max="5" step="0.5" style="width:70px" placeholder="opt."></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function saveAllWeights() {
  var st = document.getElementById('wt-save-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var today = todayISO();
    var inserts = [];
    document.querySelectorAll('.wt-new-input').forEach(function(inp) {
      var v = inp.value.trim();
      if (!v) return;
      var anId  = parseInt(inp.dataset.animalId);
      var bcsEl = document.querySelector('.wt-bcs-input[data-animal-id="' + anId + '"]');
      var bcs   = bcsEl && bcsEl.value ? parseFloat(bcsEl.value) : null;
      var rec   = { animal_id: anId, weight_kg: parseFloat(v), date: today };
      if (bcs != null) rec.bcs_score = bcs;
      inserts.push(rec);
    });
    if (!inserts.length) { st.textContent = 'No weights entered.'; return; }
    await sbInsert('animal_weights', inserts);
    st.textContent = inserts.length + ' record' + (inserts.length !== 1 ? 's' : '') + ' saved.';
    st.style.color = 'var(--green)';
    // Reload data and refresh all weight-dependent views
    anSharedLoaded = false;
    await loadSharedAnimalData();
    var allW = await sbGet('animal_weights',
      'select=animal_id,weight_kg,bcs_score,date&order=date.asc&limit=5000');
    wtAllWeights = {};
    allW.forEach(function(w) {
      if (!wtAllWeights[w.animal_id]) wtAllWeights[w.animal_id] = [];
      wtAllWeights[w.animal_id].push({
        date: w.date, weight_kg: parseFloat(w.weight_kg), bcs_score: w.bcs_score
      });
    });
    computeWTOutliers();
    renderWTOutlierStrip();
    renderWeightLogTable();
    renderWTChart();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}


// ============================================================
// OUTLIER COMPUTATION (IQR method)
// ============================================================
function computeIQRFences(vals) {
  var s = vals.slice().sort(function(a, b) { return a - b; });
  var n = s.length;
  function perc(p) {
    var i = p * (n - 1);
    var lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  var q1 = perc(0.25), q3 = perc(0.75), iqr = q3 - q1;
  return {
    q1: q1, q3: q3, iqr: iqr,
    mildLow:     q1 - 1.5 * iqr,
    extremeLow:  q1 - 3.0 * iqr,
    mildHigh:    q3 + 1.5 * iqr,
    extremeHigh: q3 + 3.0 * iqr
  };
}

function computeWTOutliers() {
  wtOutlierData  = {};
  wtOutlierStats = { groups: {}, totalFlagged: 0 };

  var activeGroups = anSharedGroups.filter(function(g) { return g.status === 'active'; });

  activeGroups.forEach(function(g) {
    var animals = getGroupAnimals(g.id);

    var points = animals.map(function(a) {
      var lw   = getLatestWeight(a.id);
      var curW = lw
        ? parseFloat(lw.weight_kg)
        : (a.entry_weight_kg != null ? parseFloat(a.entry_weight_kg) : null);

      var series     = wtAllWeights[a.id] || [];
      var rollingAdg = null;
      if (series.length >= 2) {
        var last = series[series.length - 1];
        var prev = series[series.length - 2];
        var dd = Math.round(
          (new Date(last.date + 'T00:00:00') - new Date(prev.date + 'T00:00:00')) / 864e5
        );
        if (dd > 0) rollingAdg = (last.weight_kg - prev.weight_kg) / dd * 1000;
      } else if (series.length === 1 && a.entry_weight_kg != null && a.date_of_arrival) {
        var dd2 = Math.round(
          (new Date(series[0].date + 'T00:00:00') - new Date(a.date_of_arrival + 'T00:00:00')) / 864e5
        );
        if (dd2 > 0) rollingAdg = (series[0].weight_kg - parseFloat(a.entry_weight_kg)) / dd2 * 1000;
      }
      return { a: a, curW: curW, rollingAdg: rollingAdg };
    }).filter(function(d) { return d.curW != null; });

    var grpStats = {
      name: g.name, n: points.length,
      wFences: null, adgFences: null,
      insufficient: points.length < 6
    };
    wtOutlierStats.groups[g.id] = grpStats;
    if (points.length < 6) return;

    var wFences   = computeIQRFences(points.map(function(d) { return d.curW; }));
    grpStats.wFences = wFences;

    var adgPts    = points.filter(function(d) { return d.rollingAdg != null; });
    var adgFences = adgPts.length >= 6
      ? computeIQRFences(adgPts.map(function(d) { return d.rollingAdg; }))
      : null;
    grpStats.adgFences = adgFences;

    points.forEach(function(d) {
      // --- Weight dimension ---
      var wSev = null, wReasons = [];
      if (d.curW < wFences.extremeLow)       { wSev = 'extreme'; wReasons.push('extreme low'); }
      else if (d.curW < wFences.mildLow)     { wSev = 'mild';    wReasons.push('low'); }
      else if (d.curW > wFences.extremeHigh) { wSev = 'extreme'; wReasons.push('extreme high'); }
      else if (d.curW > wFences.mildHigh)    { wSev = 'mild';    wReasons.push('high'); }

      // --- ADG dimension ---
      var aSev = null, aReasons = [];
      if (adgFences && d.rollingAdg != null) {
        if (d.rollingAdg < adgFences.extremeLow)      { aSev = 'extreme'; aReasons.push('extreme low'); }
        else if (d.rollingAdg < adgFences.mildLow)    { aSev = 'mild';    aReasons.push('low'); }
      }

      if (wSev || aSev) {
        wtOutlierData[d.a.id] = {
          weight: wSev, weightReasons: wReasons,
          adg:    aSev, adgReasons:    aReasons,
          groupName: g.name, groupId: g.id
        };
      }
    });
  });

  wtOutlierStats.totalFlagged = Object.keys(wtOutlierData).length;
}

// Returns the active-dimension outlier entry for an animal, or null if clean on that dimension
function getActiveOutlier(animalId) {
  var d = wtOutlierData[animalId];
  if (!d) return null;
  if (wtOutlierDimension === 'weight') {
    return d.weight ? { severity: d.weight, reasons: d.weightReasons, groupName: d.groupName } : null;
  }
  if (wtOutlierDimension === 'adg') {
    return d.adg ? { severity: d.adg, reasons: d.adgReasons, groupName: d.groupName } : null;
  }
  return null; // FCR not yet available
}

function setWTOutlierDimension(dim) {
  if (dim === 'fcr') return; // disabled
  wtOutlierDimension = dim;
  renderWTOutlierStrip();
  renderWeightLogTable();
}

function renderWTOutlierStrip() {
  var el = document.getElementById('wt-outlier-strip');
  if (!el) return;

  var groups        = wtOutlierStats.groups;
  var groupIds      = Object.keys(groups);
  var anySufficient = groupIds.some(function(id) { return !groups[id].insufficient; });

  // Dimension toggle (always rendered once groups exist)
  var dimToggle = groupIds.length
    ? '<div style="display:flex;margin-left:auto">' +
        '<button class="btn btn-sm' + (wtOutlierDimension === 'weight' ? ' active' : '') + '" ' +
          'onclick="setWTOutlierDimension(\'weight\')" ' +
          'style="border-radius:6px 0 0 6px;margin:0;font-size:11px;padding:2px 8px">Weight</button>' +
        '<button class="btn btn-sm' + (wtOutlierDimension === 'adg' ? ' active' : '') + '" ' +
          'onclick="setWTOutlierDimension(\'adg\')" ' +
          'style="border-radius:0;margin:0;border-left:0;font-size:11px;padding:2px 8px">ADG</button>' +
        '<button class="btn btn-sm" disabled ' +
          'title="Available once feeding events are logged" ' +
          'style="border-radius:0 6px 6px 0;margin:0;border-left:0;font-size:11px;padding:2px 8px;opacity:0.4;cursor:not-allowed">FCR</button>' +
      '</div>'
    : '';

  if (!groupIds.length) { el.innerHTML = ''; return; }

  // All groups insufficient
  if (!anySufficient) {
    var insufNames = groupIds.map(function(id) {
      return groups[id].name + '\u202f(n=' + groups[id].n + ')';
    }).join(', ');
    el.innerHTML =
      '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;' +
        'padding:9px 16px;margin-bottom:12px;font-size:12px;display:flex;align-items:center">' +
        '<span style="color:var(--faint)">&#9888; Outlier detection needs at least 6 animals per group. ' +
          'Below threshold: ' + insufNames + '</span>' + dimToggle +
      '</div>';
    return;
  }

  // Fence detail for active dimension
  var fenceLines = groupIds
    .filter(function(id) { return !groups[id].insufficient; })
    .map(function(id) {
      var g = groups[id];
      if (wtOutlierDimension === 'weight' && g.wFences) {
        return g.name + ': Q1\u202f' + r1(g.wFences.q1) + '\u2013Q3\u202f' + r1(g.wFences.q3) + '\u202fkg';
      }
      if (wtOutlierDimension === 'adg') {
        return g.adgFences
          ? g.name + ': Q1\u202f' + r1(g.adgFences.q1) + '\u2013Q3\u202f' + r1(g.adgFences.q3) + '\u202fg/d'
          : g.name + ': ADG insufficient data';
      }
      return null;
    }).filter(Boolean).join(' \u00b7 ');

  var insufStr = groupIds
    .filter(function(id) { return groups[id].insufficient; })
    .map(function(id) { return groups[id].name + '\u202f(n=' + groups[id].n + ')'; });
  var insufNote = insufStr.length ? ' \u00b7 Skipped: ' + insufStr.join(', ') : '';

  // Collect flagged animals for active dimension, grouped
  var byGroup = {};
  Object.keys(wtOutlierData).forEach(function(animalId) {
    var outlier = getActiveOutlier(parseInt(animalId));
    if (!outlier) return;
    var d = wtOutlierData[animalId];
    if (!byGroup[d.groupId]) byGroup[d.groupId] = [];
    var a = anSharedAnimals.find(function(x) { return x.id === parseInt(animalId); });
    byGroup[d.groupId].push({
      farmId: a ? a.farm_id : ('ID ' + animalId),
      severity: outlier.severity,
      reasons: outlier.reasons
    });
  });
  var flaggedGroupIds = Object.keys(byGroup);

  // All clear on this dimension
  if (!flaggedGroupIds.length) {
    el.innerHTML =
      '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;' +
        'padding:9px 16px;margin-bottom:12px;font-size:13px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="color:var(--green)">&#10003; No outliers on ' + wtOutlierDimension.toUpperCase() + '</span>' +
          dimToggle +
        '</div>' +
        '<div style="font-size:11px;color:var(--faint);margin-top:4px">' + fenceLines + insufNote + '</div>' +
      '</div>';
    return;
  }

  // Build per-group lines with animal IDs
  var groupLines = flaggedGroupIds.map(function(gid) {
    var items = byGroup[gid];
    var animalList = items.map(function(item) {
      var col   = item.severity === 'extreme' ? 'var(--red)' : WT_MILD_COLOR;
      var label = item.severity === 'extreme' ? 'urgent' : 'review';
      return '<span style="color:' + col + ';font-weight:500">' + item.farmId + '</span>' +
             '\u202f<span style="font-size:11px;color:' + col + '">(' + label +
             (item.reasons.length ? ': ' + item.reasons.join(', ') : '') + ')</span>';
    }).join(', \u200b');
    return '<div style="margin-top:5px">' +
      '<span style="font-weight:500">' + (groups[gid] ? groups[gid].name : 'Group') + ':</span> ' +
      animalList + '</div>';
  }).join('');

  var totalExtreme = flaggedGroupIds.reduce(function(s, gid) {
    return s + byGroup[gid].filter(function(x) { return x.severity === 'extreme'; }).length;
  }, 0);
  var totalMild = flaggedGroupIds.reduce(function(s, gid) {
    return s + byGroup[gid].filter(function(x) { return x.severity === 'mild'; }).length;
  }, 0);
  var parts = [];
  if (totalExtreme) parts.push('<span style="color:var(--red);font-weight:600">' + totalExtreme + ' urgent</span>');
  if (totalMild)    parts.push('<span style="color:' + WT_MILD_COLOR + ';font-weight:600">' + totalMild + ' review</span>');

  el.innerHTML =
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;' +
      'padding:10px 16px;margin-bottom:12px;font-size:13px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span>&#9888; ' + parts.join(', ') + ' on ' + wtOutlierDimension.toUpperCase() + '</span>' +
        '<a href="#" onclick="event.preventDefault();scrollToLogTable()" ' +
          'style="font-size:12px;color:var(--muted);text-decoration:underline">View in table &#8595;</a>' +
        dimToggle +
      '</div>' +
      groupLines +
      '<div style="font-size:11px;color:var(--faint);margin-top:6px">' +
        fenceLines + insufNote + ' \u00b7 ' +
        '<span style="color:var(--red)">&#9679;</span> extreme (Q1\u22123\u00d7IQR) \u00b7 ' +
        '<span style="color:' + WT_MILD_COLOR + '">&#9679;</span> mild (Q1\u22121.5\u00d7IQR)' +
      '</div>' +
    '</div>';
}

function scrollToLogTable() {
  var el = document.getElementById('wt-log-section');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ============================================================
// CHART MODE + Y-AXIS CONTROLS
// ============================================================
function setWTMode(mode) {
  wtChartMode = mode;
  var indBtn = document.getElementById('wt-mode-ind');
  var grpBtn = document.getElementById('wt-mode-grp');
  if (indBtn) indBtn.classList.toggle('active', mode === 'individual');
  if (grpBtn) grpBtn.classList.toggle('active', mode === 'groups');
  renderWTSidebar();
  renderWTChart();
}

function setWTYAxis(yAxis) {
  if (yAxis === 'fcr') return;
  wtYAxis = yAxis;
  var indBtn = document.getElementById('wt-y-weight');
  var adgBtn = document.getElementById('wt-y-adg');
  if (indBtn) indBtn.classList.toggle('active', yAxis === 'weight');
  if (adgBtn) adgBtn.classList.toggle('active', yAxis === 'adg');
  renderWTChart();
}


// ============================================================
// SIDEBAR
// ============================================================
function renderWTSidebar() {
  var el = document.getElementById('wt-sidebar');
  if (!el) return;

  if (wtChartMode === 'individual') {
    var grpId = document.getElementById('wt-chart-group')
      ? document.getElementById('wt-chart-group').value
      : '';
    var animals = anSharedAnimals.filter(function(a) {
      return a.status === 'active' || a.status === 'quarantine';
    });
    if (grpId) {
      var ids = getGroupAnimalIds(parseInt(grpId));
      animals = animals.filter(function(a) { return ids.indexOf(a.id) >= 0; });
    }

    var checkboxes = animals.map(function(a) {
      return '<label style="display:flex;align-items:center;gap:5px;padding:2px 0;cursor:pointer">' +
        '<input type="checkbox" class="wt-anim-cb" value="' + a.id + '" checked ' +
          'onchange="renderWTChart()">' +
        '<span>' + a.farm_id +
          (a.name ? ' <span style="color:var(--faint);font-size:10px">(' + a.name + ')</span>' : '') +
        '</span>' +
        '</label>';
    }).join('');

    el.innerHTML =
      '<div style="margin-bottom:6px;display:flex;gap:4px">' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" ' +
          'onclick="wtSelectAll(true)">All</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" ' +
          'onclick="wtSelectAll(false)">None</button>' +
      '</div>' +
      '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">' +
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
          '<input type="checkbox" id="wt-show-avg" ' + (wtShowGroupAvg ? 'checked' : '') + ' ' +
            'onchange="wtToggleGroupAvg()">' +
          '<span style="font-size:11px">Group avg</span>' +
        '</label>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--faint);margin-bottom:4px;text-transform:uppercase;' +
        'letter-spacing:0.05em">Animals</div>' +
      checkboxes;

  } else {
    // Groups mode
    var activeGroups = anSharedGroups.filter(function(g) { return g.status === 'active'; });
    var checkboxes2 = activeGroups.map(function(g, idx) {
      return '<label style="display:flex;align-items:center;gap:5px;padding:2px 0;cursor:pointer">' +
        '<input type="checkbox" class="wt-grp-cb" value="' + g.id + '" checked ' +
          'onchange="renderWTChart()">' +
        '<span style="display:flex;align-items:center;gap:4px">' +
          '<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;' +
            'background:' + CHART_COLORS[idx % CHART_COLORS.length] + '"></span>' +
          g.name +
        '</span>' +
        '</label>';
    }).join('');

    el.innerHTML =
      '<div style="margin-bottom:6px;display:flex;gap:4px">' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" ' +
          'onclick="wtSelectAllGroups(true)">All</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" ' +
          'onclick="wtSelectAllGroups(false)">None</button>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--faint);margin-bottom:4px;text-transform:uppercase;' +
        'letter-spacing:0.05em">Groups</div>' +
      checkboxes2;
  }
}

function wtSelectAll(checked) {
  document.querySelectorAll('.wt-anim-cb').forEach(function(cb) { cb.checked = checked; });
  renderWTChart();
}

function wtSelectAllGroups(checked) {
  document.querySelectorAll('.wt-grp-cb').forEach(function(cb) { cb.checked = checked; });
  renderWTChart();
}

function wtToggleGroupAvg() {
  var cb = document.getElementById('wt-show-avg');
  wtShowGroupAvg = cb ? cb.checked : !wtShowGroupAvg;
  renderWTChart();
}

function wtSelectAnimal(animalId) {
  // Set mode to individual
  wtChartMode = 'individual';
  var indBtn = document.getElementById('wt-mode-ind');
  var grpBtn = document.getElementById('wt-mode-grp');
  if (indBtn) indBtn.classList.add('active');
  if (grpBtn) grpBtn.classList.remove('active');
  // Render sidebar (all checked by default after render)
  renderWTSidebar();
  // Uncheck all, check only this animal
  document.querySelectorAll('.wt-anim-cb').forEach(function(cb) {
    cb.checked = parseInt(cb.value) === animalId;
  });
  renderWTChart();
  // Show history in log section
  var hw = document.getElementById('wt-history-wrap');
  if (hw) hw.style.display = '';
  renderWTHistorySummary(animalId);
  // Scroll history into view
  if (hw) hw.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ============================================================
// DATA SERIES BUILDERS
// ============================================================
function buildAnimalSeries(animal, yAxis) {
  // Assemble raw points: entry weight at arrival + all weigh-in records
  var raw = [];
  if (animal.entry_weight_kg != null && animal.date_of_arrival) {
    raw.push({ date: animal.date_of_arrival, wkg: parseFloat(animal.entry_weight_kg) });
  }
  (wtAllWeights[animal.id] || []).forEach(function(w) {
    raw.push({ date: w.date, wkg: parseFloat(w.weight_kg) });
  });
  if (!raw.length || !animal.date_of_arrival) return [];

  // Deduplicate by date (later entries win)
  var byDate = {};
  raw.forEach(function(p) { byDate[p.date] = p.wkg; });
  var ordered = Object.keys(byDate).sort().map(function(d) {
    return { date: d, wkg: byDate[d] };
  });

  var arrival = new Date(animal.date_of_arrival + 'T00:00:00');
  var timed = ordered.map(function(p) {
    var d = Math.round((new Date(p.date + 'T00:00:00') - arrival) / 864e5);
    return { days: Math.max(0, d), week: Math.max(0, d / 7), wkg: p.wkg };
  });

  if (yAxis === 'weight') {
    return timed.map(function(p) { return { x: p.week, y: p.wkg }; });
  }

  if (yAxis === 'adg') {
    // Rolling ADG: skip week-0 point, compute gain/day between consecutive pairs
    // First real ADG point is at week 1 (entry → first weigh-in)
    var result = [];
    for (var i = 1; i < timed.length; i++) {
      var dd = timed[i].days - timed[i - 1].days;
      if (dd > 0) {
        result.push({
          x: timed[i].week,
          y: (timed[i].wkg - timed[i - 1].wkg) / dd * 1000
        });
      }
    }
    return result;
  }

  return [];
}

function buildGroupAvgSeries(animals, yAxis) {
  var allSeries = animals
    .map(function(a) { return buildAnimalSeries(a, yAxis); })
    .filter(function(s) { return s.length > 0; });
  if (!allSeries.length) return [];

  // Union of all X points
  var xMap = {};
  allSeries.forEach(function(s) { s.forEach(function(p) { xMap[p.x] = p.x; }); });
  var xs = Object.keys(xMap).map(function(k) { return xMap[k]; }).sort(function(a, b) { return a - b; });

  // At each X: average carry-forward values of all series
  return xs.map(function(x) {
    var vals = [];
    allSeries.forEach(function(s) {
      var last = null;
      for (var i = 0; i < s.length; i++) {
        if (s[i].x <= x + 0.001) last = s[i]; else break;
      }
      if (last != null) vals.push(last.y);
    });
    if (!vals.length) return null;
    return { x: x, y: vals.reduce(function(a, b) { return a + b; }, 0) / vals.length };
  }).filter(Boolean);
}


// ============================================================
// CHART RENDER
// ============================================================
function renderWTChart() {
  var canvas = document.getElementById('wt-chart');
  if (!canvas) return;
  if (wtChart) { wtChart.destroy(); wtChart = null; }

  var datasets = [];
  var yLabel   = wtYAxis === 'adg' ? 'Rolling ADG (g/d)' : 'Weight (kg)';
  var ySuffix  = wtYAxis === 'adg' ? ' g/d' : ' kg';

  if (wtChartMode === 'individual') {
    var selectedIds = [];
    document.querySelectorAll('.wt-anim-cb:checked').forEach(function(cb) {
      selectedIds.push(parseInt(cb.value));
    });
    if (!selectedIds.length) return;

    var selectedAnimals = anSharedAnimals.filter(function(a) {
      return selectedIds.indexOf(a.id) >= 0;
    });

    selectedAnimals.forEach(function(a, idx) {
      var pts = buildAnimalSeries(a, wtYAxis);
      if (!pts.length) return;
      datasets.push({
        label: a.farm_id + (a.name ? ' (' + a.name + ')' : ''),
        data: pts,
        borderColor:     CHART_COLORS[idx % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
        borderWidth: 1.5, pointRadius: 3, tension: 0.15
      });
    });

    // Group average overlay (only meaningful with 2+ animals)
    if (wtShowGroupAvg && selectedAnimals.length > 1) {
      var avgSeries = buildGroupAvgSeries(selectedAnimals, wtYAxis);
      if (avgSeries.length) {
        datasets.push({
          label: 'Group avg',
          data: avgSeries,
          borderColor: '#222', backgroundColor: '#222',
          borderWidth: 2.5, pointRadius: 0, tension: 0.2,
          borderDash: [6, 3],
          order: 0
        });
      }
    }

  } else {
    // Groups mode: one avg line per selected group, no individual traces
    var selectedGrpIds = [];
    document.querySelectorAll('.wt-grp-cb:checked').forEach(function(cb) {
      selectedGrpIds.push(parseInt(cb.value));
    });
    if (!selectedGrpIds.length) return;

    selectedGrpIds.forEach(function(gid, idx) {
      var animals = getGroupAnimals(gid);
      if (!animals.length) return;
      var avgSeries = buildGroupAvgSeries(animals, wtYAxis);
      if (!avgSeries.length) return;
      datasets.push({
        label: getGroupName(gid),
        data: avgSeries,
        borderColor:     CHART_COLORS[idx % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
        borderWidth: 2.5, pointRadius: 3, tension: 0.15
      });
    });
  }

  if (!datasets.length) return;

  wtChart = new Chart(canvas, {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: function(items) {
              return 'Week ' + r1(items[0].parsed.x);
            },
            label: function(ctx) {
              return ctx.dataset.label + ': ' + r1(ctx.parsed.y) + ySuffix;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true, text: 'Weeks since arrival',
            font: { size: 11 }, color: '#6B6B65'
          },
          ticks: { font: { size: 10 }, color: '#6B6B65' },
          grid: { color: '#E8E4DA' }
        },
        y: {
          title: {
            display: true, text: yLabel,
            font: { size: 11 }, color: '#6B6B65'
          },
          ticks: { font: { size: 10 }, color: '#6B6B65' },
          grid: { color: '#E8E4DA' }
        }
      }
    }
  });
}


// ============================================================
// HISTORY PANEL (individual mode, below chart)
// ============================================================
function renderWTHistorySummary(animalId) {
  var el = document.getElementById('wt-history-wrap');
  if (!el) return;

  var a      = anSharedAnimals.find(function(x) { return x.id === animalId; });
  var series = wtAllWeights[animalId] || [];

  // Build ordered point list (entry + all weigh-ins, deduped by date)
  var rawPts = [];
  if (a && a.entry_weight_kg != null && a.date_of_arrival) {
    rawPts.push({ date: a.date_of_arrival, wkg: parseFloat(a.entry_weight_kg), bcs: null, isEntry: true });
  }
  series.forEach(function(w) {
    rawPts.push({ date: w.date, wkg: w.weight_kg, bcs: w.bcs_score, isEntry: false });
  });
  var byDate = {};
  rawPts.forEach(function(p) { byDate[p.date] = p; });
  var ordered = Object.keys(byDate).sort().map(function(d) { return byDate[d]; });

  if (!ordered.length) {
    el.innerHTML = '<div style="padding:10px 0;font-size:13px;color:var(--faint)">No weight data for this animal.</div>';
    return;
  }

  var first     = ordered[0];
  var last      = ordered[ordered.length - 1];
  var totalDays = Math.round(
    (new Date(last.date + 'T00:00:00') - new Date(first.date + 'T00:00:00')) / 864e5
  );
  var overallAdg = totalDays > 0
    ? r1((last.wkg - first.wkg) / totalDays * 1000) + ' g/d'
    : '\u2014';
  var nWeighins = series.length;
  var label     = a ? a.farm_id : 'Animal';

  var rows = '';
  for (var i = 0; i < ordered.length; i++) {
    var p = ordered[i];
    var adgCell = '\u2014';
    if (i > 0) {
      var prev = ordered[i - 1];
      var dd = Math.round(
        (new Date(p.date + 'T00:00:00') - new Date(prev.date + 'T00:00:00')) / 864e5
      );
      if (dd > 0) adgCell = r1((p.wkg - prev.wkg) / dd * 1000) + ' g/d';
    }
    rows += '<tr>' +
      '<td class="mono">' + fmtDate(p.date) +
        (p.isEntry ? ' <span style="font-size:10px;color:var(--faint)">(entry)</span>' : '') +
      '</td>' +
      '<td class="mono right">' + r1(p.wkg) + ' kg</td>' +
      '<td class="mono right">' + (p.bcs != null ? p.bcs : '\u2014') + '</td>' +
      '<td class="mono right">' + adgCell + '</td>' +
      '</tr>';
  }

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:16px;font-size:13px;margin-bottom:8px;flex-wrap:wrap">' +
      '<strong>' + label + '</strong>' +
      '<span style="color:var(--muted)">' + nWeighins + ' weigh-in' + (nWeighins !== 1 ? 's' : '') + '</span>' +
      '<span class="mono">' + r1(first.wkg) + ' \u2192 ' + r1(last.wkg) + ' kg</span>' +
      '<span style="color:var(--muted)">Overall ADG: <strong>' + overallAdg + '</strong></span>' +
      '<button class="btn btn-sm" style="margin-left:auto;font-size:11px" ' +
        'onclick="document.getElementById(\'wt-history-wrap\').style.display=\'none\'">&#10005; Close</button>' +
    '</div>' +
    '<div style="overflow-x:auto">' +
      '<table><thead><tr>' +
        '<th>Date</th>' +
        '<th class="right">Weight</th>' +
        '<th class="right">BCS</th>' +
        '<th class="right">ADG from prev</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '</div>';
}

// (wtToggleHistory removed — history table is shown directly, closed via × button)
