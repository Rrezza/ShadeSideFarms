// ============================================================
// fd_prices.js v17 — Price history page
// ============================================================

// ============================================================
// PRICE HISTORY
// ============================================================

async function loadPriceHistory() {
  var listEl = document.getElementById('ing-checkbox-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading" style="padding:14px 0">Loading…</div>';
  try {
    phIngsList = await sbGet('ingredients', 'active=eq.true&select=id,name,category&order=category,name');
    var ids = phIngsList.map(function(i) { return i.id; });
    if (!ids.length) {
      listEl.innerHTML = '<div style="padding:14px 0;font-size:13px;color:var(--faint)">No ingredients found.</div>';
      return;
    }
    var rows = await sbGet('ingredient_acquisitions',
      'ingredient_id=in.(' + ids.join(',') + ')&acquisition_type=eq.purchased&cost_per_kg=not.is.null' +
      '&select=ingredient_id,cost_per_kg,date&order=date.asc&limit=2000');
    phData = {};
    rows.forEach(function(r) {
      if (!phData[r.ingredient_id]) phData[r.ingredient_id] = [];
      phData[r.ingredient_id].push({ date: r.date, cost_per_kg: parseFloat(r.cost_per_kg) });
    });

    // Group by category, default select top-4 most-acquired
    var byCat = {};
    phIngsList.forEach(function(i) {
      var cat = i.category || 'other';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(i);
    });
    var counts = {};
    phIngsList.forEach(function(i) { counts[i.id] = (phData[i.id] || []).length; });
    if (!Object.keys(phSelected).length) {
      var topIds = phIngsList
        .filter(function(i) { return counts[i.id] > 0; })
        .sort(function(a, b) { return counts[b.id] - counts[a.id]; })
        .slice(0, 4).map(function(i) { return i.id; });
      topIds.forEach(function(id) { phSelected[id] = true; });
    }

    var colorIdx = 0;
    var colorMap = {};
    phIngsList.forEach(function(i) { colorMap[i.id] = CHART_COLORS[colorIdx % CHART_COLORS.length]; colorIdx++; });

    var html = '';
    Object.keys(byCat).sort().forEach(function(cat) {
      html += '<div class="ph-group">' + cat + '</div>';
      byCat[cat].forEach(function(i) {
        var has = (phData[i.id] || []).length;
        html += '<label><input type="checkbox" data-ing="' + i.id + '"' +
                (phSelected[i.id] ? ' checked' : '') +
                ' onchange="window.__phToggle(' + i.id + ', this.checked)">' +
                '<span class="color-dot" style="background:' + colorMap[i.id] + '"></span>' +
                '<span>' + i.name + '</span>' +
                (!has ? '<span class="no-data-label">no prices</span>' : '') +
                '</label>';
      });
    });
    listEl.innerHTML = html;
    loadPriceHistory._colors = colorMap;
    renderPriceChart();
    renderAbbrevKey('abbrev-prices', ['PKR']);
  } catch (err) {
    listEl.innerHTML = '<div style="padding:14px 0;font-size:13px;color:var(--red)">Error: ' + err.message + '</div>';
  }
}

window.__phToggle = function(ingId, checked) {
  phSelected[ingId] = !!checked;
  renderPriceChart();
};

function onPhAvgDaysChange() {
  var sel = document.getElementById('ph-avg-days');
  if (sel) phAvgDays = parseInt(sel.value) || 90;
  renderPriceChart();
}

function renderPriceChart() {
  var canvas = document.getElementById('price-chart');
  if (!canvas) return;
  var fromVal = (document.getElementById('ph-from') || {}).value;
  var toVal   = (document.getElementById('ph-to')   || {}).value;
  var colors  = loadPriceHistory._colors || {};

  // Calculate rolling avg cutoff based on selected period
  var avgCutoff = new Date();
  avgCutoff.setDate(avgCutoff.getDate() - phAvgDays);
  var avgCutoffStr = avgCutoff.toISOString().slice(0, 10);

  var datasets = [];
  var statsHtml = '';

  Object.keys(phSelected).forEach(function(id) {
    if (!phSelected[id]) return;
    var ing = phIngsList.find(function(x) { return String(x.id) === String(id); });
    if (!ing) return;
    var allPts = (phData[id] || []);
    var pts = allPts.filter(function(p) {
      if (fromVal && p.date < fromVal) return false;
      if (toVal   && p.date > toVal)   return false;
      return true;
    }).map(function(p) { return { x: new Date(p.date + 'T00:00:00').getTime(), y: p.cost_per_kg }; });

    if (!pts.length) return;
    datasets.push({
      label: ing.name,
      data: pts,
      borderColor: colors[id] || '#27623A',
      backgroundColor: colors[id] || '#27623A',
      tension: 0.2,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
      spanGaps: true
    });

    var ys = pts.map(function(p) { return p.y; });
    var minVal = Math.min.apply(null, ys);
    var maxVal = Math.max.apply(null, ys);
    var latest = pts[pts.length - 1];

    // Rolling avg over phAvgDays from today (independent of chart date filter)
    var avgPts = allPts.filter(function(p) { return p.date >= avgCutoffStr; });
    var avgVal = avgPts.length
      ? avgPts.reduce(function(s, p) { return s + p.cost_per_kg; }, 0) / avgPts.length
      : null;

    var calcQty = parseFloat((document.getElementById('ph-calc-qty') || {}).value);
    var costRow = (!isNaN(calcQty) && calcQty > 0 && latest)
      ? '<tr><td class="s-label">Cost · ' + Math.round(calcQty) + ' kg</td>' +
        '<td class="s-val" style="font-weight:600;color:var(--text)">' +
        pkr(Math.round(calcQty * latest.y)) + '</td></tr>'
      : '';

    statsHtml +=
      '<table class="stats-table" style="min-width:200px">' +
      '<thead><tr><th colspan="2" style="font-size:11px;color:' + (colors[id] || '#27623A') +
      ';text-transform:uppercase;letter-spacing:0.06em;padding-bottom:4px">' + ing.name + '</th></tr></thead>' +
      '<tbody>' +
      '<tr><td class="s-label">Latest</td><td class="s-val">' + pkr(latest.y) + ' (' + fmtDate(latest.x) + ')</td></tr>' +
      '<tr><td class="s-label">' + phAvgDays + '-day avg</td><td class="s-val">' + (avgVal != null ? pkr(avgVal) : '—') + '</td></tr>' +
      '<tr><td class="s-label">Min · Max</td><td class="s-val">' + pkr(minVal) + ' · ' + pkr(maxVal) + '</td></tr>' +
      '<tr><td class="s-label">Records (shown)</td><td class="s-val">' + pts.length + '</td></tr>' +
      costRow +
      '</tbody></table>';
  });

  var statsEl = document.getElementById('ph-stats-tables');
  if (statsEl) {
    var anySelected = Object.keys(phSelected).some(function(id) { return phSelected[id]; });
    if (!statsHtml) {
      statsEl.innerHTML = '<div style="font-size:13px;color:var(--faint)">' +
        (anySelected ? 'No price data for selected ingredients in this date range.' : 'No ingredients selected.') +
        '</div>';
    } else {
      statsEl.innerHTML = statsHtml;
    }
  }

  // Always check Chart.js registry directly — handles cases where priceChart variable
  // is stale or null due to rapid navigation or chart errors
  var existingChart = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(canvas) : null;
  if (existingChart) { existingChart.destroy(); }
  if (priceChart && priceChart !== existingChart) { try { priceChart.destroy(); } catch(e) {} }
  priceChart = null;

  if (!datasets.length) {
    var ctx0 = canvas.getContext('2d');
    ctx0.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  try {
    priceChart = new Chart(canvas, {
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
                var d = new Date(items[0].parsed.x);
                return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
              },
              label: function(ctx) { return ctx.dataset.label + ': ' + pkr(ctx.parsed.y) + ' / kg'; }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              font: { size: 10 }, color: '#6B6B65',
              maxTicksLimit: 10,
              callback: function(v) {
                var d = new Date(v);
                return d.toLocaleDateString('en-PK', { month: 'short', year: '2-digit' });
              }
            },
            grid: { color: '#E8E4DA' }
          },
          y: {
            ticks: {
              font: { size: 10 }, color: '#6B6B65',
              callback: function(v) { return 'PKR ' + Math.round(v); }
            },
            grid: { color: '#E8E4DA' }
          }
        }
      }
    });
  } catch (e) {
    console.error('Chart render error:', e);
    var errEl = document.getElementById('ph-chart-error');
    if (errEl) errEl.textContent = 'Chart error: ' + e.message;
  }
}

function clearDateRange() {
  var f = document.getElementById('ph-from');
  var t = document.getElementById('ph-to');
  if (f) f.value = '';
  if (t) t.value = '';
  renderPriceChart();
}

