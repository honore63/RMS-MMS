async function loadParentMarksContext(learnerId) {
  const visibleAssessmentStatuses = ['submitted', 'approved', 'locked'];
  const [learners, classes, marks, subjects, terms] = await Promise.all([
    DB.getFresh('learners', { id: learnerId }, { select: 'id,full_name,learner_code,class_id' }),
    DB.get('classes', {}, { select: 'id,name,education_level' }),
    DB.getFresh('marks', { learner_id: learnerId }, {
      select: 'id,assessment_id,learner_id,mark,percentage,grade,status'
    }),
    DB.get('subjects', {}, { select: 'id,name,status,level,education_level' }),
    DB.get('terms', {}, { select: 'id,name,academic_year_id,term_no,status,is_current' })
  ]);
  const learner = learners[0] || null;
  if (!learner) return { learner, classes, assessments: [], marks, subjects, terms };

  const assessmentIds = [...new Set(marks.map(mark => mark.assessment_id).filter(Boolean))];
  const assessmentBatches = [];
  for (let i = 0; i < assessmentIds.length; i += 100) {
    assessmentBatches.push(assessmentIds.slice(i, i + 100));
  }
  const assessments = (await Promise.all(assessmentBatches.map(ids =>
    DB.getFresh('assessments', { id: ids, status: visibleAssessmentStatuses }, {
      select: 'id,name,display_name,class_id,subject_id,maximum_mark,term_id,assessment_date,status'
    })
  ))).flat();
  const visibleAssessmentIds = new Set(assessments.map(assessment => String(assessment.id)));
  const visibleMarks = marks.filter(mark => visibleAssessmentIds.has(String(mark.assessment_id)));
  return { learner, classes, assessments, marks: visibleMarks, subjects, terms };
}

async function renderParentDashboard() {
  setHeader('Parent Dashboard', 'Your learner\'s academic performance');
  setContent(Utils.loading());

  try {
    const learnerId = Auth.getLearnerId();
    if (!learnerId) {
      setContent(Utils.error('No learner linked to your account. Please contact the school administrator.'));
      return;
    }

    const { learner, classes, assessments, marks, subjects } = await loadParentMarksContext(learnerId);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const learnerClass = classes.find(c => c.id === learner.class_id);
    const learnerAssessments = assessments.filter(a => {
      if (a.class_id !== learner.class_id) return false;
      const subject = subjects.find(item => item.id === a.subject_id);
      return EducationLevels.subjectMatchesClass(subject, learnerClass);
    });
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

    const { learner, classes, subjects, terms, assessments, marks } = await loadParentMarksContext(learnerId);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const learnerClass = classes.find(c => c.id === learner.class_id);
    const learnerAssessments = assessments.filter(a => {
      if (a.class_id !== learner.class_id) return false;
      const subject = subjects.find(item => item.id === a.subject_id);
      return EducationLevels.subjectMatchesClass(subject, learnerClass);
    });
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

    const [learner, classes, years, terms] = await Promise.all([
      sbClient.from('learners').select('id,full_name,learner_code,class_id').eq('id', learnerId).maybeSingle().then(r => r.data),
      DB.get('classes', {}, { select: 'id,name,education_level' }).catch(() => []),
      DB.get('academic_years', {}, { select: 'id,name,status,is_current' }),
      DB.get('terms', {}, { select: 'id,name,academic_year_id,term_no,status,is_current' })
    ]);

    if (!learner) {
      setContent(Utils.error('Learner record not found.'));
      return;
    }

    const orderedYears = years.slice().sort((a, b) => String(b.name).localeCompare(String(a.name)));
    const activeYear = orderedYears.find(year => year.status === 'active' || year.is_current) || orderedYears[0];
    const activeTerms = terms.filter(term => !activeYear || String(term.academic_year_id) === String(activeYear.id));
    const selectedTerm = activeTerms.find(term => term.status === 'active' || term.is_current) || activeTerms[0];
    ParentReports.state = {
      learner,
      cls: classes.find(cls => String(cls.id) === String(learner.class_id)) || null,
      years: orderedYears,
      terms,
      yearId: activeYear?.id || '',
      termId: selectedTerm?.id || ''
    };

    const html = ParentReports.render();

    setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    setContent(Utils.error('Failed to load reports', e.message));
  }
}

const ParentReports = {
  state: null,

  render() {
    const state = this.state;
    const filteredTerms = state.terms
      .filter(term => !state.yearId || String(term.academic_year_id) === String(state.yearId))
      .sort((a, b) => Number(a.term_no || 0) - Number(b.term_no || 0));
    return `
      <section class="card" style="padding:24px">
        <h3 style="margin:0 0 8px;font-size:18px;font-weight:700">Official Student Report Card</h3>
        <p style="color:var(--gray-500);margin:0 0 20px">Generate the report card with all submitted results for this learner, including results that have not been approved or locked.</p>
        <div class="flex gap-4 items-end" style="flex-wrap:wrap">
          <div class="form-group" style="min-width:200px">
            <label for="parent-report-year">Academic Year</label>
            <select id="parent-report-year" class="select-field" onchange="ParentReports.changeYear(this.value)">
              <option value="">Select Year</option>
              ${state.years.map(year => `<option value="${year.id}" ${String(state.yearId) === String(year.id) ? 'selected' : ''}>${Utils.escapeHtml(year.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="min-width:180px">
            <label for="parent-report-term">Term</label>
            <select id="parent-report-term" class="select-field" onchange="ParentReports.changeTerm(this.value)">
              <option value="">Select Term</option>
              ${filteredTerms.map(term => `<option value="${term.id}" ${String(state.termId) === String(term.id) ? 'selected' : ''}>${Utils.escapeHtml(term.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" type="button" onclick="ParentReports.generate()"><i data-lucide="file-badge"></i> Generate Report</button>
        </div>
        <div id="parent-report-preview" style="margin-top:24px"></div>
      </section>`;
  },

  changeYear(yearId) {
    const state = this.state;
    state.yearId = yearId;
    const terms = state.terms
      .filter(term => !yearId || String(term.academic_year_id) === String(yearId))
      .sort((a, b) => Number(a.term_no || 0) - Number(b.term_no || 0));
    const activeTerm = terms.find(term => term.status === 'active' || term.is_current) || terms[0];
    state.termId = activeTerm?.id || '';
    const select = document.getElementById('parent-report-term');
    if (select) {
      select.innerHTML = '<option value="">Select Term</option>' + terms.map(term =>
        `<option value="${term.id}" ${String(state.termId) === String(term.id) ? 'selected' : ''}>${Utils.escapeHtml(term.name)}</option>`
      ).join('');
    }
    const preview = document.getElementById('parent-report-preview');
    if (preview) preview.innerHTML = '';
  },

  changeTerm(termId) {
    this.state.termId = termId;
    const preview = document.getElementById('parent-report-preview');
    if (preview) preview.innerHTML = '';
  },

  async generate() {
    const state = this.state;
    const preview = document.getElementById('parent-report-preview');
    if (!preview || !state) return;
    if (!state.cls) {
      preview.innerHTML = Utils.error('The learner is not assigned to a class.');
      return;
    }
    if (!state.yearId || !state.termId) {
      preview.innerHTML = Utils.error('Select an academic year and term.');
      return;
    }
    if (typeof ReportStudent === 'undefined' || typeof ReportWizard === 'undefined') {
      preview.innerHTML = Utils.error('The official report service is unavailable. Please reload and try again.');
      return;
    }
    preview.innerHTML = Utils.loading();
    try {
      const { data, error } = await sbClient.rpc('get_student_marks_portal', {
        p_class_id: state.cls.id,
        p_learner_code: state.learner.learner_code,
        p_academic_year_id: state.yearId,
        p_term_id: state.termId
      });
      if (error) throw error;
      if (!data?.student || String(data.student.id) !== String(state.learner.id)
        || String(data.academic_year?.id) !== String(state.yearId)
        || String(data.term?.id) !== String(state.termId)) {
        throw new Error('The report data did not match the selected learner and reporting period.');
      }
      const card = await ReportStudent.buildPortalCard(data);
      if (!card.withMarks) {
        preview.innerHTML = '<p class="text-muted">No submitted results are available for this learner in the selected term.</p>';
        return;
      }
      const html = ReportStudent.renderCard(card);
      const safePart = value => String(value || '').replace(/[^a-z0-9_-]/gi, '_');
      ReportWizard.state.previewHtml = html;
      ReportWizard.state.previewOrientation = 'portrait';
      ReportWizard.state.previewConfig = '';
      ReportWizard.state.previewFilename = `RMS-MIS_Student_Report_${safePart(state.learner.learner_code || 'RMS')}_${safePart(card.year?.name || '')}_${safePart(card.term?.name || '')}.pdf`;
      preview.innerHTML = `
        <div class="report-preview-toolbar-flex no-print" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><h4 style="font-size:16px;font-weight:700;margin:0">Official Student Report</h4><p class="text-sm text-muted" style="margin:4px 0 0">${Utils.escapeHtml(state.learner.full_name)}</p></div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" onclick="ReportWizard.print()"><i data-lucide="printer"></i> Print</button>
            <button class="btn btn-primary btn-sm" onclick="ReportWizard.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
          </div>
        </div>
        <div class="pmp-report-preview rms-full-report-preview">${html}</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
      preview.innerHTML = Utils.error('Failed to generate report', error.message);
    }
  }
};
