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

function renderPriceChart() {
  var canvas = document.getElementById('price-chart');
  if (!canvas) return;
  var colors = loadPriceHistory._colors || {};

  // Period filter
  var periodEl  = document.getElementById('ph-period');
  var periodDays = periodEl && periodEl.value ? parseInt(periodEl.value) : null;
  var cutoffISO  = null;
  if (periodDays) {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);
    cutoffISO = cutoff.toISOString().slice(0, 10);
  }

  var datasets  = [];
  var statsHtml = '';
  var allLabels = [];

  // Build per-ingredient series (phData is date-asc from fetch)
  var seriesMap = {};
  Object.keys(phSelected).forEach(function(id) {
    if (!phSelected[id]) return;
    var ing = phIngsList.find(function(x) { return String(x.id) === String(id); });
    if (!ing) return;
    var pts = (phData[id] || []).filter(function(p) { return !cutoffISO || p.date >= cutoffISO; });
    if (!pts.length) return;
    seriesMap[id] = {
      name:   ing.name,
      labels: pts.map(function(p) { return fmtDate(p.date); }),
      values: pts.map(function(p) { return p.cost_per_kg; }),
      color:  colors[id] || CHART_COLORS[0]
    };
    seriesMap[id].labels.forEach(function(l) { if (allLabels.indexOf(l) === -1) allLabels.push(l); });
  });

  // Datasets aligned to shared category x-axis
  Object.keys(seriesMap).forEach(function(id) {
    var s = seriesMap[id];
    var aligned = allLabels.map(function(lbl) {
      var pos = s.labels.indexOf(lbl);
      return pos !== -1 ? s.values[pos] : null;
    });
    datasets.push({
      label: s.name + ' (PKR / kg)',
      data: aligned,
      borderColor: s.color, backgroundColor: s.color,
      spanGaps: true, tension: 0.2, pointRadius: 4, borderWidth: 2
    });

    // Stats block for this ingredient
    var vals   = s.values; // oldest-first (date-asc)
    var sorted = vals.slice().sort(function(a, b) { return a - b; });
    var n      = sorted.length;
    var latest = vals[n - 1];
    var mean   = sorted.reduce(function(a, v) { return a + v; }, 0) / n;
    var med    = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];

    function statRow(lbl, val) {
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">' +
        '<span style="color:var(--muted)">' + lbl + '</span>' +
        '<span style="font-weight:500">' + pkr(Math.round(val)) + ' / kg</span></div>';
    }
    statsHtml +=
      '<div style="min-width:180px;flex:1;max-width:260px;background:var(--bg);' +
      'border:1px solid var(--border);border-radius:8px;padding:14px 16px;font-size:13px">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border)">' + s.name + '</div>' +
      statRow('Latest', latest) +
      statRow('Mean',   mean)   +
      statRow('Median', med)    +
      statRow('Min',    sorted[0])    +
      statRow('Max',    sorted[n - 1]) +
      '<div style="display:flex;justify-content:space-between;padding:5px 0">' +
        '<span style="color:var(--muted)">n (period)</span>' +
        '<span style="font-weight:500">' + n + '</span></div>' +
      '</div>';
  });

  // Stats panels
  var statsEl = document.getElementById('ph-stats-tables');
  if (statsEl) {
    var anySelected = Object.keys(phSelected).some(function(id) { return phSelected[id]; });
    statsEl.innerHTML = statsHtml ||
      '<div style="font-size:13px;color:var(--faint)">' +
      (anySelected ? 'No price data for selected ingredients in this period.' : 'No ingredients selected.') +
      '</div>';
  }

  // Destroy existing chart
  var existingChart = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(canvas) : null;
  if (existingChart) existingChart.destroy();
  if (priceChart && priceChart !== existingChart) { try { priceChart.destroy(); } catch(e) {} }
  priceChart = null;

  // No-data overlay
  var noDataEl = document.getElementById('ph-no-data');
  if (noDataEl) {
    noDataEl.style.display = datasets.length ? 'none' : 'flex';
    noDataEl.textContent = 'No price data for selected ingredients in this period.';
  }

  if (!datasets.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  try {
    priceChart = new Chart(canvas, {
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
          y: { ticks: { font: { size: 10 }, callback: function(v) { return 'PKR ' + Math.round(v); } }, grid: { color: '#E8E4DA' } }
        }
      }
    });
  } catch(e) {
    console.error('Chart render error:', e);
    var errEl = document.getElementById('ph-chart-error');
    if (errEl) errEl.textContent = 'Chart error: ' + e.message;
  }
}

