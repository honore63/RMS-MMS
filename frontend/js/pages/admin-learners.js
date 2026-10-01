let learnersSearch = '';
let learnersClass = 'all';
let learnersGender = 'all';
let learnersStatus = 'all';

function requireDosLearnerAccess() {
  if (Auth.getRole() === 'dos') return true;
  Utils.toast('Only DOS accounts can register or import learners', 'error');
  return false;
}

const importFlow = {
  fileName: '',
  fileSize: 0,
  headers: [],
  columnMap: null,
  missing: [],
  dataRows: [],
  records: [],
  classes: [],
  targetClassId: '',
  classMap: {},
  existingCodes: new Set(),
  counts: { total: 0, ready: 0, exists: 0, duplicate: 0, errors: 0 }
};

async function renderLearners() {
  if (!requireDosLearnerAccess()) {
    setHeader('Learner Management', 'Register and manage learners');
    setContent('<div class="alert alert-error">Only DOS accounts can access learner management.</div>');
    return;
  }
  setHeader('Learner Management', 'Register and manage learners individually or through bulk import');
  setContent(Utils.loading());
  const [data, allClasses] = await Promise.all([
    DB.query('learners', '*', {}, { column: 'full_name', asc: true }),
    DB.get('classes')
  ]);
  const classes = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.filterClasses(allClasses) : allClasses;
  const classIds = new Set(classes.map(c => String(c.id)));
  const visibleData = (typeof Scope !== 'undefined' && Scope.isScoped())
    ? data.filter(l => l.class_id && classIds.has(String(l.class_id)))
    : data;
  const filtered = visibleData.filter(l => {
    const matchS = !learnersSearch || (l.full_name + ' ' + l.learner_code).toLowerCase().includes(learnersSearch.toLowerCase());
    const matchC = learnersClass === 'all' || l.class_id === learnersClass;
    const matchG = learnersGender === 'all' || l.gender === learnersGender;
    const matchSt = learnersStatus === 'all' || l.status === learnersStatus;
    return matchS && matchC && matchG && matchSt;
  });
  const totalActive = visibleData.filter(l => l.status === 'active').length;
  const totalInactive = visibleData.filter(l => l.status === 'inactive').length;

  const rows = filtered.map(l => {
    const cls = classes.find(c => c.id === l.class_id);
    return `<tr>
      <td class="text-center" style="width:40px"><input type="checkbox" class="cb-learner" value="${l.id}" data-name="${Utils.escapeHtml(l.full_name)}" onchange="updateLearnerBulkBar()"></td>
      <td class="col-code">${Utils.escapeHtml(l.learner_code)}</td>
      <td class="col-name">${Utils.escapeHtml(l.full_name)}</td>
      <td>${l.gender === 'M' ? '<span class="badge badge-male">Male</span>' : l.gender === 'F' ? '<span class="badge badge-female">Female</span>' : '<span class="text-muted">—</span>'}</td>
      <td>${Utils.escapeHtml(cls?.name || '-')}</td>
      <td><span class="badge ${Utils.statusColor(l.status)}"><i data-lucide="${Utils.statusIcon(l.status)}"></i> ${l.status}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick='learnerView(${JSON.stringify(l).replace(/'/g, "&#39;")})'><i data-lucide="eye"></i></button>
        <button class="btn btn-sm btn-outline" onclick='learnerEdit(${JSON.stringify(l).replace(/'/g, "&#39;")})'><i data-lucide="pencil"></i></button>
        ${l.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="learnerDeactivate('${l.id}')" title="Deactivate"><i data-lucide="user-x"></i></button>` : `<button class="btn btn-sm btn-success" onclick="learnerActivate('${l.id}')" title="Activate"><i data-lucide="user-check"></i></button>`}
      </td></tr>`;
  }).join('');

  setContent(`
    <div class="grid-3 mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="users"></i></div>
        <div class="stat-value">${visibleData.length}</div>
        <div class="stat-label">Total Learners</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="user-check"></i></div>
        <div class="stat-value" style="color:var(--green-600)">${totalActive}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--red-50);color:var(--red-500)"><i data-lucide="user-x"></i></div>
        <div class="stat-value" style="color:var(--red-500)">${totalInactive}</div>
        <div class="stat-label">Inactive</div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${learnersStatus === 'all' ? 'active' : ''}" onclick="learnersStatus='all';renderLearners()">All</button>
        <button class="tab-btn ${learnersStatus === 'active' ? 'active' : ''}" onclick="learnersStatus='active';renderLearners()">Active</button>
        <button class="tab-btn ${learnersStatus === 'inactive' ? 'active' : ''}" onclick="learnersStatus='inactive';renderLearners()">Inactive</button>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="downloadTemplate()"><i data-lucide="download"></i> Download Template</button>
        <button class="btn btn-secondary" onclick="ImportSystem.open('students')"><i data-lucide="upload"></i> Import Learners</button>
        <button class="btn btn-secondary" onclick="learnerPromote()"><i data-lucide="arrow-right-left"></i> Promote</button>
        <button class="btn btn-primary" onclick="learnerForm()"><i data-lucide="user-plus"></i> Register Learner</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="search-input-wrapper" style="flex:1;min-width:220px">
        <i data-lucide="search"></i>
        <input type="text" class="input-field" placeholder="Search by student number or name..." value="${Utils.escapeHtml(learnersSearch)}" oninput="learnersSearch=this.value;renderLearners()">
      </div>
      <div class="form-group"><select class="select-field" onchange="learnersClass=this.value;renderLearners()">
        <option value="all">All Classes</option>
        ${classes.map(c => `<option value="${c.id}" ${learnersClass === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select></div>
      <div class="form-group"><select class="select-field" onchange="learnersGender=this.value;renderLearners()">
        <option value="all" ${learnersGender === 'all' ? 'selected' : ''}>All Genders</option>
        <option value="M" ${learnersGender === 'M' ? 'selected' : ''}>Male</option>
        <option value="F" ${learnersGender === 'F' ? 'selected' : ''}>Female</option>
      </select></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:12px">
        <h3><i data-lucide="users" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Learners (${filtered.length})</h3>
        <div class="flex gap-2" style="align-items:center">
          <span id="learner-bulk-count" class="text-sm text-muted" style="display:none"><strong id="learner-sel-count">0</strong> selected</span>
          <button class="btn btn-sm btn-danger" id="btn-learner-delete" disabled onclick="learnerDeleteSelected()"><i data-lucide="trash-2"></i> Delete Selected (<span id="btn-learner-delete-count">0</span>)</button>
        </div>
      </div>
      <div id="learner-bulk-bar" class="bulk-bar" style="display:none">
        <button class="btn btn-sm btn-secondary" onclick="learnerSelectAllList()"><i data-lucide="check-check"></i> Select All ${filtered.length > 0 ? `(${filtered.length})` : ''}</button>
        <p class="text-xs text-muted" style="margin:0"><i data-lucide="info"></i> Use the checkboxes or the class filter to pick which learners to select.</p>
      </div>
      <div class="table-container"><table class="data-table">
        <thead><tr>
          <th style="width:40px;text-align:center"><input type="checkbox" id="cb-learner-all" onchange="learnerSelectAllMaster(this)" title="Select all visible learners"></th>
          <th>Student Number</th><th>Name</th><th>Gender</th><th>Class</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="7">${Utils.empty('No learners found', 'users')}</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

async function learnerForm() {
  if (!requireDosLearnerAccess()) return;
  const [allClasses, years] = await Promise.all([DB.get('classes'), DB.get('academic_years')]);
  const classes = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.filterClasses(allClasses) : allClasses;
  const activeYear = (typeof getActiveYearId === 'function' ? years.find(y => y.id === getActiveYearId(years)) : null) || years.find(y => y.status === 'active') || null;
  Modal.show('Add Learner', `
    <div class="form-group">
      <label>Student Number (11 or 12 Digits) <span class="required">*</span></label>
      <input id="lf-code" class="input-field" placeholder="e.g., 54102325012 or 541023250123" maxlength="12">
      <p class="form-hint">Must be 11 or 12 digits and unique in the system.</p>
    </div>
    <div class="form-group">
      <label>Full Name <span class="required">*</span></label>
      <input id="lf-name" class="input-field" placeholder="e.g., UWASE Alice">
    </div>
    <div class="form-row">
      <div class="form-group"><label>Gender (Optional)</label>
        <select id="lf-gender" class="select-field">
          <option value="">Select (optional)</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>
        <p class="form-hint">Leave empty if unknown — it can be added later.</p>
      </div>
      <div class="form-group"><label>Class <span class="required">*</span></label>
        <select id="lf-class" class="select-field">
          <option value="">Select</option>
          ${classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Academic Year</label>
      <select id="lf-year" class="select-field">
        <option value="">Select</option>
        ${years.map(y => `<option value="${y.id}" ${activeYear?.id === y.id ? 'selected' : ''}>${Utils.escapeHtml(y.name)}${y.status === 'active' ? ' (Current)' : ''}</option>`).join('')}
      </select>
      <p class="form-hint">Optional. Defaults to the current academic year.</p>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="learnerSave()"><i data-lucide="save"></i> Add Learner</button>`);
}

async function learnerSave() {
  if (!requireDosLearnerAccess()) return;
  const code = document.getElementById('lf-code')?.value?.trim();
  const name = document.getElementById('lf-name')?.value?.trim();
  const gender = document.getElementById('lf-gender')?.value;
  const classId = document.getElementById('lf-class')?.value;
  const yearId = document.getElementById('lf-year')?.value || null;

  if (!code) return Utils.toast('Student number is required', 'error');
  if (!name) return Utils.toast('Full name is required', 'error');
  if (!classId) return Utils.toast('Class is required', 'error');
  if (!/^\d{11,12}$/.test(code)) return Utils.toast('Student number must be 11 or 12 digits', 'error');
  if (typeof Scope !== 'undefined' && Scope.isScoped()) {
    const selectedClass = (await DB.get('classes', { id: classId }))[0];
    if (!selectedClass || !Scope.matchesClass(selectedClass)) return Utils.toast('Selected class is outside your DOS scope', 'error');
  }

  try {
    const [roleCheck, classCheck] = await Promise.all([
      sbClient.rpc('rms_account_role'),
      sbClient.rpc('rms_account_can_class', { p_class_id: classId })
    ]);
    if (roleCheck.error || classCheck.error) throw roleCheck.error || classCheck.error;
    if (roleCheck.data !== 'dos') {
      return Utils.toast('Supabase does not recognize this session as an active DOS. Sign out and sign in again, then retry.', 'error');
    }
    if (!classCheck.data) {
      return Utils.toast('This class is outside your DOS level in Supabase. Check the class education level before registering the learner.', 'error');
    }

    const existing = await DB.query('learners', 'id', { learner_code: code });
    if (existing.length) {
      showStudentDuplicateMessage(code);
      return;
    }
    const { error } = await sbClient.from('learners').insert({
      learner_code: code,
      full_name: name.toUpperCase(),
      gender: gender || null,
      class_id: classId,
      academic_year_id: yearId,
      status: 'active'
    });
    if (error) throw error;
    DB.invalidate('learners');
    Modal.close();
    Utils.toast('Learner added successfully', 'success');
    renderLearners();
  } catch (e) {
    if (/duplicate key|unique|already exists|23505/i.test(e.message || '')) {
      showStudentDuplicateMessage(code);
      return;
    }
    if (/rms_account_learner_scope|row-level security policy/i.test(e.message || '')) {
      Utils.toast('Supabase blocked registration. Run backend/sql/database.sql in the Supabase SQL Editor and verify the class is within your DOS level.', 'error');
      return;
    }
    Utils.toast('Error: ' + e.message, 'error');
  }
}

function showStudentDuplicateMessage(code) {
  Modal.show('Student Already Registered', `
    <p class="text-sm mb-4">A learner with this student number already exists in the system.</p>
    <div class="alert alert-warning" style="margin-bottom:0"><i data-lucide="user-x"></i> <strong>Student Number:</strong> ${Utils.escapeHtml(code)}</div>`,
    `<button class="btn btn-primary" onclick="Modal.close()">OK</button>`);
}

async function learnerView(l) {
  const [classes, years] = await Promise.all([DB.get('classes'), DB.get('academic_years')]);
  const cls = classes.find(c => c.id === l.class_id);
  const yr = years.find(y => y.id === l.academic_year_id);
  Modal.show('Learner Details', `
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Student Number</p>
        <p class="text-sm font-semibold" style="letter-spacing:0.15px">${Utils.escapeHtml(l.learner_code)}</p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Full Name</p>
        <p class="text-sm font-semibold">${Utils.escapeHtml(l.full_name)}</p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Gender</p>
        <p>${l.gender === 'M' ? '<span class="badge badge-male">Male</span>' : l.gender === 'F' ? '<span class="badge badge-female">Female</span>' : '<span class="text-muted">Not specified</span>'}</p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Class</p>
        <p class="text-sm font-semibold">${Utils.escapeHtml(cls?.name || '-')}</p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Academic Year</p>
        <p class="text-sm font-semibold">${Utils.escapeHtml(yr?.name || '-')}</p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Status</p>
        <p><span class="badge ${Utils.statusColor(l.status)}"><i data-lucide="${Utils.statusIcon(l.status)}"></i> ${l.status}</span></p>
      </div>
      <div>
        <p class="text-xs text-muted" style="margin-bottom:2px">Registered</p>
        <p class="text-sm">${l.created_at ? Utils.dateTimeStr(l.created_at) : '-'}</p>
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>
     <button class="btn btn-primary" onclick="Modal.close();learnerEdit(${JSON.stringify(l).replace(/"/g, "&quot;").replace(/'/g, "&#39;")})"><i data-lucide="pencil"></i> Edit</button>`, true);
}

async function learnerEdit(l) {
  if (!requireDosLearnerAccess()) return;
  const [allClasses, years] = await Promise.all([DB.get('classes'), DB.get('academic_years')]);
  const classes = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.filterClasses(allClasses) : allClasses;
  Modal.show('Edit Learner', `
    <div class="form-group">
      <label>Student Number <span class="required">*</span></label>
      <input id="le-code" class="input-field" value="${Utils.escapeHtml(l.learner_code)}">
    </div>
    <div class="form-group">
      <label>Full Name <span class="required">*</span></label>
      <input id="le-name" class="input-field" value="${Utils.escapeHtml(l.full_name)}">
    </div>
    <div class="form-row">
      <div class="form-group"><label>Gender (Optional)</label>
        <select id="le-gender" class="select-field">
          <option value="" ${!l.gender ? 'selected' : ''}>Not specified</option>
          <option value="M" ${l.gender === 'M' ? 'selected' : ''}>Male</option>
          <option value="F" ${l.gender === 'F' ? 'selected' : ''}>Female</option>
        </select>
      </div>
      <div class="form-group"><label>Class <span class="required">*</span></label>
        <select id="le-class" class="select-field">
          ${classes.map(c => `<option value="${c.id}" ${l.class_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Academic Year</label>
      <select id="le-year" class="select-field">
        <option value="">Select</option>
        ${years.map(y => `<option value="${y.id}" ${l.academic_year_id === y.id ? 'selected' : ''}>${Utils.escapeHtml(y.name)}${y.status === 'active' ? ' (Current)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="le-status" class="select-field">
        <option value="active" ${l.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="inactive" ${l.status === 'inactive' ? 'selected' : ''}>Inactive</option>
      </select>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="learnerUpdate('${l.id}')"><i data-lucide="save"></i> Update</button>`);
}

async function learnerUpdate(id) {
  if (!requireDosLearnerAccess()) return;
  const code = document.getElementById('le-code')?.value?.trim();
  const name = document.getElementById('le-name')?.value?.trim();
  const gender = document.getElementById('le-gender')?.value;
  const classId = document.getElementById('le-class')?.value;
  const yearId = document.getElementById('le-year')?.value || null;
  const status = document.getElementById('le-status')?.value;
  if (!code || !name || !classId) return Utils.toast('Fill all required fields', 'error');
  if (!/^\d{11,12}$/.test(code)) return Utils.toast('Student number must be 11 or 12 digits', 'error');
  if (typeof Scope !== 'undefined' && Scope.isScoped()) {
    const selectedClass = (await DB.get('classes', { id: classId }))[0];
    if (!selectedClass || !Scope.matchesClass(selectedClass)) return Utils.toast('Selected class is outside your DOS scope', 'error');
  }
  try {
    await DB.update('learners', id, {
      learner_code: code,
      full_name: name.toUpperCase(),
      gender: gender || null,
      class_id: classId,
      academic_year_id: yearId,
      status
    });
    Modal.close();
    Utils.toast('Learner updated', 'success');
    renderLearners();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function learnerDeactivate(id) {
  Modal.show('Deactivate Learner', `
    <p class="text-sm text-muted">Are you sure you want to deactivate this learner? They will no longer appear in active class lists or assessments.</p>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmDeactivate('${id}')"><i data-lucide="user-x"></i> Deactivate</button>`);
}

async function confirmDeactivate(id) {
  try {
    await DB.update('learners', id, { status: 'inactive' });
    Modal.close();
    Utils.toast('Learner deactivated', 'success');
    renderLearners();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function learnerActivate(id) {
  DB.update('learners', id, { status: 'active' }).then(() => {
    Utils.toast('Learner activated', 'success');
    renderLearners();
  }).catch(e => Utils.toast('Error: ' + e.message, 'error'));
}

/* ============================================================
   PROMOTE LEARNERS TO THE NEXT ACADEMIC YEAR
   ============================================================ */

let _promoteLearners = [];
let _promoteClasses = [];
let _promoteAssignments = [];
let _promoteTerms = [];

function nextLevelClass(classId, classes) {
  const cur = classes.find(c => c.id === classId);
  if (!cur) return classId;
  const m = cur.level ? cur.level.match(/P([1-6])/) : null;
  const stream = cur.stream || '';
  if (!m || Number(m[1]) >= 6) return classId;
  const next = classes.find(c => c.level === 'P' + (Number(m[1]) + 1) && (c.stream || '') === stream);
  return next ? next.id : classId;
}

async function learnerPromote() {
  const [years, learners, classes, assignments, terms] = await Promise.all([
    DB.query('academic_years', '*', {}, { column: 'name' }),
    DB.get('learners'), DB.get('classes'), DB.get('teacher_assignments'), DB.get('terms')
  ]);
  if (years.length < 2) return Utils.toast('Create at least two academic years first', 'error');
  _promoteLearners = learners;
  _promoteClasses = classes;
  _promoteAssignments = assignments;
  _promoteTerms = terms;
  const srcId = getActiveYearId(years);
  const tgtId = years.find(y => y.id !== srcId && y.status !== 'archived')?.id || years.find(y => y.id !== srcId && !y.is_current)?.id || years.find(y => y.id !== srcId)?.id || '';
  const yearOpts = years.map(y => `<option value="${y.id}" ${y.id === srcId ? 'selected' : ''}>${Utils.escapeHtml(y.name)}${y.status === 'active' && y.is_current ? ' (Current)' : ''}</option>`).join('');
  const targetOpts = years.map(y => `<option value="${y.id}" ${y.id === tgtId ? 'selected' : ''}>${Utils.escapeHtml(y.name)}${y.status === 'active' && y.is_current ? ' (Current)' : ''}</option>`).join('');
  Modal.show('Promote Learners', `
    <p class="text-sm text-muted" style="margin-bottom:12px">Move active learners from one year to the next (e.g. when the school year ends). When the toggle is on, classes advance one level (P1→P2, …) wherever the target class exists. Teacher assignments are copied to the target year and default terms are created if the target year has none.</p>
    <div class="form-row">
      <div class="form-group"><label>From (source year) <span class="required">*</span></label><select id="pf-src" class="select-field" onchange="learnerPromotePreview()">${yearOpts}</select></div>
      <div class="form-group"><label>To (target year) <span class="required">*</span></label><select id="pf-tgt" class="select-field" onchange="learnerPromotePreview()">${targetOpts}</select></div>
    </div>
    <div class="form-group" style="margin-top:12px"><label class="check-label" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pf-advance" checked> Advance learners to the next class level</label></div>
    <div id="pf-preview" class="text-sm text-muted" style="margin-top:8px"></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="learnerPromoteRun()"><i data-lucide="arrow-right"></i> Promote</button>`);
  learnerPromotePreview();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function learnerPromotePreview() {
  const src = document.getElementById('pf-src')?.value;
  const tgt = document.getElementById('pf-tgt')?.value;
  const el = document.getElementById('pf-preview');
  if (!el) return;
  if (!src || !tgt) { el.textContent = 'Select both years.'; return; }
  if (src === tgt) { el.textContent = 'Source and target years must be different.'; return; }
  const count = _promoteLearners.filter(l => l.academic_year_id === src && l.status === 'active').length;
  const taCount = _promoteAssignments.filter(a => a.academic_year_id === src).length;
  el.innerHTML = `<strong>${count}</strong> active learner(s) will move and <strong>${taCount}</strong> teacher assignment(s) will be copied.`;
}

async function learnerPromoteRun() {
  const src = document.getElementById('pf-src')?.value;
  const tgt = document.getElementById('pf-tgt')?.value;
  const advance = document.getElementById('pf-advance')?.checked !== false;
  if (!src || !tgt) return Utils.toast('Choose a valid source and target year', 'error');
  if (src === tgt) return Utils.toast('Source and target years must be different', 'error');
  try {
    const toMove = _promoteLearners.filter(l => l.academic_year_id === src && l.status === 'active');
    await Promise.all(toMove.map(async l => {
      const newClass = advance ? nextLevelClass(l.class_id, _promoteClasses) : l.class_id;
      await DB.update('learners', l.id, { academic_year_id: tgt, class_id: newClass });
    }));
    const toCopy = _promoteAssignments.filter(a => a.academic_year_id === src);
    for (const a of toCopy) {
      await DB.insert('teacher_assignments', { teacher_id: a.teacher_id, class_id: a.class_id, subject_id: a.subject_id, academic_year_id: tgt });
    }
    if (!_promoteTerms.some(t => t.academic_year_id === tgt)) {
      const names = ['Term 1', 'Term 2', 'Term 3'];
      for (let i = 0; i < names.length; i++) {
        await DB.insert('terms', { name: names[i], academic_year_id: tgt, term_no: i + 1, is_active: i === 0 });
      }
    }
    invalidateHeaderYears();
    Utils.toast(toMove.length + ' learner(s) promoted to the new academic year', 'success');
    Modal.close();
    renderLearners();
  } catch (e) { Utils.toast('Promotion failed: ' + e.message, 'error'); }
}

/* ============================================================
   BULK SELECT & DELETE LEARNERS
   ============================================================ */

let pendingBulkDelete = [];

function learnerSelectAllMaster(master) {
  document.querySelectorAll('.cb-learner').forEach(cb => cb.checked = master.checked);
  updateLearnerBulkBar();
}

function learnerSelectAllList() {
  document.querySelectorAll('.cb-learner').forEach(cb => cb.checked = true);
  updateLearnerBulkBar();
}

function updateLearnerBulkBar() {
  const cbs = document.querySelectorAll('.cb-learner');
  const selected = [...cbs].filter(cb => cb.checked);
  const bar = document.getElementById('learner-bulk-bar');
  const countEl = document.getElementById('learner-sel-count');
  const bulkCount = document.getElementById('learner-bulk-count');
  const delBtn = document.getElementById('btn-learner-delete');
  const delCount = document.getElementById('btn-learner-delete-count');
  const master = document.getElementById('cb-learner-all');
  if (bar) bar.style.display = selected.length ? 'flex' : 'none';
  if (countEl) countEl.textContent = selected.length;
  if (bulkCount) bulkCount.style.display = selected.length ? 'inline' : 'none';
  if (delCount) delCount.textContent = selected.length;
  if (delBtn) delBtn.disabled = selected.length === 0;
  if (master) {
    master.checked = cbs.length > 0 && selected.length === cbs.length;
    master.indeterminate = selected.length > 0 && selected.length < cbs.length;
  }
}

function learnerDeleteSelected() {
  const cbs = [...document.querySelectorAll('.cb-learner:checked')];
  if (!cbs.length) return Utils.toast('No learners selected', 'error');
  const items = cbs.map(cb => ({ id: cb.value, name: cb.dataset.name || '' }));
  pendingBulkDelete = items;
  const shown = items.slice(0, 8).map(i => i.name).join(', ');
  const more = items.length > 8 ? ` +${items.length - 8} more` : '';
  Modal.show('Delete Learners', `
    <p class="text-sm text-muted mb-4">Are you sure you want to permanently delete <strong>${items.length}</strong> learner${items.length !== 1 ? 's' : ''}?</p>
    <div class="alert alert-danger" style="margin-bottom:16px"><i data-lucide="alert-triangle"></i> This will also permanently delete their assessment marks and results. This action cannot be undone.</div>
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:12px 16px;font-size:13px;color:var(--gray-700)">${Utils.escapeHtml(shown)}${more ? `<span class="text-muted">${more}</span>` : ''}</div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="learnerDeleteConfirm()"><i data-lucide="trash-2"></i> Permanently Delete (${items.length})</button>`, true);
}

async function learnerDeleteConfirm() {
  const items = pendingBulkDelete;
  if (!items.length) return;
  const ids = items.map(i => i.id);
  try {
    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const { error } = await sbClient.from('learners').delete().in('id', ids.slice(i, i + batchSize));
      if (error) throw error;
    }
    DB.invalidate('learners');
    await DB.insert('audit_logs', {
      user_id: Auth.currentUser?.id,
      user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role,
      action: 'delete_learners',
      new_value: 'Deleted ' + ids.length + ' learner(s): ' + items.map(i => i.name).join(', ').slice(0, 200),
      timestamp: new Date().toISOString()
    });
    pendingBulkDelete = [];
    Modal.close();
    Utils.toast(ids.length + ' learner' + (ids.length !== 1 ? 's' : '') + ' deleted', 'success');
    renderLearners();
  } catch (e) {
    Utils.toast('Delete error: ' + e.message, 'error');
  }
}

/* ============================================================
   IMPORT LEARNERS
   ============================================================ */

function resetImportFlow() {
  importFlow.fileName = '';
  importFlow.fileSize = 0;
  importFlow.headers = [];
  importFlow.columnMap = null;
  importFlow.missing = [];
  importFlow.dataRows = [];
  importFlow.records = [];
  importFlow.classes = [];
  importFlow.targetClassId = '';
  importFlow.classMap = {};
  importFlow.existingCodes = new Set();
  importFlow.counts = { total: 0, ready: 0, exists: 0, duplicate: 0, errors: 0 };
}

function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function importStepHtml(current) {
  const steps = ['Upload', 'Validate', 'Preview', 'Import'];
  return `<div class="import-steps">
    ${steps.map((s, i) => {
      const n = i + 1;
      const cls = n < current ? 'done' : n === current ? 'active' : '';
      return `<span class="import-step ${cls}">
        <span class="step-num">${n < current ? '<i data-lucide="check"></i>' : n}</span>${s}
      </span>${n < steps.length ? '<span class="import-step-sep"></span>' : ''}`;
    }).join('')}
  </div>`;
}

async function openImportModal() {
  if (!requireDosLearnerAccess()) return;
  if (typeof Scope !== 'undefined' && Scope.isDos()) {
    const level = (Auth.currentUser?.education_level || '').toUpperCase();
    if (level !== 'PRIMARY' && level !== 'SECONDARY') {
      Utils.toast('Your DOS account has no valid education level set. Ask an administrator to assign one before importing learners.', 'error');
      return;
    }
  }
  resetImportFlow();
  const allImportClasses = await DB.get('classes');
  importFlow.classes = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.filterClasses(allImportClasses) : allImportClasses;
  const body = `
    ${importStepHtml(1)}
    <div class="form-group">
      <label for="import-target-class">Import learners into <span class="required">*</span></label>
      <select id="import-target-class" class="select-field" onchange="setImportTargetClass(this.value)">
        <option value="">Choose a class</option>
        ${importFlow.classes.map(c => `<option value="${Utils.escapeHtml(c.id)}">${Utils.escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>
    <p class="text-sm text-muted mb-4">Upload the school Excel learner list. The system finds the <strong>Student Code</strong> and <strong>Names</strong> columns, even when the sheet has school details above the table.</p>
    <div class="dropzone" id="import-dropzone">
      <div class="dz-icon"><i data-lucide="file-spreadsheet"></i></div>
      <h4>Drag &amp; drop your learner list here</h4>
      <p>or click to browse files</p>
      <div class="dz-formats"><span>.xlsx</span><span>.xls</span><span>.csv</span></div>
    </div>
    <input type="file" id="import-file" accept=".xlsx,.xls,.csv,.txt" style="display:none">
    <div id="import-preview"></div>`;
  Modal.show('Import Learners', body, '', true);
  bindImportDropzone();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function setImportTargetClass(classId) {
  if (!requireDosLearnerAccess()) return;
  importFlow.targetClassId = classId;
  if (!importFlow.headers.length) return;
  await validateImportRows();
  renderImportPreview();
}

function bindImportDropzone() {
  const dz = document.getElementById('import-dropzone');
  const input = document.getElementById('import-file');
  if (!dz || !input) return;
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleImportFile(input.files[0]));
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files?.length) handleImportFile(files[0]);
  });
}

async function handleImportFile(file) {
  if (!requireDosLearnerAccess()) return;
  const previewDiv = document.getElementById('import-preview');
  if (!file) return;

  if (!file.name.match(/\.(xlsx|xls|csv|txt)$/i)) {
    previewDiv.innerHTML = '<div class="alert alert-error"><i data-lucide="alert-circle"></i> Unsupported file type. Please upload an Excel (.xlsx, .xls) or CSV file.</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  importFlow.fileName = file.name;
  importFlow.fileSize = file.size;

  previewDiv.innerHTML = `
    <div class="file-card">
      <div class="file-icon"><i data-lucide="file-spreadsheet"></i></div>
      <div class="file-meta">
        <div class="file-name">${Utils.escapeHtml(file.name)}</div>
        <div class="file-detail">${formatFileSize(file.size)} <span id="import-file-count"></span></div>
      </div>
      <button class="btn-remove" onclick="removeImportFile()"><i data-lucide="x"></i> Remove</button>
    </div>
    <div class="alert alert-info"><i data-lucide="loader"></i> Parsing and validating file...</div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const parsed = await readImportFile(file);
    importFlow.headers = parsed.headers;
    importFlow.dataRows = parsed.rows;

    await validateImportRows();
    renderImportPreview();
  } catch (e) {
    previewDiv.innerHTML = `<div class="alert alert-error"><i data-lucide="alert-circle"></i> Could not read the file: ${Utils.escapeHtml(e.message || 'Unknown error')}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function removeImportFile() {
  resetImportFlow();
  const dz = document.getElementById('import-dropzone');
  if (dz) dz.style.display = '';
  const previewDiv = document.getElementById('import-preview');
  if (previewDiv) previewDiv.innerHTML = '';
  const input = document.getElementById('import-file');
  if (input) input.value = '';
}

function readImportFile(file) {
  return new Promise((resolve, reject) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      if (typeof XLSX === 'undefined') {
        reject(new Error('Excel import library is not loaded. Check your internet connection and reload the page.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const textRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
          const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
          resolve(buildSheetRows(textRows, rawRows));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Could not read the Excel file.'));
      reader.readAsArrayBuffer(file);
    } else {
      file.text().then(text => resolve(parseCSV(text))).catch(() => reject(new Error('Could not read the CSV file.')));
    }
  });
}

function buildSheetRows(textRows, rawRows) {
  if (!textRows.length) return { headers: [], rows: [] };
  let headerIndex = textRows.findIndex(row => {
    const map = mapImportColumns(row || []);
    return map.student_number != null && map.student_name != null;
  });
  if (headerIndex < 0) headerIndex = 0;
  const headers = (textRows[headerIndex] || []).map(h => String(h ?? '').trim());
  const width = headers.length;
  const rows = [];
  for (let r = headerIndex + 1; r < textRows.length; r++) {
    const tr = textRows[r] || [];
    const rr = rawRows[r] || [];
    const row = [];
    for (let c = 0; c < width; c++) {
      row.push(cellText(rr[c], tr[c]));
    }
    if (row.every(v => v === '')) continue;
    rows.push(row);
  }
  return { headers, rows };
}

function cellText(raw, text) {
  const t = String(text == null ? '' : text).trim();
  if (typeof raw === 'number') {
    if (!t || /^\d+(\.0+)?$/.test(t) && String(raw).length > t.length || /[eE]/.test(t)) {
      if (Number.isSafeInteger(raw)) return String(raw);
    }
  }
  return t;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const parseRow = line => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  };
  const parsedRows = lines.map(parseRow);
  let headerIndex = parsedRows.findIndex(row => {
    const map = mapImportColumns(row);
    return map.student_number != null && map.student_name != null;
  });
  if (headerIndex < 0) headerIndex = 0;
  const headers = parsedRows[headerIndex];
  const rows = parsedRows.slice(headerIndex + 1);
  return { headers, rows };
}

function normalizeHeader(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapImportColumns(headers) {
  const map = { student_number: null, student_name: null, gender: null, class: null };
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (!n) return;
    if (map.student_number == null && /^(studentnumber|studentcode|studentno|learnernumber|learnercode|admissionnumber|admissionno|regnumber|indexno|nationalid|sn)$/.test(n)) map.student_number = i;
    else if (map.student_name == null && /^(studentname|studentnames|fullname|fullnames|learnername|names|name|student)$/.test(n)) map.student_name = i;
    else if (map.gender == null && /^(gender|sex)$/.test(n)) map.gender = i;
    else if (map.class == null && /^(class|classname|classroom|section|classname)$/.test(n)) map.class = i;
  });
  return map;
}

function convertGender(raw) {
  const g = String(raw || '').trim().toUpperCase();
  if (g === 'M' || g === 'MALE') return 'M';
  if (g === 'F' || g === 'FEMALE') return 'F';
  return String(raw || '').trim();
}

async function validateImportRows() {
  const map = mapImportColumns(importFlow.headers);
  importFlow.columnMap = map;

  // Student code and name come from the file; the selected class is the destination.
  const required = [
    ['student_number', 'Student Code'],
    ['student_name', 'Names']
  ];
  importFlow.missing = required.filter(([key]) => map[key] == null).map(([, label]) => label);
  if (!importFlow.classes.some(c => String(c.id) === String(importFlow.targetClassId))) {
    importFlow.missing.push('destination class');
  }

  if (importFlow.missing.length) {
    importFlow.records = [];
    importFlow.counts = { total: 0, ready: 0, exists: 0, duplicate: 0, errors: 0 };
    return;
  }

  const targetClass = importFlow.classes.find(c => String(c.id) === String(importFlow.targetClassId));

  const { data: existing } = await sbClient.from('learners').select('learner_code');
  importFlow.existingCodes = new Set((existing || []).map(l => String(l.learner_code || '').trim().toUpperCase()));

  const seen = new Set();
  const records = [];

  for (let i = 0; i < importFlow.dataRows.length; i++) {
    const row = importFlow.dataRows[i];
    const rowNumber = i + 2;

    const learnerCode = String(row[map.student_number] ?? '').trim();
    const fullName = String(row[map.student_name] ?? '').trim();
    const genderRaw = map.gender == null ? '' : convertGender(row[map.gender]);
    const classId = importFlow.targetClassId;
    const codeKey = learnerCode.toUpperCase();

    const errors = [];

    if (!learnerCode) {
      errors.push({ column: 'student_number', message: 'Missing student number', fix: 'Add the student number from the school list.' });
    }
    if (!fullName) {
      errors.push({ column: 'student_name', message: 'Missing student name', fix: 'Add the learner\u2019s full name.' });
    }
    if (!genderRaw) {
      errors.push({ column: 'gender', message: 'Missing gender', fix: 'Add MALE or FEMALE (or M/F) for this learner.' });
    } else if (genderRaw !== 'M' && genderRaw !== 'F') {
      errors.push({ column: 'gender', message: 'Invalid gender. Expected MALE or FEMALE.', fix: 'Change the cell to MALE or FEMALE (or M/F).' });
    }
    if (learnerCode && importFlow.existingCodes.has(codeKey)) {
      errors.push({ column: 'student_number', message: 'Student number already exists.', fix: 'This learner is already registered in RMS. No action needed.' });
    }
    if (learnerCode && !errors.some(e => e.message === 'Student number already exists.') && seen.has(codeKey)) {
      errors.push({ column: 'student_number', message: 'Duplicate student number in uploaded file.', fix: 'Keep one row per student number and remove the duplicate row.' });
    }

    if (learnerCode && !errors.length) seen.add(codeKey);

    const hasErrors = errors.length > 0;
    let status = 'ready';
    if (hasErrors) {
      status = errors.some(e => e.message === 'Student number already exists.') ? 'exists' :
               errors.some(e => e.message === 'Duplicate student number in uploaded file.') ? 'duplicate' : 'error';
    }

    records.push({
      rowNumber,
      learner_code: learnerCode,
      full_name: fullName,
      gender: genderRaw || null,
      class_id: classId,
      classDisplay: targetClass?.name || '',
      status,
      errors
    });
  }

  importFlow.records = records;
  importFlow.counts = {
    total: records.length,
    ready: records.filter(r => r.status === 'ready').length,
    exists: records.filter(r => r.status === 'exists').length,
    duplicate: records.filter(r => r.status === 'duplicate').length,
    errors: records.filter(r => r.status === 'error').length
  };
}

function renderImportPreview() {
  const previewDiv = document.getElementById('import-preview');
  if (!previewDiv) return;
  const dz = document.getElementById('import-dropzone');
  if (dz) dz.style.display = 'none';

  const { missing } = importFlow;
  if (missing.length) {
    const missingColumns = missing.filter(m => m !== 'destination class');
    const needsClass = missing.includes('destination class');
    if (dz) dz.style.display = '';
    previewDiv.innerHTML = `
      <div class="alert alert-error"><i data-lucide="alert-circle"></i> ${missingColumns.length ? 'This file is missing required columns.' : 'Choose a destination class before importing.'}</div>
      <div style="margin-bottom:16px">
        ${missingColumns.map(m => `<div class="form-error" style="margin-top:6px">Required column missing: <strong>${m}</strong></div>`).join('')}
        ${needsClass ? '<div class="form-error" style="margin-top:6px">Select the class above where these learners should be added.</div>' : ''}
      </div>
      <p class="text-sm text-muted mb-4">The file must contain <strong>Student Code</strong> and <strong>Names</strong> columns. Gender is optional; the destination class is selected above.</p>
      <div class="import-progress"><button class="btn btn-secondary" onclick="downloadTemplate()"><i data-lucide="download"></i> Download Template</button></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  if (!importFlow.dataRows.length) {
    if (dz) dz.style.display = '';
    previewDiv.innerHTML = '<div class="alert alert-error"><i data-lucide="alert-circle"></i> The file is empty or has no data rows.</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const c = importFlow.counts;
  const rowsHtml = importFlow.records.map(r => {
    const clsArr = importFlow.classes.find(cl => cl.id === r.class_id);
    let genderBadge;
    if (r.gender === 'M') genderBadge = '<span class="badge badge-male">M</span>';
    else if (r.gender === 'F') genderBadge = '<span class="badge badge-female">F</span>';
    else genderBadge = `<span class="badge badge-danger" title="${Utils.escapeHtml(r.errors.find(e => e.column === 'gender')?.message || 'Invalid gender')}">${Utils.escapeHtml(r.gender || '?')}</span>`;

    let statusBadge;
    if (r.status === 'ready') statusBadge = '<span class="import-badge import-badge-ready"><i data-lucide="check"></i> Ready</span>';
    else if (r.status === 'duplicate') statusBadge = '<span class="import-badge import-badge-dup"><i data-lucide="copy"></i> Duplicate</span>';
    else if (r.status === 'exists') statusBadge = '<span class="import-badge import-badge-exists"><i data-lucide="user-check"></i> Already Exists</span>';
    else statusBadge = '<span class="import-badge import-badge-error"><i data-lucide="alert-triangle"></i> Error</span>';

    const classCell = r.class_id ? Utils.escapeHtml(clsArr?.name || r.classDisplay) :
      `<span class="badge badge-danger">${Utils.escapeHtml(r.classDisplay)}</span>`;

    return `<tr class="${r.status === 'error' ? 'table-highlight' : ''}">
      <td class="text-muted text-center">${r.rowNumber}</td>
      <td class="col-code">${Utils.escapeHtml(r.learner_code || '-')}</td>
      <td class="col-name">${Utils.escapeHtml(r.full_name || '-')}</td>
      <td>${genderBadge}</td>
      <td>${classCell}</td>
      <td>${statusBadge}</td>
      <td class="text-sm">${r.errors.map(e => `<span class="badge badge-danger" style="margin:1px;font-size:10px">${Utils.escapeHtml(e.message)}</span>`).join('') || '<span class="text-xs text-muted">—</span>'}</td>
    </tr>`;
  }).join('');

  const alerts = [];
  if (c.ready) alerts.push(`<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> ${c.ready} learners ready to import</div>`);
  if (c.exists) alerts.push(`<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="info"></i> ${c.exists} learners already exist</div>`);
  if (c.duplicate) alerts.push(`<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="copy"></i> ${c.duplicate} duplicate student number${c.duplicate !== 1 ? 's' : ''} in uploaded file</div>`);
  if (c.errors) alerts.push(`<div class="alert alert-error" style="margin-bottom:6px"><i data-lucide="alert-triangle"></i> ${c.errors} invalid record${c.errors !== 1 ? 's' : ''} (check error badges)</div>`);
  if (!alerts.length) alerts.push('<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> All rows are valid and ready to import</div>');

  const footer = `
    <div class="mt-4" style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--gray-200);flex-wrap:wrap">
      <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
      ${c.errors ? `<button class="btn btn-warning" onclick="renderImportErrors()"><i data-lucide="file-warning"></i> View Errors (${c.errors})</button>` : ''}
      ${c.ready ? `<button class="btn btn-primary" onclick="confirmImport()"><i data-lucide="upload"></i> Import ${c.ready} Valid Learner${c.ready !== 1 ? 's' : ''}</button>` : ''}
    </div>`;

  previewDiv.innerHTML = `
    ${importStepHtml(3)}
    <div class="file-card">
      <div class="file-icon"><i data-lucide="file-spreadsheet"></i></div>
      <div class="file-meta">
        <div class="file-name">${Utils.escapeHtml(importFlow.fileName)}</div>
        <div class="file-detail">${formatFileSize(importFlow.fileSize)} | ${c.total} records</div>
      </div>
      <button class="btn-remove" onclick="removeImportFile()"><i data-lucide="x"></i> Replace File</button>
    </div>
    ${alerts.join('')}
    <div class="import-stats">
      <div class="import-stat"><div class="is-value">${c.total}</div><div class="is-label">Total Records</div></div>
      <div class="import-stat is-green"><div class="is-value">${c.ready}</div><div class="is-label">New Learners</div></div>
      <div class="import-stat is-blue"><div class="is-value">${c.exists}</div><div class="is-label">Already Existing</div></div>
      <div class="import-stat is-amber"><div class="is-value">${c.duplicate}</div><div class="is-label">Duplicates</div></div>
      <div class="import-stat ${c.errors ? 'is-red' : ''}"><div class="is-value">${c.errors}</div><div class="is-label">Errors</div></div>
    </div>
    <div style="max-height:280px;overflow:auto;border:1px solid var(--gray-200);border-radius:var(--radius)">
      <table class="data-table" style="font-size:12px">
        <thead><tr><th style="width:44px">No.</th><th>Student Number</th><th>Student Name</th><th>Gender</th><th>Class</th><th>Status</th><th style="width:120px">Notes</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" class="text-center text-muted">No data rows to show</td></tr>`}</tbody>
      </table>
    </div>
    <p class="form-hint" style="margin-top:8px"><i data-lucide="info"></i> Only <strong>Ready</strong> rows will be imported. Nothing is saved until you confirm.</p>
    ${footer}`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderImportErrors() {
  const previewDiv = document.getElementById('import-preview');
  if (!previewDiv) return;
  const errorRecords = importFlow.records.filter(r => r.errors.length);
  if (!errorRecords.length) return;
  const items = errorRecords.map(r => `
    <div class="import-error-item">
      <div class="ie-row">Row ${r.rowNumber}</div>
      <div class="ie-code">${Utils.escapeHtml(r.learner_code || '(no student number)')}</div>
      ${r.errors.map(e => `
        <div class="ie-problem"><strong>Problem:</strong> ${Utils.escapeHtml(e.message)}</div>
        <div class="ie-fix"><strong>Fix:</strong> ${Utils.escapeHtml(e.fix)}</div>`).join('')}
    </div>`).join('');
  previewDiv.innerHTML = `
    <div class="alert alert-error mb-4"><i data-lucide="file-warning"></i> ${errorRecords.length} record${errorRecords.length !== 1 ? 's' : ''} need attention before importing.</div>
    <div class="import-errors-list">${items}</div>
    <p class="form-hint mt-4"><i data-lucide="alert-triangle"></i> Invalid records will not be imported. Fix them in your file and re-upload, or use <strong>Register Learner</strong> for a single learner.</p>
    <div class="mt-4" style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--gray-200)">
      <button class="btn btn-primary" onclick="renderImportPreview()"><i data-lucide="arrow-left"></i> Back to Preview</button>
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function confirmImport() {
  if (!requireDosLearnerAccess()) return;
  const count = importFlow.counts.ready;
  if (!count) return Utils.toast('No valid new learners to import', 'error');
  Modal.show('Confirm Import',
    `<p style="font-size:15px;color:var(--gray-800)">Import <strong>${count}</strong> learner${count !== 1 ? 's' : ''} into RMS?</p>
     <p class="text-sm text-muted" style="margin-top:6px;margin-bottom:16px">Only valid new learner records will be added. Existing and invalid records are skipped.</p>
     <div class="alert alert-info" style="margin-bottom:0"><i data-lucide="info"></i> Duplicates, existing students and invalid rows will be skipped automatically.</div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="executeImport()"><i data-lucide="upload"></i> Confirm Import</button>`);
}

async function executeImport() {
  if (!requireDosLearnerAccess()) return;
  const readyRows = importFlow.records.filter(r => r.status === 'ready');
  if (!readyRows.length) return Utils.toast('No valid learners to import', 'error');

  Modal.show('Import Learners', `
    ${importStepHtml(4)}
    <div class="import-progress">
      <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
      <span class="ip-text" id="import-progress-text">Importing 0 / ${readyRows.length}...</span>
    </div>
    <div class="progress-bar"><div class="progress-bar-fill" id="import-progress-bar" style="width:0%"></div></div>`, '', true);

  let imported = 0;
  try {
    const activeYears = await DB.get('academic_years');
    const activeYearId = (typeof getActiveYearId === 'function' ? getActiveYearId(activeYears) : (activeYears.find(y => y.status === 'active')?.id || null)) || null;

    const batchSize = 50;
    for (let i = 0; i < readyRows.length; i += batchSize) {
      const batch = readyRows.slice(i, i + batchSize).map(r => ({
        learner_code: r.learner_code,
        full_name: r.full_name.toUpperCase(),
        gender: r.gender,
        class_id: r.class_id,
        academic_year_id: activeYearId,
        status: 'active'
      }));
      const { data, error } = await sbClient.from('learners')
        .upsert(batch, { onConflict: 'learner_code', ignoreDuplicates: true })
        .select('id, learner_code');
      if (error) throw error;
      imported += (data || []).length;
      const pct = Math.round((imported / readyRows.length) * 100);
      const txt = document.getElementById('import-progress-text');
      const bar = document.getElementById('import-progress-bar');
      if (txt) txt.textContent = `Importing ${imported} / ${readyRows.length}...`;
      if (bar) bar.style.width = pct + '%';
    }
    DB.invalidate('learners');

    await DB.insert('audit_logs', {
      user_id: Auth.currentUser?.id,
      user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role,
      action: 'import_learners',
      new_value: `Imported ${imported} learners from ${importFlow.fileName}`,
      timestamp: new Date().toISOString()
    });

    renderImportResult(imported);
    renderLearners();
  } catch (e) {
    Modal.close();
    const msg = (e.message || '').includes('rms_account_learner_scope')
      ? 'Import blocked by security policy. Your DOS account may not have an education level assigned, or the selected class is outside your scope.'
      : e.message;
    Utils.toast('Import error: ' + msg, 'error');
  }
}

function renderImportResult(imported) {
  const c = importFlow.counts;

  const resultBody = `
    <div class="text-center mb-4">
      <div style="width:56px;height:56px;margin:0 auto 12px;border-radius:50%;background:var(--green-50);color:var(--green-600);display:flex;align-items:center;justify-content:center"><i data-lucide="check-circle-2" style="width:28px;height:28px"></i></div>
      <h2 style="font-size:20px;font-weight:800;color:var(--gray-900)">Import Completed</h2>
      <p class="text-sm text-muted">${Utils.escapeHtml(importFlow.fileName)} &bull; ${c.total} records processed</p>
    </div>
    <div class="import-stats">
      <div class="import-stat is-green"><div class="is-value">${imported}</div><div class="is-label">Successfully Imported</div></div>
      <div class="import-stat is-blue"><div class="is-value">${c.exists}</div><div class="is-label">Already Existed</div></div>
      <div class="import-stat is-amber"><div class="is-value">${c.duplicate + c.errors}</div><div class="is-label">Invalid / Skipped</div></div>
    </div>
    <div style="margin-top:12px">
      ${imported ? `<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> ${imported} learner${imported !== 1 ? 's' : ''} successfully imported.</div>` : ''}
      ${c.exists ? `<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="info"></i> ${c.exists} record${c.exists !== 1 ? 's' : ''} skipped because they already exist.</div>` : ''}
      ${c.duplicate ? `<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="copy"></i> ${c.duplicate} duplicate record${c.duplicate !== 1 ? 's' : ''} skipped.</div>` : ''}
      ${c.errors ? `<div class="alert alert-error" style="margin-bottom:6px"><i data-lucide="alert-triangle"></i> ${c.errors} invalid record${c.errors !== 1 ? 's' : ''} was not imported.</div>` : ''}
    </div>`;

  Modal.show('Import Learners', `
    ${importStepHtml(4)}
    ${resultBody}`,
    `<button class="btn btn-secondary" onclick="openImportModal()"><i data-lucide="upload"></i> Import Another File</button>
     <button class="btn btn-primary" onclick="Modal.close();renderLearners()"><i data-lucide="users"></i> View Learners</button>`, true);
}

function downloadTemplate() {
  if (typeof XLSX !== 'undefined') {
    try {
      const wsData = [
        ['STUDENT LIST'],
        [],
        ['School:', 'Rukara Model School'],
        ['Grade:', ''],
        ['Combination:', ''],
        ['Class:', 'Select the destination class in RMS'],
        [],
        ['#', 'Student Code', 'Names'],
        [1, '541023260055', 'AGIRANEZA GIFT WILSON (EXAMPLE)'],
        [2, '541204230125', 'AMIZERO ANITHA (EXAMPLE)']
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 36 }];
      const instr = XLSX.utils.aoa_to_sheet([
        ['RMS LEARNER IMPORT TEMPLATE'],
        [],
        ['1. Fill in one row per learner under the table headings:'],
        ['   # | Student Code | Names'],
        [],
        ['2. Student Code: keep the code exactly as shown on the school list.'],
        ['   Leading zeros are preserved (e.g. 000123456789 stays 000123456789).'],
        [],
        ['3. Names: enter the learner full name.'],
        [],
        ['4. Choose the destination class in the RMS import form.'],
        ['   Every learner in this file will be added to that class.'],
        [],
        ['5. IMPORTANT: the two rows marked (EXAMPLE) in the Learners sheet are samples.'],
        ['   DELETE them before importing your real learner list.'],
        [],
        ['6. Save as .xlsx or .csv and upload via "Import Learners".']
      ]);
      instr['!cols'] = [{ wch: 70 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Learners');
      XLSX.utils.book_append_sheet(wb, instr, 'Instructions');
      XLSX.writeFile(wb, 'RMS_Learner_Import_Template.xlsx');
      Utils.toast('Template downloaded', 'success');
      return;
    } catch (e) { /* fall through to CSV */ }
  }
  const csv = 'STUDENT LIST\n\nSchool:,Rukara Model School\nGrade:,\nCombination:,\nClass:,Select the destination class in RMS\n\n#,Student Code,Names\n1,541023260055,AGIRANEZA GIFT WILSON (EXAMPLE)\n2,541204230125,AMIZERO ANITHA (EXAMPLE)\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'RMS_Learner_Import_Template.csv';
  a.click();
  URL.revokeObjectURL(url);
  Utils.toast('Template downloaded', 'success');
}