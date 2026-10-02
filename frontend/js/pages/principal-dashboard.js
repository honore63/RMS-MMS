async function renderPrincipalDashboard() {
  setHeader('Principal Dashboard', 'School-wide overview and management');
  setContent(Utils.loading());

  try {
    const [learners, teachers, dosUsers, classes, subjects, assessments, marks, parents] = await Promise.all([
      DB.get('learners').catch(() => []),
      DB.get('teachers').catch(() => []),
      sbClient.from('users').select('*').eq('role', 'dos').then(r => r.data || []).catch(() => []),
      DB.get('classes').catch(() => []),
      DB.get('subjects').catch(() => []),
      DB.get('assessments').catch(() => []),
      DB.get('marks').catch(() => []),
      sbClient.from('users').select('*').eq('role', 'parent').then(r => r.data || []).catch(() => [])
    ]);

    const primaryLearners = learners.filter(l => {
      const cls = classes.find(c => c.id === l.class_id);
      return cls && (cls.education_level === 'Primary' || cls.education_level === 'PRIMARY');
    });
    const secondaryLearners = learners.filter(l => {
      const cls = classes.find(c => c.id === l.class_id);
      return cls && (cls.education_level === 'Lower Secondary' || cls.education_level === 'Upper Secondary' || cls.education_level === 'SECONDARY');
    });

    const primaryTeachers = teachers.filter(t => t.education_level === 'PRIMARY' || t.education_level === 'Primary');
    const secondaryTeachers = teachers.filter(t => t.education_level === 'SECONDARY' || t.education_level === 'Secondary');

    const primaryDos = dosUsers.filter(d => d.education_level === 'PRIMARY' || d.education_level === 'Primary');
    const secondaryDos = dosUsers.filter(d => d.education_level === 'SECONDARY' || d.education_level === 'Secondary');

    const pendingMarks = marks.filter(m => m.status === 'draft').length;
    const submittedMarks = marks.filter(m => m.status === 'submitted').length;
    const approvedMarks = marks.filter(m => m.status === 'locked').length;

    const recentAssessments = assessments
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);

    const statCards = [
      { label: 'Total Learners', value: learners.length, icon: 'users', color: 'blue' },
      { label: 'Primary Learners', value: primaryLearners.length, icon: 'user-check', color: 'green' },
      { label: 'Secondary Learners', value: secondaryLearners.length, icon: 'user-check', color: 'purple' },
      { label: 'Total Teachers', value: teachers.length, icon: 'briefcase', color: 'orange' },
      { label: 'Primary Teachers', value: primaryTeachers.length, icon: 'briefcase', color: 'teal' },
      { label: 'Secondary Teachers', value: secondaryTeachers.length, icon: 'briefcase', color: 'indigo' },
      { label: 'Total DOS', value: dosUsers.length, icon: 'shield', color: 'red' },
      { label: 'Primary DOS', value: primaryDos.length, icon: 'shield', color: 'pink' },
      { label: 'Secondary DOS', value: secondaryDos.length, icon: 'shield', color: 'rose' },
      { label: 'Parents/Guardians', value: parents.length, icon: 'heart', color: 'amber' },
      { label: 'Total Classes', value: classes.length, icon: 'school', color: 'cyan' },
      { label: 'Total Subjects', value: subjects.length, icon: 'book-open', color: 'lime' },
      { label: 'Pending Marks', value: pendingMarks, icon: 'clock', color: 'yellow' },
      { label: 'Submitted Marks', value: submittedMarks, icon: 'send', color: 'blue' },
      { label: 'Approved Marks', value: approvedMarks, icon: 'check-circle', color: 'green' }
    ];

    const html = `
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        ${statCards.map(s => `
          <div class="stat-card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:var(--${s.color}-600)">${s.value}</div>
            <div style="font-size:12px;color:var(--gray-500);margin-top:4px">${s.label}</div>
          </div>`).join('')}
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:24px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Recent Assessments</h3>
        ${recentAssessments.length ? `
          <table class="table">
            <thead><tr><th>Name</th><th>Class</th><th>Subject</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${recentAssessments.map(a => {
                const cls = classes.find(c => c.id === a.class_id);
                const subj = subjects.find(s => s.id === a.subject_id);
                return `<tr>
                  <td>${Utils.escapeHtml(a.name)}</td>
                  <td>${Utils.escapeHtml(cls?.name || '-')}</td>
                  <td>${Utils.escapeHtml(subj?.name || '-')}</td>
                  <td><span class="badge badge-${a.status}">${a.status}</span></td>
                  <td>${a.assessment_date || '-'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        ` : '<p style="color:var(--gray-500)">No assessments yet.</p>'}
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Quick Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:12px">
          <button class="btn btn-primary" onclick="Router.go('admin/learners')"><i data-lucide="user-plus"></i> Manage Learners</button>
          <button class="btn btn-primary" onclick="Router.go('admin/teachers')"><i data-lucide="users"></i> Manage Teachers</button>
          <button class="btn btn-primary" onclick="Router.go('admin/assessments')"><i data-lucide="file-text"></i> View Assessments</button>
          <button class="btn btn-primary" onclick="Router.go('admin/reports')"><i data-lucide="bar-chart-3"></i> Reports</button>
          <button class="btn btn-primary" onclick="Router.go('admin/analytics')"><i data-lucide="trending-up"></i> Analytics</button>
          <button class="btn btn-primary" onclick="Router.go('admin/settings')"><i data-lucide="settings"></i> Settings</button>
        </div>
      </div>
    `;

    setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    setContent(Utils.error('Failed to load dashboard', e.message));
  }
}
