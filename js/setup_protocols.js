// ============================================================
// setup_protocols.js — Health protocols (Setup › Health Protocols)
// A protocol is a named, reusable list of steps, e.g. "Goat arrival":
//   day 0 deworm, day 7 PPR vaccine, day 21 ET booster (repeat every 180 d).
// Applying a protocol to a group (Groups page → Apply protocol) creates one
// scheduled_health_events row per step, due on arrival date + offset_days.
// Depends on: shared.js, health_meds.js (medicine list, medEsc)
// ============================================================

var protoList      = [];          // health_protocols
var protoSteps     = [];          // health_protocol_steps (all protocols)
var protoExpanded  = new Set();   // protocol ids with their steps shown
var protoApplyGroupId = null;     // group the Apply modal is open for

var PROTO_EVENT_TYPES = ['vaccination', 'deworming', 'treatment', 'observation'];

async function protoLoadData() {
  await loadModule('health_meds');
  var r = await Promise.all([
    sbGet('health_protocols', 'select=*&order=name'),
    sbGet('health_protocol_steps', 'select=*&order=offset_days,id'),
    medLoadData()
  ]);
  protoList = r[0];
  protoSteps = r[1];
}

function protoStepsFor(protocolId) {
  return protoSteps.filter(function(s) { return s.protocol_id === protocolId; });
}

// What a step administers: cabinet medicine name, else free-text product
function protoStepProduct(step) {
  var m = step.medicine_id ? medById(step.medicine_id) : null;
  return m ? m.name : (step.product || '');
}

// ============================================================
// SETUP PAGE
// ============================================================
async function loadProtocolsPage() {
  var el = document.getElementById('protocols-content');
  el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    await protoLoadData();
    renderProtocolsPage();
  } catch(err) {
    el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderProtocolsPage() {
  var html = '<div class="section">' +
    '<div class="section-hdr"><h2>Health protocols</h2>' +
    '<span class="section-meta">Reusable schedule sets — apply one to a group from the Groups page</span></div>';
  if (!protoList.length) {
    html += '<div class="empty">No protocols yet. Add one below, e.g. "Goat arrival".</div>';
  } else {
    html += '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th></th><th>Protocol</th><th class="right">Steps</th><th>Notes</th><th>Actions</th>' +
      '</tr></thead><tbody>';
    protoList.slice().sort(function(a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).forEach(function(p) {
      var open = protoExpanded.has(p.id);
      var steps = protoStepsFor(p.id);
      html += '<tr class="grp-row' + (open ? ' grp-row-open' : '') + '"' + (!p.active ? ' style="opacity:0.5"' : '') + '>' +
        '<td style="cursor:pointer;color:var(--muted);width:14px" onclick="toggleProtocol(' + p.id + ')">' + (open ? '▾' : '▸') + '</td>' +
        '<td><input type="text" value="' + medEsc(p.name) + '" style="font-weight:500;min-width:180px" ' +
          'onchange="patchProtocol(' + p.id + ', \'name\', this.value.trim())"></td>' +
        '<td class="mono right" style="cursor:pointer" onclick="toggleProtocol(' + p.id + ')">' + steps.length + '</td>' +
        '<td><input type="text" value="' + medEsc(p.notes || '') + '" placeholder="Optional" style="min-width:200px" ' +
          'onchange="patchProtocol(' + p.id + ', \'notes\', this.value.trim() || null)"></td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="toggleProtocol(' + p.id + ')">' + (open ? 'Hide steps' : 'Steps') + '</button> ' +
          '<button class="btn btn-sm" onclick="patchProtocol(' + p.id + ', \'active\', ' + !p.active + ')">' + (p.active ? 'Retire' : 'Reactivate') + '</button> ' +
          '<button class="btn btn-sm btn-danger" onclick="deleteProtocol(' + p.id + ')">Delete</button>' +
        '</td></tr>';
      if (open) html += '<tr class="grp-expand-row"><td colspan="5" style="padding:0">' + renderProtocolSteps(p) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  // Add-protocol row
  html += '<div style="padding:12px 22px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<input type="text" id="proto-new-name" placeholder="New protocol name, e.g. Goat arrival" style="min-width:260px">' +
    '<button class="btn btn-sm btn-primary" onclick="addProtocol()">Add protocol</button>' +
    '<span id="proto-status" style="font-size:13px;color:var(--muted)"></span></div>';
  html += '</div>';
  document.getElementById('protocols-content').innerHTML = html;
}

// <select> of event types / medicines, used by step rows and the add-step row
function protoTypeSelect(attrs, cur) {
  return '<select ' + attrs + '>' + PROTO_EVENT_TYPES.map(function(t) {
    return '<option value="' + t + '"' + (cur === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('') + '</select>';
}
function protoMedSelect(attrs, cur) {
  return '<select ' + attrs + '><option value="">— not in cabinet —</option>' +
    medList.filter(function(m) { return m.active || m.id === cur; }).map(function(m) {
      return '<option value="' + m.id + '"' + (cur === m.id ? ' selected' : '') + '>' + medEsc(m.name) + '</option>';
    }).join('') + '</select>';
}

// Steps table: every field edits in place (saved on change), plus an add row
function renderProtocolSteps(p) {
  var steps = protoStepsFor(p.id);
  var html = '<div style="padding:12px 22px;background:var(--bg)"><table><thead><tr>' +
    '<th class="right">Day</th><th>Type</th><th>Description</th><th>Medicine</th><th>Product (if not in cabinet)</th>' +
    '<th class="right">Repeat every (days)</th><th></th></tr></thead><tbody>';
  steps.forEach(function(s) {
    var on = function(field, expr) { return 'onchange="patchProtocolStep(' + s.id + ', \'' + field + '\', ' + expr + ')"'; };
    html += '<tr>' +
      '<td class="right"><input type="number" min="0" step="1" style="width:64px;text-align:right" value="' + s.offset_days + '" ' +
        on('offset_days', 'parseInt(this.value) || 0') + '></td>' +
      '<td>' + protoTypeSelect(on('event_type', 'this.value'), s.event_type) + '</td>' +
      '<td><input type="text" style="min-width:170px" value="' + medEsc(s.description) + '" ' + on('description', 'this.value.trim()') + '></td>' +
      '<td>' + protoMedSelect(on('medicine_id', 'parseInt(this.value) || null'), s.medicine_id) + '</td>' +
      '<td><input type="text" style="min-width:120px" value="' + medEsc(s.product || '') + '" placeholder="Optional" ' + on('product', 'this.value.trim() || null') + '></td>' +
      '<td class="right"><input type="number" min="1" step="1" style="width:70px;text-align:right" value="' + (s.interval_days || '') + '" placeholder="once" ' +
        on('interval_days', 'parseInt(this.value) || null') + '></td>' +
      '<td><button class="btn btn-sm btn-danger" onclick="deleteProtocolStep(' + s.id + ')">Delete</button></td>' +
      '</tr>';
  });
  // Add-step row
  html += '<tr style="background:var(--surface)">' +
    '<td class="right"><input type="number" id="ps-new-day-' + p.id + '" min="0" step="1" style="width:64px;text-align:right" placeholder="0"></td>' +
    '<td>' + protoTypeSelect('id="ps-new-type-' + p.id + '"', 'deworming') + '</td>' +
    '<td><input type="text" id="ps-new-desc-' + p.id + '" style="min-width:170px" placeholder="e.g. Arrival deworming"></td>' +
    '<td>' + protoMedSelect('id="ps-new-med-' + p.id + '"', null) + '</td>' +
    '<td><input type="text" id="ps-new-product-' + p.id + '" style="min-width:120px" placeholder="Optional"></td>' +
    '<td class="right"><input type="number" id="ps-new-interval-' + p.id + '" min="1" step="1" style="width:70px;text-align:right" placeholder="once"></td>' +
    '<td><button class="btn btn-sm btn-primary" onclick="addProtocolStep(' + p.id + ')">Add step</button></td>' +
    '</tr></tbody></table>' +
    '<div style="font-size:12px;color:var(--muted);margin-top:8px">Day = days after the arrival date chosen when applying. ' +
    'Leave "Repeat every" blank for a one-off step; one-off schedules close themselves once logged.</div></div>';
  return html;
}

function toggleProtocol(id) {
  if (protoExpanded.has(id)) protoExpanded.delete(id); else protoExpanded.add(id);
  renderProtocolsPage();
}

async function protoRefresh() {
  await protoLoadData();
  renderProtocolsPage();
}

async function addProtocol() {
  var st = document.getElementById('proto-status');
  var name = document.getElementById('proto-new-name').value.trim();
  if (!name) { st.textContent = 'Enter a name.'; st.style.color = 'var(--red)'; return; }
  try {
    var rows = await sbInsert('health_protocols', [{ name: name }]);
    if (rows && rows.length) protoExpanded.add(rows[0].id);  // open it so steps can be added straight away
    await protoRefresh();
  } catch(err) { st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)'; }
}

async function patchProtocol(id, field, value) {
  if (field === 'name' && !value) { alert('A protocol needs a name.'); renderProtocolsPage(); return; }
  try {
    var d = {}; d[field] = value;
    await sbPatch('health_protocols', id, d);
    await protoRefresh();
  } catch(err) { alert('Save failed: ' + err.message); }
}

async function deleteProtocol(id) {
  var p = protoList.find(function(x) { return x.id === id; });
  if (!confirm('Delete protocol "' + (p ? p.name : '') + '" and its steps? Schedules already created from it are kept. This cannot be undone.')) return;
  try {
    await sbDelete('health_protocols', id);   // steps cascade
    protoExpanded.delete(id);
    await protoRefresh();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

async function addProtocolStep(protocolId) {
  var g = function(k) { return document.getElementById('ps-new-' + k + '-' + protocolId); };
  var desc = g('desc').value.trim();
  if (!desc) { alert('Give the step a description, e.g. "Arrival deworming".'); return; }
  try {
    await sbInsert('health_protocol_steps', [{
      protocol_id:   protocolId,
      offset_days:   parseInt(g('day').value) || 0,
      event_type:    g('type').value,
      description:   desc,
      medicine_id:   parseInt(g('med').value) || null,
      product:       g('product').value.trim() || null,
      interval_days: parseInt(g('interval').value) || null
    }]);
    await protoRefresh();
  } catch(err) { alert('Save failed: ' + err.message); }
}

async function patchProtocolStep(id, field, value) {
  if (field === 'description' && !value) { alert('A step needs a description.'); renderProtocolsPage(); return; }
  try {
    var d = {}; d[field] = value;
    await sbPatch('health_protocol_steps', id, d);
    await protoRefresh();
  } catch(err) { alert('Save failed: ' + err.message); }
}

async function deleteProtocolStep(id) {
  if (!confirm('Delete this step?')) return;
  try {
    await sbDelete('health_protocol_steps', id);
    await protoRefresh();
  } catch(err) { alert('Delete failed: ' + err.message); }
}

// ============================================================
// APPLY A PROTOCOL TO A GROUP (modal opened from the Groups page)
// ============================================================
async function openApplyProtocol(groupId) {
  protoApplyGroupId = groupId;
  document.getElementById('pa-group').textContent = getGroupName(groupId);
  document.getElementById('pa-status').textContent = '';
  document.getElementById('pa-preview').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('pa-modal').style.display = 'flex';
  try {
    await protoLoadData();
    var active = protoList.filter(function(p) { return p.active && protoStepsFor(p.id).length; });
    document.getElementById('pa-protocol').innerHTML = active.length
      ? active.map(function(p) { return '<option value="' + p.id + '">' + medEsc(p.name) + '</option>'; }).join('')
      : '<option value="">No protocols with steps yet</option>';
    // Default arrival date: when the group's current members joined (earliest), else today
    var joins = anSharedMembers.filter(function(m) { return m.group_id === groupId; })
      .map(function(m) { return m.joined_date; }).sort();
    document.getElementById('pa-date').value = joins.length ? joins[0] : todayISO();
    renderApplyPreview();
  } catch(err) {
    document.getElementById('pa-preview').innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

function closeApplyProtocol() {
  document.getElementById('pa-modal').style.display = 'none';
  protoApplyGroupId = null;
}

// Arrival date + offset as YYYY-MM-DD (local dates, no timezone drift)
function protoDueDate(arrivalISO, offsetDays) {
  var d = new Date(arrivalISO + 'T00:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Shows exactly which schedules will be created, so nothing is a surprise
function renderApplyPreview() {
  var el = document.getElementById('pa-preview');
  var pid = parseInt(document.getElementById('pa-protocol').value);
  var arrival = document.getElementById('pa-date').value;
  if (!pid) { el.innerHTML = '<div class="empty">Create a protocol with steps under Setup › Health Protocols first.</div>'; return; }
  if (!arrival) { el.innerHTML = ''; return; }
  var steps = protoStepsFor(pid);
  var html = '<table><thead><tr><th>Due</th><th>Step</th><th>Medicine</th><th class="right">Repeats</th></tr></thead><tbody>';
  steps.forEach(function(s) {
    html += '<tr><td class="mono">' + fmtDate(protoDueDate(arrival, s.offset_days)) + '</td>' +
      '<td>' + medEsc(s.description) + ' <span style="color:var(--muted);font-size:11px">' + s.event_type + '</span></td>' +
      '<td class="muted-cell">' + (protoStepProduct(s) ? medEsc(protoStepProduct(s)) : '—') + '</td>' +
      '<td class="mono right">' + (s.interval_days ? 'every ' + s.interval_days + ' d' : 'once') + '</td></tr>';
  });
  el.innerHTML = html + '</tbody></table>';
}

async function submitApplyProtocol() {
  var st = document.getElementById('pa-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var pid = parseInt(document.getElementById('pa-protocol').value);
    var arrival = document.getElementById('pa-date').value;
    if (!pid) throw new Error('Pick a protocol.');
    if (!arrival) throw new Error('Pick the arrival date.');
    var proto = protoList.find(function(p) { return p.id === pid; });
    var rows = protoStepsFor(pid).map(function(s) {
      return {
        group_id:      protoApplyGroupId,
        event_type:    s.event_type,
        description:   s.description,
        medicine_id:   s.medicine_id,
        product:       s.product,
        interval_days: s.interval_days,
        next_due_date: protoDueDate(arrival, s.offset_days),
        active:        true,
        notes:         'From protocol: ' + proto.name
      };
    });
    await sbInsert('scheduled_health_events', rows);
    st.textContent = rows.length + ' schedule' + (rows.length !== 1 ? 's' : '') + ' created.';
    st.style.color = 'var(--green)';
    setTimeout(closeApplyProtocol, 900);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}
