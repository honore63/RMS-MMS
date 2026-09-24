let assessmentTypesCache = null;
let assessmentTypesSearch = '';
let assessmentTypesStatus = 'all';

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
  const activeCount = types.filter(t => t.status === 'active').length;
  const combinedCount = types.filter(t => t.contributes_to_combined).length;
  const inUseCount = types.filter(t => used[t.id]).length;
  const filtered = ordered.filter(t => {
    const searchText = `${t.name || ''} ${t.code || ''} ${t.description || ''}`.toLowerCase();
    return (!assessmentTypesSearch || searchText.includes(assessmentTypesSearch.toLowerCase()))
      && (assessmentTypesStatus === 'all' || t.status === assessmentTypesStatus);
  });
  const rows = filtered.map(t => `
    <tr>
      <td data-label="Type"><div class="assessment-type-name"><span class="assessment-type-mark"><i data-lucide="file-check-2"></i></span><span><strong>${Utils.escapeHtml(t.name)}</strong><small>${Utils.escapeHtml(t.code || 'No code')}</small></span></div></td>
      <td data-label="Description" class="assessment-description">${Utils.escapeHtml(t.description || 'No description provided')}</td>
      <td data-label="Default maximum" class="text-center"><strong>${t.default_maximum_mark ?? '—'}</strong></td>
      <td data-label="Combined reports" class="text-center">${t.contributes_to_combined ? '<span class="status-pill success">Included</span>' : '<span class="status-pill neutral">Excluded</span>'}</td>
      <td data-label="In use" class="text-center"><span class="usage-count">${used[t.id] || 0}</span></td>
      <td data-label="Status"><span class="status-pill ${t.status === 'active' ? 'success' : 'neutral'}">${Utils.escapeHtml(t.status || 'inactive')}</span></td>
      <td data-label="Actions" class="col-actions">
        <button class="btn btn-sm btn-outline" onclick="openTypeModal('${t.id}')" title="Edit assessment type"><i data-lucide="pencil"></i><span>Edit</span></button>
        ${t.status === 'active'
          ? `<button class="btn btn-sm btn-warning" onclick="toggleTypeStatus('${t.id}','inactive')" title="Deactivate assessment type"><i data-lucide="pause-circle"></i><span>Deactivate</span></button>`
          : `<button class="btn btn-sm btn-success" onclick="toggleTypeStatus('${t.id}','active')" title="Activate assessment type"><i data-lucide="play-circle"></i><span>Activate</span></button>`}
        <button class="btn btn-sm ${(used[t.id]||0) > 0 ? 'btn-outline' : 'btn-danger'}" onclick="deleteType('${t.id}')" title="${(used[t.id]||0) > 0 ? 'In use — deactivate instead' : 'Delete type'}"><i data-lucide="trash-2"></i><span>${(used[t.id]||0) > 0 ? 'In use' : 'Delete'}</span></button>
      </td>
    </tr>`).join('');

  setContent(`
    <style>
      .assessment-types-page { display:grid; gap:20px; }
      .assessment-types-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding:24px; border:1px solid var(--gray-200); border-radius:var(--radius-lg); background:linear-gradient(135deg,#fff 0%,#f8fbff 100%); box-shadow:var(--shadow-sm); }
      .assessment-types-hero h2 { margin:0 0 6px; font-size:20px; color:var(--gray-900); }
      .assessment-types-hero p { max-width:680px; margin:0; color:var(--gray-600); font-size:13px; }
      .assessment-type-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
      .assessment-stat { display:flex; align-items:center; gap:12px; padding:16px; border:1px solid var(--gray-200); border-radius:var(--radius); background:#fff; box-shadow:var(--shadow-xs); }
      .assessment-stat-icon { width:36px; height:36px; display:grid; place-items:center; border-radius:10px; background:var(--blue-50); color:var(--blue-700); }
      .assessment-stat-icon i { width:18px; height:18px; }
      .assessment-stat strong { display:block; font-size:20px; line-height:1.1; color:var(--gray-900); }
      .assessment-stat span { display:block; margin-top:3px; color:var(--gray-500); font-size:11px; }
      .assessment-types-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border-bottom:1px solid var(--gray-200); }
      .assessment-types-filters { display:flex; gap:10px; align-items:center; flex:1 1 420px; }
      .assessment-search { position:relative; flex:1 1 260px; }
      .assessment-search i { position:absolute; top:50%; left:12px; width:16px; transform:translateY(-50%); color:var(--gray-400); }
      .assessment-search input { padding-left:36px; }
      .assessment-type-name { display:flex; align-items:center; gap:10px; min-width:170px; }
      .assessment-type-name strong, .assessment-type-name small { display:block; }
      .assessment-type-name small { margin-top:2px; color:var(--gray-500); font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
      .assessment-type-mark { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; background:var(--blue-50); color:var(--blue-700); flex:0 0 auto; }
      .assessment-type-mark i { width:16px; height:16px; }
      .assessment-description { max-width:260px; color:var(--gray-600); font-size:12px; }
      .status-pill { display:inline-flex; align-items:center; padding:4px 9px; border-radius:999px; font-size:11px; font-weight:600; text-transform:capitalize; }
      .status-pill.success { background:var(--green-50); color:var(--green-700); }
      .status-pill.neutral { background:var(--gray-100); color:var(--gray-600); }
      .weight-value, .usage-count { font-weight:700; color:var(--gray-800); }
      .assessment-types-table .data-table { min-width:920px; }
      @media (max-width:760px) {
        .assessment-types-hero { flex-direction:column; padding:18px; }
        .assessment-types-hero .btn { width:100%; }
        .assessment-type-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .assessment-types-filters { flex-direction:column; align-items:stretch; }
        .assessment-types-filters > * { width:100%; }
        .assessment-types-table .table-container { overflow:visible; }
        .assessment-types-table .data-table { display:block; min-width:0; }
        .assessment-types-table .data-table thead { display:none; }
        .assessment-types-table .data-table tbody, .assessment-types-table .data-table tr, .assessment-types-table .data-table td { display:block; width:100%; }
        .assessment-types-table .data-table tr { margin:12px 0; padding:8px 14px; border:1px solid var(--gray-200); border-radius:var(--radius); background:#fff; box-shadow:var(--shadow-xs); }
        .assessment-types-table .data-table tbody tr:first-child { margin-top:0; }
        .assessment-types-table .data-table tbody td { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:10px 0; text-align:right !important; border-bottom:1px solid var(--gray-100); }
        .assessment-types-table .data-table tbody td::before { content:attr(data-label); color:var(--gray-500); font-size:11px; font-weight:600; text-align:left; flex:0 0 38%; }
        .assessment-types-table .data-table tbody td:last-child { border-bottom:0; align-items:flex-start; }
        .assessment-types-table .assessment-type-name { text-align:left; justify-content:flex-end; }
        .assessment-types-table .assessment-description { max-width:none; }
        .assessment-types-table .col-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; }
        .assessment-types-table .col-actions::before { margin-top:7px; }
        .assessment-types-table .col-actions .btn { flex:1 1 110px; justify-content:center; }
      }
      @media (max-width:420px) { .assessment-type-stats { grid-template-columns:1fr; } .assessment-types-hero h2 { font-size:18px; } .assessment-types-table .data-table tbody td { align-items:flex-start; } .assessment-types-table .assessment-type-name { max-width:62%; } }
    </style>
    <div class="assessment-types-page">
      <section class="assessment-types-hero">
        <div><h2>Assessment catalogue</h2><p>Define the assessment categories used in mark entry, reporting and combined results. Keep names, defaults and weighting consistent across the school.</p></div>
        <button class="btn btn-primary" onclick="openTypeModal()"><i data-lucide="plus"></i> Add assessment type</button>
      </section>
      <section class="assessment-type-stats" aria-label="Assessment type summary">
        <div class="assessment-stat"><div class="assessment-stat-icon"><i data-lucide="layers-3"></i></div><div><strong>${types.length}</strong><span>Total types</span></div></div>
        <div class="assessment-stat"><div class="assessment-stat-icon" style="background:var(--green-50);color:var(--green-700)"><i data-lucide="circle-check"></i></div><div><strong>${activeCount}</strong><span>Active types</span></div></div>
        <div class="assessment-stat"><div class="assessment-stat-icon" style="background:var(--amber-50);color:var(--amber-600)"><i data-lucide="scale"></i></div><div><strong>${combinedCount}</strong><span>In combined reports</span></div></div>
        <div class="assessment-stat"><div class="assessment-stat-icon" style="background:var(--gray-100);color:var(--gray-700)"><i data-lucide="activity"></i></div><div><strong>${inUseCount}</strong><span>Currently in use</span></div></div>
      </section>
      <section class="card assessment-types-table">
        <div class="assessment-types-toolbar">
          <div><strong>Configured types</strong><div class="text-xs text-muted">${filtered.length} of ${types.length} types shown</div></div>
          <div class="assessment-types-filters">
            <div class="assessment-search"><i data-lucide="search"></i><input id="assessment-types-search" class="input-field" placeholder="Search by name, code or description" value="${Utils.escapeHtml(assessmentTypesSearch)}"></div>
            <select id="assessment-types-status" class="select-field"><option value="all">All statuses</option><option value="active" ${assessmentTypesStatus === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${assessmentTypesStatus === 'inactive' ? 'selected' : ''}>Inactive</option></select>
          </div>
        </div>
        <div class="table-container"><table class="data-table"><thead><tr><th>Type</th><th>Description</th><th>Default max</th><th>Combined</th><th>In use</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">${Utils.empty('No assessment types match your filters', 'file-text')}</td></tr>`}</tbody></table></div>
      </section>
    </div>`);

  document.getElementById('assessment-types-search')?.addEventListener('input', event => {
    assessmentTypesSearch = event.target.value.trim();
    renderAssessmentTypes();
  });
  document.getElementById('assessment-types-status')?.addEventListener('change', event => {
    assessmentTypesStatus = event.target.value;
    renderAssessmentTypes();
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
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