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

async function deleteTool(id, name) {
  if (!confirm('Delete tool "' + name + '"? This cannot be undone.')) return;
  try {
    await sbDelete('tools', id);
    await loadToolsPage();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

async function deleteSpecies(id, name) {
  if (!confirm('Delete species "' + name + '"?\n\nIf animals of this species exist, the delete will fail — do not delete species that are in active use.')) return;
  try {
    await sbDelete('species', id);
    await loadSpeciesPage();
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
  } catch (err) {
    alert(err.message.indexOf('foreign') >= 0 || err.message.indexOf('violates') >= 0
      ? fkErrMsg(name) : 'Delete failed: ' + err.message);
  }
}

async function retireLocation(id, name) {
  if (!confirm('Retire location "' + name + '"?\n\nIt will be moved to the retired section and removed from active dropdowns. Use Reactivate to reverse this.')) return;
  try {
    await sbPatch('locations', id, { active: false });
    await loadLocationsPage();
  } catch (err) {
    alert('Retire failed: ' + err.message);
  }
}

async function reactivateLocation(id) {
  try {
    await sbPatch('locations', id, { active: true });
    await loadLocationsPage();
  } catch (err) {
    alert('Reactivate failed: ' + err.message);
  }
}
