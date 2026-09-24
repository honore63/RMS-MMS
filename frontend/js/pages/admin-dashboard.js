let adminDashboardEduLevel = 'all';

async function renderAdminDashboard() {
  setHeader('Dashboard', `Welcome back, ${Auth.currentUser?.full_name}`);
  setContent(`<div class="grid-4"><div class="card card-in"><div class="spinner" style="margin:0 auto;width:28px;height:28px"></div></div><div class="card card-in"></div><div class="card card-in"></div><div class="card card-in"></div></div>`);

  try {
    const [teachers, allClasses, allAssessments] = await Promise.all([
      DB.count('teachers'),
      DB.get('classes'),
      DB.get('assessments', {}, { select: 'id,class_id,subject_id,teacher_id,status,created_at' })
    ]);

    // Apply Education Level Filter (scoped DOS is locked to its level)
    const scoped = (typeof Scope !== 'undefined' && Scope.isScoped());
    let classes = allClasses;
    if (scoped) {
      classes = allClasses.filter(c => Scope.matchesClass(c));
    } else if (adminDashboardEduLevel !== 'all') {
      classes = allClasses.filter(c => EducationLevels.getCategory(c) === adminDashboardEduLevel);
    }
    const classIds = classes.map(c => c.id);

    // Filter assessments based on filtered classes
    const assessments = (allAssessments || []).filter(a => {
      if (!scoped && adminDashboardEduLevel === 'all') return true;
      return classIds.includes(a.class_id);
    });

    // Learner count only, never load full table
    const learners = (!scoped && adminDashboardEduLevel === 'all')
      ? await DB.count('learners')
      : classIds.length ? await DB.count('learners', { class_id: classIds }) : 0;

    const completed = assessments.filter(a => ['approved','locked'].includes(a.status)).length;
    const pending = assessments.filter(a => a.status === 'draft').length;
    const submitted = assessments.filter(a => a.status === 'submitted').length;
    const approved = assessments.filter(a => a.status === 'approved' || a.status === 'locked').length;

    const recent = [...assessments].sort((x, y) => String(y.created_at||'').localeCompare(String(x.created_at||''))).slice(0, 8);
    const recentSubjectIds = [...new Set(recent.map(a => a.subject_id).filter(Boolean))];
    const recentTeacherIds = [...new Set(recent.map(a => a.teacher_id).filter(Boolean))];
    const [subjects, teachersList] = await Promise.all([
      recentSubjectIds.length ? DB.get('subjects', { id: recentSubjectIds }, { select: 'id,name' }) : [],
      recentTeacherIds.length ? DB.get('teachers', { id: recentTeacherIds }, { select: 'id,full_name' }) : []
    ]);
    const subjMap = new Map(subjects.map(s => [s.id, s]));
    const teachMap = new Map(teachersList.map(t => [t.id, t]));
    let recentRows = '';
    for (const a of recent) {
      const cls = allClasses.find(c => c.id === a.class_id);
      const subj = subjMap.get(a.subject_id);
      const teach = teachMap.get(a.teacher_id);
      const cat = Utils.escapeHtml(EducationLevels.getCategory(cls));
      recentRows += `<tr>
        <td class="col-name">${Utils.escapeHtml(teach?.full_name||'-')}</td>
        <td><span style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;display:block;margin-bottom:2px">${cat}</span>${Utils.escapeHtml(cls?.name||'-')}</td>
        <td>${Utils.escapeHtml(subj?.name||'-')}</td>
        <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
      </tr>`;
    }

    const actions = [
      { icon: 'user-plus', bg: 'var(--blue-50)', color: 'var(--blue-600)', title: 'Register Learner', desc: 'Add a new learner to RMS', route: 'admin/learners' },
      { icon: 'file-up', bg: 'var(--green-50)', color: 'var(--green-600)', title: 'Import Learners', desc: 'Bulk import from a spreadsheet', route: 'admin/learners' },
      { icon: 'clipboard-plus', bg: 'var(--amber-50)', color: 'var(--amber-600)', title: 'Create Assessment', desc: 'Start a new assessment (quiz, EOU, etc.)', route: 'admin/assessments' },
      { icon: 'calculator', bg: 'var(--blue-50)', color: 'var(--blue-600)', title: 'Enter Marks', desc: 'Record marks for a class', route: 'admin/marks' },
      { icon: 'graduation-cap', bg: 'var(--green-50)', color: 'var(--green-600)', title: 'Manage Teachers', desc: 'Add and manage teaching staff', route: 'admin/teachers' },
{ icon: 'school', bg: 'var(--amber-50)', color: 'var(--amber-600)', title: 'Manage Classes', desc: 'Set up classes and subjects', route: 'admin/academic' },
       { icon: 'file-bar-chart', bg: 'var(--blue-50)', color: 'var(--blue-600)', title: 'Report Center', desc: 'Generate academic reports', route: 'admin/reports' },
       { icon: 'settings', bg: 'var(--gray-100)', color: 'var(--gray-600)', title: 'School Settings', desc: 'Configure school information', route: 'admin/settings' }
    ];
    const actionCards = actions.map(a => `
      <button class="action-card" onclick="Router.go('${a.route}')" aria-label="${a.title}">
        <span class="ac-icon" style="background:${a.bg};color:${a.color}"><i data-lucide="${a.icon}"></i></span>
        <h4>${a.title}</h4>
        <p>${a.desc}</p>
        <span class="ac-open">Open <i data-lucide="arrow-right"></i></span>
      </button>`).join('');

    const filterHtml = scoped ? `
      <div class="card mb-6" style="padding:16px 20px; background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(37,99,235,0.05))">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-weight:700;color:var(--blue-800)"><i data-lucide="shield-check" style="width:16px;height:16px;vertical-align:middle"></i> Your Scope:</div>
          <div><span class="badge badge-info" style="font-size:12px;font-weight:700">${Utils.escapeHtml(Scope.label())}</span>
          <span class="text-sm text-muted" style="margin-left:10px">${Scope.isPrimary() ? '📗 Primary (P1-P6)' : '📘📙 Secondary (S1-S6)'}</span></div>
        </div>
      </div>
    ` : `
      <div class="card mb-6" style="padding:16px 20px; background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(37,99,235,0.05))">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-weight:700;color:var(--blue-800)"><i data-lucide="filter" style="width:16px;height:16px;vertical-align:middle"></i> View Scope:</div>
          <select class="select-field" style="width:250px;margin:0" onchange="adminDashboardEduLevel=this.value;renderAdminDashboard()">
            <option value="all">🎓 All Education Levels (Global)</option>
            <option value="Primary" ${adminDashboardEduLevel==='Primary'?'selected':''}>📗 Primary Only (P1-P6)</option>
            <option value="Lower Secondary" ${adminDashboardEduLevel==='Lower Secondary'?'selected':''}>📘 Lower Secondary (S1-S3)</option>
            <option value="Upper Secondary" ${adminDashboardEduLevel==='Upper Secondary'?'selected':''}>📙 Upper Secondary (S4-S6)</option>
          </select>
        </div>
      </div>
    `;

    setContent(`
      ${filterHtml}
      <div class="grid-4 card-in-stagger mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="users"></i></div>
          <div class="stat-value">${learners}</div>
          <div class="stat-label">Total Learners</div>
          <div class="stat-desc"><i data-lucide="users"></i> Enrolled across filtered classes</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="user-check"></i></div>
          <div class="stat-value">${teachers}</div>
          <div class="stat-label">Total Teachers</div>
          <div class="stat-desc"><i data-lucide="user-check"></i> Active teaching staff</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--amber-50);color:var(--amber-600)"><i data-lucide="school"></i></div>
          <div class="stat-value">${classes.length}</div>
          <div class="stat-label">Structured Classes</div>
          <div class="stat-desc"><i data-lucide="school"></i> Selected level classes</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#faf5ff;color:#9333ea"><i data-lucide="file-text"></i></div>
          <div class="stat-value">${assessments.length}</div>
          <div class="stat-label">Total Assessments</div>
          <div class="stat-desc"><i data-lucide="file-text"></i> For selected context</div>
        </div>
      </div>
      <div class="grid-4 card-in-stagger mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="check-circle-2"></i></div>
          <div class="stat-value" style="color:var(--green-600)">${completed}</div>
          <div class="stat-label">Completed</div>
          <div class="stat-desc"><i data-lucide="check-circle-2"></i> Approved &amp; locked</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--amber-50);color:var(--amber-600)"><i data-lucide="file-edit"></i></div>
          <div class="stat-value" style="color:var(--amber-600)">${pending}</div>
          <div class="stat-label">Draft</div>
          <div class="stat-desc"><i data-lucide="file-edit"></i> Awaiting completion</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="send"></i></div>
          <div class="stat-value" style="color:var(--blue-600)">${submitted}</div>
          <div class="stat-label">Submitted</div>
          <div class="stat-desc"><i data-lucide="send"></i> Awaiting your review</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="shield-check"></i></div>
          <div class="stat-value" style="color:var(--green-600)">${approved}</div>
          <div class="stat-label">Approved</div>
          <div class="stat-desc"><i data-lucide="shield-check"></i> Finalised results</div>
        </div>
      </div>

      <div class="card-grid card-in-stagger mb-6">
        ${actionCards}
      </div>

      <div class="card card-in mb-6">
        <div class="card-header">
          <div>
            <h3><i data-lucide="clock" style="width:18px;height:18px;color:var(--blue-600)"></i> Recent Assessments</h3>
            <p class="card-subtitle">Latest assessment activity across selected classes</p>
          </div>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>${recentRows || `<tr><td colspan="4">${Utils.empty('No assessments yet', 'file-text')}</td></tr>`}</tbody>
          </table>
        </div>
        <div class="card-footer">
          <span>Showing the latest ${recent.length} assessments</span>
          <button class="btn btn-sm btn-outline" onclick="Router.go('admin/marks')"><i data-lucide="arrow-right" style="width:14px;height:14px"></i> View All Marks</button>
        </div>
      </div>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('Admin dashboard error:', err);
    setContent(`
      <div class="error-card">
        <div class="error-icon"><i data-lucide="alert-triangle"></i></div>
        <h3>Unable to Load Data</h3>
        <p>We couldn't retrieve your dashboard information. Please try again.</p>
        <button class="btn btn-primary" onclick="renderAdminDashboard()"><i data-lucide="refresh-cw" style="width:16px;height:16px"></i> Try Again</button>
      </div>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}