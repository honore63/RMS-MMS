let teachersSearch = '';
let teachersStatusFilter = 'all';
let teachersDepartmentFilter = 'all';
let teachersClassFilter = 'all';
let teachersSubjectFilter = 'all';

function teacherLevelBadge(levels) {
  if (!levels || levels.size === 0) return '<span class="badge badge-gray">Unassigned</span>';
  return Array.from(levels).map(l =>
    `<span class="badge ${l === 'Primary' ? 'badge-success' : 'badge-info'}">${Utils.escapeHtml(l)}</span>`
  ).join(' ');
}

function getTeacherScopeCategories() {
  if (Scope.isPrimary()) return ['Primary'];
  if (Scope.isSecondary()) return ['Lower Secondary', 'Upper Secondary'];
  return ['Primary', 'Lower Secondary', 'Upper Secondary'];
}

function teacherMatchesScope(classRecord) {
  if (!classRecord) return false;
  if (!Scope.isScoped()) return true;
  const cat = EducationLevels.getCategory(classRecord);
  return getTeacherScopeCategories().includes(cat);
}

function teacherSummaryProfile(t, teacherMeta = {}) {
  const photoURL = t.profile_photo_url || t.photo_url || t.avatar_url || '';
  const avatar = photoURL
    ? `<img src="${Utils.escapeHtml(photoURL)}" alt="${Utils.escapeHtml(t.full_name || 'Teacher photo')}">`
    : `<div class="teacher-avatar-placeholder">${Utils.escapeHtml((t.full_name || 'T').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase() || 'T')}</div>`;

  const classTags = (teacherMeta.classNames || []).length
    ? teacherMeta.classNames.map(name => `<span class="teacher-chip">${Utils.escapeHtml(name)}</span>`).join('')
    : '<span class="teacher-chip muted">No classes yet</span>';

  const subjectTags = (teacherMeta.subjectNames || []).length
    ? teacherMeta.subjectNames.map(name => `<span class="teacher-chip accent">${Utils.escapeHtml(name)}</span>`).join('')
    : '<span class="teacher-chip muted">No subjects yet</span>';

  const levels = (teacherMeta.levels || []).length
    ? Array.from(new Set(teacherMeta.levels)).map(level => `<span class="teacher-badge ${level === 'Primary' ? 'success' : 'info'}">${Utils.escapeHtml(level)}</span>`).join('')
    : '<span class="teacher-badge neutral">Unassigned</span>';

  const statusClass = (t.status || 'active') === 'active' ? 'success' : 'secondary';
  const statusText = (t.status || 'active') === 'active' ? 'Active' : 'Inactive';

  return `
    <article class="teacher-card" data-teacher-id="${Utils.escapeHtml(String(t.id))}">
      <div class="teacher-card-header">
        <div class="teacher-avatar-wrap">${avatar}</div>
        <div class="teacher-meta">
          <h3>${Utils.escapeHtml(t.full_name || 'Unnamed Teacher')}</h3>
          <div class="teacher-code">${Utils.escapeHtml(t.teacher_code || '—')}</div>
          <span class="teacher-status ${statusClass}"><i data-lucide="${(t.status || 'active') === 'active' ? 'check-circle' : 'circle'}" style="width:12px;height:12px"></i> ${statusText}</span>
        </div>
      </div>

      <div class="teacher-card-body">
        <div class="teacher-academic-box">
          <div class="teacher-section-header">
            <span>Education Level</span>
          </div>
          <div class="teacher-badges">${levels}</div>

          <div class="teacher-section-header">
            <span>Classes Teaching</span>
          </div>
          <div class="teacher-tags">${classTags}</div>

          <div class="teacher-section-header">
            <span>Subjects</span>
          </div>
          <div class="teacher-tags">${subjectTags}</div>
        </div>
      </div>

      <div class="teacher-card-actions">
        <button class="btn btn-sm btn-secondary teacher-view-btn" data-action="teacher-view" data-id="${Utils.escapeHtml(String(t.id))}" title="View more teacher details" aria-label="View more teacher details"><i data-lucide="eye"></i> View more</button>
        <button class="btn btn-sm btn-outline" data-action="teacher-edit" data-id="${Utils.escapeHtml(String(t.id))}"><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn-sm btn-secondary" data-action="teacher-assignments" data-id="${Utils.escapeHtml(String(t.id))}"><i data-lucide="link"></i> Manage Assignments</button>
      </div>
    </article>
  `;
}

async function renderTeachers() {
  setHeader('Teachers', 'View and manage teacher profiles for the authorized education level');
  setContent(Utils.loading());

  let teachers;
  let assignments;
  let classes;
  let subjects;
  try {
    [teachers, assignments, classes, subjects] = await Promise.all([
      DB.query('teachers', '*', {}, { column: 'full_name' }, null, { cache: false }),
      DB.query('teacher_assignments', '*'),
      DB.get('classes'),
      DB.get('subjects')
    ]);
  } catch (e) {
    console.error('TEACHER LIST ERROR:', e);
    setContent(`<div class="alert alert-danger"><strong>Teachers could not be loaded.</strong><br>${Utils.escapeHtml(e.message || 'Database request failed')}</div>`);
    return;
  }

  const classMap = new Map((classes || []).map(c => [String(c.id), c]));
  const subjectMap = new Map((subjects || []).map(s => [String(s.id), s]));

  const teacherMeta = new Map();
  (assignments || []).forEach(a => {
    const classRecord = classMap.get(String(a.class_id));
    if (!classRecord || !teacherMatchesScope(classRecord)) return;
    const teacherId = String(a.teacher_id);
    if (!teacherMeta.has(teacherId)) {
      teacherMeta.set(teacherId, { classNames: new Set(), subjectNames: new Set(), levels: new Set() });
    }
    const meta = teacherMeta.get(teacherId);
    const name = classRecord.name || classRecord.level || `Class ${classRecord.id}`;
    meta.classNames.add(name);
    meta.levels.add(EducationLevels.getCategory(classRecord));

    if (a.subject_id) {
      const subjectRecord = subjectMap.get(String(a.subject_id));
      if (subjectRecord) meta.subjectNames.add(subjectRecord.name || 'Subject');
    }
  });

  // RLS determines which teacher records the DOS may read. Keep unassigned
  // teachers visible so a newly registered teacher can be assigned next.
  const allowedTeachers = teachers || [];

  const filtered = allowedTeachers.filter(t => {
    const meta = teacherMeta.get(String(t.id)) || { classNames: new Set(), subjectNames: new Set(), levels: new Set() };
    const searchText = `${t.full_name || ''} ${t.teacher_code || ''} ${t.email || ''} ${t.phone || ''} ${Array.from(meta.classNames).join(' ')} ${Array.from(meta.subjectNames).join(' ')} ${t.department || ''}`.toLowerCase();
    const matchesSearch = !teachersSearch || searchText.includes(teachersSearch.toLowerCase());
    const matchesStatus = teachersStatusFilter === 'all' || String(t.status || 'active') === teachersStatusFilter;
    const matchesDepartment = teachersDepartmentFilter === 'all' || (t.department || '').toLowerCase() === teachersDepartmentFilter.toLowerCase();
    const matchesClass = teachersClassFilter === 'all' || Array.from(meta.classNames).some(name => name.toLowerCase().includes(teachersClassFilter.toLowerCase()));
    const matchesSubject = teachersSubjectFilter === 'all' || Array.from(meta.subjectNames).some(name => name.toLowerCase().includes(teachersSubjectFilter.toLowerCase()));
    return matchesSearch && matchesStatus && matchesDepartment && matchesClass && matchesSubject;
  });

  const departmentOptions = Array.from(new Set((teachers || []).map(t => (t.department || '').trim()).filter(Boolean))).sort();
  const classOptions = Array.from(new Set((classes || []).filter(cls => teacherMatchesScope(cls)).map(cls => cls.name || cls.level || `Class ${cls.id}`))).sort();
  const subjectOptions = Array.from(new Set((subjects || []).map(s => s.name || '').filter(Boolean))).sort();

  const cards = filtered.map(t => {
    const meta = teacherMeta.get(String(t.id)) || { classNames: new Set(), subjectNames: new Set(), levels: new Set() };
    return teacherSummaryProfile(t, {
      classNames: Array.from(meta.classNames).slice(0, 8),
      subjectNames: Array.from(meta.subjectNames).slice(0, 8),
      levels: Array.from(meta.levels)
    });
  }).join('') || `<div class="card" style="padding:24px"><div class="empty-state"><i data-lucide="users" style="width:28px;height:28px"></i><p>No teachers found in your authorized education level.</p></div></div>`;

  setContent(`
    <style>
      .teacher-directory { display: flex; flex-direction: column; gap: 20px; }
      .teacher-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; background:#fff; border:1px solid var(--gray-200); border-radius:12px; padding:12px 14px; box-shadow:0 1px 8px rgba(15,23,42,.05); }
      .teacher-search-wrap { position: relative; display: flex; align-items: center; min-width: 220px; flex: 1 1 280px; max-width: 420px; }
      .teacher-search-wrap .search-icon { position: absolute; left: 12px; color: var(--gray-500); }
      .teacher-search-wrap input { padding-left: 38px; border-radius:10px; }
      .teacher-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .teacher-filters .select-field { border-radius:10px; }
      .teacher-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 20px; align-items: stretch; }
      .teacher-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 4px 16px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.04); padding: 0; display: flex; flex-direction: column; gap: 0; min-width: 0; height: 100%; overflow: hidden; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
      .teacher-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(15,23,42,.10), 0 2px 8px rgba(15,23,42,.06); border-color: #dbeafe; }
      .teacher-card-header { display: flex; flex-direction: column; gap: 0; padding: 0; border-bottom: none; min-width: 0; }
      .teacher-avatar-wrap { width: 100%; height: auto; aspect-ratio: 16 / 9; border-radius: 0; overflow: hidden; border: none; border-bottom:1px solid #eef2f7; background: linear-gradient(180deg,#f8fafc 0%, #eef2ff 100%); flex-shrink: 0; position:relative; }
      .teacher-avatar-wrap img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center 30%; }
      .teacher-avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#1e3a5f 0%, #2563eb 55%, #3b82f6 100%); color:#fff; font-size:32px; font-weight:800; letter-spacing:.04em; }
      .teacher-avatar-wrap::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg, transparent 55%, rgba(15,23,42,.06) 100%); pointer-events:none; }
      .teacher-meta { min-width: 0; flex: 1; padding:14px 16px 12px; background:#fff; }
      .teacher-meta h3 { margin: 0; font-size: 16px; line-height: 1.35; color: #0f172a; font-weight: 800; overflow-wrap:anywhere; letter-spacing:-.01em; }
      .teacher-code { margin-top: 5px; font-size: 11px; color: #64748b; letter-spacing: 0.08em; font-weight:700; overflow-wrap:anywhere; text-transform:uppercase; }
      .teacher-code::before { content:"ID • "; color:#94a3b8; letter-spacing:.08em; }
      .teacher-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; margin-top: 10px; border:1px solid transparent; letter-spacing:.03em; }
      .teacher-status.success { background: #ecfdf5; color: #047857; border-color:#a7f3d0; }
      .teacher-status.secondary { background: #f1f5f9; color: #475569; border-color:#e2e8f0; }
      .teacher-card-body { display: flex; flex-direction: column; gap: 12px; padding:14px 16px; background:#f8fafc; border-top:1px solid #f1f5f9; }
      .teacher-info-list { display: grid; gap: 8px; }
      .teacher-info-list div { display: grid; grid-template-columns: 92px minmax(0,1fr); gap: 8px; align-items: start; font-size: 12.5px; color: var(--gray-700); min-width: 0; }
      .teacher-info-list div > span:last-child { min-width: 0; overflow-wrap:anywhere; word-break:break-word; }
      .teacher-label { color: var(--gray-500); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
      .teacher-label i { width: 14px; height: 14px; }
      .teacher-academic-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; box-shadow:0 1px 6px rgba(15,23,42,.04) inset; }
      .teacher-section-header { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.09em; color: #64748b; display:flex; align-items:center; gap:6px; }
      .teacher-section-header::after { content:""; flex:1; height:1px; background:#eef2f7; margin-left:8px; }
      .teacher-badges, .teacher-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .teacher-badge, .teacher-chip { display: inline-flex; align-items: center; justify-content: center; max-width:100%; padding: 5px 11px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid transparent; overflow-wrap:anywhere; word-break:break-word; line-height:1.2; }
      .teacher-badge.success { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
      .teacher-badge.info { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
      .teacher-badge.neutral { background: #f1f5f9; color: #475569; border-color:#e2e8f0; }
      .teacher-chip { background: #eff6ff; color: #1e40af; border-color: #dbeafe; }
      .teacher-chip.accent { background: #f5f3ff; color: #5b21b6; border-color: #ddd6fe; }
      .teacher-chip.muted { background: #f8fafc; color: #64748b; border-color: #e2e8f0; border-style:dashed; }
      .teacher-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding:12px 14px 14px; background:#fff; border-top:1px solid #f1f5f9; }
      .teacher-card-actions .btn { flex: 1 1 112px; min-width:0; justify-content:center; border-radius:10px; font-weight:700; font-size:12px; padding:8px 10px; }
      @media (max-width: 640px) {
        .teacher-toolbar { align-items: stretch; }
        .teacher-filters { width: 100%; }
        .teacher-filters > * { flex: 1 1 100%; }
        .teacher-info-list div { grid-template-columns: 1fr; gap: 4px; }
      }
    </style>
    <div class="teacher-directory">
      <div class="teacher-toolbar">
        <div class="teacher-search-wrap">
          <i class="search-icon" data-lucide="search" style="width:16px;height:16px"></i>
          <input id="teachers-search-input" class="input-field" type="text" placeholder="Search teachers by name, ID, class, subject or department" value="${Utils.escapeHtml(teachersSearch)}">
        </div>
        <div class="teacher-filters">
          <select id="teachers-status-filter" class="select-field">
            <option value="all">All statuses</option>
            <option value="active" ${teachersStatusFilter === 'active' ? 'selected' : ''}>Active</option>
            <option value="inactive" ${teachersStatusFilter === 'inactive' ? 'selected' : ''}>Inactive</option>
          </select>
          <select id="teachers-dept-filter" class="select-field">
            <option value="all">All departments</option>
            ${departmentOptions.map(dep => `<option value="${Utils.escapeHtml(dep)}" ${teachersDepartmentFilter === dep ? 'selected' : ''}>${Utils.escapeHtml(dep)}</option>`).join('')}
          </select>
          <select id="teachers-class-filter" class="select-field">
            <option value="all">All classes</option>
            ${classOptions.map(c => `<option value="${Utils.escapeHtml(c)}" ${teachersClassFilter === c ? 'selected' : ''}>${Utils.escapeHtml(c)}</option>`).join('')}
          </select>
          <select id="teachers-subject-filter" class="select-field">
            <option value="all">All subjects</option>
            ${subjectOptions.map(s => `<option value="${Utils.escapeHtml(s)}" ${teachersSubjectFilter === s ? 'selected' : ''}>${Utils.escapeHtml(s)}</option>`).join('')}
          </select>
          <button id="teacher-add-btn" class="btn btn-primary"><i data-lucide="user-plus"></i> Add Teacher</button>
        </div>
      </div>
      <div class="teacher-card-grid">${cards}</div>
    </div>
  `);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  const searchInput = document.getElementById('teachers-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      teachersSearch = e.target.value.trim();
      renderTeachers();
    });
  }

  const statusFilter = document.getElementById('teachers-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      teachersStatusFilter = e.target.value;
      renderTeachers();
    });
  }

  const deptFilter = document.getElementById('teachers-dept-filter');
  if (deptFilter) {
    deptFilter.addEventListener('change', (e) => {
      teachersDepartmentFilter = e.target.value;
      renderTeachers();
    });
  }

  const classFilter = document.getElementById('teachers-class-filter');
  if (classFilter) {
    classFilter.addEventListener('change', (e) => {
      teachersClassFilter = e.target.value;
      renderTeachers();
    });
  }

  const subjectFilter = document.getElementById('teachers-subject-filter');
  if (subjectFilter) {
    subjectFilter.addEventListener('change', (e) => {
      teachersSubjectFilter = e.target.value;
      renderTeachers();
    });
  }

  const addBtn = document.getElementById('teacher-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', teacherForm);
  }

  const root = document.getElementById('main-content');
  if (root) {
    root.querySelectorAll('[data-action="teacher-view"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const teacher = (teachers || []).find(t => String(t.id) === String(id));
        if (!teacher) return;
        const meta = teacherMeta.get(String(id)) || { classNames: new Set(), subjectNames: new Set(), levels: new Set() };
        teacherViewProfile(teacher, {
          classNames: Array.from(meta.classNames),
          subjectNames: Array.from(meta.subjectNames),
          levels: Array.from(meta.levels)
        });
      });
    });

    root.querySelectorAll('[data-action="teacher-edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const teacher = (teachers || []).find(t => String(t.id) === String(id));
        if (teacher) teacherEdit(teacher);
      });
    });

    root.querySelectorAll('[data-action="teacher-assignments"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const teacher = (teachers || []).find(t => String(t.id) === String(id));
        if (teacher) {
          const teacherName = Utils.escapeHtml(teacher.full_name || 'Teacher');
          Modal.show(`Assignments for ${teacherName}`, `
            <div class="alert alert-info"><i data-lucide="info"></i> Use the assignments module to manage this teacher's class and subject links.</div>
            <div class="card" style="margin-top:12px; padding:14px; background:var(--gray-50)">
              <p class="text-sm text-muted" style="margin:0">Teacher: <strong>${teacherName}</strong></p>
            </div>`, `<button class="btn btn-secondary" data-close-modal="true">Close</button>
             <button class="btn btn-primary" id="teacher-assignments-btn"><i data-lucide="link"></i> Open Assignments</button>`);
          if (typeof lucide !== 'undefined') lucide.createIcons();
          document.querySelector('[data-close-modal="true"]')?.addEventListener('click', () => Modal.close());
          document.getElementById('teacher-assignments-btn')?.addEventListener('click', () => Router.go('admin/assignments'));
        }
      });
    });
  }
}

function teacherViewProfile(t, teacherMeta = {}) {
  const classTags = (teacherMeta.classNames || []).length
    ? teacherMeta.classNames.map(n => `<span class="teacher-chip">${Utils.escapeHtml(n)}</span>`).join('')
    : '<span class="teacher-chip muted">No classes yet</span>';
  const subjectTags = (teacherMeta.subjectNames || []).length
    ? teacherMeta.subjectNames.map(n => `<span class="teacher-chip accent">${Utils.escapeHtml(n)}</span>`).join('')
    : '<span class="teacher-chip muted">No subjects yet</span>';
  const levels = (teacherMeta.levels || []).length
    ? Array.from(new Set(teacherMeta.levels)).map(level => `<span class="teacher-badge ${level === 'Primary' ? 'success' : 'info'}">${Utils.escapeHtml(level)}</span>`).join('')
    : '<span class="teacher-badge neutral">Unassigned</span>';

  const photo = t.profile_photo_url || t.photo_url || t.avatar_url
    ? `<img src="${Utils.escapeHtml(t.profile_photo_url || t.photo_url || t.avatar_url)}" alt="Teacher photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--blue-600),var(--blue-800));color:#fff;font-size:20px;font-weight:700;border-radius:50%">${Utils.escapeHtml((t.full_name || 'T').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase() || 'T')}</div>`;

  Modal.show(`Teacher Profile — ${Utils.escapeHtml(t.full_name || 'Teacher')}`, `
    <div class="card" style="padding:0;overflow:hidden;margin:0">
      <div style="background:linear-gradient(135deg,var(--blue-900),var(--blue-700));color:white;padding:24px;text-align:center">
        <div style="width:96px;height:96px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.22);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08)">${photo}</div>
        <div style="font-size:22px;font-weight:700;line-height:1.25">${Utils.escapeHtml(t.full_name || 'Unnamed Teacher')}</div>
        <div style="font-size:12px;opacity:.9;letter-spacing:.08em;margin-top:6px">${Utils.escapeHtml(t.teacher_code || 'Teacher Code')}</div>
      </div>
      <div style="padding:20px 20px 0">
        <div class="teacher-info-list" style="margin-bottom:14px">
          <div><span class="teacher-label"><i data-lucide="phone"></i>Phone</span><span>${Utils.escapeHtml(t.phone || 'Not provided')}</span></div>
          <div><span class="teacher-label"><i data-lucide="mail"></i>Email</span><span>${Utils.escapeHtml(t.email || 'Not provided')}</span></div>
          <div><span class="teacher-label"><i data-lucide="user"></i>Gender</span><span>${Utils.escapeHtml(t.gender || '—')}</span></div>
          <div><span class="teacher-label"><i data-lucide="graduation-cap"></i>Qualification</span><span>${Utils.escapeHtml(t.qualification || 'Not provided')}</span></div>
          <div><span class="teacher-label"><i data-lucide="briefcase"></i>Department</span><span>${Utils.escapeHtml(t.department || 'Not provided')}</span></div>
          <div><span class="teacher-label"><i data-lucide="shield-check"></i>Role</span><span>${Utils.escapeHtml(t.role || 'Teacher')}</span></div>
        </div>
        <div class="teacher-academic-box">
          <div class="teacher-section-header">Education Level</div>
          <div class="teacher-badges">${levels}</div>
          <div class="teacher-section-header">Classes Teaching</div>
          <div class="teacher-tags">${classTags}</div>
          <div class="teacher-section-header">Subjects</div>
          <div class="teacher-tags">${subjectTags}</div>
        </div>
      </div>
    </div>`, `<button class="btn btn-secondary" data-close-modal="true">Close</button>
     <button class="btn btn-primary" id="profile-edit-btn"><i data-lucide="pencil"></i> Edit</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  document.querySelector('[data-close-modal="true"]')?.addEventListener('click', () => Modal.close());
  document.getElementById('profile-edit-btn')?.addEventListener('click', () => teacherEdit(t));
}

function teacherForm() {
  Modal.show('Add Teacher', `
    <div class="form-group"><label>Teacher Code (11 Digits) <span class="required">*</span></label><input id="tf-code" class="input-field" placeholder="e.g., 54102325012" maxlength="11"></div>
    <div class="form-group"><label>Full Name <span class="required">*</span></label><input id="tf-name" class="input-field" placeholder="e.g., John Doe"></div>
    <div class="form-group"><label>Email <span class="required">*</span></label><input id="tf-email" class="input-field" placeholder="e.g., john@rukara.edu"></div>
    <div class="form-group"><label>Password <span class="required">*</span></label><input id="tf-pass" class="input-field" type="password" value="teacher123" placeholder="teacher123" autocomplete="new-password"><p class="form-hint">Default password: teacher123. The teacher should change it after signing in.</p></div>
    <div class="form-group"><label>Phone</label><input id="tf-phone" class="input-field" placeholder="e.g., +250788123456"></div>
    <div class="alert alert-info" style="margin-bottom:0"><i data-lucide="info"></i> After registration, open Assignments to link this teacher to authorized classes and subjects.</div>`,
    `<button class="btn btn-secondary" data-modal-close="true">Cancel</button>
     <button class="btn btn-primary" id="teacher-save-btn"><i data-lucide="save"></i> Save</button>`);

  document.getElementById('teacher-save-btn')?.addEventListener('click', teacherSave);
  document.querySelector('[data-modal-close="true"]')?.addEventListener('click', () => Modal.close());
}

async function teacherSave() {
  const code = document.getElementById('tf-code')?.value?.trim();
  const name = document.getElementById('tf-name')?.value?.trim();
  const email = document.getElementById('tf-email')?.value?.trim();
  const pass = document.getElementById('tf-pass')?.value || 'teacher123';
  const phone = document.getElementById('tf-phone')?.value?.trim() || null;

  if (!code || !name || !email || !pass) return Utils.toast('Fill all required fields', 'error');
  if (!/^\d{11}$/.test(code)) return Utils.toast('Teacher code must be exactly 11 digits', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Utils.toast('Enter a valid teacher email address', 'error');
  if (pass.length < 8) return Utils.toast('Password must be at least 8 characters', 'error');

  try {
    const { data: currentSessionData } = await sbClient.auth.getSession();
    const adminSession = currentSessionData?.session || null;
    const [{ data: existingCode }, { data: existingEmail }] = await Promise.all([
      sbClient.from('teachers').select('id').eq('teacher_code', code).maybeSingle(),
      sbClient.from('users').select('id').eq('email', email).maybeSingle()
    ]);
    if (existingCode) return Utils.toast('That teacher code is already registered', 'error');
    if (existingEmail) return Utils.toast('That email address is already registered', 'error');

    const { data: authData, error } = await sbClient.auth.signUp({ email, password: pass });
    if (error) throw error;
    if (!authData?.user?.id) throw new Error('Teacher account could not be created');

    if (adminSession) {
      const { data: activeSessionData } = await sbClient.auth.getSession();
      const activeUserId = activeSessionData?.session?.user?.id || null;
      if (activeUserId !== adminSession.user?.id) {
        const { error: restoreError } = await sbClient.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token
        });
        if (restoreError) throw restoreError;
      }
    }
    const creatorId = (typeof Auth !== 'undefined' && Auth.currentUser?.id) ? Auth.currentUser.id : (adminSession?.user?.id || null);
    await DB.insert('users', { id: authData.user.id, email, full_name: name, role: 'teacher', status: 'active', phone });
    await DB.insert('teachers', { user_id: authData.user.id, teacher_code: code, full_name: name, email, phone, status: 'active', created_by: creatorId });
    DB.invalidate('teachers');
    DB.invalidate('users');
    Modal.close();
    Utils.toast('Teacher created', 'success');
    await renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function teacherEdit(t) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay">
      <div class="modal"><div class="modal-header">Edit Teacher</div><div class="modal-body">
        <div class="form-group"><label>Teacher Code</label><input id="te-code" class="input-field" value="${Utils.escapeHtml(t.teacher_code || '')}"></div>
        <div class="form-group"><label>Full Name</label><input id="te-name" class="input-field" value="${Utils.escapeHtml(t.full_name || '')}"></div>
        <div class="form-group"><label>Email</label><input id="te-email" class="input-field" value="${Utils.escapeHtml(t.email || '')}"></div>
        <div class="form-group"><label>Phone</label><input id="te-phone" class="input-field" value="${Utils.escapeHtml(t.phone || '')}"></div>
        <div class="form-group"><label>Status</label><select id="te-status" class="select-field"><option value="active" ${t.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${t.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
        <div class="alert alert-info" style="margin-bottom:0"><i data-lucide="info"></i> Education level is driven by the classes this teacher is assigned to (see Assignments).</div>
      </div><div class="modal-footer">
        <button class="btn btn-secondary" data-close-modal="true">Cancel</button>
        <button class="btn btn-primary" id="teacher-update-btn"><i data-lucide="save"></i> Update</button>
      </div></div></div>`;

  document.querySelector('[data-close-modal="true"]')?.addEventListener('click', () => Modal.close());
  document.getElementById('teacher-update-btn')?.addEventListener('click', () => teacherUpdate(t.id));
  const overlay = document.querySelector('#modal-root .modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) Modal.close();
    });
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function teacherUpdate(id) {
  try {
    await DB.update('teachers', id, {
      teacher_code: document.getElementById('te-code').value,
      full_name: document.getElementById('te-name').value,
      email: document.getElementById('te-email').value,
      phone: document.getElementById('te-phone').value,
      status: document.getElementById('te-status').value
    });
    Modal.close();
    Utils.toast('Updated', 'success');
    renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

async function teacherDeactivate(id) {
  Modal.show('Deactivate Teacher', `
    <p class="text-sm text-muted">Deactivate this teacher? They will no longer appear in assignment lists.</p>`,
    `<button class="btn btn-secondary" data-close-modal="true">Cancel</button>
     <button class="btn btn-danger" id="teacher-deactivate-btn"><i data-lucide="user-x"></i> Deactivate</button>`);

  document.querySelector('[data-close-modal="true"]')?.addEventListener('click', () => Modal.close());
  document.getElementById('teacher-deactivate-btn')?.addEventListener('click', () => confirmTeacherDeactivate(id));
}

async function confirmTeacherDeactivate(id) {
  try {
    await DB.update('teachers', id, { status: 'inactive' });
    Modal.close();
    Utils.toast('Teacher deactivated', 'success');
    renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function teacherActivate(id) {
  DB.update('teachers', id, { status: 'active' }).then(() => {
    Utils.toast('Teacher activated', 'success');
    renderTeachers();
  }).catch(e => Utils.toast('Error: ' + e.message, 'error'));
}

function teacherDelete(t) {
  Modal.show('Delete Teacher', `
    <div class="text-center mb-4">
      <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:var(--red-50);color:var(--red-500);display:flex;align-items:center;justify-content:center"><i data-lucide="trash-2" style="width:24px;height:24px"></i></div>
      <p style="font-size:15px;color:var(--gray-800)">Delete <strong>${Utils.escapeHtml(t.full_name || 'Teacher')}</strong> permanently?</p>
    </div>
    <div class="alert alert-danger" style="margin:0 0 16px"><i data-lucide="alert-triangle"></i> This removes the teacher, their login account and all their assignments. This cannot be undone.</div>
    <div class="alert alert-warning" style="margin-bottom:0"><i data-lucide="info"></i> If the teacher already owns assessments, delete those assessments first — otherwise the delete is blocked.</div>`,
    `<button class="btn btn-secondary" data-close-modal="true">Cancel</button>
     <button class="btn btn-danger" id="teacher-delete-btn"><i data-lucide="trash-2"></i> Delete Teacher</button>`, true);

  document.querySelector('[data-close-modal="true"]')?.addEventListener('click', () => Modal.close());
  document.getElementById('teacher-delete-btn')?.addEventListener('click', () => confirmTeacherDelete(t.id, t.user_id || ''));
}

async function confirmTeacherDelete(id, userId) {
  try {
    if (userId) {
      const { error } = await sbClient.from('users').delete().eq('id', userId);
      if (error) throw error;
    } else {
      await DB.remove('teachers', id);
    }
    await DB.insert('audit_logs', {
      user_id: Auth.currentUser?.id, user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role, action: 'delete_teacher',
      new_value: 'Deleted teacher ' + (id || ''),
      timestamp: new Date().toISOString()
    });
    Modal.close();
    Utils.toast('Teacher deleted', 'success');
    renderTeachers();
  } catch (e) {
    if (/violates foreign key constraint/i.test(e.message || '')) {
      Modal.close();
      Utils.toast('Cannot delete: teacher owns assessments. Delete or reassign those assessments first.', 'error');
    } else {
      Utils.toast('Delete error: ' + e.message, 'error');
    }
  }
}
