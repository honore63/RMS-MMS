let assessmentTypesCache = null;
let assessmentTypesSearch = '';
let assessmentTypesStatus = 'all';
let typeModalMode = 'add';

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
  try {
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
    const totalMax = types.reduce((s, t) => s + (t.default_maximum_mark || 0), 0);
    const filtered = ordered.filter(t => {
      const searchText = `${t.name || ''} ${t.code || ''} ${t.description || ''}`.toLowerCase();
      return (!assessmentTypesSearch || searchText.includes(assessmentTypesSearch.toLowerCase()))
        && (assessmentTypesStatus === 'all' || t.status === assessmentTypesStatus);
    });

    setContent(`
      <style>
        .at-page { display:grid; gap:24px; }
        .at-hero {
          background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%);
          border-radius: var(--radius-xl); padding: 32px; color: #fff;
          box-shadow: var(--shadow-lg); position: relative; overflow: hidden;
        }
        .at-hero::before {
          content: ''; position: absolute; top: -50%; right: -20%; width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(255,255,255,.08) 0%, transparent 70%);
          border-radius: 50%;
        }
        .at-hero h2 { margin: 0 0 6px; font-size: 24px; font-weight: 700; letter-spacing: -.02em; }
        .at-hero p { margin: 0; font-size: 14px; opacity: .85; max-width: 540px; line-height: 1.5; }
        .at-hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 28px; }
        .at-stat { background: rgba(255,255,255,.12); backdrop-filter: blur(10px); border-radius: var(--radius-lg); padding: 20px; text-align: center; border: 1px solid rgba(255,255,255,.1); }
        .at-stat-value { font-size: 32px; font-weight: 800; line-height: 1; }
        .at-stat-label { font-size: 12px; opacity: .75; margin-top: 6px; text-transform: uppercase; letter-spacing: .05em; }
        .at-toolbar {
          display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;
          background: #fff; border: 1px solid var(--gray-200); border-radius: var(--radius-lg);
          padding: 16px 20px; box-shadow: var(--shadow-sm);
        }
        .at-toolbar-left { display: flex; align-items: center; gap: 12px; flex: 1 1 300px; }
        .at-search { position: relative; flex: 1 1 280px; }
        .at-search i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--gray-400); width: 18px; height: 18px; }
        .at-search input { width: 100%; padding-left: 42px; }
        .at-filters { display: flex; gap: 8px; align-items: center; }
        .at-filter-btn {
          padding: 8px 16px; border-radius: var(--radius); border: 1px solid var(--gray-200);
          background: #fff; color: var(--gray-600); font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all var(--transition); font-family: var(--font-sans);
        }
        .at-filter-btn:hover { border-color: var(--blue-300); color: var(--blue-600); background: var(--blue-50); }
        .at-filter-btn.active { background: var(--blue-600); color: #fff; border-color: var(--blue-600); }
        .at-table-wrapper { background: #fff; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
        .at-table-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--gray-100); background: var(--gray-50); }
        .at-table-header h3 { font-size: 15px; font-weight: 600; color: var(--gray-800); margin: 0; }
        .at-table-header span { font-size: 13px; color: var(--gray-500); }
        .at-table { width: 100%; border-collapse: collapse; }
        .at-table thead { background: var(--gray-100); }
        .at-table th { padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-500); border-bottom: 1px solid var(--gray-200); }
        .at-table td { padding: 14px 16px; font-size: 14px; border-bottom: 1px solid var(--gray-100); vertical-align: middle; }
        .at-table tbody tr { transition: background var(--transition); }
        .at-table tbody tr:hover { background: var(--blue-50); }
        .at-table tbody tr:last-child td { border-bottom: none; }
        .at-type-name { display: flex; align-items: center; gap: 12px; }
        .at-type-icon { width: 40px; height: 40px; border-radius: var(--radius); display: grid; place-items: center; font-size: 16px; flex-shrink: 0; }
        .at-type-icon.blue { background: var(--blue-50); color: var(--blue-600); }
        .at-type-icon.green { background: var(--green-50); color: var(--green-600); }
        .at-type-icon.amber { background: var(--amber-50); color: var(--amber-600); }
        .at-type-name-text strong { display: block; font-size: 14px; font-weight: 600; color: var(--gray-800); }
        .at-type-name-text small { display: block; font-size: 12px; color: var(--gray-500); font-weight: 500; margin-top: 2px; }
        .at-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
        .at-badge.success { background: var(--green-50); color: var(--green-700); }
        .at-badge.warning { background: var(--amber-50); color: var(--amber-700); }
        .at-badge.neutral { background: var(--gray-100); color: var(--gray-600); }
        .at-action-btn {
          padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--gray-200);
          background: #fff; color: var(--gray-600); font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all var(--transition); display: inline-flex; align-items: center; gap: 5px;
          font-family: var(--font-sans);
        }
        .at-action-btn:hover { border-color: var(--blue-300); color: var(--blue-600); background: var(--blue-50); }
        .at-action-btn.primary { background: var(--blue-600); color: #fff; border-color: var(--blue-600); }
        .at-action-btn.primary:hover { background: var(--blue-700); }
        .at-action-btn.danger { color: var(--red-600); border-color: var(--red-200); }
        .at-action-btn.danger:hover { background: var(--red-50); border-color: var(--red-400); }
        .at-empty { padding: 60px 20px; text-align: center; color: var(--gray-400); }
        .at-empty i { margin-bottom: 12px; }
        .at-empty p { font-size: 14px; margin-top: 8px; }
        .at-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--gray-100); background: var(--gray-50); font-size: 13px; color: var(--gray-500); }

        /* Modal styles */
        .at-modal .modal-content { max-width: 560px; width: 90%; border-radius: var(--radius-xl); overflow: hidden; }
        .at-modal-header { background: linear-gradient(135deg, var(--blue-600), var(--blue-700)); padding: 24px; color: #fff; }
        .at-modal-header h3 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
        .at-modal-header p { font-size: 13px; opacity: .8; margin: 0; }
        .at-modal-body { padding: 24px; }
        .at-form-group { margin-bottom: 20px; }
        .at-form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--gray-700); margin-bottom: 6px; }
        .at-form-group label .req { color: var(--red-500); }
        .at-form-group input, .at-form-group select, .at-form-group textarea {
          width: 100%; padding: 10px 14px; border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-size: 14px; font-family: var(--font-sans); color: var(--gray-800);
          transition: border-color var(--transition); background: #fff;
        }
        .at-form-group input:focus, .at-form-group select:focus, .at-form-group textarea:focus {
          outline: none; border-color: var(--blue-500); box-shadow: 0 0 0 3px rgba(59,130,246,.1);
        }
        .at-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .at-form-actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 8px; }
        .at-btn { padding: 10px 24px; border-radius: var(--radius); border: none; font-size: 14px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); transition: all var(--transition); }
        .at-btn.secondary { background: var(--gray-100); color: var(--gray-600); }
        .at-btn.secondary:hover { background: var(--gray-200); }
        .at-btn.primary { background: var(--blue-600); color: #fff; }
        .at-btn.primary:hover { background: var(--blue-700); }
        .at-btn:disabled { opacity: .6; cursor: not-allowed; }
        .at-form-hint { font-size: 12px; color: var(--gray-400); margin-top: 4px; }

        /* Confirm modal */
        .at-confirm-body { padding: 24px; text-align: center; }
        .at-confirm-body .confirm-icon { width: 64px; height: 64px; border-radius: 50%; background: var(--red-50); color: var(--red-500); display: grid; place-items: center; margin: 0 auto 16px; }
        .at-confirm-body h4 { font-size: 16px; color: var(--gray-800); margin: 0 0 8px; }
        .at-confirm-body p { font-size: 14px; color: var(--gray-500); margin: 0 0 24px; }

        @media (max-width: 768px) {
          .at-hero-stats { grid-template-columns: repeat(2, 1fr); }
          .at-toolbar { flex-direction: column; align-items: stretch; }
          .at-toolbar-left { flex-direction: column; }
          .at-form-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 480px) {
          .at-hero-stats { grid-template-columns: 1fr; }
          .at-hero { padding: 20px; }
          .at-hero h2 { font-size: 20px; }
        }
      </style>

      <div class="at-page">
        <!-- Hero -->
        <div class="at-hero">
          <h2>Assessment Catalogue</h2>
          <p>Define the assessment categories used in mark entry, reporting, and combined results. Keep names, defaults, and weighting consistent across the school.</p>
          <div class="at-hero-stats">
            <div class="at-stat"><div class="at-stat-value">${types.length}</div><div class="at-stat-label">Total Types</div></div>
            <div class="at-stat"><div class="at-stat-value">${activeCount}</div><div class="at-stat-label">Active</div></div>
            <div class="at-stat"><div class="at-stat-value">${combinedCount}</div><div class="at-stat-label">In Combined</div></div>
            <div class="at-stat"><div class="at-stat-value">${inUseCount}</div><div class="at-stat-label">In Use</div></div>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="at-toolbar">
          <div class="at-toolbar-left">
            <div class="at-search">
              <i data-lucide="search"></i>
              <input id="at-search" type="search" placeholder="Search by name, code, or description..." value="${Utils.escapeHtml(assessmentTypesSearch)}">
            </div>
            <div class="at-filters">
              <button class="at-filter-btn ${assessmentTypesStatus === 'all' ? 'active' : ''}" data-status="all">All</button>
              <button class="at-filter-btn ${assessmentTypesStatus === 'active' ? 'active' : ''}" data-status="active">Active</button>
              <button class="at-filter-btn ${assessmentTypesStatus === 'inactive' ? 'active' : ''}" data-status="inactive">Inactive</button>
            </div>
          </div>
          <button class="at-action-btn primary" id="at-add-btn"><i data-lucide="plus"></i> Add Type</button>
        </div>

        <!-- Table -->
        <div class="at-table-wrapper">
          <div class="at-table-header">
            <h3>Configured Types</h3>
            <span>${filtered.length} of ${types.length} shown</span>
          </div>
          ${filtered.length === 0 ? `
            <div class="at-empty">
              <i data-lucide="inbox"></i>
              <p>No assessment types match your filters</p>
            </div>
          ` : `
          <table class="at-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th style="text-align:center">Default Max</th>
                <th style="text-align:center">Combined</th>
                <th style="text-align:center">In Use</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(t => {
                const isActive = t.status === 'active';
                const iconClass = isActive ? 'blue' : (used[t.id] ? 'green' : 'amber');
                const iconName = isActive ? 'check-circle' : (used[t.id] ? 'folder' : 'pause');
                return `<tr>
                  <td>
                    <div class="at-type-name">
                      <div class="at-type-icon ${iconClass}"><i data-lucide="${iconName}"></i></div>
                      <div class="at-type-name-text">
                        <strong>${Utils.escapeHtml(t.name)}</strong>
                        <small>${Utils.escapeHtml(t.code || '—')} &middot; ${Utils.escapeHtml(t.period_hint || '')}</small>
                      </div>
                    </div>
                  </td>
                  <td style="color:var(--gray-600);font-size:13px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.escapeHtml(t.description || '—')}</td>
                  <td style="text-align:center"><strong>${t.default_maximum_mark ?? '—'}</strong></td>
                  <td style="text-align:center">${t.contributes_to_combined ? '<span class="at-badge success">Yes</span>' : '<span class="at-badge neutral">No</span>'}</td>
                  <td style="text-align:center"><strong>${used[t.id] || 0}</strong></td>
                  <td><span class="at-badge ${isActive ? 'success' : 'neutral'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button class="at-action-btn" onclick="openTypeModal('${t.id}')" title="Edit"><i data-lucide="pencil"></i> Edit</button>
                    ${isActive
                      ? `<button class="at-action-btn" onclick="toggleTypeStatus('${t.id}','inactive')" title="Deactivate" style="color:var(--amber-600);border-color:var(--amber-200)"><i data-lucide="pause"></i> Deact</button>`
                      : `<button class="at-action-btn" onclick="toggleTypeStatus('${t.id}','active')" title="Activate" style="color:var(--green-600);border-color:var(--green-200)"><i data-lucide="play"></i> Activate</button>`
                    }
                    ${(used[t.id] || 0) > 0
                      ? `<button class="at-action-btn danger" disabled title="In use"><i data-lucide="lock"></i> In Use</button>`
                      : `<button class="at-action-btn danger" onclick="confirmDeleteType('${t.id}')" title="Delete"><i data-lucide="trash-2"></i> Delete</button>`
                    }
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="at-footer">
            <span>Showing ${filtered.length} of ${types.length} assessment types</span>
            <span>Total max marks: ${totalMax}</span>
          </div>
          `}
        </div>
      </div>
    `);

    // Event listeners
    document.getElementById('at-search')?.addEventListener('input', event => {
      assessmentTypesSearch = event.target.value.trim();
      renderAssessmentTypes();
    });
    document.querySelectorAll('[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        assessmentTypesStatus = btn.dataset.status;
        renderAssessmentTypes();
      });
    });
    document.getElementById('at-add-btn')?.addEventListener('click', () => openTypeModal());
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (error) {
    setContent(`
      <div class="at-page">
        <div class="at-hero" style="background:var(--red-50);color:var(--red-700)">
          <h2>Error Loading Assessment Types</h2>
          <p>${Utils.escapeHtml(error.message || 'Could not load assessment types from the database.')}</p>
        </div>
        <div style="text-align:center;padding:60px 20px;color:var(--gray-500)">
          <i data-lucide="alert-circle" style="width:48px;height:48px;margin-bottom:12px"></i>
          <p>Make sure the database migration has been run. Check the server console for details.</p>
          <p style="font-size:13px;margin-top:8px">Run <code>migration-rms-mis-assessment-types-rls-combined.sql</code> in Supabase SQL Editor.</p>
        </div>
      </div>
    `);
  }
}

// ---- Modal ----

async function openTypeModal(id) {
  typeModalMode = id ? 'edit' : 'add';
  const [types, assessments] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = id ? types.find(x => x.id === id) : null;
  const used = {};
  (assessments || []).forEach(a => { if (a.assessment_type_id) used[a.assessment_type_id] = (used[a.assessment_type_id] || 0) + 1; });

  const weightHelp = t && t.weight != null
    ? `Overrides the type weight (default: ${t.weight}).`
    : 'Optional. Combined reports use the weighted average.';

  const modalBody = typeModalMode === 'add' ? `
    <div class="at-form-group"><label>Type Name <span class="req">*</span></label><input id="atf-name" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="at-form-row">
      <div class="at-form-group"><label>Code <span class="req">*</span></label><input id="atf-code" placeholder="e.g., EOU" style="text-transform:uppercase"></div>
      <div class="at-form-group"><label>Default Max Mark</label><input id="atf-max" type="number" min="1" value="30"></div>
    </div>
    <div class="at-form-group"><label>Description</label><textarea id="atf-desc" rows="3" placeholder="Short description of this category" style="resize:vertical"></textarea></div>
    <div class="at-form-row">
      <div class="at-form-group"><label>Weight (optional)</label><input id="atf-weight" type="number" min="0" step="any" placeholder="blank = unweighted"></div>
      <div class="at-form-group"><label>Status</label><select id="atf-status"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
    </div>
    <div class="at-form-group"><label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="atf-combined" checked> Include in combined reports</label></div>
    <p class="at-form-hint">${weightHelp}</p>
  ` : `
    <div class="at-form-group"><label>Type Name <span class="req">*</span></label><input id="atf-name" value="${Utils.escapeHtml(t?.name || '')}" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="at-form-row">
      <div class="at-form-group"><label>Code <span class="req">*</span></label><input id="atf-code" value="${Utils.escapeHtml(t?.code || '')}" placeholder="e.g., EOU" style="text-transform:uppercase"></div>
      <div class="at-form-group"><label>Default Max Mark</label><input id="atf-max" type="number" min="1" value="${t?.default_maximum_mark ?? 30}"></div>
    </div>
    <div class="at-form-group"><label>Description</label><textarea id="atf-desc" rows="3" placeholder="Short description" style="resize:vertical">${Utils.escapeHtml(t?.description || '')}</textarea></div>
    <div class="at-form-row">
      <div class="at-form-group"><label>Weight (optional)</label><input id="atf-weight" type="number" min="0" step="any" value="${t?.weight != null ? t.weight : ''}" placeholder="blank = unweighted"></div>
      <div class="at-form-group"><label>Status</label><select id="atf-status"><option value="active" ${t?.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${t?.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    </div>
    <div class="at-form-group"><label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="atf-combined" ${t?.contributes_to_combined !== false ? 'checked' : ''}> Include in combined reports</label></div>
    <p class="at-form-hint">${weightHelp}</p>
    ${t && used[t.id] ? `<div style="background:var(--amber-50);border:1px solid var(--amber-200);border-radius:var(--radius);padding:12px;font-size:13px;color:var(--amber-700)"><i data-lucide="alert-triangle"></i> <strong>${used[t.id]} assessment(s)</strong> currently use this type. Editing the default max or weight only affects future assessments.</div>` : ''}
  `;

  const modalFooter = `<div class="at-form-actions">
    <button class="at-btn secondary" onclick="Modal.close()">Cancel</button>
    <button class="at-btn primary" id="at-save-btn"><i data-lucide="save"></i> ${typeModalMode === 'add' ? 'Create Type' : 'Save Changes'}</button>
  </div>`;

  Modal.show('', `
    <div class="at-modal-header">
      <h3>${typeModalMode === 'add' ? 'Add Assessment Type' : 'Edit ' + Utils.escapeHtml(t?.name || 'Assessment Type')}</h3>
      <p>${typeModalMode === 'add' ? 'Create a new assessment category' : 'Modify the assessment type settings'}</p>
    </div>
    <div class="at-modal-body">${modalBody}</div>
    ${modalFooter}
  `, null);

  document.getElementById('at-save-btn')?.addEventListener('click', () => saveType(id));
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function saveType(id) {
  const name = document.getElementById('atf-name').value.trim();
  const code = document.getElementById('atf-code').value.trim().toUpperCase();
  const d = {
    name, code,
    description: document.getElementById('atf-desc').value.trim() || null,
    default_maximum_mark: parseFloat(document.getElementById('atf-max').value) || 30,
    weight: document.getElementById('atf-weight').value.trim() === '' ? null : parseFloat(document.getElementById('atf-weight').value),
    contributes_to_combined: document.getElementById('atf-combined').checked,
    status: document.getElementById('atf-status').value
  };
  if (!d.name || !d.code) return Utils.toast('Name and code are required', 'error');

  const btn = document.getElementById('at-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;animation:spin 1s linear infinite"></i> Saving...'; }
  try {
    if (id) { await DB.update('assessment_types', id, d); Utils.toast('Assessment type updated', 'success'); }
    else { await DB.insert('assessment_types', d); Utils.toast('Assessment type created', 'success'); }
    assessmentTypesCache = null;
    Modal.close();
    renderAssessmentTypes();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = typeModalMode === 'add' ? '<i data-lucide="plus"></i> Create Type' : '<i data-lucide="save"></i> Save Changes'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
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

async function confirmDeleteType(id) {
  const [types] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = types.find(x => x.id === id);
  if (!t) return;

  Modal.show('', `
    <div class="at-confirm-body">
      <div class="confirm-icon"><i data-lucide="alert-triangle" style="width:32px;height:32px"></i></div>
      <h4>Delete "${Utils.escapeHtml(t.name)}"?</h4>
      <p>This cannot be undone. Any assessments using this type will keep working without it.</p>
      <div style="display:flex;justify-content:center;gap:12px">
        <button class="at-btn secondary" onclick="Modal.close()">Cancel</button>
        <button class="at-btn" style="background:var(--red-500);color:#fff" onclick="deleteType('${id}')">Delete</button>
      </div>
    </div>
  `, null);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function deleteType(id) {
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
