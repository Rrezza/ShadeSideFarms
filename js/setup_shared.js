// ============================================================
// setup_shared.js v17 — Delete helpers
// Must load after shared.js, before any setup_*.js page file
// ============================================================

// DELETE HELPERS
// ============================================================
// Hard delete with FK error handling.
// If record is referenced by other data, Supabase returns a 409/foreign key error.
// We catch that and tell the user to deactivate instead.

function fkErrMsg(name) {
  return '"' + name + '" is referenced by other records and cannot be deleted.\n\nUse the Active toggle to deactivate it instead — this hides it from dropdowns without removing the historical data.';
}

async function deleteIngredient(id, name) {
  if (!confirm('Delete ingredient "' + name + '"?\n\nThis cannot be undone. If this ingredient has purchase or feeding history, the delete will fail — deactivate it instead.')) return;
  try {
    await sbDelete('ingredients', id);
    await loadIngredients();
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function deleteFertilizer(id, name) {
  if (!confirm('Delete fertilizer "' + name + '"?\n\nIf this fertilizer has purchase or application history, the delete will fail — deactivate it instead.')) return;
  try {
    await sbDelete('fertilizers', id);
    await loadFertilizersPage();
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function deleteFertPurchase(id) {
  if (!confirm('Delete this purchase record? This cannot be undone.')) return;
  try {
    await sbDelete('fertilizer_purchases', id);
    await loadFertilizersPage();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function deleteSpecies(id, name) {
  if (!confirm('Delete species "' + name + '"?\n\nIf animals of this species exist, the delete will fail — do not delete species that are in active use.')) return;
  try {
    await sbDelete('species', id);
    await loadSpeciesPage();
    // Refresh the shared species cache so recipe and animal dropdowns stop offering the deleted species
    if (typeof loadSharedAnimalData === 'function' && anSharedLoaded) {
      sbGet('species', 'select=id,common_name,gestation_days,category&order=common_name').then(function(r) { anSharedSpecies = r; });
    }
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function deleteCrop(id, name) {
  if (!confirm('Delete crop "' + name + '"?\n\nIf this crop has active tracking records, the delete will fail — deactivate it instead.')) return;
  try {
    await sbDelete('crops', id);
    await loadCropsPage();
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function deleteWorker(id, name) {
  if (!confirm('Delete worker "' + name + '"?\n\nIf this worker is referenced in any logs or events, the delete will fail — deactivate them instead.')) return;
  try {
    await sbDelete('workers', id);
    await loadWorkersPage();
    // Refresh the shared workers cache so feeding/health/expense dropdowns stop offering the deleted worker
    if (typeof loadSharedAnimalData === 'function' && anSharedLoaded) {
      sbGet('workers', 'select=id,name&active=eq.true&order=name').then(function(r) { anSharedWorkers = r; });
    }
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function refreshSharedLocationCaches() {
  // Both anSharedPens (pen-only) and anSharedLocations (all active) are
  // derived from the locations table — a retire/reactivate/add can affect
  // either depending on the location's type, so refresh both together.
  if (typeof loadSharedAnimalData === 'function' && anSharedLoaded) {
    sbGet('locations', 'location_type=eq.pen&active=eq.true&select=id,name&order=name').then(function(r) { anSharedPens = r; });
    sbGet('locations', 'active=eq.true&select=id,name&order=name').then(function(r) { anSharedLocations = r; });
  }
}

async function retireLocation(id, name) {
  if (!confirm('Retire location "' + name + '"?\n\nIt will be moved to the retired section and removed from active dropdowns. Use Reactivate to reverse this.')) return;
  try {
    await sbPatch('locations', id, { active: false });
    await loadLocationsPage();
    refreshSharedLocationCaches();
  } catch (err) {
    alert('Retire failed: ' + err.message);
  }
}

async function reactivateLocation(id) {
  try {
    await sbPatch('locations', id, { active: true });
    await loadLocationsPage();
    refreshSharedLocationCaches();
  } catch (err) {
    alert('Reactivate failed: ' + err.message);
  }
}
