// an_intake.js v19
// Intake page
// Depends on: shared.js, an_helpers.js
// ============================================================

// ============================================================
// INTAKE PAGE
// ============================================================
async function loadIntakePage() {
  var el = document.getElementById('intake-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    renderIntakeTabs();
    await renderQuarantineTable();
    renderAbbrevKey('abbrev-intake', ['BCS','PKR']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderIntakeTabs() {
  var speciesOpts = anSelect(anSharedSpecies, 'id', function(s){return s.common_name;}, '-- select species --');
  var groupOpts   = anSelect(
    anSharedGroups.filter(function(g){return g.status==='active';}),
    'id', function(g){return g.name;}, '-- assign group (optional) --'
  );

  var single = '<div class="hf-grid">' +
    '<div class="hf-field"><label>Farm ID</label><input type="text" id="si-farmid" placeholder="Auto-generated" oninput="this.dataset.autoFilled=\'false\'"></div>' +
    '<div class="hf-field"><label>Species</label><select id="si-species" onchange="siAutoFarmId()">' + speciesOpts + '</select></div>' +
    '<div class="hf-field"><label>Breed</label><input type="text" id="si-breed" placeholder="e.g. Beetal"></div>' +
    '<div class="hf-field"><label>Sex</label><select id="si-sex"><option value="">Unknown</option><option value="male">Male</option><option value="female">Female</option></select></div>' +
    '<div class="hf-field"><label>Arrival date</label><input type="date" id="si-arrival" value="' + todayISO() + '"></div>' +
    '<div class="hf-field"><label>Entry weight (kg)</label><input type="number" id="si-entrywt" min="0" step="0.1" placeholder="kg"></div>' +
    '</div><div class="hf-grid">' +
    '<div class="hf-field"><label>Purchase cost (PKR)</label><input type="number" id="si-cost" min="0" step="1" placeholder="per head"></div>' +
    '<div class="hf-field"><label>Source / supplier</label><input type="text" id="si-source" placeholder="Market, farm name..."></div>' +
    '<div class="hf-field"><label>Purpose</label><select id="si-purpose">' +
      '<option value="meat">Meat</option><option value="breeder">Breeder</option>' +
      '<option value="layer">Layer</option><option value="dual_purpose">Dual-purpose</option>' +
      '<option value="farm_labor">Farm labor</option><option value="learning">Learning</option>' +
    '</select></div>' +
    '<div class="hf-field"><label>Quarantine on arrival?</label><select id="si-quar"><option value="true">Yes (default for market purchase)</option><option value="false">No</option></select></div>' +
    '<div class="hf-field"><label>Assign to group</label><select id="si-group">' + groupOpts + '</select></div>' +
    '</div><div class="hf-grid" style="grid-template-columns:1fr 1fr"><div class="hf-field"><label>Notes</label><input type="text" id="si-notes" placeholder="Optional"></div>' +
    '<div class="hf-field"><label>Quarantine observations</label><input type="text" id="si-observations" placeholder="Initial health observations (optional)"></div></div>' +
    '<div style="display:flex;gap:10px;margin-top:8px">' +
    '<button class="btn btn-primary" onclick="submitSingleAnimal()">Add animal</button>' +
    '<span id="si-status" style="font-size:13px;color:var(--muted);align-self:center"></span></div>';

  var batch = '<div class="hf-grid">' +
    '<div class="hf-field"><label>Species</label><select id="ba-species">' + speciesOpts + '</select></div>' +
    '<div class="hf-field"><label>Breed</label><input type="text" id="ba-breed" placeholder="e.g. Beetal"></div>' +
    '<div class="hf-field"><label>Count</label><input type="number" id="ba-count" min="1" step="1" placeholder="Number of animals" oninput="updateBatchCostCalc();updateBatchWeightHint()"></div>' +
    '<div class="hf-field"><label>Arrival date</label><input type="date" id="ba-arrival" value="' + todayISO() + '"></div>' +
    '<div class="hf-field"><label>Total batch cost (PKR)</label><input type="number" id="ba-totalcost" min="0" step="1" placeholder="Total" oninput="updateBatchCostCalc()"></div>' +
    '<div class="hf-field"><label>Per-head cost</label><div id="ba-perhead" style="font-size:13px;color:var(--muted);padding:6px 0">\u2014 auto-calculated</div></div>' +
    '</div><div class="hf-grid">' +
    '<div class="hf-field"><label>Entry weight (kg)</label>' +
    '<input type="text" id="ba-entrywt" placeholder="e.g. 14.2" oninput="updateBatchWeightHint()">' +
    '<div style="font-size:11px;color:var(--muted);margin-top:3px">One value for all animals, or comma-separated for individual weights: <em>14.2, 13.8, 15.1</em></div>' +
    '<div id="ba-wt-hint" style="font-size:11px;margin-top:2px"></div></div>' +
    '<div class="hf-field"><label>Source / supplier</label><input type="text" id="ba-source" placeholder="Market, farm name..."></div>' +
    '<div class="hf-field"><label>Purpose</label><select id="ba-purpose">' +
      '<option value="meat">Meat</option><option value="breeder">Breeder</option>' +
      '<option value="layer">Layer</option><option value="dual_purpose">Dual-purpose</option>' +
      '<option value="farm_labor">Farm labor</option><option value="learning">Learning</option>' +
    '</select></div>' +
    '<div class="hf-field"><label>Quarantine on arrival?</label><select id="ba-quar"><option value="true">Yes (default)</option><option value="false">No</option></select></div>' +
    '<div class="hf-field"><label>Assign to group</label><select id="ba-group">' + groupOpts + '</select></div>' +
    '<div class="hf-field"><label>Batch reference</label><input type="text" id="ba-ref" placeholder="e.g. Batch-2026-04"></div>' +
    '<div class="hf-field"><label>Quarantine observations</label><input type="text" id="ba-observations" placeholder="Initial health notes for whole batch"></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-top:8px">' +
    '<button class="btn btn-primary" onclick="submitBatchIntake()">Add batch</button>' +
    '<span id="ba-status" style="font-size:13px;color:var(--muted);align-self:center"></span></div>';

  var html =
    '<div class="section"><div class="section-hdr"><h2>Add animals</h2></div>' +
    '<div style="padding:0 22px 8px">' +
    '<div class="modal-tabs" style="margin-bottom:18px">' +
    '<button class="modal-tab' + (intakeTab==='single'?' active':'') + '" onclick="setIntakeTab(\'single\')">Single animal</button>' +
    '<button class="modal-tab' + (intakeTab==='batch'?' active':'') + '" onclick="setIntakeTab(\'batch\')">Batch intake</button>' +
    '</div>' +
    '<div id="intake-single-tab" style="display:' + (intakeTab==='single'?'block':'none') + '">' + single + '</div>' +
    '<div id="intake-batch-tab"  style="display:' + (intakeTab==='batch'?'block':'none') + '">' + batch + '</div>' +
    '</div></div>';

  document.getElementById('intake-content').innerHTML = html;
}

function setIntakeTab(tab) {
  intakeTab = tab;
  document.getElementById('intake-single-tab').style.display = tab === 'single' ? 'block' : 'none';
  document.getElementById('intake-batch-tab').style.display  = tab === 'batch'  ? 'block' : 'none';
  document.querySelectorAll('#intake-content .modal-tab').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('#intake-content .modal-tab')[tab === 'single' ? 0 : 1].classList.add('active');
}

function updateBatchCostCalc() {
  var count = parseInt(document.getElementById('ba-count') && document.getElementById('ba-count').value) || 0;
  var total = parseFloat(document.getElementById('ba-totalcost') && document.getElementById('ba-totalcost').value) || 0;
  var el = document.getElementById('ba-perhead');
  if (el) el.textContent = (count > 0 && total > 0) ? 'PKR ' + Math.round(total/count).toLocaleString() + ' per head' : '\u2014 auto-calculated';
}

function updateBatchWeightHint() {
  var hint  = document.getElementById('ba-wt-hint');
  if (!hint) return;
  var raw   = (document.getElementById('ba-entrywt').value || '').trim();
  var count = parseInt(document.getElementById('ba-count') && document.getElementById('ba-count').value) || 0;

  // Single value or empty — no hint needed
  if (!raw || !raw.includes(',')) { hint.textContent = ''; return; }

  var parts = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var allValid = parts.every(function(s) { return s !== '' && !isNaN(parseFloat(s)); });

  if (!allValid) {
    hint.style.color = 'var(--red)';
    hint.textContent = '\u26a0 Some values are not valid numbers';
    return;
  }

  if (count > 0 && parts.length === count) {
    hint.style.color = 'var(--green)';
    hint.textContent = parts.length + ' weights entered \u2013 one per animal \u2713';
  } else if (count > 0) {
    hint.style.color = '#C8A800';
    hint.textContent = parts.length + ' weights entered, ' + count + ' animals \u2013 counts must match before saving';
  } else {
    hint.style.color = 'var(--muted)';
    hint.textContent = parts.length + ' weights entered \u2013 set Count to validate';
  }
}

async function submitSingleAnimal() {
  var st = document.getElementById('si-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var farmId  = document.getElementById('si-farmid').value.trim();
    var species = document.getElementById('si-species').value;
    var arrival = document.getElementById('si-arrival').value;
    if (!species) throw new Error('Species required.');
    if (!arrival) throw new Error('Arrival date required.');
    // Auto-generate if still blank
    if (!farmId) {
      farmId = nextFarmIdForPrefix(speciesPrefix(species));
    }
    var quar = document.getElementById('si-quar').value === 'true';
    var d = {
      farm_id: farmId,
      species_id: parseInt(species),
      date_of_arrival: arrival,
      status: quar ? 'quarantine' : 'active',
      purpose: document.getElementById('si-purpose').value,
      is_breeding: false,
      born_on_farm: false
    };
    var breed = document.getElementById('si-breed').value.trim(); if (breed) d.breed = breed;
    var sex   = document.getElementById('si-sex').value;          if (sex)   d.sex   = sex;
    var ew    = document.getElementById('si-entrywt').value;      if (ew)    d.entry_weight_kg = parseFloat(ew);
    var cost  = document.getElementById('si-cost').value;         if (cost)  d.purchase_cost_pkr = parseFloat(cost);
    var src   = document.getElementById('si-source').value.trim(); if (src)  d.source = src;
    var notes = document.getElementById('si-notes').value.trim(); if (notes) d.notes = notes;
    var created = await sbInsert('animals', [d]);
    var animalId = created[0].id;

    // Quarantine record
    if (quar) {
      var obs = document.getElementById('si-observations') && document.getElementById('si-observations').value.trim();
      var qRec = { animal_id: animalId, arrival_date: arrival };
      if (obs) qRec.observations = obs;
      await sbInsert('quarantine_records', [qRec]);
    }

    // Group assignment
    var groupId = document.getElementById('si-group').value;
    if (groupId) {
      await sbInsert('group_members', [{ group_id: parseInt(groupId), animal_id: animalId, joined_date: arrival }]);
    }

    st.textContent = 'Saved — ' + farmId; st.style.color = 'var(--green)';
    document.getElementById('si-farmid').value = '';
    document.getElementById('si-entrywt').value = '';
    document.getElementById('si-cost').value = '';
    document.getElementById('si-notes').value = '';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await renderQuarantineTable();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

async function submitBatchIntake() {
  var st = document.getElementById('ba-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var species = document.getElementById('ba-species').value;
    var count   = parseInt(document.getElementById('ba-count').value);
    var arrival = document.getElementById('ba-arrival').value;
    if (!species)     throw new Error('Species required.');
    if (!count || count < 1) throw new Error('Count must be at least 1.');
    if (!arrival)     throw new Error('Arrival date required.');

    var totalCost  = parseFloat(document.getElementById('ba-totalcost').value) || null;
    var perHead    = totalCost && count ? Math.round(totalCost / count * 100) / 100 : null;
    var breed      = document.getElementById('ba-breed').value.trim() || null;
    var src        = document.getElementById('ba-source').value.trim() || null;
    var purpose    = document.getElementById('ba-purpose').value;
    var quar       = document.getElementById('ba-quar').value === 'true';
    var batchRef   = document.getElementById('ba-ref').value.trim() || null;
    var groupId    = document.getElementById('ba-group').value || null;

    // Parse and validate entry weights BEFORE any DB writes
    var entryWtRaw = (document.getElementById('ba-entrywt').value || '').trim();
    var entryWts   = null;
    var weightMode = 'none'; // 'none' | 'single' | 'vector'
    if (entryWtRaw) {
      if (entryWtRaw.includes(',')) {
        var wtParts = entryWtRaw.split(',').map(function(s) { return parseFloat(s.trim()); });
        if (wtParts.some(function(v) { return isNaN(v); })) {
          document.getElementById('ba-entrywt').style.borderColor = 'var(--red)';
          throw new Error('Some weight values are not valid numbers. Check for typos in the comma-separated list.');
        }
        if (wtParts.length !== count) {
          document.getElementById('ba-entrywt').style.borderColor = 'var(--red)';
          throw new Error('You entered ' + wtParts.length + ' weights but Count is ' + count + '. They must match exactly — one weight per animal.');
        }
        entryWts   = wtParts;
        weightMode = 'vector';
        document.getElementById('ba-entrywt').style.borderColor = '';
      } else {
        var singleWt = parseFloat(entryWtRaw);
        if (isNaN(singleWt)) {
          document.getElementById('ba-entrywt').style.borderColor = 'var(--red)';
          throw new Error('Entry weight is not a valid number.');
        }
        entryWts   = Array(count).fill(singleWt);
        weightMode = 'single';
        document.getElementById('ba-entrywt').style.borderColor = '';
      }
    }

    // Create intake_batches record
    var batchRec = {
      date: arrival,
      head_count: count,
      supplier: src
    };
    if (totalCost) batchRec.total_cost_pkr = totalCost;
    if (perHead)   batchRec.per_head_cost_pkr = perHead;
    if (groupId)   batchRec.group_id = parseInt(groupId);
    var batchRes = await sbInsert('intake_batches', [batchRec]);
    var batchId  = batchRes[0].id;

    // Auto-generate farm IDs
    var sn = getSpeciesName(parseInt(species));
    var prefix = 'A-';
    if (sn === 'Goat')    prefix = 'G-';
    else if (sn === 'Chicken') prefix = 'C-';
    else if (sn === 'Duck')    prefix = 'D-';
    else if (sn === 'Sheep')   prefix = 'S-';
    var existingNums = anSharedAnimals
      .filter(function(a) { return a.farm_id.startsWith(prefix); })
      .map(function(a) { return parseInt(a.farm_id.replace(prefix,'')); })
      .filter(function(n) { return !isNaN(n); });
    var next = existingNums.length ? Math.max.apply(null, existingNums) + 1 : 1;

    var inserts = [];
    for (var i = 0; i < count; i++) {
      var d = {
        farm_id: prefix + String(next + i).padStart(3,'0'),
        species_id: parseInt(species),
        date_of_arrival: arrival,
        status: quar ? 'quarantine' : 'active',
        purpose: purpose,
        is_breeding: false,
        born_on_farm: false,
        intake_batch_id: batchId
      };
      if (breed)              d.breed = breed;
      if (entryWts)           d.entry_weight_kg = entryWts[i];
      if (perHead)            d.purchase_cost_pkr = perHead;
      if (src)      d.source = src;
      if (batchRef) d.batch_ref = batchRef;
      inserts.push(d);
    }
    console.log('[intake] entryWtRaw:', JSON.stringify(entryWtRaw));
    console.log('[intake] entryWts:', JSON.stringify(entryWts));
    console.log('[intake] weightMode:', weightMode);
    console.log('[intake] first animal payload:', JSON.stringify(inserts[0]));
    var created = await sbInsert('animals', inserts);
    console.log('[intake] first created record back:', JSON.stringify(created[0]));

    // Quarantine records
    if (quar && created.length) {
      var batchObs = document.getElementById('ba-observations') && document.getElementById('ba-observations').value.trim();
      var qRecs = created.map(function(a) {
        var r = { animal_id: a.id, arrival_date: arrival };
        if (batchObs) r.observations = batchObs;
        return r;
      });
      await sbInsert('quarantine_records', qRecs);
    }

    // Group members
    if (groupId && created.length) {
      var memRecs = created.map(function(a) { return { group_id: parseInt(groupId), animal_id: a.id, joined_date: arrival }; });
      await sbInsert('group_members', memRecs);
    }

    var savedWt = created[0].entry_weight_kg;
    var wtNote = weightMode === 'vector' ? ' \u00b7 individual weights recorded'
               : weightMode === 'single' ? ' \u00b7 entry weight ' + entryWts[0] + '\u202fkg each'
               : ' \u00b7 no entry weights recorded';
    if (weightMode !== 'none' && (savedWt == null || savedWt === '')) {
      wtNote = ' \u00b7 \u26a0 weight sent but not returned by DB \u2014 check console';
    }
    st.textContent = 'Saved ' + count + ' animals (' + created[0].farm_id + '\u2013' + created[created.length-1].farm_id + ')' + wtNote + '.';
    st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await renderQuarantineTable();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

async function renderQuarantineTable() {
  var el = document.getElementById('quarantine-table');
  if (!el) return;
  try {
    var recs = await sbGet('quarantine_records',
      'clearance_date=is.null&select=id,animal_id,arrival_date,observations,' +
      'animals(farm_id,name,species_id,breed)&order=arrival_date.desc');
    if (!recs.length) {
      el.innerHTML = '<div class="empty">No animals currently in quarantine.</div>';
      return;
    }
    var today = new Date();
    var html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Farm ID</th><th>Species</th><th>Arrival</th><th>Days in quarantine</th>' +
      '<th>Observations</th><th></th>' +
      '</tr></thead><tbody>';
    recs.forEach(function(r) {
      var a     = r.animals || {};
      var days  = r.arrival_date ? Math.round((today - new Date(r.arrival_date + 'T00:00:00')) / 864e5) : '\u2014';
      html += '<tr>' +
        '<td style="font-weight:500">' + (a.farm_id || '\u2014') + '</td>' +
        '<td>' + getSpeciesName(a.species_id) + (a.breed ? ' \u00b7 ' + a.breed : '') + '</td>' +
        '<td class="mono">' + fmtDate(r.arrival_date) + '</td>' +
        '<td class="mono">' + days + '</td>' +
        '<td class="muted-cell">' + (r.observations || '\u2014') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="editQuarantineObs(' + r.id + ', this)">Add note</button> ' +
          '<button class="btn btn-sm btn-primary" onclick="clearQuarantine(' + r.id + ',' + r.animal_id + ')">Clear</button>' +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch(err) {
    el.innerHTML = '<div style="color:var(--red);padding:12px">Error loading quarantine: ' + err.message + '</div>';
  }
}

async function clearQuarantine(recId, animalId) {
  try {
    var today = todayISO();
    await sbPatch('quarantine_records', recId, { clearance_date: today });
    await sbPatch('animals', animalId, { status: 'active' });
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await renderQuarantineTable();
  } catch(err) {
    alert('Error clearing quarantine: ' + err.message);
  }
}

async function editQuarantineObs(recId, btn) {
  var obs = prompt('Enter observation note for this animal (will replace existing):');
  if (obs === null) return; // cancelled
  try {
    await sbPatch('quarantine_records', recId, { observations: obs.trim() || null });
    await renderQuarantineTable();
  } catch(err) {
    alert('Save failed: ' + err.message);
  }
}

