let assessmentTypesCache = null;

async function getAssessmentTypes(force = false) {
  if (Array.isArray(assessmentTypesCache) && !force) return assessmentTypesCache;
  try {
    assessmentTypesCache = (await DB.get('assessment_types')) || [];
  } catch (e) {
    assessmentTypesCache = assessmentTypesCache || [];
  }
  return assessmentTypesCache;
}

function assessmentTypeName(types, id, fallback) {
  const t = (types || []).find(x => x.id === id);
  return (t && t.name) || fallback || 'Assessment';
}

async function renderAssessmentTypes() {
  setHeader('Assessment Types', 'Configure the categories of assessments used across the school');
  setContent(Utils.loading());
  const [types, assessments] = await Promise.all([
    getAssessmentTypes(true),
    DB.get('assessments').catch(() => [])
  ]);
  const used = {};
  (assessments || []).forEach(a => {
    if (a.assessment_type_id) used[a.assessment_type_id] = (used[a.assessment_type_id] || 0) + 1;
  });

  const ordered = [...types].sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || a.name.localeCompare(b.name));
  const rows = ordered.map(t => `
    <tr>
      <td><div class="col-name">${Utils.escapeHtml(t.name)}</div><div class="text-xs text-muted">${Utils.escapeHtml(t.code || '')}</div></td>
      <td class="text-sm text-muted">${Utils.escapeHtml(t.description || '—')}</td>
      <td class="text-center">${t.default_maximum_mark ?? '—'}</td>
      <td class="text-center">${t.weight != null ? t.weight : '<span class="text-muted">—</span>'}</td>
      <td class="text-center">${t.contributes_to_combined ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
      <td class="text-center">${used[t.id] || 0}</td>
      <td><span class="badge ${t.status === 'active' ? 'badge-success' : 'badge-secondary'}">${t.status}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick="openTypeModal('${t.id}')"><i data-lucide="pencil"></i> Edit</button>
        ${t.status === 'active'
          ? `<button class="btn btn-sm btn-warning" onclick="toggleTypeStatus('${t.id}','inactive')"><i data-lucide="pause-circle"></i> Deactivate</button>`
          : `<button class="btn btn-sm btn-success" onclick="toggleTypeStatus('${t.id}','active')"><i data-lucide="play-circle"></i> Activate</button>`}
        <button class="btn btn-sm ${(used[t.id]||0) > 0 ? 'btn-outline' : 'btn-danger'}" onclick="deleteType('${t.id}')" title="${(used[t.id]||0) > 0 ? 'In use — deactivate instead' : 'Delete type'}"><i data-lucide="trash-2"></i> ${(used[t.id]||0) > 0 ? 'In use' : 'Delete'}</button>
      </td>
    </tr>`).join('');

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div>
        <p class="text-muted" style="max-width:640px">Assessment types are configurable categories (Quiz, Assignment, End-of-Unit Assessment, Terminal Examination, ...). They power mark entry, filtering, reporting titles and the optional weighting used in combined reports. The <strong>weight</strong> here is the default; a per-assessment weight overrides it.</p>
      </div>
      <button class="btn btn-primary" onclick="openTypeModal()"><i data-lucide="plus"></i> Add Assessment Type</button>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Type</th><th>Description</th><th>Default Max</th><th>Weight</th><th>Combined</th><th>In Use</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8">${Utils.empty('No assessment types', 'file-text')}</td></tr>`}</tbody></table></div></div>`);
}

async function openTypeModal(id) {
  const [types, assessments] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = types.find(x => x.id === id);
  const used = {};
  (assessments || []).forEach(a => { if (a.assessment_type_id) used[a.assessment_type_id] = (used[a.assessment_type_id] || 0) + 1; });

  const codesInUse = types.map(x => x.code).filter(Boolean);
  const weightHelp = t && t.weight != null
    ? `Overrides the type weight (type default: ${t.weight}). Combined reports use the weighted average only when every included assessment has a weight.`
    : 'Optional. When set (type or per-assessment), combined reports compute the weighted average across included assessments.';

  Modal.show(`${t ? 'Edit' : 'Add'} Assessment Type`, `
    <div class="form-group"><label>Name <span class="required">*</span></label><input id="atf-name" class="input-field" value="${t ? Utils.escapeHtml(t.name) : ''}" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="form-row">
      <div class="form-group"><label>Code <span class="required">*</span></label><input id="atf-code" class="input-field" value="${t ? Utils.escapeHtml(t.code || '') : ''}" placeholder="e.g., EOU" style="text-transform:uppercase"></div>
      <div class="form-group"><label>Default Maximum Mark</label><input id="atf-max" type="number" min="1" class="input-field" value="${t ? (t.default_maximum_mark ?? 30) : 30}"></div>
    </div>
    <div class="form-group"><label>Description</label><textarea id="atf-desc" class="textarea-field" placeholder="Short description of this category">${t ? Utils.escapeHtml(t.description || '') : ''}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Default Weight (optional)</label><input id="atf-weight" type="number" min="0" step="any" class="input-field" value="${t && t.weight != null ? t.weight : ''}" placeholder="blank = unweighted"></div>
      <div class="form-group"><label>Status</label><select id="atf-status" class="select-field"><option value="active" ${!t || t.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${t?.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>
    </div>
    <div class="form-group" style="margin-bottom:0"><label class="checkbox-label" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="atf-combined" ${!t || t.contributes_to_combined ? 'checked' : ''}> Include in combined reports</label></div>
    <p class="text-xs text-muted" style="margin-top:10px">${weightHelp}</p>
    ${t && used[t.id] ? `<p class="text-xs text-muted" style="margin-top:6px">In use by <strong>${used[t.id]}</strong> assessment(s). Changing the default max or weight only affects future assessments.</p>` : ''}`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="saveType(${t ? `'${t.id}'` : 'null'}, this)"><i data-lucide="save"></i> ${t ? 'Save Changes' : 'Create Type'}</button>`);
}

async function saveType(id, btn) {
  const name = document.getElementById('atf-name').value.trim();
  const code = document.getElementById('atf-code').value.trim().toUpperCase();
  const d = {
    name,
    code,
    description: document.getElementById('atf-desc').value.trim() || null,
    default_maximum_mark: parseFloat(document.getElementById('atf-max').value) || 30,
    weight: document.getElementById('atf-weight').value.trim() === '' ? null : parseFloat(document.getElementById('atf-weight').value),
    contributes_to_combined: document.getElementById('atf-combined').checked,
    status: document.getElementById('atf-status').value
  };
  if (!d.name || !d.code) return Utils.toast('Name and code are required', 'error');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }
  try {
    if (id) { await DB.update('assessment_types', id, d); Utils.toast('Assessment type updated', 'success'); }
    else { await DB.insert('assessment_types', d); Utils.toast('Assessment type created', 'success'); }
    assessmentTypesCache = null;
    Modal.close();
    renderAssessmentTypes();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> ' + (id ? 'Save Changes' : 'Create Type'); if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast('Error: ' + (e.message || 'Could not save'), 'error');
  }
}

async function toggleTypeStatus(id, status) {
  try {
    await DB.update('assessment_types', id, { status });
    assessmentTypesCache = null;
    Utils.toast('Type ' + (status === 'active' ? 'activated' : 'deactivated'), 'success');
    renderAssessmentTypes();
  } catch (e) { Utils.toast('Error: ' + (e.message || 'Could not update'), 'error'); }
}

async function deleteType(id) {
  const [types, assessments] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = types.find(x => x.id === id);
  const inUse = (assessments || []).filter(a => a.assessment_type_id === id).length;
  if (inUse > 0) return Utils.toast('Cannot delete: ' + inUse + ' assessment(s) use this type. Deactivate it instead.', 'error');
  if (!t) return;
  Modal.show('Delete Assessment Type', `
    <p class="text-sm text-muted mb-4">Delete <strong>${Utils.escapeHtml(t.name)}</strong> permanently? Assessments keep working without this category.</p>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmDeleteType('${id}')"><i data-lucide="trash-2"></i> Permanently Delete</button>`);
}

async function confirmDeleteType(id) {
  try {
    await DB.remove('assessment_types', id);
    assessmentTypesCache = null;
    Modal.close();
    Utils.toast('Assessment type deleted', 'success');
    renderAssessmentTypes();
  } catch (e) {
    Modal.close();
    Utils.toast('Delete failed: ' + (e.message || 'Type may be in use; deactivate instead'), 'error');
  }
}