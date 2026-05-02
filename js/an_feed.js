// an_feed.js v20
// Animal feeding page — rebuilt
// Depends on: shared.js, an_helpers.js
// ============================================================

var anFeedGroupId  = null;
var afPeriod       = 'daily';   // 'daily' | 'weekly' | 'monthly'
var afEditEventId  = null;

var FEED_RESPONSE_LABELS = {
  fully_consumed:      'Fully consumed',
  partial_refusal:     'Partial refusal',
  significant_refusal: 'Significant refusal',
  trough_empty_early:  'Trough empty early',
  not_offered:         'Not offered'
};
var FEED_RESPONSE_OPTS = Object.keys(FEED_RESPONSE_LABELS).map(function(k) {
  return '<option value="' + k + '">' + FEED_RESPONSE_LABELS[k] + '</option>';
}).join('');

// ============================================================
// PAGE LOAD
// ============================================================
async function loadAnimalFeedingPage() {
  var el = document.getElementById('anfeed-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var activeGroups = anSharedGroups.filter(function(g) { return g.status === 'active'; });
    if (!anFeedGroupId && activeGroups.length) anFeedGroupId = activeGroups[0].id;
    var grpOpts = activeGroups.map(function(g) {
      return '<option value="' + g.id + '"' + (g.id === anFeedGroupId ? ' selected' : '') + '>' +
        g.name + '</option>';
    }).join('');

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        '<label style="font-size:13px;color:var(--muted)">Group</label>' +
        '<select id="anfeed-group-sel" onchange="onAnFeedGroupChange()">' + grpOpts + '</select>' +
      '</div>' +
      '<div id="anfeed-group-body"><div class="loading">Loading group...</div></div>' +
      '<div id="abbrev-anfeed"></div>';

    if (anFeedGroupId) await renderAnFeedGroup(anFeedGroupId);
    renderAbbrevKey('abbrev-anfeed', ['DM', 'DMI', 'FCR', 'PKR', 'ADG']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

async function onAnFeedGroupChange() {
  var sel = document.getElementById('anfeed-group-sel');
  if (!sel) return;
  anFeedGroupId = sel.value ? parseInt(sel.value) : null;
  if (anFeedGroupId) await renderAnFeedGroup(anFeedGroupId);
}

// ============================================================
// GROUP RENDER — assembles all four sections
// ============================================================
async function renderAnFeedGroup(groupId) {
  var el = document.getElementById('anfeed-group-body');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var group   = anSharedGroups.find(function(g) { return g.id === groupId; });
    var animals = getGroupAnimals(groupId);
    var stats   = computeGroupStats(animals);

    var results = await Promise.all([
      sbGet('group_recipes',
        'group_id=eq.' + groupId + '&effective_to=is.null' +
        '&select=id,ration_plan_id,effective_from,notes,ration_plans(id,name)&limit=1'),
      sbGet('group_recipes',
        'group_id=eq.' + groupId + '&effective_to=not.is.null' +
        '&select=id,ration_plan_id,effective_from,effective_to,' +
        'ration_plans(name)&order=effective_to.desc&limit=10'),
      sbGet('ration_plans', 'active=eq.true&select=id,name,species_id&order=name'),
      sbGet('feeding_events',
        'group_id=eq.' + groupId +
        '&select=id,recorded_at,concentrate_kg,hay_kg,green_fodder_kg,bsf_larvae_kg,' +
        'concentrate_response,hay_response,green_fodder_response,ration_plan_version_id,' +
        'recorded_by,workers(name),notes&order=recorded_at.desc&limit=200')
    ]);

    var activeAssignment = results[0].length ? results[0][0] : null;
    var history          = results[1];
    var allPlans         = results[2];
    var feedLog          = results[3];

    var activePlanId = activeAssignment && activeAssignment.ration_plan_id;
    var activeVersion = null;
    var hayDmPct = null, fodDmPct = null;

    if (activePlanId) {
      var verRows = await sbGet('ration_plan_versions',
        'ration_plan_id=eq.' + activePlanId +
        '&select=id,version_number,dmi_pct_body_weight,concentrate_pct_dmi,hay_pct_dmi,' +
        'green_fodder_pct_dmi,concentrate_recipe_id,hay_ingredient_id,green_fodder_ingredient_id,' +
        'recipes(name),hay_ing:ingredients!hay_ingredient_id(id,name,dry_matter_pct),' +
        'fodder_ing:ingredients!green_fodder_ingredient_id(id,name,dry_matter_pct)' +
        '&order=version_number.desc&limit=1');
      activeVersion = verRows.length ? verRows[0] : null;
      if (activeVersion) {
        if (activeVersion.hay_ing    && activeVersion.hay_ing.dry_matter_pct)
          hayDmPct = parseFloat(activeVersion.hay_ing.dry_matter_pct);
        if (activeVersion.fodder_ing && activeVersion.fodder_ing.dry_matter_pct)
          fodDmPct = parseFloat(activeVersion.fodder_ing.dry_matter_pct);
      }
    }

    var html =
      afRenderRationSection(groupId, activeAssignment, activeVersion, history, allPlans) +
      afRenderTargetsSection(activeVersion, stats, hayDmPct, fodDmPct) +
      afRenderSummarySection(groupId, feedLog, activeVersion, stats, hayDmPct, fodDmPct) +
      afRenderLogSection(groupId, feedLog, allPlans, activeVersion);

    el.innerHTML = html;
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}


// ============================================================
// SECTION 1 — RATION ASSIGNMENT
// ============================================================
function afRenderRationSection(groupId, assignment, version, history, allPlans) {
  var cardHtml = '';
  if (version) {
    var planName = assignment && assignment.ration_plans ? assignment.ration_plans.name : 'Ration plan';
    cardHtml =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
        'padding:14px 18px;background:var(--green-lt);border:1px solid var(--green-bdr);border-radius:10px;margin-bottom:12px">' +
        '<div>' +
          '<div style="font-weight:500;font-size:14px">' + planName + '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:3px">' +
            'DMI: ' + version.dmi_pct_body_weight + '% BW \u00b7 ' +
            'Concentrate: ' + version.concentrate_pct_dmi + '% \u00b7 ' +
            'Hay: ' + version.hay_pct_dmi + '% \u00b7 ' +
            'Green fodder: ' + version.green_fodder_pct_dmi + '%' +
          '</div>' +
          '<div style="font-size:12px;color:var(--muted)">' +
            (version.recipes ? 'Concentrate: ' + version.recipes.name : '') +
            (version.hay_ing    ? ' \u00b7 Hay: '    + version.hay_ing.name    : '') +
            (version.fodder_ing ? ' \u00b7 Fodder: ' + version.fodder_ing.name : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--faint);margin-top:2px">' +
            'v' + version.version_number +
            (assignment ? ' \u00b7 Assigned ' + fmtDate(assignment.effective_from) : '') +
            (assignment && assignment.notes ? ' \u00b7 ' + assignment.notes : '') +
          '</div>' +
        '</div>' +
        '<button class="btn btn-sm" onclick="afOpenRationModal(' + groupId + ')">Change</button>' +
      '</div>';
  } else {
    cardHtml =
      '<div style="padding:14px 18px;background:var(--amber-lt);border:1px solid var(--amber-bdr);' +
        'border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">' +
        '<div>' +
          '<div style="font-weight:500">No ration plan assigned.</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:3px">Assign a ration plan to enable feed targets and projections.</div>' +
        '</div>' +
        '<button class="btn btn-sm btn-primary" onclick="afOpenRationModal(' + groupId + ')">Assign plan</button>' +
      '</div>';
  }

  var histHtml = '';
  if (history.length) {
    histHtml = '<details style="margin-top:8px"><summary style="font-size:12px;color:var(--muted);cursor:pointer">' +
      'Previous assignments (' + history.length + ')</summary>' +
      '<div style="overflow-x:auto;margin-top:8px"><table><thead><tr>' +
        '<th>Plan</th><th>From</th><th>To</th>' +
      '</tr></thead><tbody>' +
      history.map(function(h) {
        return '<tr><td>' + (h.ration_plans ? h.ration_plans.name : '\u2014') + '</td>' +
          '<td class="mono">' + fmtDate(h.effective_from) + '</td>' +
          '<td class="mono">' + fmtDate(h.effective_to) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></details>';
  }

  return '<div class="section">' +
    '<div class="section-hdr"><h2>Ration assignment</h2></div>' +
    '<div style="padding:16px 22px">' + cardHtml + histHtml + '</div>' +
    '</div>';
}


// ============================================================
// SECTION 2 — TODAY'S TARGETS
// ============================================================
function afRenderTargetsSection(version, stats, hayDmPct, fodDmPct) {
  if (!version) {
    return '<div class="section"><div class="section-hdr"><h2>Today\'s targets</h2></div>' +
      '<div style="padding:14px 22px;font-size:13px;color:var(--faint)">Assign a ration plan to see daily feed targets.</div></div>';
  }
  if (stats.avgCurrent == null) {
    return '<div class="section"><div class="section-hdr"><h2>Today\'s targets</h2></div>' +
      '<div style="padding:14px 22px;font-size:13px;color:var(--amber)">No weight data for this group — targets cannot be calculated.</div></div>';
  }

  var avgWt  = stats.avgCurrent;
  var n      = stats.headCount;
  var dmi    = parseFloat(version.dmi_pct_body_weight) / 100;
  var cPct   = parseFloat(version.concentrate_pct_dmi) / 100;
  var hPct   = parseFloat(version.hay_pct_dmi) / 100;
  var fPct   = parseFloat(version.green_fodder_pct_dmi) / 100;
  var hayLabel = version.hay_ing    ? version.hay_ing.name    : 'Hay';
  var fodLabel = version.fodder_ing ? version.fodder_ing.name : 'Green fodder';

  // DM% for concentrate assumed 88% (standard for mixed concentrate)
  var concDmPct = 0.88;

  var totalDmiPerHead = avgWt * dmi;
  var concDmPerHead   = totalDmiPerHead * cPct;
  var hayDmPerHead    = totalDmiPerHead * hPct;
  var fodDmPerHead    = totalDmiPerHead * fPct;

  // As-fed = DM kg / DM fraction
  var concAfPerHead = concDmPct > 0 ? concDmPerHead / concDmPct : null;
  var hayAfPerHead  = hayDmPct  > 0 ? hayDmPerHead  / (hayDmPct / 100) : null;
  var fodAfPerHead  = fodDmPct  > 0 ? fodDmPerHead  / (fodDmPct / 100) : null;

  function fmt(v, n2) {
    if (v == null) return '\u2014';
    return r1(v) + ' kg' + (n2 ? ' &nbsp;<span style="color:var(--faint);font-size:11px">(' + r1(v * n2) + ' kg group)</span>' : '');
  }

  // Weight staleness warning
  var warnHtml = '';
  if (stats.latestWeightDate) {
    var daysSince = Math.round((new Date() - new Date(stats.latestWeightDate + 'T00:00:00')) / 864e5);
    if (daysSince > 10) {
      warnHtml = '<div style="font-size:12px;color:#C8A800;margin-bottom:10px">' +
        '\u26a0 Weight data is ' + daysSince + ' days old \u2014 targets may be understated.</div>';
    }
  }

  var footNote = '<div style="font-size:11px;color:var(--faint);margin-top:10px">' +
    'Based on avg weight ' + r1(avgWt) + ' kg \u00b7 ' + n + ' animals \u00b7 ' +
    'Concentrate DM 88% \u00b7 ' +
    'Hay DM ' + (hayDmPct != null ? hayDmPct + '%' : 'unknown') + ' \u00b7 ' +
    'Green fodder DM ' + (fodDmPct != null ? fodDmPct + '%' : 'unknown') +
    (stats.latestWeightDate ? ' \u00b7 Weights from ' + fmtDate(stats.latestWeightDate) : '') +
    '</div>';

  return '<div class="section">' +
    '<div class="section-hdr"><h2>Today\'s targets</h2>' +
      '<span style="font-size:12px;color:var(--muted)">' + n + ' animals \u00b7 avg ' + r1(avgWt) + ' kg</span>' +
    '</div>' +
    '<div style="padding:16px 22px">' +
    warnHtml +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:10px">' +
      '<div class="metric-card">' +
        '<div class="m-label">Concentrate</div>' +
        '<div class="m-value" style="font-size:22px">' + (concAfPerHead != null ? r1(concAfPerHead * n) + ' kg' : '\u2014') + '</div>' +
        '<div class="m-sub">' + (concAfPerHead != null ? r1(concAfPerHead) + ' kg per head' : '') + '</div>' +
      '</div>' +
      '<div class="metric-card">' +
        '<div class="m-label">Hay</div>' +
        '<div class="m-value" style="font-size:22px">' + (hayAfPerHead != null ? r1(hayAfPerHead * n) + ' kg' : '\u2014') + '</div>' +
        '<div class="m-sub">' + (hayAfPerHead != null ? r1(hayAfPerHead) + ' kg per head' : '') + '</div>' +
      '</div>' +
      '<div class="metric-card">' +
        '<div class="m-label">Green fodder</div>' +
        '<div class="m-value" style="font-size:22px">' + (fodAfPerHead != null ? r1(fodAfPerHead * n) + ' kg' : '\u2014') + '</div>' +
        '<div class="m-sub">' + (fodAfPerHead != null ? r1(fodAfPerHead) + ' kg per head' : '') + '</div>' +
      '</div>' +
    '</div>' +
    footNote +
    '</div></div>';
}


// ============================================================
// SECTION 3 — SUMMARY VIEW
// ============================================================
function afRenderSummarySection(groupId, feedLog, version, stats, hayDmPct, fodDmPct) {
  var periodBtns =
    '<div style="display:flex">' +
      ['daily','weekly','monthly'].map(function(p) {
        return '<button id="af-period-' + p + '" class="btn btn-sm' + (afPeriod === p ? ' active' : '') + '" ' +
          'onclick="afSetPeriod(\'' + p + '\',' + groupId + ')" ' +
          'style="border-radius:' + (p==='daily'?'6px 0 0 6px':p==='monthly'?'0 6px 6px 0':'0') + ';margin:0;border-left:' + (p==='daily'?'':' 0') + '">' +
          p.charAt(0).toUpperCase() + p.slice(1) + '</button>';
      }).join('') +
    '</div>';

  // Build response summary (last 14 days)
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
  var recentLog = feedLog.filter(function(f) { return new Date(f.recorded_at) >= cutoff; });
  var responseSummaryHtml = afRenderResponseSummary(recentLog);

  // Build period data
  var periodData = afAggregatePeriod(feedLog, afPeriod);
  var projData   = afComputeProjections(feedLog, version, stats, hayDmPct, fodDmPct, afPeriod);
  var summaryTableHtml = afRenderSummaryTable(periodData, projData, afPeriod);

  return '<div class="section" id="af-summary-section">' +
    '<div class="section-hdr"><h2>Feed summary</h2>' + periodBtns + '</div>' +
    '<div style="padding:16px 22px">' +
    (feedLog.length === 0
      ? '<div style="font-size:13px;color:var(--amber);padding:8px 12px;background:var(--amber-lt);' +
          'border:1px solid var(--amber-bdr);border-radius:8px;margin-bottom:14px">' +
          '\u26a0 No feed events logged yet \u2014 projections shown below are estimates only.</div>'
      : '') +
    summaryTableHtml +
    '<div style="margin-top:20px"><strong style="font-size:13px">Feed response \u2014 last 14 days</strong></div>' +
    responseSummaryHtml +
    '</div></div>';
}

function afSetPeriod(period, groupId) {
  afPeriod = period;
  renderAnFeedGroup(groupId);
}

function afAggregatePeriod(feedLog, period) {
  var buckets = {};
  feedLog.forEach(function(f) {
    var d   = new Date(f.recorded_at);
    var key;
    if (period === 'daily') {
      key = d.toISOString().slice(0, 10);
    } else if (period === 'weekly') {
      // ISO week start (Monday)
      var day = d.getDay() || 7;
      var mon = new Date(d); mon.setDate(d.getDate() - day + 1);
      key = mon.toISOString().slice(0, 10);
    } else {
      key = d.toISOString().slice(0, 7);
    }
    if (!buckets[key]) buckets[key] = { concentrate: 0, hay: 0, fodder: 0, bsf: 0, events: 0 };
    buckets[key].concentrate += parseFloat(f.concentrate_kg || 0);
    buckets[key].hay         += parseFloat(f.hay_kg || 0);
    buckets[key].fodder      += parseFloat(f.green_fodder_kg || 0);
    buckets[key].bsf         += parseFloat(f.bsf_larvae_kg || 0);
    buckets[key].events++;
  });
  return Object.keys(buckets).sort().reverse().slice(0, 30).map(function(k) {
    return Object.assign({ key: k }, buckets[k]);
  });
}

function afComputeProjections(feedLog, plan, stats, hayDmPct, fodDmPct, period) {
  if (!plan || stats.avgCurrent == null) return {};
  var avgWt = stats.avgCurrent;
  var n     = stats.headCount;
  var dmi   = parseFloat(plan.dmi_pct_body_weight) / 100;
  var concDmPct = 0.88;
  var hDmFrac = hayDmPct ? hayDmPct / 100 : null;
  var fDmFrac = fodDmPct ? fodDmPct / 100 : null;

  var dailyConcAf = concDmPct > 0 ? (avgWt * dmi * parseFloat(plan.concentrate_pct_dmi) / 100 / concDmPct) * n : null;
  var dailyHayAf  = hDmFrac   > 0 ? (avgWt * dmi * parseFloat(plan.hay_pct_dmi)          / 100 / hDmFrac)   * n : null;
  var dailyFodAf  = fDmFrac   > 0 ? (avgWt * dmi * parseFloat(plan.green_fodder_pct_dmi) / 100 / fDmFrac)   * n : null;

  var mult = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 1;
  return {
    concentrate: dailyConcAf != null ? dailyConcAf * mult : null,
    hay:         dailyHayAf  != null ? dailyHayAf  * mult : null,
    fodder:      dailyFodAf  != null ? dailyFodAf  * mult : null
  };
}

function afRenderSummaryTable(periodData, projData, period) {
  if (!periodData.length) {
    return '<div class="empty">No feeding events recorded yet.</div>';
  }
  var hasProj = projData.concentrate != null || projData.hay != null || projData.fodder != null;
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>' + (period === 'monthly' ? 'Month' : period === 'weekly' ? 'Week of' : 'Date') + '</th>' +
    '<th class="right">Conc. (kg)</th>' +
    (hasProj ? '<th class="right" style="color:var(--faint)">Proj.</th>' : '') +
    '<th class="right">Hay (kg)</th>' +
    (hasProj ? '<th class="right" style="color:var(--faint)">Proj.</th>' : '') +
    '<th class="right">Green fodder (kg)</th>' +
    (hasProj ? '<th class="right" style="color:var(--faint)">Proj.</th>' : '') +
    '<th class="right">BSF (kg)</th><th class="right">Events</th>' +
    '</tr></thead><tbody>';

  periodData.forEach(function(row) {
    var cVar = (hasProj && projData.concentrate && row.concentrate)
      ? ((row.concentrate - projData.concentrate) / projData.concentrate * 100) : null;
    var varStyle = function(v) {
      if (v == null) return '';
      return v < -15 ? 'color:var(--amber)' : v > 15 ? 'color:#C8A800' : 'color:var(--green)';
    };
    html += '<tr>' +
      '<td class="mono">' + row.key + '</td>' +
      '<td class="mono right">' + r1(row.concentrate) + '</td>' +
      (hasProj ? '<td class="mono right" style="color:var(--faint)">' +
        (projData.concentrate != null ? r1(projData.concentrate) : '\u2014') +
        (cVar != null ? ' <span style="font-size:10px;' + varStyle(cVar) + '">(' + (cVar > 0 ? '+' : '') + r1(cVar) + '%)</span>' : '') +
        '</td>' : '') +
      '<td class="mono right">' + r1(row.hay) + '</td>' +
      (hasProj ? '<td class="mono right" style="color:var(--faint)">' + (projData.hay != null ? r1(projData.hay) : '\u2014') + '</td>' : '') +
      '<td class="mono right">' + r1(row.fodder) + '</td>' +
      (hasProj ? '<td class="mono right" style="color:var(--faint)">' + (projData.fodder != null ? r1(projData.fodder) : '\u2014') + '</td>' : '') +
      '<td class="mono right">' + r1(row.bsf) + '</td>' +
      '<td class="mono right">' + row.events + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  if (hasProj) {
    html += '<div style="font-size:11px;color:var(--faint);margin-top:6px">' +
      'Proj. = projected from ration plan \u00b7 % variance shown for concentrate only</div>';
  }
  return html;
}

function afRenderResponseSummary(recentLog) {
  if (!recentLog.length) {
    return '<div style="font-size:13px;color:var(--faint);margin-top:8px">No events in last 14 days.</div>';
  }
  var types  = ['concentrate', 'hay', 'green_fodder'];
  var labels = ['Concentrate', 'Hay', 'Green fodder'];
  var keys   = Object.keys(FEED_RESPONSE_LABELS);

  var counts = {};
  types.forEach(function(t) { counts[t] = {}; keys.forEach(function(k) { counts[t][k] = 0; }); counts[t].null = 0; });
  recentLog.forEach(function(f) {
    types.forEach(function(t) {
      var v = f[t + '_response'];
      if (v && counts[t][v] !== undefined) counts[t][v]++;
      else counts[t].null++;
    });
  });

  var html = '<div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th>Feed type</th>' +
    keys.map(function(k) { return '<th class="right" style="font-size:11px">' + FEED_RESPONSE_LABELS[k] + '</th>'; }).join('') +
    '<th class="right" style="font-size:11px">Not recorded</th>' +
    '</tr></thead><tbody>';
  types.forEach(function(t, i) {
    html += '<tr><td style="font-weight:500">' + labels[i] + '</td>' +
      keys.map(function(k) { return '<td class="mono right">' + (counts[t][k] || 0) + '</td>'; }).join('') +
      '<td class="mono right" style="color:var(--faint)">' + (counts[t].null || 0) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}


// ============================================================
// SECTION 4 — FULL EVENT LOG
// ============================================================
function afRenderLogSection(groupId, feedLog, allPlans, activeVersion) {

  var respOpts = '<option value="">\u2014</option>' + FEED_RESPONSE_OPTS;

  var formHtml =
    '<div id="af-log-form" style="display:none;padding:16px 22px;background:var(--bg);border-bottom:1px solid var(--border)">' +
      '<input type="hidden" id="afl-version-id" value="' + (activeVersion ? activeVersion.id : '') + '">' +
      '<div class="hf-grid">' +
        '<div class="hf-field"><label>Date &amp; time</label>' +
          '<input type="datetime-local" id="afl-dt" value="' + afNowLocal() + '"></div>' +

        '<div class="hf-field"><label>Concentrate (kg as-fed)</label>' +
          '<input type="number" id="afl-conc" min="0" step="0.1" placeholder="kg">' +
          '<div style="font-size:11px;margin-top:3px"><label style="font-size:11px;font-weight:400">Response: </label>' +
          '<select id="afl-conc-resp" style="font-size:11px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div></div>' +
        '<div class="hf-field"><label>Hay (kg as-fed)</label>' +
          '<input type="number" id="afl-hay" min="0" step="0.1" placeholder="kg">' +
          '<div style="font-size:11px;margin-top:3px"><label style="font-size:11px;font-weight:400">Response: </label>' +
          '<select id="afl-hay-resp" style="font-size:11px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div></div>' +
        '<div class="hf-field"><label>Green fodder (kg as-fed)</label>' +
          '<input type="number" id="afl-fod" min="0" step="0.1" placeholder="kg">' +
          '<div style="font-size:11px;margin-top:3px"><label style="font-size:11px;font-weight:400">Response: </label>' +
          '<select id="afl-fod-resp" style="font-size:11px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div></div>' +
        '<div class="hf-field"><label>BSF larvae (kg as-fed)</label>' +
          '<input type="number" id="afl-bsf" min="0" step="0.1" placeholder="kg"></div>' +
        '<div class="hf-field"><label>Recorded by</label>' +
          '<select id="afl-worker"><option value="">\u2014</option>' +
          anSharedWorkers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="hf-field"><label>Notes (optional)</label>' +
          '<input type="text" id="afl-notes" placeholder="Optional"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:10px">' +
        '<button class="btn btn-primary btn-sm" onclick="afSubmitFeedEvent(' + groupId + ')">Save</button>' +
        '<button class="btn btn-sm" onclick="afToggleLogForm()">Cancel</button>' +
        '<span id="afl-status" style="font-size:13px;color:var(--muted);align-self:center"></span>' +
      '</div>' +
    '</div>';

  var tableHtml = '';
  if (!feedLog.length) {
    tableHtml = '<div class="empty">No feed events logged for this group yet.</div>';
  } else {
    tableHtml = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Date / time</th>' +
      '<th class="right">Conc.</th><th style="font-size:10px;color:var(--faint)">Response</th>' +
      '<th class="right">Hay</th><th style="font-size:10px;color:var(--faint)">Response</th>' +
      '<th class="right">Fodder</th><th style="font-size:10px;color:var(--faint)">Response</th>' +
      '<th class="right">BSF</th>' +
      '<th>By</th><th></th>' +
      '</tr></thead><tbody>';
    feedLog.forEach(function(f) {
      var dt = new Date(f.recorded_at);
      var dtStr = dt.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) +
        ' ' + dt.toLocaleTimeString('en-PK', { hour:'2-digit', minute:'2-digit' });
      tableHtml += '<tr id="af-row-' + f.id + '">' +
        '<td class="mono">' + dtStr + '</td>' +
        '<td class="mono right">' + (f.concentrate_kg  != null ? r1(f.concentrate_kg)  : '\u2014') + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + afResponseLabel(f.concentrate_response)  + '</td>' +
        '<td class="mono right">' + (f.hay_kg           != null ? r1(f.hay_kg)           : '\u2014') + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + afResponseLabel(f.hay_response)           + '</td>' +
        '<td class="mono right">' + (f.green_fodder_kg  != null ? r1(f.green_fodder_kg)  : '\u2014') + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + afResponseLabel(f.green_fodder_response)  + '</td>' +
        '<td class="mono right">' + (f.bsf_larvae_kg    != null ? r1(f.bsf_larvae_kg)    : '\u2014') + '</td>' +
        '<td class="muted-cell">' + (f.workers ? f.workers.name : '\u2014') + '</td>' +
        '<td><button class="btn btn-sm" onclick="afOpenInlineEdit(' + f.id + ', ' + groupId + ')">Edit</button></td>' +
        '</tr>';
    });
    tableHtml += '</tbody></table></div>';
  }

  return '<div class="section">' +
    '<div class="section-hdr"><h2>Feed log</h2>' +
      '<button class="btn btn-sm btn-primary" onclick="afToggleLogForm()">+ Log event</button>' +
    '</div>' +
    formHtml +
    tableHtml +
    '</div>';
}

function afResponseLabel(val) {
  if (!val) return '\u2014';
  return FEED_RESPONSE_LABELS[val] || val;
}

function afNowLocal() {
  var now = new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
}


// ============================================================
// LOG FORM ACTIONS
// ============================================================
function afToggleLogForm() {
  var f = document.getElementById('af-log-form');
  if (!f) return;
  f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
}

async function afSubmitFeedEvent(groupId) {
  var st = document.getElementById('afl-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var dt = document.getElementById('afl-dt').value;
    if (!dt) throw new Error('Date and time required.');
    var d = { group_id: groupId, recorded_at: new Date(dt).toISOString() };
    var verId = document.getElementById('afl-version-id').value;
    if (verId) d.ration_plan_version_id = parseInt(verId);

    var conc = document.getElementById('afl-conc').value;
    var hay  = document.getElementById('afl-hay').value;
    var fod  = document.getElementById('afl-fod').value;
    var bsf  = document.getElementById('afl-bsf').value;
    var wkr  = document.getElementById('afl-worker').value;
    var nts  = document.getElementById('afl-notes').value.trim();

    if (conc) d.concentrate_kg  = parseFloat(conc);
    if (hay)  d.hay_kg           = parseFloat(hay);
    if (fod)  d.green_fodder_kg  = parseFloat(fod);
    if (bsf)  d.bsf_larvae_kg    = parseFloat(bsf);
    if (wkr)  d.recorded_by      = parseInt(wkr);
    if (nts)  d.notes             = nts;

    var cr = document.getElementById('afl-conc-resp').value;
    var hr = document.getElementById('afl-hay-resp').value;
    var fr = document.getElementById('afl-fod-resp').value;
    if (cr) d.concentrate_response  = cr;
    if (hr) d.hay_response           = hr;
    if (fr) d.green_fodder_response  = fr;

    if (!conc && !hay && !fod && !bsf) throw new Error('Enter at least one feed quantity.');

    await sbInsert('feeding_events', [d]);
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    afToggleLogForm();
    await renderAnFeedGroup(groupId);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}


// ============================================================
// INLINE EDIT
// ============================================================
function afOpenInlineEdit(eventId, groupId) {
  // Close any open edit rows first
  var existing = document.getElementById('af-edit-row-' + afEditEventId);
  if (existing) existing.remove();

  afEditEventId = eventId;
  var row = document.getElementById('af-row-' + eventId);
  if (!row) return;

  var editRow = document.createElement('tr');
  editRow.id = 'af-edit-row-' + eventId;
  editRow.style.background = 'var(--bg)';
  editRow.innerHTML = '<td colspan="10" style="padding:10px 14px">' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Concentrate kg</div>' +
        '<input type="number" id="afl-edit-conc" min="0" step="0.1" style="width:90px"></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Conc. response</div>' +
        '<select id="afl-edit-conc-resp" style="font-size:12px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Hay kg</div>' +
        '<input type="number" id="afl-edit-hay" min="0" step="0.1" style="width:90px"></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Hay response</div>' +
        '<select id="afl-edit-hay-resp" style="font-size:12px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Fodder kg</div>' +
        '<input type="number" id="afl-edit-fod" min="0" step="0.1" style="width:90px"></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Fodder response</div>' +
        '<select id="afl-edit-fod-resp" style="font-size:12px"><option value="">\u2014</option>' + FEED_RESPONSE_OPTS + '</select></div>' +
      '<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">BSF kg</div>' +
        '<input type="number" id="afl-edit-bsf" min="0" step="0.1" style="width:90px"></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button class="btn btn-primary btn-sm" onclick="afSaveInlineEdit(' + eventId + ',' + groupId + ')">Save</button>' +
      '<button class="btn btn-sm" onclick="afCancelInlineEdit()">Cancel</button>' +
      '<span id="afl-edit-status" style="font-size:12px;color:var(--muted);align-self:center"></span>' +
    '</div>' +
    '</td>';
  row.insertAdjacentElement('afterend', editRow);
}

function afCancelInlineEdit() {
  var existing = document.getElementById('af-edit-row-' + afEditEventId);
  if (existing) existing.remove();
  afEditEventId = null;
}

async function afSaveInlineEdit(eventId, groupId) {
  var st = document.getElementById('afl-edit-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var patch = {};
    var conc = document.getElementById('afl-edit-conc').value;
    var hay  = document.getElementById('afl-edit-hay').value;
    var fod  = document.getElementById('afl-edit-fod').value;
    var bsf  = document.getElementById('afl-edit-bsf').value;
    var cr   = document.getElementById('afl-edit-conc-resp').value;
    var hr   = document.getElementById('afl-edit-hay-resp').value;
    var fr   = document.getElementById('afl-edit-fod-resp').value;

    if (conc !== '') patch.concentrate_kg        = conc ? parseFloat(conc) : null;
    if (hay  !== '') patch.hay_kg                = hay  ? parseFloat(hay)  : null;
    if (fod  !== '') patch.green_fodder_kg       = fod  ? parseFloat(fod)  : null;
    if (bsf  !== '') patch.bsf_larvae_kg         = bsf  ? parseFloat(bsf)  : null;
    if (cr)  patch.concentrate_response          = cr;
    if (hr)  patch.hay_response                  = hr;
    if (fr)  patch.green_fodder_response         = fr;

    if (!Object.keys(patch).length) throw new Error('No changes to save.');
    await sbPatch('feeding_events', eventId, patch);
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    afEditEventId = null;
    await renderAnFeedGroup(groupId);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}


// ============================================================
// RATION ASSIGNMENT MODAL
// ============================================================
async function afOpenRationModal(groupId) {
  try {
    var plans = await sbGet('ration_plans', 'active=eq.true&select=id,name,dmi_pct_body_weight,' +
      'concentrate_pct_dmi,hay_pct_dmi,green_fodder_pct_dmi&order=name');
    var opts = '<option value="">\u2014 select \u2014</option>' +
      plans.map(function(p) {
        return '<option value="' + p.id + '">' + p.name +
          ' (' + p.dmi_pct_body_weight + '% DMI, ' +
          p.concentrate_pct_dmi + '/' + p.hay_pct_dmi + '/' + p.green_fodder_pct_dmi + ')</option>';
      }).join('');

    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'af-ration-modal';
    modal.innerHTML = '<div class="modal-box">' +
      '<h3>Assign ration plan</h3>' +
      '<p style="font-size:13px;color:var(--muted);margin-bottom:14px">' +
        'Current assignment will be closed today. New plan becomes active from the date selected.</p>' +
      '<div class="modal-fields">' +
        '<label>Ration plan</label><select id="arm-plan"><option value="">\u2014 select \u2014</option>' + opts + '</select>' +
        '<label>Effective from</label><input type="date" id="arm-from" value="' + todayISO() + '">' +
        '<label>Notes (optional)</label><input type="text" id="arm-notes" placeholder="Optional">' +
      '</div>' +
      '<div class="modal-btns">' +
        '<button class="btn" onclick="document.getElementById(\'af-ration-modal\').remove()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="afSaveRationAssign(' + groupId + ')">Assign</button>' +
      '</div>' +
      '<div id="arm-status" style="font-size:13px;margin-top:8px"></div>' +
      '</div>';
    document.body.appendChild(modal);
  } catch(err) { alert('Error: ' + err.message); }
}

async function afSaveRationAssign(groupId) {
  var st = document.getElementById('arm-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var planId = document.getElementById('arm-plan').value;
    var from   = document.getElementById('arm-from').value;
    var notes  = document.getElementById('arm-notes').value.trim();
    if (!planId) throw new Error('Select a ration plan.');
    if (!from)   throw new Error('Effective from date required.');

    // Close existing
    var existing = await sbGet('group_recipes',
      'group_id=eq.' + groupId + '&effective_to=is.null&select=id&limit=1');
    if (existing.length) {
      await sbPatch('group_recipes', existing[0].id, { effective_to: from });
    }
    var d = { group_id: groupId, ration_plan_id: parseInt(planId), effective_from: from };
    if (notes) d.notes = notes;
    await sbInsert('group_recipes', [d]);

    var modal = document.getElementById('af-ration-modal');
    if (modal) modal.remove();
    await renderAnFeedGroup(groupId);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}
