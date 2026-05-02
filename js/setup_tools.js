// ============================================================
// setup_tools.js v17 — Tools page
// ============================================================

// TOOLS PAGE
// ============================================================
var toolData = [];

async function loadToolsPage() {
  document.getElementById('tool-table').innerHTML = '<div class="loading">Loading…</div>';
  try {
    toolData = await sbGet('tools', 'select=*&order=name');
    document.getElementById('tool-count').textContent =
      toolData.length + ' tool' + (toolData.length !== 1 ? 's' : '');
    var tbl = document.getElementById('tool-table');
    if (!toolData.length) {
      tbl.innerHTML = '<div class="empty">No tools yet. Click + Add tool.</div>';
      renderAbbrevKey('abbrev-tools', []);
      return;
    }
    var CONDITIONS = ['new','good','fair','needs_repair','retired'];
    var COND_BADGE = { new:'badge-green', good:'badge-lime', fair:'badge-amber', needs_repair:'badge-red', retired:'badge-gray' };
    var html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Name</th><th>Category</th><th>Purchase date</th><th>Condition</th><th>Active</th><th>Notes</th><th></th>' +
      '</tr></thead><tbody>';
    toolData.forEach(function(t) {
      var condOpts = CONDITIONS.map(function(c) {
        return '<option value="' + c + '"' + (t.condition === c ? ' selected' : '') + '>' + c + '</option>';
      }).join('');
      html += '<tr style="' + (!t.active ? 'opacity:0.5' : '') + '">' +
        '<td><input type="text" value="' + (t.name || '').replace(/"/g, '&quot;') + '" style="width:100%" onchange="patchTool(' + t.id + ',\'name\',this.value)"></td>' +
        '<td><input type="text" value="' + (t.category || '').replace(/"/g, '&quot;') + '" style="width:100%" placeholder="—" onchange="patchTool(' + t.id + ',\'category\',this.value||null)"></td>' +
        '<td><input type="date" value="' + (t.purchase_date || '') + '" onchange="patchTool(' + t.id + ',\'purchase_date\',this.value||null)"></td>' +
        '<td><select onchange="patchTool(' + t.id + ',\'condition\',this.value||null)"><option value="">—</option>' + condOpts + '</select></td>' +
        '<td style="text-align:center"><input type="checkbox" ' + (t.active ? 'checked' : '') + ' onchange="patchTool(' + t.id + ',\'active\',this.checked)"></td>' +
        '<td><input type="text" value="' + (t.notes || '').replace(/"/g, '&quot;') + '" style="width:100%;min-width:140px" placeholder="—" onchange="patchTool(' + t.id + ',\'notes\',this.value||null)"></td>' +
        '<td><button class="btn btn-sm del-btn" onclick="deleteTool(' + t.id + ',\'' + (t.name || '').replace(/'/g,"\\'") + '\')">Delete</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    tbl.innerHTML = html;
    renderAbbrevKey('abbrev-tools', []);
  } catch (err) {
    document.getElementById('tool-table').innerHTML =
      '<div class="loading" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

async function patchTool(id, field, value) {
  try {
    var d = {}; d[field] = value;
    await sbPatch('tools', id, d);
    var t = toolData.find(function(x) { return x.id === id; });
    if (t) t[field] = value;
  } catch (err) {
    alert('Update failed: ' + err.message);
    loadToolsPage();
  }
}

function openToolModal() {
  document.getElementById('tool-modal-title').textContent = 'Add tool';
  ['tool-name','tool-category','tool-notes'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('tool-purchase-date').value = todayISO();
  document.getElementById('tool-condition').value = 'good';
  document.getElementById('tool-modal-status').textContent = '';
  document.getElementById('tool-modal').style.display = 'flex';
}
function closeToolModal() { document.getElementById('tool-modal').style.display = 'none'; }
async function submitTool() {
  var statusEl = document.getElementById('tool-modal-status');
  statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)';
  try {
    var name = document.getElementById('tool-name').value.trim();
    if (!name) throw new Error('Name is required.');
    var d = { name: name, active: true };
    var cat = document.getElementById('tool-category').value.trim(); if (cat) d.category = cat;
    var pd  = document.getElementById('tool-purchase-date').value;   if (pd)  d.purchase_date = pd;
    var con = document.getElementById('tool-condition').value;       if (con) d.condition = con;
    var n   = document.getElementById('tool-notes').value.trim();    if (n)   d.notes = n;
    await sbInsert('tools', [d]);
    statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--green)';
    setTimeout(function() { closeToolModal(); loadToolsPage(); }, 800);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--red)';
  }
}

// ============================================================
