async function renderParentDashboard() {
  setHeader('Parent Dashboard', 'Your learner\'s academic performance');
  setContent(Utils.loading());

  try {
    const learnerId = Auth.getLearnerId();
    if (!learnerId) {
      setContent(Utils.error('No learner linked to your account. Please contact the school administrator.'));
      return;
    }

    const [learner, classes, assessments, marks, subjects, terms] = await Promise.all([
      sbClient.from('learners').select('*').eq('id', learnerId).maybeSingle().then(r => r.data),
      DB.get('classes').catch(() => []),
      sbClient.from('assessments').select('*').eq('status', 'locked').then(r => r.data || []).catch(() => []),
      sbClient.from('marks').select('*').eq('learner_id', learnerId).eq('status', 'locked').then(r => r.data || []).catch(() => []),
      DB.get('subjects').catch(() => []),
      DB.get('terms').catch(() => [])
    ]);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const learnerClass = classes.find(c => c.id === learner.class_id);
    const learnerAssessments = assessments.filter(a => a.class_id === learner.class_id);
    const learnerMarks = marks.filter(m => learnerAssessments.some(a => a.id === m.assessment_id));

    const subjectPerformance = {};
    learnerMarks.forEach(m => {
      const assessment = learnerAssessments.find(a => a.id === m.assessment_id);
      if (!assessment) return;
      const subj = subjects.find(s => s.id === assessment.subject_id);
      if (!subj) return;
      if (!subjectPerformance[subj.id]) subjectPerformance[subj.id] = { subject: subj, marks: [] };
      subjectPerformance[subj.id].marks.push({ mark: m, assessment });
    });

    const overallAvg = learnerMarks.length
      ? Math.round(learnerMarks.reduce((sum, m) => sum + (m.percentage || 0), 0) / learnerMarks.length)
      : null;

    const html = `
      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:24px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <div style="width:64px;height:64px;border-radius:50%;background:var(--blue-100);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:var(--blue-600)">
            ${Utils.initials(learner.full_name)}
          </div>
          <div>
            <h2 style="margin:0;font-size:20px;font-weight:700">${Utils.escapeHtml(learner.full_name)}</h2>
            <p style="margin:4px 0 0;color:var(--gray-500);font-size:14px">
              ${Utils.escapeHtml(learner.learner_code)} &middot; ${Utils.escapeHtml(learnerClass?.name || '-')} &middot; ${Utils.escapeHtml(learnerClass?.education_level || '-')}
            </p>
          </div>
        </div>
        ${overallAvg !== null ? `
          <div style="background:var(--blue-50);border:1px solid var(--blue-200);border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:var(--blue-600)">${overallAvg}%</div>
            <div style="font-size:12px;color:var(--gray-500)">Overall Average</div>
          </div>
        ` : '<p style="color:var(--gray-500)">No published marks yet.</p>'}
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:24px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Subject Performance</h3>
        ${Object.keys(subjectPerformance).length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
            ${Object.values(subjectPerformance).map(sp => {
              const avg = sp.marks.length
                ? Math.round(sp.marks.reduce((s, m) => s + (m.mark.percentage || 0), 0) / sp.marks.length)
                : null;
              return `
                <div style="border:1px solid var(--gray-200);border-radius:8px;padding:16px;text-align:center">
                  <div style="font-weight:600;margin-bottom:8px">${Utils.escapeHtml(sp.subject.name)}</div>
                  <div style="font-size:24px;font-weight:700;color:${avg !== null && avg >= 50 ? 'var(--green-600)' : 'var(--red-600)'}">${avg !== null ? avg + '%' : '-'}</div>
                  <div style="font-size:12px;color:var(--gray-500)">${sp.marks.length} assessment(s)</div>
                </div>`;
            }).join('')}
          </div>
        ` : '<p style="color:var(--gray-500)">No subject performance data yet.</p>'}
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Recent Published Results</h3>
        ${learnerMarks.length ? `
          <table class="table">
            <thead><tr><th>Assessment</th><th>Subject</th><th>Mark</th><th>%</th><th>Grade</th></tr></thead>
            <tbody>
              ${learnerMarks.slice(0, 10).map(m => {
                const a = learnerAssessments.find(x => x.id === m.assessment_id);
                const subj = subjects.find(s => s.id === a?.subject_id);
                return `<tr>
                  <td>${Utils.escapeHtml(a?.name || '-')}</td>
                  <td>${Utils.escapeHtml(subj?.name || '-')}</td>
                  <td>${m.mark}/${a?.maximum_mark || '-'}</td>
                  <td>${m.percentage || '-'}%</td>
                  <td>${Utils.escapeHtml(m.grade || '-')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        ` : '<p style="color:var(--gray-500)">No published results yet.</p>'}
      </div>
    `;

    setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    setContent(Utils.error('Failed to load performance data', e.message));
  }
}

async function renderParentPerformance() {
  setHeader('My Academic Performance', 'Detailed performance breakdown');
  setContent(Utils.loading());

  try {
    const learnerId = Auth.getLearnerId();
    if (!learnerId) {
      setContent(Utils.error('No learner linked to your account.'));
      return;
    }

    const [learner, classes, subjects, terms, assessments, marks] = await Promise.all([
      sbClient.from('learners').select('*').eq('id', learnerId).maybeSingle().then(r => r.data),
      DB.get('classes').catch(() => []),
      DB.get('subjects').catch(() => []),
      DB.get('terms').catch(() => []),
      sbClient.from('assessments').select('*').eq('status', 'locked').then(r => r.data || []).catch(() => []),
      sbClient.from('marks').select('*').eq('learner_id', learnerId).eq('status', 'locked').then(r => r.data || []).catch(() => [])
    ]);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const learnerClass = classes.find(c => c.id === learner.class_id);
    const learnerAssessments = assessments.filter(a => a.class_id === learner.class_id);
    const learnerMarks = marks.filter(m => learnerAssessments.some(a => a.id === m.assessment_id));

    const selectedTerm = terms[0]?.id || null;
    const filteredAssessments = selectedTerm
      ? learnerAssessments.filter(a => a.term_id === selectedTerm)
      : learnerAssessments;
    const filteredMarks = learnerMarks.filter(m => filteredAssessments.some(a => a.id === m.assessment_id));

    const subjectBreakdown = {};
    filteredMarks.forEach(m => {
      const a = filteredAssessments.find(x => x.id === m.assessment_id);
      if (!a) return;
      const subj = subjects.find(s => s.id === a.subject_id);
      if (!subj) return;
      if (!subjectBreakdown[subj.id]) subjectBreakdown[subj.id] = { subject: subj, marks: [], assessments: [] };
      subjectBreakdown[subj.id].marks.push(m);
      subjectBreakdown[subj.id].assessments.push(a);
    });

    const overallAvg = filteredMarks.length
      ? Math.round(filteredMarks.reduce((s, m) => s + (m.percentage || 0), 0) / filteredMarks.length)
      : null;

    const html = `
      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <div class="card" style="flex:1;min-width:200px;background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:36px;font-weight:700;color:var(--blue-600)">${overallAvg !== null ? overallAvg + '%' : '-'}</div>
          <div style="font-size:12px;color:var(--gray-500)">Overall Average</div>
        </div>
        <div class="card" style="flex:1;min-width:200px;background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:36px;font-weight:700;color:var(--green-600)">${filteredMarks.filter(m => (m.percentage || 0) >= 50).length}</div>
          <div style="font-size:12px;color:var(--gray-500)">Passed</div>
        </div>
        <div class="card" style="flex:1;min-width:200px;background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:36px;font-weight:700;color:var(--red-600)">${filteredMarks.filter(m => (m.percentage || 0) < 50).length}</div>
          <div style="font-size:12px;color:var(--gray-500)">Failed</div>
        </div>
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px;margin-bottom:24px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Subject Breakdown</h3>
        ${Object.keys(subjectBreakdown).length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
            ${Object.values(subjectBreakdown).map(sb => {
              const avg = sb.marks.length
                ? Math.round(sb.marks.reduce((s, m) => s + (m.percentage || 0), 0) / sb.marks.length)
                : null;
              return `
                <div style="border:1px solid var(--gray-200);border-radius:8px;padding:16px">
                  <div style="font-weight:600;margin-bottom:12px">${Utils.escapeHtml(sb.subject.name)}</div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <span style="font-size:12px;color:var(--gray-500)">Average</span>
                    <span style="font-weight:700;color:${avg !== null && avg >= 50 ? 'var(--green-600)' : 'var(--red-600)'}">${avg !== null ? avg + '%' : '-'}</span>
                  </div>
                  <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
                    <div style="background:${avg !== null && avg >= 50 ? 'var(--green-500)' : 'var(--red-500)'};height:100%;width:${avg || 0}%"></div>
                  </div>
                  <div style="margin-top:12px;font-size:12px;color:var(--gray-500)">
                    ${sb.marks.length} assessment(s)
                  </div>
                </div>`;
            }).join('')}
          </div>
        ` : '<p style="color:var(--gray-500)">No subject data available.</p>'}
      </div>

      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Assessment Results</h3>
        ${filteredMarks.length ? `
          <table class="table">
            <thead><tr><th>Assessment</th><th>Subject</th><th>Term</th><th>Mark</th><th>%</th><th>Grade</th></tr></thead>
            <tbody>
              ${filteredMarks.map(m => {
                const a = filteredAssessments.find(x => x.id === m.assessment_id);
                const subj = subjects.find(s => s.id === a?.subject_id);
                const term = terms.find(t => t.id === a?.term_id);
                return `<tr>
                  <td>${Utils.escapeHtml(a?.name || '-')}</td>
                  <td>${Utils.escapeHtml(subj?.name || '-')}</td>
                  <td>${Utils.escapeHtml(term?.name || '-')}</td>
                  <td>${m.mark}/${a?.maximum_mark || '-'}</td>
                  <td>${m.percentage || '-'}%</td>
                  <td>${Utils.escapeHtml(m.grade || '-')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        ` : '<p style="color:var(--gray-500)">No published results available.</p>'}
      </div>
    `;

    setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    setContent(Utils.error('Failed to load performance data', e.message));
  }
}

async function renderParentReports() {
  setHeader('Reports', 'Download your learner\'s academic reports');
  setContent(Utils.loading());

  try {
    const learnerId = Auth.getLearnerId();
    if (!learnerId) {
      setContent(Utils.error('No learner linked to your account.'));
      return;
    }

    const [learner, classes, assessments, marks, subjects] = await Promise.all([
      sbClient.from('learners').select('*').eq('id', learnerId).maybeSingle().then(r => r.data),
      DB.get('classes').catch(() => []),
      sbClient.from('assessments').select('*').eq('status', 'locked').then(r => r.data || []).catch(() => []),
      sbClient.from('marks').select('*').eq('learner_id', learnerId).eq('status', 'locked').then(r => r.data || []).catch(() => []),
      DB.get('subjects').catch(() => [])
    ]);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const learnerClass = classes.find(c => c.id === learner.class_id);
    const learnerAssessments = assessments.filter(a => a.class_id === learner.class_id);
    const learnerMarks = marks.filter(m => learnerAssessments.some(a => a.id === m.assessment_id));

    const html = `
      <div class="card" style="background:#fff;border:1px solid var(--gray-200);border-radius:12px;padding:24px">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Available Reports</h3>
        <p style="color:var(--gray-500);margin-bottom:24px">Select a report to view or download your learner's academic performance.</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
          <div class="card" style="border:1px solid var(--gray-200);border-radius:8px;padding:20px">
            <h4 style="margin:0 0 8px;font-size:14px;font-weight:600">Overall Performance Summary</h4>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:16px">Complete overview of all subjects and assessments</p>
            <button class="btn btn-primary btn-sm" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
          </div>

          <div class="card" style="border:1px solid var(--gray-200);border-radius:8px;padding:20px">
            <h4 style="margin:0 0 8px;font-size:14px;font-weight:600">Subject Performance</h4>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:16px">Detailed breakdown by subject</p>
            <button class="btn btn-primary btn-sm" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
          </div>

          <div class="card" style="border:1px solid var(--gray-200);border-radius:8px;padding:20px">
            <h4 style="margin:0 0 8px;font-size:14px;font-weight:600">Assessment Results</h4>
            <p style="font-size:12px;color:var(--gray-500);margin-bottom:16px">All published assessment marks and grades</p>
            <button class="btn btn-primary btn-sm" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
          </div>
        </div>

        ${learnerMarks.length ? `
          <div style="margin-top:24px">
            <h4 style="margin:0 0 12px;font-size:14px;font-weight:600">Performance Summary</h4>
            <table class="table">
              <thead><tr><th>Subject</th><th>Assessments</th><th>Average</th></tr></thead>
              <tbody>
                ${Object.entries(learnerMarks.reduce((acc, m) => {
                  const a = learnerAssessments.find(x => x.id === m.assessment_id);
                  const subj = subjects.find(s => s.id === a?.subject_id);
                  if (!subj) return acc;
                  if (!acc[subj.id]) acc[subj.id] = { name: subj.name, marks: [] };
                  acc[subj.id].marks.push(m);
                  return acc;
                }, {})).map(([_, v]) => {
                  const avg = v.marks.length ? Math.round(v.marks.reduce((s, m) => s + (m.percentage || 0), 0) / v.marks.length) : null;
                  return `<tr>
                    <td>${Utils.escapeHtml(v.name)}</td>
                    <td>${v.marks.length}</td>
                    <td>${avg !== null ? avg + '%' : '-'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p style="color:var(--gray-500);margin-top:24px">No published results available for reports.</p>'}
      </div>
    `;

    setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    setContent(Utils.error('Failed to load reports', e.message));
  }
}
