let teacherDashEduLevel = 'all';

async function renderTeacherDashboard() {
  setHeader('Dashboard', `Welcome, ${Auth.currentUser?.full_name}`);
  setContent(`<div class="grid-4"><div class="card card-in"><div class="spinner" style="margin:0 auto;width:28px;height:28px"></div></div><div class="card card-in"></div><div class="card card-in"></div><div class="card card-in"></div></div>`);
  const teacherId = Auth.getTeacherId();
  if (!teacherId) { setContent(Utils.errorCard('No Teacher Profile', 'Your account is not linked to a teacher record.')); return; }

  try {
    const [assignments, allAssessments, allClasses, subjects] = await Promise.all([
      DB.query('teacher_assignments', '*', { teacher_id: teacherId }),
      DB.query('assessments', '*', { teacher_id: teacherId }),
      DB.get('classes'),
      DB.get('subjects')
    ]);

    const filteredClassesIds = new Set(allClasses.filter(c => teacherDashEduLevel === 'all' || EducationLevels.getCategory(c) === teacherDashEduLevel).map(c => c.id));
    const filteredAssignments = assignments.filter(a => filteredClassesIds.has(a.class_id));
    const assessments = allAssessments.filter(a => filteredClassesIds.has(a.class_id));

    const pending = assessments.filter(a => a.status === 'draft').length;
    const submitted = assessments.filter(a => a.status === 'submitted').length;
    const approved = assessments.filter(a => ['approved', 'locked'].includes(a.status)).length;
    const rejected = assessments.filter(a => a.status === 'rejected').length;

    const assessRows = assessments.slice(0, 10).map(a => {
      const cls = allClasses.find(c => c.id === a.class_id);
      const subj = subjects.find(s => s.id === a.subject_id);
      const cat = Utils.escapeHtml(EducationLevels.getCategory(cls));
      return `<tr>
        <td><span style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;display:block;margin-bottom:2px">${cat}</span>${Utils.escapeHtml(cls?.name || '-')}</td>
        <td>${Utils.escapeHtml(subj?.name || '-')}</td>
        <td>${Utils.escapeHtml(a.name)}</td>
        <td>${Utils.escapeHtml(a.unit || '-')}</td>
        <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
        <td><button class="btn btn-sm btn-primary" onclick="Router.go('teacher/enter-marks?assessment=${a.id}')">${a.status === 'draft' || a.status === 'rejected' ? '<i data-lucide="pencil"></i> Enter' : '<i data-lucide="eye"></i> View'}</button></td></tr>`;
    }).join('');

    const actions = [
      { icon: 'school', bg: 'var(--blue-50)', color: 'var(--blue-600)', title: 'My Classes', desc: 'View your class rosters', route: 'teacher/my-classes' },
      { icon: 'book-open', bg: 'var(--green-50)', color: 'var(--green-600)', title: 'My Subjects', desc: 'Subjects you are assigned to teach', route: 'teacher/my-subjects' },
{ icon: 'calculator', bg: 'var(--amber-50)', color: 'var(--amber-600)', title: 'Enter Marks', desc: 'Record and submit your marks', route: 'teacher/enter-marks' }
    ];
    const actionCards = actions.map(a => `
      <button class="action-card" onclick="Router.go('${a.route}')" aria-label="${a.title}">
        <span class="ac-icon" style="background:${a.bg};color:${a.color}"><i data-lucide="${a.icon}"></i></span>
        <h4>${a.title}</h4>
        <p>${a.desc}</p>
        <span class="ac-open">Open <i data-lucide="arrow-right"></i></span>
      </button>`).join('');

    setContent(`
      <div class="card mb-6" style="padding:16px 20px; background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(37,99,235,0.05))">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-weight:700;color:var(--blue-800)"><i data-lucide="filter" style="width:16px;height:16px;vertical-align:middle"></i> View Scope:</div>
          <select class="select-field" style="width:250px;margin:0" onchange="teacherDashEduLevel=this.value;renderTeacherDashboard()">
            <option value="all">🎓 All Assigned Levels</option>
            <option value="Primary" ${teacherDashEduLevel==='Primary'?'selected':''}>📗 Primary Only</option>
            <option value="Lower Secondary" ${teacherDashEduLevel==='Lower Secondary'?'selected':''}>📘 Lower Sec Only</option>
            <option value="Upper Secondary" ${teacherDashEduLevel==='Upper Secondary'?'selected':''}>📙 Upper Sec Only</option>
          </select>
        </div>
      </div>
      
      <div class="grid-4 card-in-stagger mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="link"></i></div>
          <div class="stat-value">${filteredAssignments.length}</div>
          <div class="stat-label">My Assignments</div>
          <div class="stat-desc"><i data-lucide="link"></i> Enrolled subjects via filter</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--amber-50);color:var(--amber-600)"><i data-lucide="file-edit"></i></div>
          <div class="stat-value" style="color:var(--amber-600)">${pending}</div>
          <div class="stat-label">Pending Entry</div>
          <div class="stat-desc"><i data-lucide="file-edit"></i> Marks still to be recorded</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="check-circle-2"></i></div>
          <div class="stat-value" style="color:var(--green-600)">${approved}</div>
          <div class="stat-label">Approved</div>
          <div class="stat-desc"><i data-lucide="check-circle-2"></i> Approved &amp; locked results</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:${rejected > 0 ? 'var(--red-50)' : 'var(--gray-100)'};color:${rejected > 0 ? 'var(--red-500)' : 'var(--gray-500)'}"><i data-lucide="alert-circle"></i></div>
          <div class="stat-value" style="color:${rejected > 0 ? 'var(--red-500)' : 'var(--gray-500)'}">${rejected}</div>
          <div class="stat-label">Rejected</div>
          <div class="stat-desc"><i data-lucide="alert-circle"></i> ${rejected > 0 ? 'Needs your attention' : 'No rejected assessments'}</div>
        </div>
      </div>

      <div class="card-grid card-in-stagger mb-6">
        ${actionCards}
      </div>

      <div class="card card-in">
        <div class="card-header">
          <div>
            <h3><i data-lucide="clipboard-list" style="width:18px;height:18px;color:var(--blue-600)"></i> Recent Assessments</h3>
            <p class="card-subtitle">Your latest assessment work within this level</p>
          </div>
          <button class="btn btn-sm btn-outline" onclick="Router.go('teacher/enter-marks')"><i data-lucide="arrow-right" style="width:14px;height:14px"></i> View All</button>
        </div>
        <div class="table-container"><table class="data-table">
          <thead><tr><th>Class</th><th>Subject</th><th>Assessment</th><th>Unit</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${assessRows || `<tr><td colspan="6">${Utils.empty('No assessments yet. Create one from Marks Recording.','clipboard-list')}</td></tr>`}</tbody></table></div>
      </div>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    setContent(`
      <div class="error-card">
        <div class="error-icon"><i data-lucide="alert-triangle"></i></div>
        <h3>Unable to Load Data</h3>
        <p>We couldn't retrieve your dashboard information. Please try again.</p>
        <button class="btn btn-primary" onclick="renderTeacherDashboard()"><i data-lucide="refresh-cw" style="width:16px;height:16px"></i> Try Again</button>
      </div>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

let openClassStudents = new Set();
let classStudentsInitial = true;

async function renderMyClasses() {
  setHeader('My Classes', 'Your assigned classes and students');
  setContent(Utils.loading());
  const teacherId = Auth.getTeacherId();
  if (!teacherId) { setContent(Utils.empty('No teacher profile found', 'user-x')); return; }

  const assignments = await DB.query('teacher_assignments', '*', { teacher_id: teacherId });
  const [classes, subjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);

  const uniqueClasses = {};
  const classIds = [];
  for (const a of assignments) {
    const cls = classes.find(c => c.id === a.class_id);
    if (!cls) continue;
    if (!uniqueClasses[cls.id]) {
      uniqueClasses[cls.id] = { id: cls.id, name: cls.name, level: cls.level || '', stream: cls.stream || '', subjects: [], students: [] };
      classIds.push(cls.id);
    }
    const sub = subjects.find(s => s.id === a.subject_id);
    if (sub && !uniqueClasses[cls.id].subjects.some(x => x.id === sub.id)) {
      uniqueClasses[cls.id].subjects.push(sub);
    }
  }

  /* Fetch EVERY learner in the assigned classes (active + inactive) so the
     teacher sees the full roster, with status clearly marked. */
  const learnerResults = await Promise.all(
    classIds.map(id => DB.query('learners', '*', { class_id: id }, { column: 'full_name', asc: true }))
  );
  classIds.forEach((id, i) => { uniqueClasses[id].students = learnerResults[i] || []; });

  /* Expand all rosters by default on the first visit so students are
     immediately visible; the teacher can still collapse them. */
  if (classStudentsInitial) {
    classIds.forEach(id => openClassStudents.add(id));
    classStudentsInitial = false;
  }

  const cards = Object.values(uniqueClasses).map(c => {
    c.education_level = EducationLevels.getCategory(c);
    const open = openClassStudents.has(c.id);
    const activeCount = c.students.filter(l => l.status === 'active').length;
    const subjectTags = c.subjects.map(s => `<span class="badge badge-gray">${Utils.escapeHtml(s.name)}</span>`).join(' ') || '<span class="text-sm text-muted">—</span>';
    const studentsHtml = c.students.length
      ? `<div class="table-container" style="margin-top:14px">
          <table class="data-table">
            <thead><tr><th class="text-center" style="width:48px">No.</th><th>Student Number</th><th>Learner Name</th><th class="text-center" style="width:110px">Gender</th><th class="text-center" style="width:120px">Status</th></tr></thead>
            <tbody>
              ${c.students.map((l, i) => `
                <tr>
                  <td class="text-center text-muted">${i + 1}</td>
                  <td class="col-code">${Utils.escapeHtml(l.learner_code)}</td>
                  <td class="col-name">${Utils.escapeHtml(l.full_name)}</td>
                  <td class="text-center"><span class="badge ${l.gender === 'M' ? 'badge-info' : 'badge-danger'}">${l.gender === 'M' ? 'Male' : 'Female'}</span></td>
                  <td class="text-center"><span class="badge ${Utils.statusColor(l.status)}"><i data-lucide="${Utils.statusIcon(l.status)}"></i> ${l.status}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : `<p class="text-sm text-muted" style="margin-top:14px">No students have been assigned to this class yet.</p>`;

    const meta = `${c.level ? Utils.escapeHtml(c.level) + ' level' : ''}${c.stream ? ', ' + Utils.escapeHtml(c.stream) : ''} &bull; ${c.students.length} student(s)${activeCount !== c.students.length ? ' (' + activeCount + ' active)' : ''} &bull; ${c.subjects.length} subject(s)`;

    return `
      <div class="card" data-education-level="${c.education_level}">
        <div class="card-header" style="flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px"><i data-lucide="layers" style="width:10px;height:10px"></i> ${c.education_level}</div>
            <h3 style="margin:0"><i data-lucide="school" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>${Utils.escapeHtml(c.name)}</h3>
            <p class="text-sm text-muted mt-1">${meta}</p>
          </div>
          <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
            <div class="flex gap-1" style="flex-wrap:wrap">${subjectTags}</div>
            <button class="btn btn-sm btn-secondary" onclick="teacherDownloadClassList('${c.id}','xlsx')" title="Download the class student list as Excel"><i data-lucide="file-spreadsheet"></i> Excel</button>
            <button class="btn btn-sm btn-secondary" onclick="teacherDownloadClassList('${c.id}','word')" title="Download the class student list as Word"><i data-lucide="file-text"></i> Word</button>
            <button class="btn btn-sm btn-secondary" onclick="teacherDownloadClassList('${c.id}','pdf')" title="Download the class student list as PDF"><i data-lucide="file-down"></i> PDF</button>
            <button class="btn btn-sm btn-secondary" onclick="teacherDownloadClassList('${c.id}','csv')" title="Download the class student list as CSV"><i data-lucide="file-text"></i> CSV</button>
            <button class="btn btn-sm btn-outline" onclick="toggleClassStudents('${c.id}')">
              <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}"></i> ${open ? 'Hide Students' : 'View ' + c.students.length + ' Students'}
            </button>
          </div>
        </div>
        ${open ? studentsHtml : ''}
      </div>`;
  });

  // Group cards visually
  const cats = ['Primary', 'Lower Secondary', 'Upper Secondary'];
  const sortedCards = cats.map(cat => cards.filter(c => c.includes(`data-education-level="${cat}"`)).join('')).filter(Boolean);
  const otherCards = cards.filter(c => !cats.some(cat => c.includes(`data-education-level="${cat}"`))).join('');

  setContent(`<div class="flex flex-col gap-4">${sortedCards.join('') + otherCards || Utils.empty('No classes have been assigned to you yet', 'school')}</div>`);
}

function toggleClassStudents(classId) {
  if (openClassStudents.has(classId)) openClassStudents.delete(classId);
  else openClassStudents.add(classId);
  renderMyClasses();
}

function teacherDownloadClassList(classId, format) {
   Utils.toast('Reports are not available at this time.', 'info');
}

async function renderMySubjects() {
  setHeader('My Subjects', 'Your assigned subjects');
  setContent(Utils.loading());
  const teacherId = Auth.getTeacherId();
  const assignments = await DB.query('teacher_assignments','*',{teacher_id:teacherId});
  const [classes, subjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);

  const rows = assignments.map(a => {
    const cls = classes.find(c => c.id === a.class_id);
    const sub = subjects.find(s => s.id === a.subject_id);
    const cat = EducationLevels.getCategory(cls);
    return `<tr>
      <td class="col-name">
        <span style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;display:block;margin-bottom:2px">${cat}</span>
        ${Utils.escapeHtml(sub?.name||'-')}
      </td>
      <td class="col-code">${Utils.escapeHtml(sub?.code||'-')}</td>
      <td>${Utils.escapeHtml(cls?.name||'-')}</td>
    </tr>`;
  }).sort((a,b) => a.localeCompare(b)).join('');

  setContent(`<div class="card">
    <div class="card-header"><h3><i data-lucide="book-marked" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--green-600)"></i>Subject Assignments</h3></div>
    <div class="table-container"><table class="data-table">
      <thead><tr><th>Subject</th><th>Code</th><th>Class Context</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="3">${Utils.empty('No subjects','book-open')}</td></tr>`}</tbody></table></div></div>`);
}

async function renderSubmittedMarks() {
  setHeader('Submitted Marks', 'Your submitted assessments');
  setContent(Utils.loading());
  const teacherId = Auth.getTeacherId();
  const assessments = await DB.query('assessments','*',{teacher_id:teacherId},{column:'created_at',asc:false});
  const submitted = assessments.filter(a => ['submitted','approved','locked','rejected'].includes(a.status));
  const [classes, subjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);

  const rows = submitted.map(a => {
    const cls = classes.find(c => c.id === a.class_id);
    const sub = subjects.find(s => s.id === a.subject_id);
    return `<tr><td class="col-name">${Utils.escapeHtml(a.name)}</td>
      <td>${Utils.escapeHtml(cls?.name||'-')}</td><td>${Utils.escapeHtml(sub?.name||'-')}</td>
      <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
      <td><button class="btn btn-sm btn-outline" onclick="Router.go('teacher/enter-marks?assessment=${a.id}')"><i data-lucide="eye"></i> View</button></td></tr>`;
  }).join('');

  setContent(`<div class="card">
    <div class="card-header"><h3><i data-lucide="check-circle-2" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--green-600)"></i>Submitted Assessments</h3></div>
    <div class="table-container"><table class="data-table">
      <thead><tr><th>Assessment</th><th>Class</th><th>Subject</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="5">${Utils.empty('No submitted assessments','check-circle-2')}</td></tr>`}</tbody></table></div></div>`);
}

async function renderNotifications() {
  setHeader('Notifications', 'View your notifications');
  setContent(Utils.loading());
  if (typeof markNotificationsRead === 'function') markNotificationsRead();
  const notifs = await DB.query('notifications','*',{user_id:Auth.currentUser?.id},{column:'created_at',asc:false});

  const items = notifs.map(n => {
    const borderColor = n.type==='success'?'var(--green-500)':n.type==='error'?'var(--red-500)':n.type==='warning'?'var(--amber-500)':'var(--blue-500)';
    const bgColor = n.type==='success'?'var(--green-50)':n.type==='error'?'var(--red-50)':n.type==='warning'?'var(--amber-50)':'var(--blue-50)';
    return `
    <div class="card" style="border-left:4px solid ${borderColor};${!n.read?'background:'+bgColor:''}">
      <div class="flex justify-between items-center">
        <div class="flex gap-3 items-center">
          <div style="width:36px;height:36px;border-radius:50%;background:${bgColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i data-lucide="${n.type==='success'?'check-circle-2':n.type==='error'?'x-circle':n.type==='warning'?'alert-triangle':'info'}" style="width:18px;height:18px;color:${borderColor}"></i>
          </div>
          <div><h4 class="font-semibold">${Utils.escapeHtml(n.title)}</h4><p class="text-sm text-muted" style="margin-top:2px">${Utils.escapeHtml(n.message)}</p></div>
        </div>
        <div class="text-right" style="flex-shrink:0">
          <p class="text-xs text-muted">${n.created_at ? Utils.dateTimeStr(n.created_at) : ''}</p>
          ${!n.read?'<span style="display:inline-block;width:8px;height:8px;background:var(--blue-500);border-radius:50%;margin-top:4px"></span>':''}
        </div>
      </div>
    </div>`;
  }).join('');

  setContent(`<div class="flex flex-col gap-3">${items || Utils.empty('No notifications','bell')}</div>`);
}

/* ============================================================
   MY ASSESSMENTS & COMBINED EXPORT
   ============================================================ */

let currentTeacherAssessments = [];
let lastCombinedReportData = null;

async function renderMyAssessments() {
  setHeader('My Assessments', 'View, manage, and export combined reports for your assessments');
  setContent(Utils.loading());

  const teacherId = Auth.getTeacherId();
  if (!teacherId) { setContent(Utils.empty('No teacher profile associated with your account', 'user-x')); return; }

  const [assessments, classes, subjects, years, terms, types] = await Promise.all([
    DB.query('assessments', '*', { teacher_id: teacherId }, { column: 'created_at', asc: false }),
    DB.get('classes'),
    DB.get('subjects'),
    DB.get('academic_years'),
    DB.get('terms'),
    getAssessmentTypes()
  ]);

  currentTeacherAssessments = assessments;

  const rows = assessments.map((a) => {
    const cls = classes.find(c => c.id === a.class_id);
    const sub = subjects.find(s => s.id === a.subject_id);

    return `
      <tr>
        <td class="text-center" style="width:40px">
          <input type="checkbox" class="cb-assess" value="${a.id}" data-class="${a.class_id}" data-subject="${a.subject_id}" data-year="${a.academic_year_id || ''}" data-term="${a.term_id || ''}" onchange="updateCombinedExportBtn()">
        </td>
        <td class="col-name">${Utils.escapeHtml(cls?.name || '-')}</td>
        <td>${Utils.escapeHtml(sub?.name || '-')}</td>
        <td class="font-semibold">${Utils.escapeHtml(a.name)}</td>
        <td>${Utils.escapeHtml(assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'))}</td>
        <td>${Utils.escapeHtml(a.unit || '-')}</td>
        <td class="text-center">${a.maximum_mark}</td>
        <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
        <td class="col-actions">
          <button class="btn btn-sm btn-outline" onclick="Router.go('teacher/enter-marks?assessment=${a.id}')">
            ${['draft', 'rejected'].includes(a.status) ? '<i data-lucide="pencil-line"></i> Enter Marks' : '<i data-lucide="eye"></i> View Marks'}
          </button>
        </td>
      </tr>`;
  }).join('');

  setContent(`
    <div class="card mb-6">
      <div class="card-header" style="flex-wrap:wrap;gap:12px">
        <div>
          <h3><i data-lucide="clipboard-list" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>My Assessments</h3>
          <p class="text-sm text-muted mt-1">Select 2 or more assessments belonging to the same Class and Subject to export a combined report.</p>
        </div>
        <div class="flex gap-2">
          <button id="btn-combined-export" class="btn btn-primary" disabled onclick="handleCombinedExport()">
            <i data-lucide="file-spreadsheets"></i> Combined Export Selected (<span id="selected-count">0</span>)
          </button>
        </div>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px;text-align:center">
                <input type="checkbox" id="cb-select-all" onchange="toggleSelectAllAssessments(this)">
              </th>
              <th>Class</th>
              <th>Subject</th>
              <th>Assessment Name</th>
              <th>Type</th>
              <th>Unit</th>
              <th class="text-center">Max Mark</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="9">${Utils.empty('No assessments found. Create assessments from Enter Marks.', 'clipboard-list')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`);
}

function toggleSelectAllAssessments(master) {
  document.querySelectorAll('.cb-assess').forEach(cb => cb.checked = master.checked);
  updateCombinedExportBtn();
}

function updateCombinedExportBtn() {
  const selected = document.querySelectorAll('.cb-assess:checked');
  const count = selected.length;
  const btn = document.getElementById('btn-combined-export');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) countSpan.textContent = count;
  if (btn) btn.disabled = count < 2;
}

async function handleCombinedExport() {
  const checkedNodes = Array.from(document.querySelectorAll('.cb-assess:checked'));
  if (checkedNodes.length < 2) {
    return Utils.toast('Please select at least 2 assessments to generate a combined report.', 'warning');
  }

  const selectedIds = checkedNodes.map(node => node.value);
  const classIds = new Set(checkedNodes.map(node => node.dataset.class));
  const subjectIds = new Set(checkedNodes.map(node => node.dataset.subject));

  if (classIds.size > 1 || subjectIds.size > 1) {
    return Utils.toast('All selected assessments must belong to the SAME Class and Subject for combined export.', 'error');
  }

  Modal.show('Generating Combined Report...', '<div id="teacher-rpt-modal"></div>', '', true);

  try {
    const reportData = await buildCombinedReportData(selectedIds);
    lastCombinedReportData = reportData;
    renderCombinedReportModal(reportData);
  } catch (err) {
    console.error('Combined export error:', err);
    Utils.toast('Error generating report: ' + err.message, 'error');
    Modal.close();
  }
}

async function buildCombinedReportData(assessmentIds) {
  const assessments = await Promise.all(assessmentIds.map(id => DB.getRelated('assessments', '*', { id }).then(res => res[0])));
  assessments.sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date));

  const classId = assessments[0].class_id;
  const subjectId = assessments[0].subject_id;
  const yearId = assessments[0].academic_year_id;
  const termId = assessments[0].term_id;
  const teacherId = assessments[0].teacher_id;

  const [cls, sub, yr, tm, teacher, learners, settings, scale, allMarks] = await Promise.all([
    DB.getRelated('classes', '*', { id: classId }).then(r => r[0]),
    DB.getRelated('subjects', '*', { id: subjectId }).then(r => r[0]),
    yearId ? DB.getRelated('academic_years', '*', { id: yearId }).then(r => r[0]) : null,
    termId ? DB.getRelated('terms', '*', { id: termId }).then(r => r[0]) : null,
    teacherId ? DB.getRelated('teachers', '*', { id: teacherId }).then(r => r[0]) : null,
    DB.query('learners', '*', { class_id: classId, status: 'active' }, { column: 'full_name', asc: true }),
    typeof getSchoolSettings === 'function' ? getSchoolSettings() : DB.query('school_settings', '*').then(res => res[0] || {}),
    typeof getGrading === 'function' ? getGrading() : DB.get('grading_scales'),
    DB.get('marks')
  ]);

  const marksMap = {};
  allMarks.forEach(m => {
    if (assessmentIds.includes(m.assessment_id)) {
      if (!marksMap[m.learner_id]) marksMap[m.learner_id] = {};
      marksMap[m.learner_id][m.assessment_id] = m.mark;
    }
  });

  const passMark = settings.pass_mark || 50;
  const totalPossibleMax = assessments.reduce((acc, a) => acc + (a.maximum_mark || 0), 0);

  const learnerRows = learners.map(l => {
    const learnerMarks = marksMap[l.id] || {};
    let totalObtained = 0;
    let totalMaxForLearner = 0;
    const unitMarks = {};

    assessments.forEach(a => {
      const val = learnerMarks[a.id];
      if (val !== undefined && val !== null) {
        unitMarks[a.id] = val;
        totalObtained += Number(val);
        totalMaxForLearner += Number(a.maximum_mark || 0);
      } else {
        unitMarks[a.id] = 'N/R'; // Not Recorded
      }
    });

    const maxToUse = totalMaxForLearner > 0 ? totalMaxForLearner : totalPossibleMax;
    const pct = maxToUse > 0 ? Utils.pct(totalObtained, maxToUse) : 0;
    const grade = Utils.grade(pct, scale);
    const pf = Utils.passFail(pct, passMark);

    return {
      learnerId: l.id,
      learnerCode: l.learner_code || '-',
      name: l.full_name,
      gender: l.gender || '-',
      unitMarks,
      totalObtained,
      totalMax: totalPossibleMax,
      pct,
      grade,
      pf,
      position: '-'
    };
  });

  if (settings.ranking_enabled !== false) {
    const posList = Utils.positions(learnerRows.map(r => ({ id: r.learnerId, pct: r.pct })));
    learnerRows.forEach(r => {
      const p = posList.find(x => x.id === r.learnerId);
      if (p) r.position = p.position;
    });
    learnerRows.sort((a, b) => (a.position || 999) - (b.position || 999));
  }

  const validPcts = learnerRows.map(r => r.pct);
  const classAvg = validPcts.length ? Math.round(validPcts.reduce((a, b) => a + b, 0) / validPcts.length * 10) / 10 : 0;
  const highestPct = validPcts.length ? Math.max(...validPcts) : 0;
  const lowestPct = validPcts.length ? Math.min(...validPcts) : 0;
  const passCount = learnerRows.filter(r => r.pf === 'PASS').length;
  const failCount = learnerRows.length - passCount;
  const passRate = validPcts.length ? Math.round((passCount / validPcts.length) * 1000) / 10 : 0;

  // Grade distribution
  const gradeDist = Utils.gradeDist(learnerRows.map(r => r.grade));

  // Unit performance breakdown
  const unitPerf = assessments.map(a => {
    const attended = learnerRows.filter(r => r.unitMarks[a.id] !== 'N/R');
    const sumMarks = attended.reduce((acc, r) => acc + Number(r.unitMarks[a.id]), 0);
    const maxPoss = attended.length * (a.maximum_mark || 30);
    const unitAvg = maxPoss > 0 ? Math.round((sumMarks / maxPoss) * 1000) / 10 : 0;
    return {
      unit: a.unit,
      name: a.name,
      max: a.maximum_mark,
      avg: unitAvg
    };
  });

  const allApproved = assessments.every(a => ['approved', 'locked'].includes(a.status));

  return {
    className: cls?.name || 'Class',
    subjectName: sub?.name || 'Subject',
    academicYear: yr?.name || '',
    term: tm?.name || '',
    teacherName: teacher?.full_name || Auth.currentUser?.full_name || '',
    assessments,
    totalPossibleMax,
    learnerRows,
    settings,
    isOfficial: allApproved,
    stats: {
      classAvg,
      highestPct,
      lowestPct,
      passCount,
      failCount,
      totalCount: learnerRows.length,
      passRate
    },
    gradeDist,
    unitPerf
  };
}

function renderCombinedReportModal(data) {
  const headerOpts = {
    settings: data.settings,
    className: data.className,
    subject: data.subjectName,
    academicYear: data.academicYear,
    term: data.term,
    teacher: data.teacherName,
    date: Utils.dateStr(new Date()),
    assessmentsCount: data.assessments.length,
    totalMax: data.totalPossibleMax,
    isOfficial: data.isOfficial
  };

  const headerHtml = schoolReportHeader('END-OF-UNIT ASSESSMENT COMBINED PERFORMANCE REPORT', headerOpts);
  const signatureHtml = schoolSignatureSection(data.teacherName, data.settings.dos_name, data.settings.headteacher_name);

  const unitHeadersHtml = data.assessments.map(a => `<th class="text-center">${Utils.escapeHtml(a.unit)}<br><span style="font-size:10px;font-weight:400">(${a.maximum_mark})</span></th>`).join('');

  const bodyRowsHtml = data.learnerRows.map((r, idx) => `
    <tr>
      <td class="text-center text-muted">${idx + 1}</td>
      <td class="col-code">${Utils.escapeHtml(r.learnerCode)}</td>
      <td class="col-learner-name">${Utils.escapeHtml(r.name)}</td>
      <td class="text-center">${Utils.escapeHtml(r.gender)}</td>
      ${data.assessments.map(a => {
        const val = r.unitMarks[a.id];
        return `<td class="text-center ${val === 'N/R' ? 'text-nr' : 'font-medium'}">${val === 'N/R' ? 'N/R' : val}</td>`;
      }).join('')}
      <td class="font-bold text-center">${r.totalObtained}/${r.totalMax}</td>
      <td class="font-semibold text-center">${r.pct}%</td>
      <td class="text-center"><span class="badge badge-info">${r.grade}</span></td>
      <td class="text-center"><span class="${r.pf === 'PASS' ? 'badge-result-pass' : 'badge-result-fail'}">${r.pf}</span></td>
      <td class="font-bold text-center">${r.position}</td>
    </tr>`).join('');

  const unitPerfCardsHtml = data.unitPerf.map(u => `
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px">
      <div style="font-size:11px;color:var(--gray-500);font-weight:700;text-transform:uppercase">${Utils.escapeHtml(u.unit)}</div>
      <div style="font-size:18px;font-weight:800;color:var(--blue-900);margin-top:2px">${u.avg}%</div>
    </div>`).join('');

  const gradeDistHtml = Object.entries(data.gradeDist).sort().map(([g, c]) => `
    <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:var(--gray-100);border-radius:6px;font-size:12px">
      <strong>Grade ${g}:</strong> <span>${c} learners</span>
    </div>`).join('');

  const modalHtml = `
    <div class="report-paper-container" id="combined-printable-report">
      ${headerHtml}

      <div class="report-summary-section">
        <h4 style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-700);margin-bottom:12px">CLASS PERFORMANCE SUMMARY</h4>
        <div class="report-summary-grid">
          <div class="report-stat-card"><div class="val">${data.stats.totalCount}</div><div class="lbl">Total Learners</div></div>
          <div class="report-stat-card"><div class="val" style="color:var(--blue-600)">${data.stats.classAvg}%</div><div class="lbl">Class Average</div></div>
          <div class="report-stat-card"><div class="val" style="color:var(--green-600)">${data.stats.passRate}%</div><div class="lbl">Pass Rate</div></div>
          <div class="report-stat-card"><div class="val" style="color:var(--green-600)">${data.stats.highestPct}%</div><div class="lbl">Highest Score</div></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div>
            <h5 style="font-size:12px;font-weight:700;color:var(--gray-600);margin-bottom:8px;text-transform:uppercase">Unit Performance Summary</h5>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px">
              ${unitPerfCardsHtml}
            </div>
          </div>
          <div>
            <h5 style="font-size:12px;font-weight:700;color:var(--gray-600);margin-bottom:8px;text-transform:uppercase">Grade Distribution</h5>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${gradeDistHtml || '<span class="text-sm text-muted">No grade data</span>'}
            </div>
          </div>
        </div>
      </div>

      <div class="table-container" style="overflow-x:auto">
        <table class="report-marks-table">
          <thead>
            <tr>
              <th style="width:36px">No.</th>
              <th>Student Code</th>
              <th>Learner Name</th>
              <th style="width:40px">Gen</th>
              ${unitHeadersHtml}
              <th>Total Marks</th>
              <th>Average %</th>
              <th>Grade</th>
              <th>Result</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRowsHtml || `<tr><td colspan="${7 + data.assessments.length}">${Utils.empty('No learner records found')}</td></tr>`}
          </tbody>
        </table>
      </div>

      ${signatureHtml}
    </div>`;

  const footerHtml = `
    <button class="btn btn-outline" onclick="exportCombinedCSV()"><i data-lucide="file-text"></i> Export CSV</button>
    <button class="btn btn-secondary" onclick="exportCombinedExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel (.xlsx)</button>
    <button class="btn btn-primary" onclick="printCombinedReport()"><i data-lucide="printer"></i> Print / PDF Report</button>`;

  Modal.show('Official Consolidated Assessment Report Preview', modalHtml, footerHtml, true);
}

function printCombinedReport() {
  window.print();
}

function buildReportFilename(ext) {
  if (!lastCombinedReportData) return `RMS-MIS_Report_${new Date().toISOString().slice(0,10)}.${ext}`;
  const d = lastCombinedReportData;
  const clsStr = (d.cls?.name || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
  const subStr = (d.sub?.name || 'Subject').replace(/[^a-zA-Z0-9]/g, '_');
  const termStr = (d.term?.name || 'Term').replace(/[^a-zA-Z0-9]/g, '_');
  const yrStr = (d.year?.name || 'Year').replace(/[^a-zA-Z0-9]/g, '_');
  return `RMS-MIS_${clsStr}_${subStr}_Combined_Assessments_${termStr}_${yrStr}.${ext}`;
}

function exportCombinedCSV() {
  if (!lastCombinedReportData) return Utils.toast('No report data available', 'error');
  const d = lastCombinedReportData;

  let csv = [];
  csv.push(`"${d.settings.school_name || 'Rukara Model School'}"`);
  if (d.settings.school_motto) csv.push(`"${d.settings.school_motto}"`);
  csv.push(`"COMBINED ASSESSMENT PERFORMANCE REPORT"`);
  csv.push(`"Class: ${d.cls?.name || ''}","Subject: ${d.sub?.name || ''}","Academic Year: ${d.year?.name || ''}","Term: ${d.term?.name || ''}","Teacher: ${d.teacher || ''}"`);
  csv.push('');

  const headers = ['No.', 'Student Number', 'Learner Name', 'Gender'];
  d.assessments.forEach(a => headers.push(`${a.unit || a.name} (${a.maximum_mark})`));
  headers.push('Total Marks', 'Maximum Marks', d.weighted ? 'Weighted %' : 'Average %', 'Grade', 'Result', 'Rank');

  csv.push(headers.map(h => `"${h}"`).join(','));

  d.rows.forEach((r, idx) => {
    const row = [idx + 1, r.learnerCode, r.name, r.gender];
    d.assessments.forEach((a, j) => {
      row.push(r.units[j].hasMark ? r.units[j].mark : 'N/R');
    });
    row.push(r.pct == null ? 'N/R' : r.obtained, r.pct == null ? 'N/R' : r.denominator, r.pct == null ? 'N/R' : r.pct + '%', r.grade, r.pf, r.position);
    csv.push(row.map(v => `"${v}"`).join(','));
  });

  csv.push('');
  csv.push(`"Prepared by: ${d.teacher || ''}","Reviewed by: ${d.settings.dos_name || ''}","Approved by: ${d.settings.headteacher_name || ''}"`);

  const filename = buildReportFilename('csv');
  downloadCSVFile(filename, csv.join('\n'));
}

function exportCombinedExcel() {
  if (!lastCombinedReportData) return Utils.toast('No report data available', 'error');
  const d = lastCombinedReportData;

  let tableHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8">
  <style>
    body { font-family: 'Poppins', Arial, sans-serif; }
    h2, h3 { text-align: center; margin: 4px; color: #0f172a; }
    p.motto { text-align: center; font-style: italic; color: #475569; margin-bottom: 12px; }
    .header-table td { font-weight: bold; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th { background-color: #0f172a; color: #ffffff; border: 1px solid #334155; padding: 10px; text-align: center; font-size: 12px; }
    td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .pass { background-color: #dcfce7; color: #15803d; font-weight: bold; }
    .fail { background-color: #fee2e2; color: #dc2626; font-weight: bold; }
  </style>
  </head>
  <body>
    <h2>${Utils.escapeHtml(d.settings.school_name || 'Rukara Model School')}</h2>
    ${d.settings.school_motto ? `<p class="motto">${Utils.escapeHtml(d.settings.school_motto)}</p>` : ''}
    <h3>COMBINED ASSESSMENT PERFORMANCE REPORT</h3>
    <table class="header-table" style="border:none">
      <tr><td>Class: ${Utils.escapeHtml(d.cls?.name || '')}</td><td>Subject: ${Utils.escapeHtml(d.sub?.name || '')}</td></tr>
      <tr><td>Academic Year: ${Utils.escapeHtml(d.year?.name || '')}</td><td>Term: ${Utils.escapeHtml(d.term?.name || '')}</td></tr>
      <tr><td>Teacher: ${Utils.escapeHtml(d.teacher || '')}</td><td>Report Status: ${d.isOfficial ? 'OFFICIAL / APPROVED' : 'DRAFT / WORKING'}</td></tr>
    </table>
    <br>
    <table>
      <thead>
        <tr>
          <th>No.</th>
          <th>Student Number</th>
          <th>Learner Name</th>
          <th>Gender</th>
          ${d.assessments.map(a => `<th>${Utils.escapeHtml(a.unit || a.name)} (${a.maximum_mark})</th>`).join('')}
          <th>Total Marks</th>
          <th>Maximum Marks</th>
          <th>${d.weighted ? 'Weighted %' : 'Average %'}</th>
          <th>Grade</th>
          <th>Result</th>
          <th>Rank</th>
        </tr>
      </thead>
      <tbody>
        ${d.rows.map((r, idx) => `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center">${Utils.escapeHtml(r.learnerCode)}</td>
            <td>${Utils.escapeHtml(r.name)}</td>
            <td class="center">${Utils.escapeHtml(r.gender)}</td>
            ${d.assessments.map((a, j) => `<td class="center">${r.units[j].hasMark ? r.units[j].mark : 'N/R'}</td>`).join('')}
            <td class="center bold">${r.pct == null ? 'N/R' : r.obtained}</td>
            <td class="center bold">${r.pct == null ? 'N/R' : r.denominator}</td>
            <td class="center bold">${r.pct == null ? 'N/R' : r.pct + '%'}</td>
            <td class="center bold">${r.grade}</td>
            <td class="center ${r.pf === 'PASS' ? 'pass' : 'fail'}">${r.pf}</td>
            <td class="center bold">${r.position}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <br><br>
    <table>
      <tr>
        <td><strong>Prepared by:</strong> ${Utils.escapeHtml(d.teacher || '')}</td>
        <td><strong>Reviewed by:</strong> ${Utils.escapeHtml(d.settings.dos_name || '')}</td>
        <td><strong>Approved by:</strong> ${Utils.escapeHtml(d.settings.headteacher_name || '')}</td>
      </tr>
    </table>
  </body>
  </html>`;

  const blob = new Blob([tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = buildReportFilename('xls');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadCSVFile(filename, csvContent) {
  const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


