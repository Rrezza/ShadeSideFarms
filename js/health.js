// ============================================================
// health.js v17
// Pages: Health, Breeding, Cost & Sales
// Depends on: shared.js
// ============================================================

// ---- Module state ----
var healthScheds     = [];
var healthEvts       = [];
var breedingData     = [];
var birthData        = [];
var birthStep        = 1;
var pendingBirthEvt  = null;
var csGroupId        = null;   // selected group on Cost & Sales page

// ============================================================
// HEALTH PAGE
// ============================================================
async function loadHealthPage() {
  var dueEl = document.getElementById('health-due-panel');
  var logEl = document.getElementById('health-log-table');
  if (dueEl) dueEl.innerHTML = '<div class="loading">Loading...</div>';
  if (logEl) logEl.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var due14 = new Date(); due14.setDate(due14.getDate() + 14);
    var due14s = due14.toISOString().slice(0, 10);
    var r = await Promise.all([
      sbGet('scheduled_health_events',
        'active=eq.true&next_due_date=lte.' + due14s + '&select=*&order=next_due_date'),
      sbGet('animal_health_events',
        'select=*,animals(farm_id,name),workers(name)&order=date.desc&limit=300')
    ]);
    healthScheds = r[0]; healthEvts = r[1];
    populateHealthForm();
    renderHealthDue();
    renderHealthLog();
    document.getElementById('health-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    renderAbbrevKey('abbrev-health', ['BCS', 'PKR']);
  } catch(err) {
    if (dueEl) dueEl.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function populateHealthForm() {
  document.getElementById('hf-date').value = todayISO();

  // Populate animal selector (active only)
  var activeAnimals = anSharedAnimals.filter(function(a) { return a.status === 'active'; });
  document.getElementById('hf-animal').innerHTML =
    '<option value="">Select animal</option>' +
    activeAnimals.map(function(a) {
      return '<option value="' + a.id + '">' + a.farm_id + (a.name ? ' (' + a.name + ')' : '') + '</option>';
    }).join('');

  // Populate group selector
  document.getElementById('hf-group').innerHTML =
    '<option value="">Select group</option>' +
    anSharedGroups.filter(function(g){return g.status==='active';}).map(function(g) {
      return '<option value="' + g.id + '">' + g.name + '</option>';
    }).join('');

  // Scheduled protocols selector
  document.getElementById('hf-sched').innerHTML =
    '<option value="">None</option>' +
    healthScheds.map(function(s) {
      return '<option value="' + s.id + '">' + s.description + ' (due ' + fmtDate(s.next_due_date) + ')</option>';
    }).join('');
}

function toggleHealthForm() {
  document.getElementById('health-log-form').classList.toggle('open');
}

function onHfTargetChange() {
  var t = document.getElementById('hf-target-type').value;
  document.getElementById('hf-animal-wrap').style.display = t === 'animal' ? 'flex' : 'none';
  document.getElementById('hf-group-wrap').style.display  = t === 'group'  ? 'flex' : 'none';
  var mortFields = document.getElementById('hf-mortality-fields');
  if (mortFields) mortFields.style.display = 'none';
}

function onHfEventTypeChange() {
  var et = document.getElementById('hf-event-type').value;
  var mortFields = document.getElementById('hf-mortality-fields');
  if (mortFields) mortFields.style.display = (et === 'mortality') ? 'grid' : 'none';
}

function renderHealthDue() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  document.getElementById('health-due-meta').textContent =
    healthScheds.length + ' event' + (healthScheds.length !== 1 ? 's' : '') + ' due within 14 days';
  if (!healthScheds.length) {
    document.getElementById('health-due-panel').innerHTML =
      '<div class="empty">No health events due in the next 14 days.</div>';
    return;
  }
  var html = '<div class="due-grid">';
  healthScheds.forEach(function(s) {
    var due  = new Date(s.next_due_date + 'T00:00:00');
    var diff = Math.round((due - today) / 864e5);
    var cls  = diff < 0 ? 'overdue' : (diff <= 7 ? 'soon' : 'upcoming');
    var daysLabel = diff < 0
      ? Math.abs(diff) + ' day' + (Math.abs(diff) !== 1 ? 's' : '') + ' overdue'
      : (diff === 0 ? 'Due today' : diff + ' day' + (diff !== 1 ? 's' : '') + ' away');
    var target = s.animal_id ? getAnimalDisplayName(s.animal_id)
               : (s.group_id ? getGroupName(s.group_id)
               : (s.location_id ? getPenName(s.location_id) : '\u2014'));
    var targetLabel = s.animal_id ? 'Animal' : (s.group_id ? 'Group' : 'Pen');
    html += '<div class="due-card ' + cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">' + s.description + '</span>' +
      '<span class="due-card-days ' + cls + '">' + daysLabel + '</span></div>' +
      '<div class="due-card-meta">' + (s.event_type || '') + ' &middot; ' + targetLabel + ': ' + target +
      (s.product ? ' &middot; ' + s.product : '') + '</div>';
    if (s.dose) html += '<div class="due-card-meta">Dose: ' + s.dose + '</div>';
    html += '<div style="margin-top:8px"><button class="btn btn-sm" onclick="preFillHealthForm(' + s.id + ')">Log this event</button></div>';
    html += '</div>';
  });
  html += '</div>';
  document.getElementById('health-due-panel').innerHTML = html;
}

function preFillHealthForm(schedId) {
  var sched = healthScheds.find(function(s) { return s.id === schedId; });
  if (!sched) return;
  document.getElementById('hf-event-type').value = sched.event_type || 'vaccination';
  document.getElementById('hf-sched').value = schedId;
  if (sched.product) document.getElementById('hf-product').value = sched.product;
  if (sched.dose)    document.getElementById('hf-dose').value    = sched.dose;
  if (sched.animal_id) {
    document.getElementById('hf-target-type').value = 'animal';
    document.getElementById('hf-animal').value = sched.animal_id;
    onHfTargetChange();
  } else if (sched.group_id) {
    document.getElementById('hf-target-type').value = 'group';
    document.getElementById('hf-group').value = sched.group_id;
    onHfTargetChange();
  }
  document.getElementById('health-log-form').classList.add('open');
  document.getElementById('health-log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHealthLog() {
  var logType   = document.getElementById('health-log-type-filter') ? document.getElementById('health-log-type-filter').value : '';
  var logGroup  = document.getElementById('health-log-group-filter') ? document.getElementById('health-log-group-filter').value : '';

  var evts = healthEvts.slice();
  if (logType)  evts = evts.filter(function(e) { return e.event_type === logType; });
  if (logGroup) {
    var gAnimalIds = getGroupAnimalIds(parseInt(logGroup));
    evts = evts.filter(function(e) {
      return (e.group_id && String(e.group_id) === logGroup) ||
             (e.animal_id && gAnimalIds.indexOf(e.animal_id) >= 0);
    });
  }

  document.getElementById('health-log-meta').textContent =
    evts.length + ' record' + (evts.length !== 1 ? 's' : '');
  if (!evts.length) {
    document.getElementById('health-log-table').innerHTML = '<div class="empty">No health events match the current filter.</div>';
    return;
  }
  var EVTYPE = {
    vaccination: 'badge-blue', deworming: 'badge-teal', treatment: 'badge-amber',
    observation: 'badge-gray', injury: 'badge-brown', mortality: 'badge-red'
  };
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Target</th><th>Type</th><th>Description</th>' +
    '<th>Product</th><th>Dose</th><th>Vet</th><th class="right">Cost</th><th>Follow-up</th>' +
    '</tr></thead><tbody>';
  evts.forEach(function(e) {
    var target = e.animals ? (e.animals.name || e.animals.farm_id)
               : (e.group_id ? getGroupName(e.group_id) : '\u2014');
    html += '<tr>' +
      '<td class="mono">' + fmtDate(e.date) + '</td>' +
      '<td style="font-weight:500">' + target + '</td>' +
      '<td><span class="badge ' + (EVTYPE[e.event_type] || 'badge-gray') + '">' + (e.event_type || '') + '</span></td>' +
      '<td>' + (e.description || '\u2014') + '</td>' +
      '<td class="muted-cell">' + (e.product_used || '\u2014') + '</td>' +
      '<td class="muted-cell">' + (e.dose || '\u2014') + '</td>' +
      '<td>' + (e.vet_involved ? '<span class="badge badge-teal">Yes</span>' : '\u2014') + '</td>' +
      '<td class="mono right">' + (e.cost_pkr ? pkr(e.cost_pkr) : '\u2014') + '</td>' +
      '<td class="muted-cell">' + (e.follow_up_date ? fmtDate(e.follow_up_date) : '\u2014') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  document.getElementById('health-log-table').innerHTML = html;
}

async function submitHealthEvent() {
  var statusEl = document.getElementById('hf-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var targetType = document.getElementById('hf-target-type').value;
    var animalId   = targetType === 'animal' ? document.getElementById('hf-animal').value : null;
    var groupId    = targetType === 'group'  ? document.getElementById('hf-group').value  : null;
    var date       = document.getElementById('hf-date').value;
    var desc       = document.getElementById('hf-desc').value.trim();
    var evType     = document.getElementById('hf-event-type').value;
    if (!date || !desc) throw new Error('Date and description required.');
    if (targetType === 'animal' && !animalId) throw new Error('Select an animal.');
    if (targetType === 'group'  && !groupId)  throw new Error('Select a group.');
    var d = {
      date: date, event_type: evType, description: desc,
      vet_involved: document.getElementById('hf-vet').value === 'true'
    };
    if (animalId) d.animal_id = parseInt(animalId);
    if (groupId)  d.group_id  = parseInt(groupId);
    var prod = document.getElementById('hf-product').value.trim(); if (prod) d.product_used = prod;
    var dose = document.getElementById('hf-dose').value.trim();    if (dose) d.dose = dose;
    var cost = document.getElementById('hf-cost').value;           if (cost) d.cost_pkr = parseFloat(cost);
    var fu   = document.getElementById('hf-followup').value;       if (fu)   d.follow_up_date = fu;

    // Mortality special handling
    if (evType === 'mortality' && animalId) {
      var cause   = document.getElementById('hf-mort-cause') ? document.getElementById('hf-mort-cause').value.trim() : '';
      var disposal= document.getElementById('hf-mort-disposal') ? document.getElementById('hf-mort-disposal').value : '';
      var mortRec = {
        animal_id: parseInt(animalId),
        date: date,
        probable_cause: cause || null,
        carcass_disposal: disposal || null,
        vet_confirmed: document.getElementById('hf-vet').value === 'true'
      };
      if (groupId) mortRec.group_id = parseInt(groupId);
      await sbInsert('animal_mortality', [mortRec]);
      // Update animal status to deceased
      await sbPatch('animals', parseInt(animalId), { status: 'deceased' });
      // Set group_members.left_date
      var memRec = anSharedMembers.find(function(m) { return m.animal_id === parseInt(animalId); });
      if (memRec) {
        await sbPatch('group_members', memRec.id, { left_date: date, left_reason: 'deceased' });
      }
    }

    await sbInsert('animal_health_events', [d]);

    // Update scheduled event if linked
    var schedId = document.getElementById('hf-sched').value;
    if (schedId) {
      var sched = healthScheds.find(function(s) { return s.id === parseInt(schedId); });
      if (sched && sched.interval_days) {
        var nextDue = new Date(date + 'T00:00:00');
        nextDue.setDate(nextDue.getDate() + sched.interval_days);
        await sbPatch('scheduled_health_events', parseInt(schedId), {
          last_done_date: date,
          next_due_date: nextDue.toISOString().slice(0, 10)
        });
      }
    }

    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    document.getElementById('health-log-form').classList.remove('open');
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await loadHealthPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
// BREEDING PAGE
// ============================================================
async function loadBreedingPage() {
  // Do NOT wipe breeding-content — static form fields (br-dam etc.) live inside it.
  // Set loading state only on the dynamic sub-panels.
  var dueEl = document.getElementById('breeding-due-panel');
  var evtEl = document.getElementById('br-event-table');
  var bthEl = document.getElementById('birth-event-table');
  if (dueEl) dueEl.innerHTML = '<div class="loading">Loading...</div>';
  if (evtEl) evtEl.innerHTML = '<div class="loading">Loading...</div>';
  if (bthEl) bthEl.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var r = await Promise.all([
      sbGet('breeding_events',
        'select=id,date,dam_id,sire_id,sire_unknown,location_id,observed_by,notes,' +
        'dams:animals!breeding_events_dam_id_fkey(farm_id,name,species_id),' +
        'sires:animals!breeding_events_sire_id_fkey(farm_id,name)&order=date.desc&limit=200'),
      sbGet('birth_events',
        'select=id,date,dam_id,sire_id,litter_size,live_births,stillbirths,notes,' +
        'dams:animals!birth_events_dam_id_fkey(farm_id,name),' +
        'sires:animals!birth_events_sire_id_fkey(farm_id,name)&order=date.desc&limit=100')
    ]);
    breedingData = r[0]; birthData = r[1];
    renderDueToKid();
    populateBreedingForm();
    renderBreedingEvents();
    renderBirthHistory();
    renderAbbrevKey('abbrev-breeding', ['BCS']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderDueToKid() {
  var el = document.getElementById('breeding-due-panel');
  if (!el) return;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 21);
  var cutoffS = cutoff.toISOString().slice(0, 10);

  // Find breeding events with no linked birth, expected kidding within 21 days
  var registeredDamDates = {};
  birthData.forEach(function(b) {
    registeredDamDates[b.dam_id + '_' + b.date] = true;
  });

  var due = breedingData.filter(function(b) {
    if (!b.dam_id) return false;
    var damA = anSharedAnimals.find(function(a) { return a.id === b.dam_id; });
    var gestDays = 150; // default goat
    if (damA) {
      var sp = anSharedSpecies.find(function(s) { return s.id === damA.species_id; });
      if (sp && sp.gestation_days) gestDays = sp.gestation_days;
    }
    var breedDate = new Date(b.date + 'T00:00:00');
    var expected  = new Date(breedDate); expected.setDate(expected.getDate() + gestDays);
    var expS      = expected.toISOString().slice(0, 10);
    b._expectedKidding = expS;
    b._gestDays = gestDays;
    if (expS > cutoffS) return false;
    // Check if birth already registered
    return !registeredDamDates[b.dam_id + '_' + expS];
  });

  if (!due.length) {
    el.innerHTML = '<div class="empty">No animals due to kid in the next 21 days.</div>';
    return;
  }
  var html = '<div class="due-grid">';
  due.forEach(function(b) {
    var due2  = new Date(b._expectedKidding + 'T00:00:00');
    var diff  = Math.round((due2 - today) / 864e5);
    var cls   = diff < 0 ? 'overdue' : (diff <= 7 ? 'soon' : 'upcoming');
    var daysLabel = diff < 0 ? Math.abs(diff) + 'd overdue' : (diff === 0 ? 'Today' : diff + 'd away');
    var damName = b.dams ? (b.dams.name || b.dams.farm_id) : '\u2014';
    var sireName = b.sires ? (b.sires.farm_id) : (b.sire_unknown ? 'Unknown' : 'Not recorded');
    html += '<div class="due-card ' + cls + '">' +
      '<div class="due-card-top"><span class="due-card-title">Dam: ' + damName + '</span>' +
      '<span class="due-card-days ' + cls + '">' + daysLabel + '</span></div>' +
      '<div class="due-card-meta">Sire: ' + sireName + ' &middot; Bred: ' + fmtDate(b.date) + '</div>' +
      '<div class="due-card-meta">Expected kidding: ' + fmtDate(b._expectedKidding) + '</div>' +
      '<div style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="openBirthModal(' + b.id + ')">Register birth</button></div>' +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function populateBreedingForm() {
  var females = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'female' || a.purpose === 'breeder' || a.is_breeding);
  });
  var males = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'male');
  });
  document.getElementById('br-dam').innerHTML =
    '<option value="">Select dam</option>' +
    females.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('br-sire').innerHTML =
    '<option value="">Select sire (optional)</option>' +
    males.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('br-loc').innerHTML =
    '<option value="">Select location</option>' +
    anSharedPens.map(function(p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
  document.getElementById('br-obs').innerHTML =
    '<option value="">Select worker</option>' +
    anSharedWorkers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('');
  document.getElementById('br-date').value = todayISO();
}

function toggleBrForm() {
  document.getElementById('br-form-box').classList.toggle('open');
}

function renderBreedingEvents() {
  var el = document.getElementById('br-event-table');
  if (!el) return;
  if (!breedingData.length) {
    el.innerHTML = '<div class="empty">No breeding events recorded.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Dam</th><th>Sire</th><th>Expected kidding</th><th>Birth registered</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  breedingData.forEach(function(b) {
    var gestDays = 150;
    if (b.dams) {
      var damA = anSharedAnimals.find(function(a) { return a.id === b.dam_id; });
      if (damA) {
        var sp = anSharedSpecies.find(function(s) { return s.id === damA.species_id; });
        if (sp && sp.gestation_days) gestDays = sp.gestation_days;
      }
    }
    var expected = new Date(b.date + 'T00:00:00'); expected.setDate(expected.getDate() + gestDays);
    var expS = expected.toISOString().slice(0, 10);
    var damName  = b.dams  ? (b.dams.name  || b.dams.farm_id)  : '\u2014';
    var sireName = b.sires ? (b.sires.farm_id) : (b.sire_unknown ? 'Unknown' : '\u2014');
    var birthReg = birthData.find(function(bd) { return bd.dam_id === b.dam_id; });
    html += '<tr>' +
      '<td class="mono">' + fmtDate(b.date) + '</td>' +
      '<td style="font-weight:500">' + damName + '</td>' +
      '<td class="muted-cell">' + sireName + '</td>' +
      '<td class="mono">' + fmtDate(expS) + '</td>' +
      '<td>' + (birthReg ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>') + '</td>' +
      '<td class="muted-cell">' + (b.notes || '\u2014') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function submitBreedingEvent() {
  var st = document.getElementById('br-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var damId = document.getElementById('br-dam').value;
    var date  = document.getElementById('br-date').value;
    if (!damId || !date) throw new Error('Dam and date required.');
    var d = {
      dam_id: parseInt(damId), date: date,
      sire_unknown: document.getElementById('br-sire-unk').value === 'true'
    };
    var sire = document.getElementById('br-sire').value; if (sire) d.sire_id = parseInt(sire);
    var loc  = document.getElementById('br-loc').value;  if (loc)  d.location_id = parseInt(loc);
    var obs  = document.getElementById('br-obs').value;  if (obs)  d.observed_by = parseInt(obs);
    var notes= document.getElementById('br-notes').value.trim(); if (notes) d.notes = notes;
    await sbInsert('breeding_events', [d]);
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    document.getElementById('br-form-box').classList.remove('open');
    await loadBreedingPage();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

function renderBirthHistory() {
  var el = document.getElementById('birth-event-table');
  if (!el) return;
  if (!birthData.length) {
    el.innerHTML = '<div class="empty">No birth events recorded.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Date</th><th>Dam</th><th>Sire</th><th class="right">Litter</th>' +
    '<th class="right">Live</th><th class="right">Stillbirths</th><th>Notes</th>' +
    '</tr></thead><tbody>';
  birthData.forEach(function(b) {
    var damName  = b.dams  ? (b.dams.name  || b.dams.farm_id)  : '\u2014';
    var sireName = b.sires ? (b.sires.farm_id) : '\u2014';
    html += '<tr>' +
      '<td class="mono">' + fmtDate(b.date) + '</td>' +
      '<td style="font-weight:500">' + damName + '</td>' +
      '<td class="muted-cell">' + sireName + '</td>' +
      '<td class="mono right">' + b.litter_size + '</td>' +
      '<td class="mono right" style="color:var(--green)">' + b.live_births + '</td>' +
      '<td class="mono right" style="color:' + (b.stillbirths > 0 ? 'var(--red)' : 'var(--faint)') + '">' + (b.stillbirths || 0) + '</td>' +
      '<td class="muted-cell">' + (b.notes || '\u2014') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ---- Birth modal ----
function openBirthModal(breedingEventId) {
  if (!anSharedLoaded) { alert('Please wait for data to load.'); return; }
  birthStep = 1; pendingBirthEvt = null;
  // Pre-populate dam if called from a breeding event shortcut
  if (breedingEventId) {
    var be = breedingData.find(function(b) { return b.id === breedingEventId; });
    if (be) {
      setTimeout(function() {
        var damSel = document.getElementById('bs1-dam');
        if (damSel) damSel.value = be.dam_id;
        if (be.sire_id) {
          var sireSel = document.getElementById('bs1-sire');
          if (sireSel) sireSel.value = be.sire_id;
        }
      }, 50);
    }
  }
  document.getElementById('birth-modal').style.display = 'flex';
  updateBirthStep();
  populateBirthForm();
}
function closeBirthModal() { document.getElementById('birth-modal').style.display = 'none'; }

function populateBirthForm() {
  var females = anSharedAnimals.filter(function(a) {
    return a.status === 'active' && (a.sex === 'female' || a.purpose === 'breeder' || a.is_breeding);
  });
  var males = anSharedAnimals.filter(function(a) { return a.status === 'active' && a.sex === 'male'; });
  document.getElementById('bs1-dam').innerHTML =
    '<option value="">Select dam</option>' +
    females.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + (a.name?' ('+a.name+')':'') + '</option>'; }).join('');
  document.getElementById('bs1-sire').innerHTML =
    '<option value="">Select sire (optional)</option>' +
    males.map(function(a) { return '<option value="' + a.id + '">' + a.farm_id + '</option>'; }).join('');
  document.getElementById('bs1-worker').innerHTML =
    '<option value="">Select worker</option>' +
    anSharedWorkers.map(function(w) { return '<option value="' + w.id + '">' + w.name + '</option>'; }).join('');
  document.getElementById('bs1-date').value = todayISO();
}

function updateBirthStep() {
  ['birth-step-1','birth-step-2','birth-step-3'].forEach(function(id, i) {
    document.getElementById(id).style.display = (i + 1 === birthStep) ? 'block' : 'none';
  });
  for (var i = 1; i <= 3; i++) {
    var dot = document.getElementById('bstep-' + i);
    if (dot) dot.className = 'step-dot' + (i === birthStep ? ' active' : (i < birthStep ? ' done' : ''));
  }
  document.getElementById('birth-btn-next').textContent =
    birthStep === 2 ? 'Save & register offspring' : (birthStep === 3 ? 'Close' : 'Next');
  var cancelBtn = document.getElementById('birth-btn-cancel');
  if (cancelBtn) cancelBtn.style.display = birthStep === 3 ? 'none' : 'inline-block';
  document.getElementById('birth-status').textContent = '';
}

function updateLitterCalc() {
  var l     = parseInt(document.getElementById('bs1-litter').value) || 0;
  var live  = parseInt(document.getElementById('bs1-live').value)   || 0;
  var still = parseInt(document.getElementById('bs1-still').value)  || 0;
  var el    = document.getElementById('bs1-check');
  if (!l && !live && !still) { el.textContent = ''; return; }
  if (live + still === l) {
    el.innerHTML = '<span style="color:var(--green)">\u2713 Live + stillbirths = litter size</span>';
  } else {
    el.innerHTML = '<span style="color:var(--amber)">\u26a0 Live (' + live + ') + stillbirths (' + still + ') = ' +
                   (live + still) + ' \u2014 litter size set to ' + l + '</span>';
  }
}

async function birthNextStep() {
  var statusEl = document.getElementById('birth-status');
  statusEl.textContent = '';
  if (birthStep === 3) { closeBirthModal(); await loadBreedingPage(); return; }

  if (birthStep === 1) {
    try {
      var date   = document.getElementById('bs1-date').value;
      var damId  = document.getElementById('bs1-dam').value;
      var litter = parseInt(document.getElementById('bs1-litter').value);
      var live   = parseInt(document.getElementById('bs1-live').value);
      var still  = parseInt(document.getElementById('bs1-still').value) || 0;
      if (!date || !damId || isNaN(litter) || isNaN(live)) throw new Error('Date, dam, litter size, and live births required.');
      if (live + still !== litter) throw new Error('Live + stillbirths must equal litter size.');
      statusEl.textContent = 'Saving...';
      var d = {
        date: date, dam_id: parseInt(damId), litter_size: litter,
        live_births: live, stillbirths: still,
        sire_unknown: document.getElementById('bs1-sire-unk').value === 'true'
      };
      var sire   = document.getElementById('bs1-sire').value;   if (sire)   d.sire_id     = parseInt(sire);
      var worker = document.getElementById('bs1-worker').value;  if (worker) d.recorded_by = parseInt(worker);
      var notes  = document.getElementById('bs1-notes').value.trim(); if (notes) d.notes = notes;
      var result = await sbInsert('birth_events', [d]);
      pendingBirthEvt = result[0];
      buildOffspringForms(live, d.dam_id, d.sire_id, d.sire_unknown, date);
      birthStep = 2; updateBirthStep();
    } catch(err) {
      statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
    }
  } else if (birthStep === 2) {
    try {
      statusEl.textContent = 'Creating animal records...';
      var damA = anSharedAnimals.find(function(a) { return String(a.id) === String(pendingBirthEvt.dam_id); });
      var speciesId = damA ? damA.species_id : (anSharedSpecies[0] && anSharedSpecies[0].id);
      var inserts = [];
      document.querySelectorAll('.offspring-card').forEach(function(card) {
        var fid = card.querySelector('.off-fid').value.trim();
        var sex = card.querySelector('.off-sex').value;
        var wt  = card.querySelector('.off-wt').value;
        var nm  = card.querySelector('.off-name').value.trim();
        if (!fid) return;
        var d2 = {
          farm_id: fid, species_id: speciesId, sex: sex,
          date_of_arrival: pendingBirthEvt.date, status: 'active',
          purpose: 'learning', is_breeding: false, born_on_farm: true,
          sire_unknown: pendingBirthEvt.sire_unknown
        };
        if (wt) d2.entry_weight_kg = parseFloat(wt);
        if (nm) d2.name = nm;
        if (pendingBirthEvt.dam_id)  d2.dam_id  = pendingBirthEvt.dam_id;
        if (pendingBirthEvt.sire_id) d2.sire_id = pendingBirthEvt.sire_id;
        inserts.push(d2);
      });
      var createdAnimals = inserts.length ? await sbInsert('animals', inserts) : [];
      if (createdAnimals.length && pendingBirthEvt) {
        var links = createdAnimals.map(function(a) { return { birth_event_id: pendingBirthEvt.id, animal_id: a.id }; });
        await sbInsert('birth_offspring', links);
      }
      document.getElementById('bs3-summary').textContent =
        'Birth registered \u2014 ' + createdAnimals.length + ' offspring created.';
      document.getElementById('bs3-detail').textContent =
        'Offspring assigned purpose: learning. Assign to a group via the Intake page.';
      anSharedLoaded = false; await loadSharedAnimalData();
      birthStep = 3; updateBirthStep();
    } catch(err) {
      statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
    }
  }
}

function buildOffspringForms(count, damId, sireId, sireUnk, birthDate) {
  var damA = anSharedAnimals.find(function(a) { return a.id === damId; });
  var speciesId = damA ? damA.species_id : null;
  var prefix = 'A-';
  if (speciesId) {
    var sn = getSpeciesName(speciesId);
    if      (sn === 'Goat')    prefix = 'G-';
    else if (sn === 'Chicken') prefix = 'C-';
    else if (sn === 'Duck')    prefix = 'D-';
    else if (sn === 'Sheep')   prefix = 'S-';
    else if (sn === 'Goose')   prefix = 'GS-';
    else if (sn === 'Turkey')  prefix = 'T-';
  }
  var existingNums = anSharedAnimals
    .filter(function(a) { return a.farm_id.startsWith(prefix); })
    .map(function(a) { return parseInt(a.farm_id.replace(prefix, '')); })
    .filter(function(n) { return !isNaN(n); });
  var nextNum = existingNums.length ? Math.max.apply(null, existingNums) + 1 : 1;
  var html = '';
  for (var i = 0; i < count; i++) {
    var sid = prefix + String(nextNum + i).padStart(3, '0');
    html += '<div class="offspring-card" style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
      '<h4 style="font-size:13px;font-weight:500;margin-bottom:10px">Offspring ' + (i+1) + ' of ' + count + '</h4>' +
      '<div class="hf-grid"><div class="hf-field"><label>Farm ID</label>' +
      '<input type="text" class="off-fid" value="' + sid + '"></div>' +
      '<div class="hf-field"><label>Sex</label><select class="off-sex">' +
      '<option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option>' +
      '</select></div>' +
      '<div class="hf-field"><label>Birth weight (kg)</label>' +
      '<input type="number" class="off-wt" min="0" step="0.1" placeholder="Optional"></div></div>' +
      '<div class="hf-grid" style="grid-template-columns:1fr">' +
      '<div class="hf-field"><label>Name (optional)</label>' +
      '<input type="text" class="off-name" placeholder="Optional"></div></div>' +
      '</div>';
  }
  document.getElementById('bs2-offspring-forms').innerHTML =
    html || '<div style="font-size:13px;color:var(--faint)">No live births \u2014 click Save to complete.</div>';
}

// ============================================================
// COST & SALES PAGE
// ============================================================
async function loadCostSalesPage() {
  var el = document.getElementById('costsales-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    var allGroups = anSharedGroups;
    if (!csGroupId && allGroups.length) csGroupId = allGroups[0].id;
    var grpOpts = allGroups.map(function(g) {
      return '<option value="' + g.id + '"' + (g.id === csGroupId ? ' selected' : '') + '>' +
        g.name + (g.status === 'closed' ? ' (closed)' : '') + '</option>';
    }).join('');
    var html =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
      '<label style="font-size:13px;color:var(--muted)">Group</label>' +
      '<select id="cs-group-sel" onchange="onCSGroupChange()">' + grpOpts + '</select>' +
      '</div>' +
      '<div id="cs-group-body"><div class="loading">Loading group P&amp;L...</div></div>';
    document.getElementById('costsales-content').innerHTML = html;
    if (csGroupId) await renderCSGroup(csGroupId);
    renderAbbrevKey('abbrev-costsales', ['PKR', 'ADG', 'FCR']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

async function onCSGroupChange() {
  var sel = document.getElementById('cs-group-sel');
  if (!sel) return;
  csGroupId = sel.value ? parseInt(sel.value) : null;
  if (csGroupId) await renderCSGroup(csGroupId);
}

async function renderCSGroup(groupId) {
  var el = document.getElementById('cs-group-body');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    var group = anSharedGroups.find(function(g) { return g.id === groupId; });

    // Fetch all group members (including departed)
    var r = await Promise.all([
      sbGet('group_members', 'group_id=eq.' + groupId + '&select=id,animal_id,joined_date,left_date,left_reason,animals(farm_id,name,purchase_cost_pkr,entry_weight_kg,status)'),
      sbGet('animal_health_events', 'group_id=eq.' + groupId + '&select=cost_pkr'),
      sbGet('animal_sales', 'group_id=eq.' + groupId + '&select=id,animal_id,date,exit_weight_kg,sale_price_pkr,buyer,notes,animals(farm_id,name)&order=date.desc'),
      sbGet('animal_mortality', 'group_id=eq.' + groupId + '&select=id,animal_id,date,probable_cause')
    ]);
    var members   = r[0];
    var healthEvs = r[1];
    var sales     = r[2];
    var mortality = r[3];

    // Also get per-animal health costs for individual animals in the group
    var memberIds = members.map(function(m) { return m.animal_id; }).filter(Boolean);
    var indivHealthCosts = [];
    if (memberIds.length) {
      indivHealthCosts = await sbGet('animal_health_events',
        'animal_id=in.(' + memberIds.join(',') + ')&select=cost_pkr');
    }

    // Purchase cost
    var purchaseCost = members.reduce(function(sum, m) {
      var c = m.animals && m.animals.purchase_cost_pkr ? parseFloat(m.animals.purchase_cost_pkr) : 0;
      return sum + c;
    }, 0);

    // Health costs
    var healthCost = 0;
    healthEvs.forEach(function(e) { if (e.cost_pkr) healthCost += parseFloat(e.cost_pkr); });
    indivHealthCosts.forEach(function(e) { if (e.cost_pkr) healthCost += parseFloat(e.cost_pkr); });

    // Sales revenue
    var saleRevenue = sales.reduce(function(sum, s) {
      return sum + (s.sale_price_pkr ? parseFloat(s.sale_price_pkr) : 0);
    }, 0);

    // Active animals (still in group)
    var activeMembers  = members.filter(function(m) { return !m.left_date; });
    var soldMembers    = members.filter(function(m) { return m.left_reason === 'sold'; });
    var deceasedMembers= members.filter(function(m) { return m.left_reason === 'deceased'; });

    // Confirmed costs (purchase + health)
    var confirmedCost = purchaseCost + healthCost;

    // Projected remaining feed cost — not calculable without feed log; show placeholder
    var targetWt = group && group.target_weight_kg ? parseFloat(group.target_weight_kg) : null;

    // P&L
    var confirmedMargin = saleRevenue - confirmedCost;

    // Render
    var costHtml = '<div class="section"><div class="section-hdr"><h2>Cost summary</h2></div><div style="padding:0">' +
      '<table class="cycle-table"><tbody>' +
      '<tr><td class="c-label">Purchase cost (all members)</td><td class="c-val mono">' + pkr(purchaseCost) + '</td>' +
      '<td class="c-note" style="font-size:11px;color:var(--faint)">' + members.length + ' animal' + (members.length!==1?'s':'') + ' total (' + activeMembers.length + ' active)</td></tr>' +
      '<tr><td class="c-label">Health costs</td><td class="c-val mono">' + pkr(healthCost) + '</td><td></td></tr>' +
      '<tr class="section-break"><td colspan="3">Feed costs</td></tr>' +
      '<tr><td class="c-label">Feed cost (actual)</td><td class="c-val mono">\u2014</td><td class="c-note" style="color:var(--amber)">Feed log not yet implemented for this group</td></tr>' +
      '<tr class="total-row"><td class="c-label"><strong>Total confirmed cost</strong></td><td class="c-val mono">' + pkr(confirmedCost) + '</td><td class="c-note">Purchase + health only</td></tr>' +
      '</tbody></table></div></div>';

    // Sales log
    var salesHtml = '<div class="section"><div class="section-hdr"><h2>Sales log</h2>' +
      '<button class="btn btn-sm btn-primary" onclick="toggleSaleForm()">+ Log sale</button></div>' +
      '<div id="sale-form-wrap" style="display:none;padding:16px 22px;background:var(--bg);border-bottom:1px solid var(--border)">' +
      '<div class="hf-grid">' +
      '<div class="hf-field"><label>Animal</label><select id="sf-animal">' +
      '<option value="">Select animal</option>' +
      members.filter(function(m){return m.animals;}).map(function(m) {
        return '<option value="' + m.animal_id + '">' + (m.animals.farm_id || m.animal_id) + (m.animals.name ? ' ('+m.animals.name+')' : '') + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="hf-field"><label>Date</label><input type="date" id="sf-date" value="' + todayISO() + '"></div>' +
      '<div class="hf-field"><label>Exit weight (kg)</label><input type="number" id="sf-wt" min="0" step="0.1" placeholder="kg"></div>' +
      '<div class="hf-field"><label>Sale price (PKR)</label><input type="number" id="sf-price" min="0" step="1" placeholder="Total sale price"></div>' +
      '<div class="hf-field"><label>Buyer</label><input type="text" id="sf-buyer" placeholder="Optional"></div>' +
      '<div class="hf-field"><label>Notes</label><input type="text" id="sf-notes" placeholder="Optional"></div>' +
      '</div><div style="display:flex;gap:10px;margin-top:8px">' +
      '<button class="btn btn-primary btn-sm" onclick="submitSale(' + groupId + ')">Save sale</button>' +
      '<button class="btn btn-sm" onclick="toggleSaleForm()">Cancel</button>' +
      '<span id="sf-status" style="font-size:13px;color:var(--muted);align-self:center"></span></div></div>';

    if (!sales.length) {
      salesHtml += '<div class="empty">No sales recorded for this group.</div>';
    } else {
      salesHtml += '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Date</th><th>Animal</th><th class="right">Exit weight</th><th class="right">Sale price</th>' +
        '<th class="right">Price/kg</th><th>Buyer</th></tr></thead><tbody>';
      sales.forEach(function(s) {
        var name = s.animals ? (s.animals.name || s.animals.farm_id) : '\u2014';
        var ppkg = (s.sale_price_pkr && s.exit_weight_kg) ? r1(s.sale_price_pkr / s.exit_weight_kg) : null;
        salesHtml += '<tr>' +
          '<td class="mono">' + fmtDate(s.date) + '</td>' +
          '<td style="font-weight:500">' + name + '</td>' +
          '<td class="mono right">' + (s.exit_weight_kg ? r1(s.exit_weight_kg) + ' kg' : '\u2014') + '</td>' +
          '<td class="mono right">' + pkr(s.sale_price_pkr) + '</td>' +
          '<td class="mono right">' + (ppkg ? 'PKR ' + ppkg.toLocaleString() + '/kg' : '\u2014') + '</td>' +
          '<td class="muted-cell">' + (s.buyer || '\u2014') + '</td>' +
          '</tr>';
      });
      salesHtml += '</tbody></table></div>';
    }
    salesHtml += '</div>';

    // P&L panel
    var plHtml = '<div class="section"><div class="section-hdr"><h2>P&amp;L</h2>' +
      (group && group.status === 'active' ? '<span class="section-meta">Group active \u2014 final P&amp;L on close</span>' : '<span class="section-meta">Group closed</span>') +
      '</div>' +
      '<table class="cycle-table"><tbody>' +
      '<tr><td class="c-label">Total confirmed cost</td><td class="c-val mono">' + pkr(confirmedCost) + '</td><td class="c-note">Purchase + health (feed costs not yet logged)</td></tr>' +
      '<tr><td class="c-label">Revenue recovered (sales)</td><td class="c-val mono">' + pkr(saleRevenue) + '</td>' +
      '<td class="c-note">' + soldMembers.length + ' animal' + (soldMembers.length!==1?'s':'') + ' sold</td></tr>' +
      '<tr><td class="c-label">Animals remaining</td><td class="c-val mono">' + activeMembers.length + '</td>' +
      '<td class="c-note">' + (targetWt ? 'Target: ' + targetWt + ' kg/head' : 'No target set') + '</td></tr>' +
      '<tr><td class="c-label">Mortality</td><td class="c-val mono">' + deceasedMembers.length + '</td><td></td></tr>' +
      '<tr class="total-row"><td class="c-label"><strong>Actual margin (to date)</strong></td>' +
      '<td class="c-val mono" style="color:' + (confirmedMargin >= 0 ? 'var(--green)' : 'var(--red)') + '">' + pkr(confirmedMargin) + '</td>' +
      '<td class="c-note">Revenue \u2212 confirmed costs</td></tr>' +
      '</tbody></table></div>';

    document.getElementById('cs-group-body').innerHTML = costHtml + salesHtml + plHtml;
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function toggleSaleForm() {
  var f = document.getElementById('sale-form-wrap');
  if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
}

async function submitSale(groupId) {
  var st = document.getElementById('sf-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var animalId = document.getElementById('sf-animal').value;
    var date     = document.getElementById('sf-date').value;
    var price    = document.getElementById('sf-price').value;
    if (!animalId) throw new Error('Select an animal.');
    if (!date)     throw new Error('Date required.');
    if (!price)    throw new Error('Sale price required.');
    var d = {
      animal_id: parseInt(animalId),
      group_id: groupId,
      date: date,
      sale_price_pkr: parseFloat(price)
    };
    var wt    = document.getElementById('sf-wt').value;    if (wt)    d.exit_weight_kg = parseFloat(wt);
    var buyer = document.getElementById('sf-buyer').value.trim(); if (buyer) d.buyer = buyer;
    var notes = document.getElementById('sf-notes').value.trim(); if (notes) d.notes = notes;
    await sbInsert('animal_sales', [d]);
    // Update animal status to sold
    await sbPatch('animals', parseInt(animalId), { status: 'sold' });
    // Set group_members.left_date
    var memRecs = await sbGet('group_members',
      'group_id=eq.' + groupId + '&animal_id=eq.' + animalId + '&left_date=is.null&select=id&limit=1');
    if (memRecs.length) {
      await sbPatch('group_members', memRecs[0].id, { left_date: date, left_reason: 'sold' });
    }
    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await renderCSGroup(groupId);
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}
