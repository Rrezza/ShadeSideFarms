// an_groups.js v17
// Groups page
// Depends on: shared.js, an_helpers.js
// ============================================================

// ============================================================
// GROUPS PAGE
// ============================================================
async function loadGroupsPage() {
  var el = document.getElementById('grp-content');
  if (el) el.innerHTML = '<div class="loading">Loading...</div>';
  try {
    // Always reload — membership changes from Intake or direct DB ops must be reflected.
    anSharedLoaded = false;
    await loadSharedAnimalData();
    var activeGrps = anSharedGroups.filter(function(g) { return g.status === 'active'; });
    var closedGrps = anSharedGroups.filter(function(g) { return g.status !== 'active'; });

    renderGroupsTable(activeGrps, closedGrps);
    populateGroupCreateForm();
    document.getElementById('grp-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-PK', { hour:'2-digit', minute:'2-digit' });
    renderAbbrevKey('abbrev-groups', ['BCS','DM','ADG','PKR']);
  } catch(err) {
    if (el) el.innerHTML = '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
    console.error(err);
  }
}

function renderGroupsTable(activeGrps, closedGrps) {
  var html = '';

  function groupRow(g) {
    var animals   = getGroupAnimals(g.id);
    var stats     = computeGroupStats(animals);
    var comp      = animals.length ? speciesComposition(animals) : 'empty';
    var locId     = null; // current location loaded separately when expanded
    var multiFlag = g.is_multi_species
      ? ' <span class="badge badge-blue" style="font-size:10px">Multi-species</span>' : '';
    var expanded  = grpExpanded === g.id;
    return '<tr class="grp-row' + (expanded ? ' grp-row-open' : '') + '" onclick="toggleGroupExpand(' + g.id + ')">' +
      '<td style="font-weight:500">' + g.name + multiFlag + '</td>' +
      '<td>' + purposeBadge(g.primary_purpose) + '</td>' +
      '<td>' + comp + '</td>' +
      '<td class="right" style="font-weight:500">' + animals.length + '</td>' +
      '<td class="mono">' + (stats.avgCurrent != null ? r1(stats.avgCurrent) + ' kg' : '\u2014') + '</td>' +
      '<td class="mono">' + (stats.avgDays > 0 ? stats.avgDays + 'd' : '\u2014') + '</td>' +
      '<td>' + statusBadge(g.status) + '</td>' +
      '</tr>' +
      (expanded ? '<tr class="grp-expand-row"><td colspan="7" style="padding:0">' + renderGroupDetail(g, animals, stats) + '</td></tr>' : '');
  }

  html += '<div class="section"><div class="section-hdr"><h2>Active groups</h2>' +
    '<span class="section-meta">' + activeGrps.length + ' group' + (activeGrps.length !== 1 ? 's' : '') + '</span>' +
    '</div>';
  if (!activeGrps.length) {
    html += '<div class="empty">No active groups. Create one below to start adding animals.</div>';
  } else {
    html += '<div style="overflow-x:auto"><table>' +
      '<thead><tr><th>Name</th><th>Purpose</th><th>Species</th><th class="right">Head</th>' +
      '<th>Avg weight</th><th>Avg days</th><th>Status</th></tr></thead><tbody>';
    activeGrps.forEach(function(g) { html += groupRow(g); });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  if (closedGrps.length) {
    html += '<div class="section"><div class="section-hdr"><h2>Closed groups</h2>' +
      '<span class="section-meta">' + closedGrps.length + ' closed</span></div>' +
      '<div style="overflow-x:auto"><table>' +
      '<thead><tr><th>Name</th><th>Purpose</th><th>Species</th><th class="right">Head</th>' +
      '<th>Avg weight</th><th>Avg days</th><th>Status</th></tr></thead><tbody>';
    closedGrps.forEach(function(g) { html += groupRow(g); });
    html += '</tbody></table></div></div>';
  }

  document.getElementById('grp-content').innerHTML = html;
}

function renderGroupDetail(g, animals, stats) {
  // Member table
  var memberRows = animals.length
    ? animals.map(function(a) {
        var lw = getLatestWeight(a.id);
        var curW = lw ? parseFloat(lw.weight_kg) : (a.entry_weight_kg ? parseFloat(a.entry_weight_kg) : null);
        var mem  = anSharedMembers.find(function(m) { return m.animal_id === a.id && m.group_id === g.id; });
        var daysInGrp = mem ? Math.round((new Date() - new Date(mem.joined_date + 'T00:00:00')) / 864e5) : '\u2014';
        var statusCls = a.status === 'active' ? 'badge-green' : a.status === 'quarantine' ? 'badge-amber' : 'badge-gray';
        return '<tr><td class="mono">' + a.farm_id + '</td>' +
          '<td>' + getSpeciesName(a.species_id) + '</td>' +
          '<td>' + (a.breed || '\u2014') + '</td>' +
          '<td>' + (a.sex || '\u2014') + '</td>' +
          '<td><span class="badge ' + statusCls + '">' + (a.status || '\u2014') + '</span></td>' +
          '<td class="mono">' + (curW != null ? r1(curW) + ' kg' : '\u2014') + '</td>' +
          '<td class="mono">' + (typeof daysInGrp === 'number' ? daysInGrp + 'd' : '\u2014') + '</td>' +
          '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="muted-cell" style="text-align:center">No members</td></tr>';

  // Stat cards
  var sc = '';
  sc += '<div class="pen-stat"><div class="pen-stat-label">Head count</div><div class="pen-stat-val">' + stats.headCount + '</div></div>';
  sc += '<div class="pen-stat"><div class="pen-stat-label">Avg entry wt</div><div class="pen-stat-val">' + (stats.avgEntry != null ? r1(stats.avgEntry) + ' kg' : '\u2014') + '</div></div>';
  sc += '<div class="pen-stat"><div class="pen-stat-label">Avg current wt</div><div class="pen-stat-val">' + (stats.avgCurrent != null ? r1(stats.avgCurrent) + ' kg' : '\u2014') + '</div></div>';
  sc += '<div class="pen-stat"><div class="pen-stat-label">Avg days in group</div><div class="pen-stat-val">' + (stats.avgDays > 0 ? stats.avgDays : '\u2014') + '</div></div>';
  sc += '<div class="pen-stat"><div class="pen-stat-label">ADG (observed)</div><div class="pen-stat-val" style="font-size:12px">' +
    (stats.adg ? r1(stats.adg) + ' g/d' : (stats.adgInsufficient ? '<span style="color:var(--faint)">insufficient data</span>' : '\u2014')) + '</div></div>';

  // Target weight (meat only)
  var targetWt = g.target_weight_kg
    ? '<div style="font-size:13px;color:var(--muted);margin-top:6px">Target weight: <strong>' + r1(g.target_weight_kg) + ' kg</strong></div>'
    : '';

  // Notes
  var notesHtml = g.notes
    ? '<div style="font-size:13px;color:var(--muted);margin-top:8px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">' + g.notes + '</div>'
    : '';

  // Location
  var grpLoc = anSharedGroupLocations.find(function(l) { return l.group_id === g.id; });
  var locDisplay = grpLoc
    ? (grpLoc.locations ? grpLoc.locations.name : getLocationName(grpLoc.location_id))
    : '<span style="color:var(--muted)">Not assigned</span>';

  return '<div style="padding:18px 22px;background:var(--bg);border-top:2px solid var(--green-bdr)">' +
    '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();goToPage(\'intake\')">+ Add animals</button>' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();goToPage(\'weighttracking\')">Log weights</button>' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();goToPage(\'anfeed\')">Feeding</button>' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();goToPage(\'health\')">Health events</button>' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();goToPage(\'costsales\')">Cost &amp; Sales</button>' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();openGroupEditModal(' + g.id + ')">Edit group</button>' +
      '<button class="btn btn-sm" style="margin-left:auto;color:var(--red);border-color:var(--red)" onclick="event.stopPropagation();deleteGroup(' + g.id + ', \'' + g.name.replace(/'/g,"\\'") + '\', ' + animals.length + ')">Delete group</button>' +
    '</div>' +
    '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
      '<strong>Location:</strong> ' + locDisplay +
    '</div>' +
    '<div class="pen-stats-row" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">' + sc + '</div>' +
    targetWt +
    notesHtml +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin:14px 0 8px">Members</div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>Farm ID</th><th>Species</th><th>Breed</th><th>Sex</th><th>Status</th><th>Current wt</th><th>Days in group</th>' +
    '</tr></thead><tbody>' + memberRows + '</tbody></table></div>' +
    '</div>';
}

async function deleteGroup(groupId, groupName, headCount) {
  if (headCount > 0) {
    alert('Cannot delete "' + groupName + '" — it has ' + headCount + ' animal' + (headCount > 1 ? 's' : '') + ' in it. Remove all animals from the group first, then delete.');
    return;
  }
  // Check for any historical members (animals that were in this group and left)
  try {
    var hist = await sbGet('group_members', 'group_id=eq.' + groupId + '&select=id&limit=1');
    if (hist.length) {
      if (!confirm('"' + groupName + '" has historical member records. Deleting it will also remove that history. Proceed?')) return;
    } else {
      if (!confirm('Delete group "' + groupName + '"? This cannot be undone.')) return;
    }
    // Delete child records first to avoid FK violations, then the group
    await sbDeleteWhere('group_members',          'group_id=eq.' + groupId);
    await sbDeleteWhere('group_location_history', 'group_id=eq.' + groupId);
    await sbDeleteWhere('group_recipes',          'group_id=eq.' + groupId);
    await sbDelete('animal_groups', groupId);
    grpExpanded = null;
    anSharedLoaded = false;
    await loadSharedAnimalData();
    await loadGroupsPage();
  } catch(err) {
    alert('Delete failed: ' + err.message);
  }
}

function toggleGroupExpand(groupId) {
  grpExpanded = (grpExpanded === groupId) ? null : groupId;
  var activeGrps = anSharedGroups.filter(function(g) { return g.status === 'active'; });
  var closedGrps = anSharedGroups.filter(function(g) { return g.status !== 'active'; });
  renderGroupsTable(activeGrps, closedGrps);
}

function openGroupEditModal(groupId) {
  var g = anSharedGroups.find(function(x) { return x.id === groupId; });
  if (!g) return;
  document.getElementById('ge-id').value       = groupId;
  document.getElementById('ge-name').value     = g.name || '';
  document.getElementById('ge-target').value   = g.target_weight_kg || '';
  document.getElementById('ge-reminder').value = g.weigh_in_reminder_days || '';
  document.getElementById('ge-notes').value    = g.notes || '';
  // Purpose
  var pSel = document.getElementById('ge-purpose');
  if (pSel) pSel.value = g.primary_purpose || 'meat';
  // Location
  var lSel = document.getElementById('ge-location');
  if (lSel) {
    lSel.innerHTML = '<option value="">None / not assigned</option>' +
      anSharedPens.map(function(p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
    var grpLoc = anSharedGroupLocations.find(function(l) { return l.group_id === groupId; });
    if (grpLoc) lSel.value = grpLoc.location_id;
  }
  var modal = document.getElementById('grp-edit-modal');
  if (modal) modal.style.display = 'flex';
}

function closeGroupEditModal() {
  var modal = document.getElementById('grp-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function submitGroupEdit() {
  var st = document.getElementById('ge-status');
  st.textContent = 'Saving...'; st.style.color = 'var(--muted)';
  try {
    var groupId = parseInt(document.getElementById('ge-id').value);
    var name     = document.getElementById('ge-name').value.trim();
    var purpose  = document.getElementById('ge-purpose').value;
    var target   = document.getElementById('ge-target').value;
    var reminder = document.getElementById('ge-reminder').value;
    var notes    = document.getElementById('ge-notes').value.trim();
    var locId    = document.getElementById('ge-location').value;
    if (!name) throw new Error('Name required.');
    var patch = { name: name, primary_purpose: purpose };
    patch.target_weight_kg       = target   ? parseFloat(target)  : null;
    patch.weigh_in_reminder_days = reminder ? parseInt(reminder)  : null;
    patch.notes                  = notes || null;
    await sbPatch('animal_groups', groupId, patch);

    // Location: close existing open record, create new if different
    var today = todayISO();
    var existing = anSharedGroupLocations.find(function(l) { return l.group_id === groupId; });
    var existingLocId = existing ? String(existing.location_id) : '';
    if (locId !== existingLocId) {
      if (existing) {
        await sbPatch('group_location_history', existing.id, { to_date: today });
      }
      if (locId) {
        await sbInsert('group_location_history', [{ group_id: groupId, location_id: parseInt(locId), from_date: today }]);
      }
    }

    st.textContent = 'Saved.'; st.style.color = 'var(--green)';
    anSharedLoaded = false;
    await loadSharedAnimalData();
    closeGroupEditModal();
    await loadGroupsPage();
  } catch(err) {
    st.textContent = 'Error: ' + err.message; st.style.color = 'var(--red)';
  }
}

function populateGroupCreateForm() {
  // populate location selector for group create (optional)
  var sel = document.getElementById('grp-create-loc');
  if (sel) {
    sel.innerHTML = '<option value="">None / not assigned</option>' +
      anSharedPens.map(function(p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
  }
}

function toggleGroupCreateForm() {
  var f = document.getElementById('grp-create-form');
  if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
}

async function submitCreateGroup() {
  var statusEl = document.getElementById('grp-create-status');
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--muted)';
  try {
    var name     = document.getElementById('grp-create-name').value.trim();
    var purpose  = document.getElementById('grp-create-purpose').value;
    var target   = document.getElementById('grp-create-target').value;
    var reminder = document.getElementById('grp-create-reminder') ? document.getElementById('grp-create-reminder').value : '';
    var notes    = document.getElementById('grp-create-notes').value.trim();
    if (!name)    throw new Error('Group name required.');
    if (!purpose) throw new Error('Purpose required.');
    var d = { name: name, primary_purpose: purpose, status: 'active' };
    if (target)   d.target_weight_kg = parseFloat(target);
    if (reminder) d.weigh_in_reminder_days = parseInt(reminder);
    if (notes)    d.notes = notes;
    var locId = document.getElementById('grp-create-loc') && document.getElementById('grp-create-loc').value;
    var created = await sbInsert('animal_groups', [d]);
    if (locId && created.length) {
      await sbInsert('group_location_history', [{
        group_id: created[0].id, location_id: parseInt(locId), from_date: todayISO()
      }]);
    }
    statusEl.textContent = 'Group created.'; statusEl.style.color = 'var(--green)';
    document.getElementById('grp-create-name').value = '';
    document.getElementById('grp-create-notes').value = '';
    document.getElementById('grp-create-target').value = '';
    anSharedLoaded = false;
    await loadGroupsPage();
  } catch(err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

