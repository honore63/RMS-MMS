// ============================================================================
// admin-subjects.js — Subject Management Module for RMS-MIS
// DOS/Admin can view, add, edit, activate/deactivate subjects.
// ============================================================================

let subjectsSearch   = '';
let subjectsStatus   = 'all';

function subjectLevelOptionsHtml(selected) {
  const opts = [
    ['Both', 'All Levels'],
    ['Primary', 'Primary (P1 - P6)'],
    ['Lower Secondary', 'Lower Secondary (S1 - S3)'],
    ['Upper Secondary', 'Upper Secondary (S4 - S6)'],
    ['Secondary', 'Secondary (S1 - S6)']
  ];
  const allowed = (typeof Scope !== 'undefined' && Scope.isScoped())
    ? (Scope.isPrimary() ? ['Both', 'Primary'] : ['Both', 'Lower Secondary', 'Upper Secondary', 'Secondary'])
    : opts.map(o => o[0]);
  return opts
    .filter(o => allowed.includes(o[0]))
    .map(([v, label]) => `<option value="${v}" ${selected === v || (!selected && v === 'Both') ? 'selected' : ''}>${label}</option>`)
    .join('');
}

// ---- Main Render ------------------------------------------------------------

async function renderSubjects() {
  setHeader('Subject Management', 'Manage Rwanda General Education subjects for all classes and levels');
  setContent(Utils.loading());

  const subjects = await DB.get('subjects');

  const totalActive   = subjects.filter(s => (s.status || 'active') === 'active').length;
  const totalInactive = subjects.filter(s => s.status === 'inactive').length;

  const filtered = subjects.filter(s => {
    const matchS  = !subjectsSearch || (s.name + ' ' + (s.code || '')).toLowerCase().includes(subjectsSearch.toLowerCase());
    const matchSt = subjectsStatus === 'all' || (s.status || 'active') === subjectsStatus;
    return matchS && matchSt;
  });

  // Sort: active first, then by name
  filtered.sort((a, b) => {
    if ((a.status || 'active') !== (b.status || 'active')) {
      return (a.status || 'active') === 'active' ? -1 : 1;
    }
    return (a.name || '').localeCompare(b.name || '');
  });

  const rows = filtered.map(s => {
    const st = s.status || 'active';
    return `<tr>
      <td class="col-name">
        <strong>${Utils.escapeHtml(s.name)}</strong>
        <div class="text-sm mt-1" style="color:var(--gray-500);font-weight:500">${Utils.escapeHtml(s.level || 'Both')}</div>
      </td>
      <td><code style="background:var(--gray-100);padding:2px 6px;border-radius:4px;font-size:12px">${Utils.escapeHtml(s.code || '-')}</code></td>
      <td><span class="badge ${Utils.statusColor(st)}"><i data-lucide="${Utils.statusIcon(st)}" style="width:12px;height:12px"></i> ${st}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick='subjectEdit(${JSON.stringify(s).replace(/'/g, "&#39;")})'><i data-lucide="pencil"></i> Edit</button>
        ${st === 'active'
          ? `<button class="btn btn-sm btn-danger" onclick="subjectToggle('${s.id}','inactive')"><i data-lucide="power"></i> Deactivate</button>`
          : `<button class="btn btn-sm btn-success" onclick="subjectToggle('${s.id}','active')"><i data-lucide="check-circle"></i> Activate</button>`}
        <button class="btn btn-sm btn-danger" onclick="subjectDelete('${s.id}','${Utils.escapeHtml(s.name)}')" title="Delete"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>`;
  }).join('');

  setContent(`
    <!-- Stats -->
    <div class="grid-3 mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="book-open"></i></div>
        <div class="stat-value">${subjects.length}</div>
        <div class="stat-label">Total Subjects</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="check-circle-2"></i></div>
        <div class="stat-value" style="color:var(--green-600)">${totalActive}</div>
        <div class="stat-label">Active Subjects</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--gray-100);color:var(--gray-500)"><i data-lucide="pause-circle"></i></div>
        <div class="stat-value" style="color:var(--gray-600)">${totalInactive}</div>
        <div class="stat-label">Inactive Subjects</div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${subjectsStatus === 'all' ? 'active' : ''}" onclick="subjectsStatus='all';renderSubjects()">All (${subjects.length})</button>
        <button class="tab-btn ${subjectsStatus === 'active' ? 'active' : ''}" onclick="subjectsStatus='active';renderSubjects()">Active (${totalActive})</button>
        <button class="tab-btn ${subjectsStatus === 'inactive' ? 'active' : ''}" onclick="subjectsStatus='inactive';renderSubjects()">Inactive (${totalInactive})</button>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="subjectSeedRwanda()"><i data-lucide="download"></i> Seed Rwanda Subjects</button>
        <button class="btn btn-primary" onclick="subjectForm()"><i data-lucide="plus"></i> Add Subject</button>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="filter-bar mb-4">
      <div class="search-input-wrapper" style="flex:1;min-width:220px">
        <i data-lucide="search"></i>
        <input type="text" class="input-field" placeholder="Search by subject name or code..."
          value="${Utils.escapeHtml(subjectsSearch)}"
          oninput="subjectsSearch=this.value;renderSubjects()">
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <h3><i data-lucide="book-open" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Subjects (${filtered.length})</h3>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Subject Name</th>
              <th>Code</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="4">${Utils.empty('No subjects found — click "Add Subject" or "Seed Rwanda Subjects"', 'book-open')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---- Add Form ---------------------------------------------------------------

function subjectForm() {
  Modal.show('Add New Subject', `
    <div class="form-group">
      <label>Subject Name <span class="required">*</span></label>
      <input id="sf-name" class="input-field" placeholder="e.g., Mathematics" oninput="subjectAutoCode()">
    </div>
    <div class="form-group">
      <label>Subject Code <span class="required">*</span></label>
      <input id="sf-code" class="input-field" placeholder="e.g., MATH" style="text-transform:uppercase"
        oninput="this.value=this.value.toUpperCase();this.dataset.userEdited='true'">
    </div>
    <div class="form-group">
      <label>Education Level Context</label>
      <select id="sf-level" class="select-field">
        ${subjectLevelOptionsHtml()}
      </select>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="sf-status" class="select-field">
        <option value="active" selected>Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="subjectSave()"><i data-lucide="save"></i> Save Subject</button>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function subjectAutoCode() {
  const nameEl = document.getElementById('sf-name');
  const codeEl = document.getElementById('sf-code');
  if (!codeEl || codeEl.dataset.userEdited === 'true') return;
  const name  = nameEl?.value?.trim() || '';
  // Build code from initials of major words
  const code  = name
    .split(/[\s\(\)&,]+/)
    .filter(w => w.length > 2)
    .map(w => w[0].toUpperCase())
    .join('').substring(0, 6);
  codeEl.value = code;
}

async function subjectSave() {
  const name   = document.getElementById('sf-name')?.value?.trim();
  const code   = document.getElementById('sf-code')?.value?.trim().toUpperCase();
  const level  = document.getElementById('sf-level')?.value || 'Both';
  const status = document.getElementById('sf-status')?.value || 'active';

  if (!name) return Utils.toast('Subject name is required', 'error');
  if (!code) return Utils.toast('Subject code is required', 'error');
  if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.matchesSubject({ level })) {
    return Utils.toast(`Subject level "${level}" is outside your ${Scope.label()} scope`, 'error');
  }

  try {
    // Duplicate check
    const existing = await DB.get('subjects');
    if (existing.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      return Utils.toast(`Subject "${name}" already exists`, 'error');
    }
    if (existing.some(s => (s.code || '').toUpperCase() === code)) {
      return Utils.toast(`A subject with code "${code}" already exists`, 'error');
    }

    await DB.insert('subjects', { name, code, level, status });
    Modal.close();
    Utils.toast('Subject added successfully', 'success');
    renderSubjects();
  } catch (e) {
    if (/duplicate|unique/i.test(e.message || '')) {
      Utils.toast(`Subject "${name}" or code "${code}" already exists`, 'error');
    } else {
      Utils.toast('Error adding subject: ' + e.message, 'error');
    }
  }
}

// ---- Edit Form --------------------------------------------------------------

function subjectEdit(s) {
  Modal.show('Edit Subject', `
    <div class="form-group">
      <label>Subject Name <span class="required">*</span></label>
      <input id="se-name" class="input-field" value="${Utils.escapeHtml(s.name || '')}">
    </div>
    <div class="form-group">
      <label>Subject Code <span class="required">*</span></label>
      <input id="se-code" class="input-field" value="${Utils.escapeHtml(s.code || '')}" style="text-transform:uppercase"
        oninput="this.value=this.value.toUpperCase()">
    </div>
    <div class="form-group">
      <label>Education Level Context</label>
      <select id="se-level" class="select-field">
        ${subjectLevelOptionsHtml(s.level)}
      </select>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="se-status" class="select-field">
        <option value="active" ${(s.status || 'active') === 'active' ? 'selected' : ''}>Active</option>
        <option value="inactive" ${s.status === 'inactive' ? 'selected' : ''}>Inactive</option>
      </select>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="subjectUpdate('${s.id}')"><i data-lucide="save"></i> Update Subject</button>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function subjectUpdate(id) {
  const name   = document.getElementById('se-name')?.value?.trim();
  const code   = document.getElementById('se-code')?.value?.trim().toUpperCase();
  const level  = document.getElementById('se-level')?.value || 'Both';
  const status = document.getElementById('se-status')?.value || 'active';

  if (!name) return Utils.toast('Subject name is required', 'error');
  if (!code) return Utils.toast('Subject code is required', 'error');
  if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.matchesSubject({ level })) {
    return Utils.toast(`Subject level "${level}" is outside your ${Scope.label()} scope`, 'error');
  }

  try {
    const existing = await DB.get('subjects');
    if (existing.some(s => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) {
      return Utils.toast(`Subject "${name}" already exists`, 'error');
    }
    if (existing.some(s => s.id !== id && (s.code || '').toUpperCase() === code)) {
      return Utils.toast(`Code "${code}" is already used by another subject`, 'error');
    }

    await DB.update('subjects', id, { name, code, level, status });
    Modal.close();
    Utils.toast('Subject updated', 'success');
    renderSubjects();
  } catch (e) {
    Utils.toast('Update error: ' + e.message, 'error');
  }
}

// ---- Toggle Status ----------------------------------------------------------

async function subjectToggle(id, newStatus) {
  try {
    await DB.update('subjects', id, { status: newStatus });
    Utils.toast(`Subject set to ${newStatus}`, 'success');
    renderSubjects();
  } catch (e) {
    Utils.toast('Status update failed: ' + e.message, 'error');
  }
}

// ---- Delete -----------------------------------------------------------------

async function subjectDelete(id, name) {
  // Guard: check if subject is in-use by teacher_assignments or assessments
  const [assignments, assessments] = await Promise.all([
    DB.query('teacher_assignments', '*', { subject_id: id }),
    DB.query('assessments', '*', { subject_id: id })
  ]);

  if (assignments.length > 0 || assessments.length > 0) {
    return Modal.show('Cannot Delete Subject', `
      <div class="alert alert-warning mb-4">
        <i data-lucide="alert-triangle"></i>
        Subject <strong>${Utils.escapeHtml(name)}</strong> cannot be deleted because it is linked to
        <strong>${assignments.length} teacher assignment(s)</strong> and
        <strong>${assessments.length} assessment(s)</strong>.
      </div>
      <p class="text-sm text-muted">You can set this subject to <strong>Inactive</strong> to hide it from new assignments without losing any historical data.</p>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>
       <button class="btn btn-danger" onclick="Modal.close();subjectToggle('${id}','inactive')"><i data-lucide="power"></i> Set Inactive Instead</button>`);
  }

  Modal.confirm('Delete Subject',
    `Permanently delete subject <strong>${Utils.escapeHtml(name)}</strong>? This cannot be undone.`,
    async () => {
      try {
        await DB.remove('subjects', id);
        Utils.toast('Subject deleted', 'success');
        renderSubjects();
      } catch (e) {
        Utils.toast('Delete error: ' + e.message, 'error');
      }
    });
}

// ---- Seed Rwanda Subjects ---------------------------------------------------

const RWANDA_SUBJECTS = [
  { name: 'Mathematics',                                     code: 'MATH'    },
  { name: 'English',                                         code: 'ENG'     },
  { name: 'Kinyarwanda',                                     code: 'KIN'     },
  { name: 'French',                                          code: 'FRE'     },
  { name: 'Kiswahili',                                       code: 'KISW'    },
  { name: 'Physics',                                         code: 'PHY'     },
  { name: 'Chemistry',                                       code: 'CHEM'    },
  { name: 'Biology and Health Sciences',                     code: 'BIO'     },
  { name: 'Geography and Environment',                       code: 'GEO'     },
  { name: 'History and Citizenship',                         code: 'HIST'    },
  { name: 'Entrepreneurship',                                code: 'ENT'     },
  { name: 'ICT',                                             code: 'ICT'     },
  { name: 'Computer Science',                                code: 'CS'      },
  { name: 'Economics',                                       code: 'ECON'    },
  { name: 'Psychology',                                      code: 'PSY'     },
  { name: 'Literature in English',                           code: 'LIT'     },
  { name: 'General Studies and Communication Skills (GSCS)', code: 'GSCS'    },
  { name: 'Subsidiary Mathematics',                          code: 'SUB_MATH'},
  { name: 'Religion and Ethics',                             code: 'REL_ETH' },
  { name: 'Religious Studies',                               code: 'REL_STU' },
  { name: 'Physical Education and Sports',                   code: 'PES'     },
  { name: 'Music, Dance and Drama',                          code: 'MDD'     },
  { name: 'Fine Arts and Crafts',                            code: 'FAC'     },
  { name: 'Home Sciences',                                   code: 'HS'      },
  { name: 'Farming (Agriculture and Animal Husbandry)',      code: 'FARM'    }
];

async function subjectSeedRwanda() {
  Modal.confirm('Seed Rwanda Subjects',
    `This will add all <strong>${RWANDA_SUBJECTS.length} Rwanda General Education subjects</strong> that are not already in the database. Existing subjects will NOT be modified or deleted.`,
    async () => {
      try {
        const existing = await DB.get('subjects');
        const existingNames = new Set(existing.map(s => s.name.toLowerCase()));
        const existingCodes = new Set(existing.map(s => (s.code || '').toUpperCase()));

        const toAdd = RWANDA_SUBJECTS.filter(s =>
          !existingNames.has(s.name.toLowerCase()) && !existingCodes.has(s.code.toUpperCase())
        );

        if (toAdd.length === 0) {
          return Utils.toast('All Rwanda subjects are already in the database!', 'success');
        }

        let added = 0;
        let skipped = 0;
        for (const subj of toAdd) {
          try {
            await DB.insert('subjects', { name: subj.name, code: subj.code, status: 'active' });
            added++;
          } catch (_) {
            skipped++;
          }
        }

        Utils.toast(`Done! ${added} subject(s) added${skipped > 0 ? `, ${skipped} skipped (already existed)` : ''}.`, 'success');
        renderSubjects();
      } catch (e) {
        Utils.toast('Seed error: ' + e.message, 'error');
      }
    });
}
