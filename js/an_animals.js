// an_animals.js v17
// Animals list page
// Depends on: shared.js, an_helpers.js
// ============================================================

// ============================================================
// ANIMALS LIST PAGE
// ============================================================
async function loadAnimalsListPage() {
  var wrapper = document.getElementById('al-table-wrap');
  if (wrapper) wrapper.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (!anSharedLoaded) await loadSharedAnimalData();
    renderAlTabBar();
    renderAnimalsList();
    renderAbbrevKey('abbrev-animalslist', ['BCS', 'ADG', 'DM']);
  } catch(err) {
    if (wrapper) wrapper.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderAlTabBar() {
  var bar = document.getElementById('al-tab-bar');
  if (!bar) return;
  var tabs = [
    { id: 'all',        label: 'All' },
    { id: 'active',     label: 'Active' },
    { id: 'quarantine', label: 'Quarantine' },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'sick',       label: 'Sick' }
  ];
  bar.innerHTML = tabs.map(function(t) {
    return '<button class="modal-tab' + (alFilterTab === t.id ? ' active' : '') + '" ' +
      'onclick="alSetTab(\'' + t.id + '\')">' + t.label + '</button>';
  }).join('');
}

function renderAnimalsList() {
  var wrapper = document.getElementById('al-table-wrap');
  if (!wrapper) return;

  var animals = anSharedAnimals.filter(function(a) {
    if (alFilterTab === 'all')        return true;
    if (alFilterTab === 'active')     return a.status === 'active';
    if (alFilterTab === 'quarantine') return a.status === 'quarantine';
    if (alFilterTab === 'sick')       return a.status === 'sick';
    if (alFilterTab === 'unassigned') {
      return anSharedMembers.every(function(m) { return m.animal_id !== a.id; });
    }
    return true;
  });

  var badge = document.getElementById('al-count');
  if (badge) badge.textContent = animals.length + ' animal' + (animals.length === 1 ? '' : 's');

  if (!animals.length) {
    wrapper.innerHTML = '<div class="empty">' +
      (alFilterUnassigned ? 'No unassigned animals with the current filter.' : 'No animals match the current filter.') +
      '</div>';
    return;
  }

  var today = new Date();
  var html = '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Farm ID</th><th>Species / Breed</th><th>Sex</th><th>Purpose</th>' +
    '<th>Status</th><th>Group</th><th>Location</th>' +
    '<th class="right">Entry kg</th><th class="right">Current kg</th><th class="right">Days on farm</th>' +
    '<th></th></tr></thead><tbody>';

  animals.forEach(function(a) {
    var lw      = getLatestWeight(a.id);
    var curW    = lw ? parseFloat(lw.weight_kg) : null;
    var days    = a.date_of_arrival ? Math.round((today - new Date(a.date_of_arrival + 'T00:00:00')) / 864e5) : null;
    var mem     = anSharedMembers.find(function(m) { return m.animal_id === a.id; });
    var grpName = mem ? getGroupName(mem.group_id) : '<span class="badge badge-amber">Unassigned</span>';
    var locName = a.current_location_id ? getLocationName(a.current_location_id) : '\u2014';
    var statusCls   = a.status === 'active' ? 'badge-green' : a.status === 'quarantine' ? 'badge-amber' : 'badge-gray';
    var statusLabel = a.status === 'other_exit' ? 'left farm' : (a.status || 'unknown');

    if (alEditId === a.id) {
      // Inline edit row
      html += '<tr style="background:var(--bg)">' +
        '<td style="font-weight:500">' + a.farm_id + '</td>' +
        '<td>' + getSpeciesName(a.species_id) + (a.breed ? ' &middot; ' + a.breed : '') + '</td>' +
        '<td><select id="ale-sex" style="font-size:12px;padding:2px 4px">' +
          '<option value=""'       + (!a.sex?' selected':'') + '>Unknown</option>' +
          '<option value="male"'   + (a.sex==='male'?' selected':'') + '>Male</option>' +
          '<option value="female"' + (a.sex==='female'?' selected':'') + '>Female</option>' +
        '</select></td>' +
        '<td><select id="ale-purpose" style="font-size:12px;padding:2px 4px">' +
          '<option value="meat"' + (a.purpose==='meat'?' selected':'') + '>Meat</option>' +
          '<option value="breeder"' + (a.purpose==='breeder'?' selected':'') + '>Breeder</option>' +
          '<option value="layer"' + (a.purpose==='layer'?' selected':'') + '>Layer</option>' +
          '<option value="dual_purpose"' + (a.purpose==='dual_purpose'?' selected':'') + '>Dual-purpose</option>' +
          '<option value="farm_labor"' + (a.purpose==='farm_labor'?' selected':'') + '>Farm labor</option>' +
          '<option value="learning"' + (a.purpose==='learning'?' selected':'') + '>Learning</option>' +
        '</select></td>' +
        '<td><select id="ale-status" style="font-size:12px;padding:2px 4px">' +
          '<option value="active"' + (a.status==='active'?' selected':'') + '>Active</option>' +
          '<option value="quarantine"' + (a.status==='quarantine'?' selected':'') + '>Quarantine</option>' +
        '</select></td>' +
        '<td>' + grpName + '</td>' +
        '<td>' + locName + '</td>' +
        '<td class="right mono">' + (a.entry_weight_kg != null ? r1(parseFloat(a.entry_weight_kg)) : '\u2014') + '</td>' +
        '<td class="right mono">' + (curW != null ? r1(curW) : '\u2014') + '</td>' +
        '<td class="right mono">' + (days != null ? days : '\u2014') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm btn-primary" onclick="alSaveEdit(' + a.id + ')">Save</button> ' +
          '<button class="btn btn-sm" onclick="alCancelEdit()">Cancel</button>' +
        '</td></tr>';
    } else {
      html += '<tr>' +
        '<td style="font-weight:500">' + a.farm_id + '</td>' +
        '<td>' + getSpeciesName(a.species_id) + (a.breed ? ' &middot; ' + a.breed : '') + '</td>' +
        '<td class="muted-cell">' + (a.sex || '\u2014') + '</td>' +
        '<td>' + purposeBadge(a.purpose) + '</td>' +
        '<td><span class="badge ' + statusCls + '">' + statusLabel + '</span></td>' +
        '<td>' + grpName + '</td>' +
        '<td class="muted-cell">' + locName + '</td>' +
        '<td class="right mono">' + (a.entry_weight_kg != null ? r1(parseFloat(a.entry_weight_kg)) : '\u2014') + '</td>' +
        '<td class="right mono">' + (curW != null ? r1(curW) : '\u2014') + '</td>' +
        '<td class="right mono">' + (days != null ? days : '\u2014') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-sm" onclick="alStartEdit(' + a.id + ')">Edit</button> ' +
          '<button class="btn btn-sm btn-primary" onclick="alOpenAssign(' + a.id + ', ' + (mem ? mem.group_id : 'null') + ')">' +
            (mem ? 'Move group' : 'Assign group') +
          '</button>' +
          (a.status === 'active' || a.status === 'quarantine'
            ? ' <button class="btn btn-sm" onclick="alOpenExit(' + a.id + ')">Left farm</button>'
            : '') +
          ' <button class="btn btn-sm" style="color:var(--red);border-color:var(--red)" ' +
            'onclick="alDeleteAnimal(' + a.id + ', \'' + a.farm_id.replace(/'/g, "\\'") + '\')">Delete</button>' +
        '</td></tr>';
    }
  });

  html += '</tbody></table></div>';
  wrapper.innerHTML = html;
}

function alSetTab(tab) {
  alFilterTab = tab;
  alEditId = null;
  // Update tab bar active state
  var bar = document.getElementById('al-tab-bar');
  if (bar) {
    var tabs = ['all','active','quarantine','unassigned','sick'];
    bar.querySelectorAll('.modal-tab').forEach(function(btn, i) {
      btn.classList.toggle('active', tabs[i] === tab);
    });
  }
  renderAnimalsList();
}

function alStartEdit(animalId) {
  alEditId = animalId;
  renderAnimalsList();
}

function alCancelEdit() {
  alEditId = null;
  renderAnimalsList();
}

async function alSaveEdit(animalId) {
  try {
    var purpose = document.getElementById('ale-purpose').value;
    var status  = document.getElementById('ale-status').value;
    var sex     = document.getElementById('ale-sex').value;
    await sbPatch('animals', animalId, { purpose: purpose, status: status, sex: sex || null });
    alEditId = null;
    anSharedLoaded = false;
    await loadSharedAnimalData();
    renderAnimalsList();
  } catch(err) {
    alert('Save failed: ' + err.message);
  }
}

function alOpenAssign(animalId, currentGroupId) {
  alAssignAnimalId = animalId;
  var sel = document.getElementById('al-assign-group');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- No group (remove from current) --</option>' +
    anSharedGroups
      .filter(function(g) { return g.status === 'active'; })
      .map(function(g) {
        var sel2 = (g.id === currentGroupId) ? ' selected' : '';
        return '<option value="' + g.id + '"' + sel2 + '>' + g.name + '</option>';
      }).join('');
  document.getElementById('al-assign-date').value = todayISO();
  var lbl = document.getElementById('al-assign-label');
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  if (lbl) lbl.textContent = a ? (a.name || a.farm_id) : ('Animal #' + animalId);
  var modal = document.getElementById('al-assign-modal');
  if (modal) modal.style.display = 'flex';
}

function alCloseAssign() {
  var modal = document.getElementById('al-assign-modal');
  if (modal) modal.style.display = 'none';
  alAssignAnimalId = null;
}

async function alSubmitAssign() {
  var st = document.getElementById('al-assign-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var groupId   = document.getElementById('al-assign-group').value;
    var joinDate  = document.getElementById('al-assign-date').value;
    if (!joinDate) throw new Error('Join date required.');
    var today = todayISO();

    // Close any existing active group membership
    var existing = anSharedMembers.filter(function(m) { return m.animal_id === alAssignAnimalId; });
    for (var i = 0; i < existing.length; i++) {
      await sbPatch('group_members', existing[i].id, { left_date: today, left_reason: 'transferred' });
    }

    // Create new membership if a group was selected
    if (groupId) {
      await sbInsert('group_members', [{ group_id: parseInt(groupId), animal_id: alAssignAnimalId, joined_date: joinDate }]);
    }

    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    alCloseAssign();
    renderAnimalsList();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

// ============================================================
// LEFT FARM EXIT
// ============================================================
function alOpenExit(animalId) {
  var a = anSharedAnimals.find(function(x) { return x.id === animalId; });
  if (!a) return;
  document.getElementById('al-exit-id').value         = animalId;
  document.getElementById('al-exit-label').textContent = a.farm_id + (a.name ? ' (' + a.name + ')' : '');
  document.getElementById('al-exit-date').value        = todayISO();
  document.getElementById('al-exit-notes').value       = '';
  document.getElementById('al-exit-status').textContent = '';
  document.getElementById('al-exit-modal').style.display = 'flex';
}

function alCloseExit() {
  document.getElementById('al-exit-modal').style.display = 'none';
}

async function alSubmitExit() {
  var st = document.getElementById('al-exit-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var animalId = parseInt(document.getElementById('al-exit-id').value);
    var date     = document.getElementById('al-exit-date').value;
    var reason   = document.getElementById('al-exit-reason').value;
    var notes    = document.getElementById('al-exit-notes').value.trim();
    if (!date) throw new Error('Date left is required.');

    var exitNote = 'Left farm: ' + reason.replace(/_/g, ' ') + (notes ? ' \u2014 ' + notes : '');
    await sbPatch('animals', animalId, { status: 'other_exit', notes: exitNote });

    // Close active group memberships
    var memberships = anSharedMembers.filter(function(m) { return m.animal_id === animalId; });
    for (var i = 0; i < memberships.length; i++) {
      await sbPatch('group_members', memberships[i].id, { left_date: date, left_reason: 'left_farm' });
    }

    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    alCloseExit();
    renderAnimalsList();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}


// ============================================================
// HARD DELETE (testing / admin)
// ============================================================
async function alDeleteAnimal(animalId, farmId) {
  var typed = window.prompt(
    'Permanently delete ' + farmId + ' and ALL their records?\n' +
    'This cannot be undone. Type their Farm ID to confirm:'
  );
  if (typed === null) return; // cancelled
  if (typed.trim() !== farmId) {
    alert('Farm ID did not match. Deletion cancelled.');
    return;
  }
  try {
    // Null out self-referential FKs on other animals (dam/sire references)
    await sbPatchWhere('animals', 'dam_id=eq.'  + animalId, { dam_id:  null });
    await sbPatchWhere('animals', 'sire_id=eq.' + animalId, { sire_id: null });
    // Delete all child records
    await sbDeleteWhere('animal_weights',       'animal_id=eq.' + animalId);
    await sbDeleteWhere('animal_health_events', 'animal_id=eq.' + animalId);
    await sbDeleteWhere('quarantine_records',   'animal_id=eq.' + animalId);
    await sbDeleteWhere('animal_sales',         'animal_id=eq.' + animalId);
    await sbDeleteWhere('animal_mortality',     'animal_id=eq.' + animalId);
    await sbDeleteWhere('group_members',        'animal_id=eq.' + animalId);
    // Delete the animal record itself
    await sbDelete('animals', animalId);
    anSharedLoaded = false;
    await loadSharedAnimalData();
    renderAnimalsList();
  } catch(err) {
    alert('Delete failed: ' + err.message);
  }
}

