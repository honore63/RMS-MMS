/* ============================================================
   admin-report-card.js
   Official Student Report Card for RMS-MIS
   Modelled STRICTLY on the uploaded Rukara Model School image.
   ============================================================ */

let rcState = {
  yearId:       '',
  termIds:      [],        // multi-term selection
  classId:      '',
  learnerId:    '',
  subjectIds:   [],        // 'all' or specific IDs
  allSubjects:  true,
  reportType:   'individual', 
  annualMode:   true       // enabled by default
};

function rcLevelLabel(level) {
  if (!level) return 'PRIMARY';
  const l = String(level).toUpperCase();
  if (['P1','P2','P3','P4','P5','P6'].includes(l)) return 'PRIMARY';
  if (['S1','S2','S3'].includes(l)) return 'LOWER SECONDARY';
  if (['S4','S5','S6'].includes(l)) return 'UPPER SECONDARY';
  return 'PRIMARY';
}

function getOfficialReportCardHtml(years, classes, subjects, terms, filteredTerms) {
  if (!rcState.yearId && typeof getActiveYearId === 'function') {
    rcState.yearId = getActiveYearId(years) || (years[0] ? years[0].id : '');
  }
  return `
    <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:14px;
                background:linear-gradient(135deg,#1e3a5f 0%,#184e9b 100%);
                color:#fff;margin-bottom:24px;box-shadow:0 4px 18px rgba(29,78,216,.35)">
      <div style="background:rgba(255,255,255,.18);border-radius:12px;padding:12px;flex-shrink:0">
        <i data-lucide="file-badge" style="width:32px;height:32px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:18px;font-weight:800">Official Report Card Generator</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">
          Dynamic A4 report card exactly matching the provided Rukara Model School blueprint.
        </div>
      </div>
    </div>

    <div class="card mb-6">
      <div class="card-header">
        <h3><i data-lucide="settings-2" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Configuration</h3>
      </div>
      <div class="flex gap-4 items-end mb-4" style="flex-wrap:wrap">
        <div class="form-group" style="min-width:160px">
          <label>Academic Year <span class="required">*</span></label>
          <select id="rc-year" class="select-field" onchange="rcPickYear(this.value)">
            <option value="">Select Year</option>
            ${years.map(y => `<option value="${y.id}" ${rcState.yearId===y.id?'selected':''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:150px">
          <label>Class <span class="required">*</span></label>
          <select id="rc-class" class="select-field" onchange="rcPickClass(this.value)">
            <option value="">Select Class</option>
            ${classes.map(c => `<option value="${c.id}" ${rcState.classId===c.id?'selected':''}>${Utils.escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:160px">
          <label>Report Type</label>
          <select id="rc-rtype" class="select-field" onchange="rcState.reportType=this.value;rcPickClass(rcState.classId)">
            <option value="individual" ${rcState.reportType==='individual'?'selected':''}>Individual Student</option>
            <option value="class" ${rcState.reportType==='class'?'selected':''}>Whole Class</option>
          </select>
        </div>
        <div class="form-group" style="min-width:150px" id="rc-student-wrap">
          <label>Student</label>
          <select id="rc-learner" class="select-field"><option value="">Select Student</option></select>
        </div>
      </div>
      <div class="form-group mb-4">
        <label>Terms <span class="required">*</span> <span style="font-weight:400;font-size:12px;color:var(--gray-400);margin-left:8px">Hold Ctrl/Cmd to select multiple</span></label>
        <select id="rc-terms" class="select-field" multiple style="min-height:80px;height:auto" onchange="rcState.termIds=Array.from(this.selectedOptions).map(o=>o.value)">
          ${filteredTerms.map(t => `<option value="${t.id}" ${rcState.termIds.includes(t.id)?'selected':''}>${Utils.escapeHtml(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group mb-4">
        <label>Subjects</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:500;margin-bottom:8px">
          <input type="checkbox" id="rc-all-subjects" ${rcState.allSubjects?'checked':''} onchange="rcState.allSubjects=this.checked;document.getElementById('rc-subjects-list').style.display=this.checked?'none':'block'"> All Subjects
        </label>
        <div id="rc-subjects-list" style="display:${rcState.allSubjects?'none':'block'}">
          <div class="report-cb-grid" style="max-height:180px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:10px">
            ${subjects.map(s => `<label class="report-cb-item"><input type="checkbox" class="rc-subj-cb" value="${s.id}" ${rcState.subjectIds.includes(s.id)?'checked':''}> <span class="report-cb-body"><span class="report-cb-title">${Utils.escapeHtml(s.name)}</span></span></label>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group mb-4">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="rc-annual" ${rcState.annualMode?'checked':''} onchange="rcState.annualMode=this.checked">
          <span>Include Annual / Overall Summary</span>
        </label>
      </div>
      <div class="flex gap-3" style="flex-wrap:wrap">
        <button class="btn btn-primary" onclick="rcGenerate()"><i data-lucide="file-badge" style="width:15px;height:15px"></i> Generate Report</button>
        <button class="btn btn-secondary" onclick="rcPrintReport()"><i data-lucide="printer"></i> Print</button>
        <button class="btn btn-secondary" onclick="rcExportPdf()"><i data-lucide="file-down"></i> Export PDF</button>
      </div>
    </div>
    <div id="rc-preview"></div>
  `;
}

async function rcPickYear(id) {
  rcState.yearId = id; rcState.termIds = [];
  const terms = await DB.get('terms');
  const sel = document.getElementById('rc-terms');
  if (!sel) return;
  const filtered = terms.filter(t => !id || t.academic_year_id === id).sort((a,b)=> (a.term_no||0)-(b.term_no||0));
  sel.innerHTML = filtered.map(t => `<option value="${t.id}">${Utils.escapeHtml(t.name)}</option>`).join('');
}

async function rcPickClass(id) {
  rcState.classId = id; rcState.learnerId = '';
  const wrap = document.getElementById('rc-student-wrap');
  const sel = document.getElementById('rc-learner');
  const rtype = document.getElementById('rc-rtype')?.value || rcState.reportType;
  if (!sel) return;
  if (rtype === 'class') { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  if (!id) { sel.innerHTML = '<option value="">Select Student</option>'; return; }
  const learners = await DB.query('learners','*',{ class_id: id, status: 'active' },{ column: 'full_name', asc: true });
  sel.innerHTML = '<option value="">Select Student</option>' + learners.map(l => `<option value="${l.id}">${Utils.escapeHtml(l.learner_code)} — ${Utils.escapeHtml(l.full_name)}</option>`).join('');
}

async function rcGenerate() {
  const rtype = document.getElementById('rc-rtype')?.value || 'individual';
  const classId = document.getElementById('rc-class')?.value || '';
  const learnerId = document.getElementById('rc-learner')?.value || '';
  const yearId = document.getElementById('rc-year')?.value || '';
  const termIds = Array.from(document.querySelectorAll('#rc-terms option:checked')).map(o => o.value);
  const allSubjects = document.getElementById('rc-all-subjects')?.checked !== false;
  const annualMode = document.getElementById('rc-annual')?.checked || false;
  const selSubjects = allSubjects ? [] : Array.from(document.querySelectorAll('.rc-subj-cb:checked')).map(cb => cb.value);

  if (!classId) return Utils.toast('Select a class', 'error');
  if (termIds.length === 0) return Utils.toast('Select at least one term', 'error');
  if (rtype === 'individual' && !learnerId) return Utils.toast('Select a student', 'error');

  const previewTab = window.open('', '_blank');
  if (previewTab) {
    previewTab.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing RMS-MIS Report</title></head><body style="font:16px Arial,sans-serif;padding:24px">Preparing your complete report preview…</body></html>');
    previewTab.document.close();
  } else {
    Utils.toast('Allow pop-ups to open the complete report preview in a new tab.', 'error');
  }
  const preview = document.getElementById('rc-preview');
  preview.innerHTML = Utils.loading();
  preview.scrollIntoView({ behavior:'smooth', block:'start' });

  try {
    if (rtype === 'class') {
      await rcBuildClassReport({ classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview });
    } else {
      await rcBuildIndividualReport({ learnerId, classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview });
    }
    const paper = document.getElementById('rc-paper');
    if (previewTab && paper && typeof ReportCenter !== 'undefined') {
      const className = document.querySelector('#rc-class option:checked')?.textContent || 'Class';
      ReportCenter.openPreviewDocument(
        paper.innerHTML,
        `RMS-MIS ${rtype === 'class' ? 'Class Report Cards' : 'Student Report Card'} — ${className}`,
        'portrait',
        rcBuildOutputFilename(),
        previewTab
      );
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    if (previewTab && !previewTab.closed) {
      previewTab.document.body.innerHTML = `<main style="font:16px Arial,sans-serif;padding:24px"><h1>Report preview failed</h1><p>${Utils.escapeHtml(e.message || 'Unable to generate report.')}</p></main>`;
    }
    preview.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:#dc2626"><p>${Utils.escapeHtml(e.message)}</p></div>`;
  }
}

async function rcFetchLearnerData({ learnerId, classId, yearId, termIds, allSubjects, selSubjects }) {
  const [learner, cls, allYears, terms, subjects, classSubjectRows, assessmentTypes, settings, scale, learnersList] = await Promise.all([
    learnerId ? DB.get('learners', { id: learnerId }).then(r => r[0]) : Promise.resolve(null),
    DB.get('classes', { id: classId }).then(r => r[0]),
    DB.get('academic_years'),
    DB.get('terms'),
    DB.get('subjects'),
    DB.query('class_subjects', '*', { class_id: classId }),
    DB.get('assessment_types'),
    typeof getSchoolSettings === 'function' ? getSchoolSettings() : {},
    typeof getGrading === 'function' ? getGrading() : [],
    DB.getFreshQuery('learners', '*', { class_id: classId, status: 'active' }, { column: 'full_name', asc: true })
  ]);
  const year = allYears.find(y => y.id === yearId);
  const selectedTermIds = new Set((termIds || []).map(String));
  const selectedTerms = terms.filter(t => selectedTermIds.has(String(t.id))).sort((a,b)=> (a.term_no||0)-(b.term_no||0));
  const classCategory = typeof EducationLevels !== 'undefined'
    ? EducationLevels.getCategory(cls)
    : (/^P[1-6]/i.test(String(cls?.level || cls?.name || '')) ? 'Primary' : 'Secondary');
  const assignedSubjectIds = new Set((classSubjectRows || []).map(row => String(row.subject_id)));
  const hasClassSubjectAssignments = classCategory !== 'Primary' && assignedSubjectIds.size > 0;
  const selectedSubjectIds = new Set((selSubjects || []).map(String));
  const activeSubjects = (subjects || [])
    .filter(subject => subject.status === 'active' || !subject.status)
    .filter(subject => allSubjects || selectedSubjectIds.has(String(subject.id)))
    .filter(subject => {
      if (hasClassSubjectAssignments && !assignedSubjectIds.has(String(subject.id))) return false;
      return rcSubjectMatchesLevel(subject, cls, classCategory);
    })
    .sort((a,b) => a.name.localeCompare(b.name));
  const activeSubjectIds = new Set(activeSubjects.map(subject => String(subject.id)));

  const [submittedA, approvedA, lockedA] = await Promise.all([
    DB.query('assessments','*',{ class_id: classId, academic_year_id: yearId || undefined, status:'submitted' }),
    DB.query('assessments','*',{ class_id: classId, academic_year_id: yearId || undefined, status:'approved' }),
    DB.query('assessments','*',{ class_id: classId, academic_year_id: yearId || undefined, status:'locked' })
  ]);
  const allAssessments = [...lockedA, ...approvedA, ...submittedA]
    .filter(a => !(Utils.isConversionHelper && Utils.isConversionHelper(a)))
    .filter(a => selectedTermIds.has(String(a.term_id)))
    .filter(a => activeSubjectIds.has(String(a.subject_id)));
  
  let allMarks = [];
  const assessIds = allAssessments.map(a=>a.id);
  for (let i=0; i<assessIds.length; i+=50) {
    /* Critical final report — force fresh marks read (still deduped). */
    const rows = await DB.getFresh('marks', { assessment_id: assessIds.slice(i,i+50) });
    if (rows && rows.length) allMarks.push(...rows);
  }

  // Pre-calculate positions
  const posData = {};
  for (const termId of termIds) {
    posData[termId] = rcClassPositions(learnersList, allAssessments, allMarks, termId, activeSubjects, assessmentTypes);
  }
  const annualPosData = rcClassPositions(learnersList, allAssessments, allMarks, null, activeSubjects, assessmentTypes);

  return {
    learner, cls, year, selectedTerms, activeSubjects, allAssessments, allMarks,
    assessmentTypes: assessmentTypes || [], settings, scale, learnersList, posData, annualPosData
  };
}

function rcSubjectMatchesLevel(subject, cls, category) {
  if (typeof EducationLevels !== 'undefined' && EducationLevels.subjectMatchesClass) {
    return EducationLevels.subjectMatchesClass(subject, cls);
  }
  const values = [subject.level, subject.education_level]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());
  if (!values.length || values.every(value => value === 'both' || value === 'all')) return true;
  const mentionsPrimary = values.some(value => value.includes('primary') || value === 'p');
  const mentionsSecondary = values.some(value => value.includes('secondary') || value === 's');
  if (category === 'Primary') return mentionsPrimary || !mentionsSecondary;
  return mentionsSecondary || !mentionsPrimary;
}

function rcAssessmentType(assessment, types) {
  return (types || []).find(type => String(type.id) === String(assessment.assessment_type_id)) || null;
}

function rcAssessmentComponentKey(assessment, types) {
  const type = rcAssessmentType(assessment, types);
  return String(assessment.assessment_type_id || `name:${type?.name || assessment.type || assessment.name || 'Assessment'}`);
}

function rcAssessmentComponentLabel(assessment, types) {
  const type = rcAssessmentType(assessment, types);
  const name = type?.name || assessment.type || assessment.name || 'Assessment';
  const code = type?.code || assessment.type_code;
  return String(code || name.split(/\s+/).map(word => word[0]).join('').slice(0, 6)).toUpperCase();
}

function rcAssessmentWeight(assessment, types) {
  if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.effWeight === 'function') {
    return AnalyticsEngine.effWeight(assessment, types);
  }
  if (assessment.weight != null) return Number(assessment.weight);
  const type = rcAssessmentType(assessment, types);
  return type?.weight == null ? null : Number(type.weight);
}

function rcComponentColumns(assessments, types) {
  const columns = new Map();
  (assessments || []).forEach(assessment => {
    const key = rcAssessmentComponentKey(assessment, types);
    if (columns.has(key)) return;
    const type = rcAssessmentType(assessment, types);
    columns.set(key, {
      key,
      label: rcAssessmentComponentLabel(assessment, types),
      name: type?.name || assessment.type || assessment.name || 'Assessment',
      typeId: assessment.assessment_type_id || null
    });
  });
  const typeOrder = new Map((types || []).map((type, index) => [
    String(type.id),
    Number(type.display_order ?? index)
  ]));
  return [...columns.values()].sort((a, b) =>
    (typeOrder.get(String(a.typeId)) ?? Number.MAX_SAFE_INTEGER)
      - (typeOrder.get(String(b.typeId)) ?? Number.MAX_SAFE_INTEGER)
      || a.label.localeCompare(b.label)
  ).map(column => ({
    ...column,
    assessments: (assessments || []).filter(assessment =>
      rcAssessmentComponentKey(assessment, types) === column.key)
  }));
}

function rcCalcSubject(sub, termAssessments, marksForLearner, scale, types = []) {
  const subAssessments = (termAssessments || []).filter(a => String(a.subject_id) === String(sub.id));
  const byAssessment = new Map((marksForLearner || []).map(mark => [String(mark.assessment_id), mark]));
  const marks = subAssessments.map(a => byAssessment.get(String(a.id))).filter(mark => mark && mark.mark != null && mark.mark !== '');
  const pct = marks.length
    ? (typeof AnalyticsEngine !== 'undefined' && AnalyticsEngine.learnerPct
      ? AnalyticsEngine.learnerPct(marks, subAssessments, types)
      : rcRawPercentage(marks, subAssessments))
    : null;
  const components = new Map();
  rcComponentColumns(subAssessments, types).forEach(column => {
    const componentAssessments = column.assessments;
    const componentMarks = componentAssessments.map(a => byAssessment.get(String(a.id)))
      .filter(mark => mark && mark.mark != null && mark.mark !== '');
    const obtained = componentMarks.reduce((sum, mark) => sum + Number(mark.mark), 0);
    const maximum = componentAssessments.reduce((sum, a) => sum + Number(a.maximum_mark || 0), 0);
    components.set(column.key, {
      obtained: componentMarks.length ? obtained : null,
      scoredMaximum: componentMarks.reduce((sum, mark) => {
        const assessment = componentAssessments.find(a => String(a.id) === String(mark.assessment_id));
        return sum + Number(assessment?.maximum_mark || 0);
      }, 0),
      maximum,
      count: componentAssessments.length
    });
  });
  const obtained = marks.reduce((sum, mark) => sum + Number(mark.mark), 0);
  const maximum = marks.reduce((sum, mark) => {
    const assessment = subAssessments.find(a => String(a.id) === String(mark.assessment_id));
    return sum + Number(assessment?.maximum_mark || 0);
  }, 0);
  const grade = pct == null ? '' : rcGrade(pct, scale);
  return {
    subjectId: sub.id,
    components,
    obtained: marks.length ? obtained : null,
    maximum,
    pct,
    grade,
    hasMarks: marks.length > 0
  };
}

function rcRawPercentage(marks, assessments) {
  const obtained = marks.reduce((sum, mark) => sum + Number(mark.mark), 0);
  const maximum = marks.reduce((sum, mark) => {
    const assessment = assessments.find(a => String(a.id) === String(mark.assessment_id));
    return sum + Number(assessment?.maximum_mark || 0);
  }, 0);
  return maximum > 0 ? Math.round(obtained / maximum * 10000) / 100 : null;
}

function rcGrade(pct, scale) {
  if (typeof GradingEngine !== 'undefined' && scale && scale.length) {
    return GradingEngine.calculateGradeSync(pct, scale).grade;
  }
  if (!scale || !scale.length) return 'N/R';
  const ordered = [...scale].sort((a, b) => Number(b.minimum_percentage) - Number(a.minimum_percentage));
  for (const s of ordered) {
    if (Number(pct) >= Number(s.minimum_percentage)) return s.grade;
  }
  return 'F';
}

function rcClassPositions(learnersList, allAssessments, allMarks, termId, subjects = [], types = []) {
  const termAssess = termId == null
    ? allAssessments
    : allAssessments.filter(a => String(a.term_id) === String(termId));
  const scores = learnersList.map(l => {
    const learnerMarks = allMarks.filter(mark => String(mark.learner_id) === String(l.id));
    const percentages = subjects
      .map(subject => rcCalcSubject(subject, termAssess, learnerMarks, [], types).pct)
      .filter(pct => pct != null);
    const pct = percentages.length
      ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      : null;
    return { id: l.id, pct };
  }).filter(x => x.pct != null);
  
  scores.sort((a,b) => b.pct - a.pct);
  const pos = {};
  let prev = null, prevRank = 1;
  scores.forEach((s,i) => {
    const rounded = Math.round(s.pct * 100) / 100;
    if (i===0) { pos[s.id]=1; prev=rounded; prevRank=1; }
    else if (rounded===prev) pos[s.id]=prevRank;
    else { pos[s.id]=i+1; prev=rounded; prevRank=i+1; }
  });
  return { positions: pos, total: scores.length };
}

async function rcBuildIndividualReport({ learnerId, classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview }) {
  const d = await rcFetchLearnerData({ learnerId, classId, yearId, termIds, allSubjects, selSubjects });
  if (!d.learner) throw new Error('Learner not found');
  d.annualMode = annualMode;
  d.orientation = 'portrait';
  const html = rcRenderCard(d.learner, d);
  preview.innerHTML = `
    <div class="report-preview-toolbar-flex no-print" style="margin-bottom:16px">
      <div><h3 style="font-size:16px;font-weight:700">Preview</h3><p class="text-sm text-muted">${Utils.escapeHtml(d.learner.full_name)}</p></div>
    </div>
    <div id="rc-paper" class="rc-paper-outer">${html}</div>`;
  rcFitReportPages(preview);
}

async function rcBuildClassReport({ classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview }) {
  const d = await rcFetchLearnerData({ classId, yearId, termIds, allSubjects, selSubjects });
  if (!d.learnersList.length) throw new Error('No active learners found in the selected class.');
  d.annualMode = annualMode;
  d.orientation = 'portrait';
  const cards = d.learnersList.map(l => rcRenderCard(l, d));
  const learnerIds = new Set(d.learnersList.map(learner => String(learner.id)));
  const generatedPageCount = cards.reduce((count, card) =>
    count + (card.match(/class="rc-paper rc-paper-fit"/g) || []).length, 0);
  if (cards.length !== d.learnersList.length || learnerIds.size !== d.learnersList.length
    || generatedPageCount !== d.learnersList.length) {
    throw new Error(`Report generation produced ${generatedPageCount} cards for ${d.learnersList.length} active learners.`);
  }
  preview.innerHTML = `
    <div class="report-preview-toolbar-flex no-print" style="margin-bottom:16px">
      <div><h3 style="font-size:16px;font-weight:700">Whole-Class Preview</h3><p class="text-sm text-muted">Generated ${cards.length} of ${d.learnersList.length} active student reports.</p></div>
    </div>
    <div id="rc-paper" class="rc-paper-outer">${cards.join(ReportHeader.getPageBreak())}</div>`;
  rcFitReportPages(preview);
}

function rcFitReportPages(root) {
  if (!root) return;
  const pages = [...root.querySelectorAll('.rc-paper-fit')];
  pages.forEach((page, index) => {
    page.classList.toggle('rc-page-last', index === pages.length - 1);
    const content = page.querySelector('.rc-fit-content');
    if (!content) return;
    page.style.setProperty('position', 'relative', 'important');
    page.style.setProperty('width', '210mm', 'important');
    page.style.setProperty('height', '297mm', 'important');
    page.style.setProperty('min-height', '297mm', 'important');
    page.style.setProperty('max-height', '297mm', 'important');
    page.style.setProperty('padding', '0', 'important');
    page.style.setProperty('overflow', 'hidden', 'important');
    content.style.setProperty('position', 'static', 'important');
    content.style.setProperty('width', '200mm', 'important');
    content.style.setProperty('transform', 'none', 'important');
    const bounds = content.getBoundingClientRect();
    const pageWidth = page.clientWidth;
    const pageHeight = page.clientHeight;
    const mmToPx = pageWidth / 210;
    const availableWidth = pageWidth - 10 * mmToPx;
    const availableHeight = pageHeight - 10 * (pageHeight / 297);
    const viewScale = Math.min(
      1,
      Math.max(0.01, (document.documentElement.clientWidth - 16) / pageWidth)
    );
    const scale = Math.min(
      1,
      availableWidth / Math.max(bounds.width, 1),
      availableHeight / Math.max(bounds.height, 1)
    );
    page.removeAttribute('style');
    page.style.setProperty('--rc-fit-scale', String(Math.max(scale, 0.01)));
    page.style.setProperty('--rc-view-scale', String(viewScale));
    content.removeAttribute('style');
  });
}

function rcRenderCard(learner, d) {
  const logoUrl = d.settings.logo_url || 'public/logo.webp';
  const levelLbl = rcLevelLabel(d.cls?.level);
  const mMarks = d.allMarks.filter(m => String(m.learner_id) === String(learner.id));
  const schoolName = d.settings.school_name || 'RUKARA MODEL SCHOOL';
  const { email: schoolEmail, phone: schoolPhone } = ReportHeader.getSchoolContact(d.settings);
  const termCols = (d.selectedTerms || []).map(t => ({ id: t.id, name: t.name }));
  const showAnn = Boolean(d.annualMode);
  const types = d.assessmentTypes || [];
  const assessmentsByTerm = new Map();
  const termScores = new Map();
  termCols.forEach(t => {
    const termAssessments = d.allAssessments.filter(a => String(a.term_id) === String(t.id));
    assessmentsByTerm.set(String(t.id), termAssessments);
    termScores.set(String(t.id), new Map(d.activeSubjects.map(subject => [
      String(subject.id),
      rcCalcSubject(subject, termAssessments, mMarks, d.scale, types)
    ])));
  });

  const annualScores = new Map(d.activeSubjects.map(subject => [
    String(subject.id),
    rcCalcSubject(subject, d.allAssessments, mMarks, d.scale, types)
  ]));
  const availableSubjects = d.activeSubjects;
  const numberText = value => Number(value.toFixed(1)).toString();
  const termTotals = new Map(termCols.map(term => [String(term.id), {
    obtained: 0,
    maximum: 0,
    percentages: []
  }]));
  const annualTotal = { obtained: 0, maximum: 0, percentages: [] };
  const tableColumnCount = 1 + termCols.length + (showAnn ? 1 : 0);
  const headingRow = `<tr>
    <th class="rc-th-sub rc-align-left">SUBJECT</th>
    ${termCols.map(term => `<th>${Utils.escapeHtml(term.name)}${d.year?.name ? ` / ${Utils.escapeHtml(d.year.name)}` : ''}</th>`).join('')}
    ${showAnn ? '<th>OVERALL</th>' : ''}
  </tr>`;
  const isComplete = assessments => assessments.length > 0 && assessments.every(assessment => {
    const mark = mMarks.find(item => String(item.assessment_id) === String(assessment.id));
    return mark && mark.mark != null && mark.mark !== '';
  });
  const renderAssessmentDetails = assessments => {
    if (!assessments.length) return '<span class="rc-no-assessment">No assessment</span>';
    return assessments.map(assessment => {
      const component = rcAssessmentType(assessment, types);
      const label = assessment.period_label || assessment.name || assessment.unit_name || assessment.unit || '';
      const mark = mMarks.find(item => String(item.assessment_id) === String(assessment.id));
      const markText = mark && mark.mark != null && mark.mark !== ''
        ? numberText(Number(mark.mark))
        : '—';
      return `<span class="rc-assessment-mark"><b>${Utils.escapeHtml(component?.code || rcAssessmentComponentLabel(assessment, types))}</b>${label ? ` ${Utils.escapeHtml(label)}` : ''} ${markText}/${numberText(Number(assessment.maximum_mark || 0))}</span>`;
    }).join(' ');
  };
  let tbody = `<tr class="rc-all-subjects-row"><td colspan="${tableColumnCount}">All Subjects</td></tr>`;

  availableSubjects.forEach(subject => {
    let row = `<tr><td class="rc-align-left" style="font-weight:500">${Utils.escapeHtml(subject.name)}</td>`;

    termCols.forEach(term => {
      const score = termScores.get(String(term.id))?.get(String(subject.id));
      const assessments = (assessmentsByTerm.get(String(term.id)) || [])
        .filter(assessment => String(assessment.subject_id) === String(subject.id));
      const complete = isComplete(assessments);
      const scoreSummary = complete && score?.hasMarks
        ? `<strong>${numberText(score.obtained)}/${numberText(score.maximum)} · ${score.pct.toFixed(1)}% ${Utils.escapeHtml(score.grade)}</strong>`
        : '<strong>Incomplete</strong>';
      row += `<td class="rc-term-detail"><div>${renderAssessmentDetails(assessments)}</div>${scoreSummary}</td>`;
      const termTotal = termTotals.get(String(term.id));
      termTotal.maximum += assessments.reduce((sum, assessment) =>
        sum + Number(assessment.maximum_mark || 0), 0);
      if (complete && score?.hasMarks) {
        termTotal.obtained += score.obtained;
        termTotal.percentages.push(score.pct);
      }
    });

    if (showAnn) {
      const annual = annualScores.get(String(subject.id));
      const assessments = d.allAssessments.filter(assessment =>
        String(assessment.subject_id) === String(subject.id));
      const complete = isComplete(assessments);
      const maximum = assessments.reduce((sum, assessment) =>
        sum + Number(assessment.maximum_mark || 0), 0);
      const overallSummary = annual?.hasMarks
        ? `<strong>${numberText(annual.obtained)}/${numberText(maximum)}${complete && annual.pct != null ? `<br>${annual.pct.toFixed(1)}% ${Utils.escapeHtml(annual.grade)}` : ''}</strong>`
        : `<strong>—/${numberText(maximum)}</strong>`;
      row += `<td class="rc-overall-cell">${overallSummary}</td>`;
      if (complete && annual?.hasMarks) {
        annualTotal.obtained += annual.obtained;
        annualTotal.percentages.push(annual.pct);
      }
      annualTotal.maximum += maximum;
    }
    tbody += `${row}</tr>`;
  });

  const average = values => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  let totalRow = '<tr class="rc-total-row"><td class="rc-align-left font-bold">Total</td>';
  termCols.forEach(term => {
    const total = termTotals.get(String(term.id));
    const pct = average(total.percentages);
    totalRow += `<td><strong>${numberText(total.obtained)}/${numberText(total.maximum)}${pct == null ? '' : `<br>${pct.toFixed(1)}% ${Utils.escapeHtml(rcGrade(pct, d.scale))}`}</strong></td>`;
  });
  if (showAnn) {
    const pct = average(annualTotal.percentages);
    totalRow += `<td><strong>${numberText(annualTotal.obtained)}/${numberText(annualTotal.maximum)}${pct == null ? '' : `<br>${pct.toFixed(1)}% ${Utils.escapeHtml(rcGrade(pct, d.scale))}`}</strong></td>`;
  }
  totalRow += '</tr>';

  const summaryScores = showAnn
    ? [...annualScores.values()]
    : [...(termScores.get(String(termCols[0]?.id))?.values() || [])];
  const validSummaryScores = summaryScores.filter(score => score.hasMarks && score.pct != null);
  const overallAverage = average(validSummaryScores.map(score => score.pct));
  const passMark = Number(d.settings.pass_mark || 50);
  const positionData = showAnn
    ? d.annualPosData
    : d.posData?.[termCols[0]?.id];
  const learnerPosition = positionData?.positions?.[learner.id];
  const studentSummary = [
    { label: 'Total Subjects', value: String(d.activeSubjects.length || 0) },
    { label: 'Subjects Passed', value: String(validSummaryScores.filter(score => score.pct >= passMark).length) },
    { label: 'Overall Average', value: overallAverage == null ? '—' : `${overallAverage.toFixed(1)}%` },
    { label: 'Class Position', value: learnerPosition ? `${learnerPosition}/${positionData.total}` : '—' }
  ];

  const finalDesc = `
    <div class="rc-student-block" style="margin-top:8px; padding:8px 12px;">
      <div class="rc-stu-col1" style="gap:8px">
        <div><span class="rc-lbl-blue">Name:</span> <strong style="font-size:14px; margin-left:4px">${Utils.escapeHtml(learner.full_name || '-')}</strong></div>
        <div><span class="rc-lbl-blue">Student Code:</span> <span style="margin-left:4px">${Utils.escapeHtml(learner.learner_code || '-')}</span></div>
      </div>
      <div class="rc-stu-col2" style="gap:8px">
        <div><span class="rc-lbl-blue">Academic Year:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.year?.name || '-')}</span></div>
        <div><span class="rc-lbl-blue">Class:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.cls?.name || '-')}</span></div>
      </div>
      <div class="rc-stu-col2" style="gap:8px">
        <div><span class="rc-lbl-blue">Term(s):</span> <span style="margin-left:4px">${(termCols.map(t => t.name).join(', ') || '—')}</span></div>
        <div><span class="rc-lbl-blue">Level:</span> <span style="margin-left:4px">${levelLbl}</span></div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; margin-top:8px;">
      ${studentSummary.map(item => `
        <div style="border:1px solid var(--rc-dark-blue); border-radius:6px; background:#f5f9ff; padding:7px 8px; text-align:center;">
          <div style="font-size:7.5pt; color:var(--rc-dark-blue); font-weight:700; text-transform:uppercase;">${Utils.escapeHtml(item.label)}</div>
          <div style="font-size:12pt; font-weight:800; color:var(--rc-dark-blue); margin-top:4px;">${Utils.escapeHtml(item.value)}</div>
        </div>
      `).join('')}
    </div>`;

  return `
    <div class="rc-paper rc-paper-fit">
    <div class="rc-fit-content">
      <div class="rc-header">
        <div class="rc-title-group">
          <div class="rc-main-title">${Utils.escapeHtml(schoolName)}</div>
          <div class="rc-sub-title">RMS-MIS</div>
          <div class="rc-tagline">Rukara Model School Marks Information System</div>
          <div class="rc-contact-info">
            <div>P.O. Box 1234, Rukara, Rwanda</div>
            <div>Email: ${Utils.escapeHtml(schoolEmail)}</div>
            <div>Phone: ${Utils.escapeHtml(schoolPhone)}</div>
          </div>
        </div>

        <div class="rc-center-badge">
          <div class="rc-badge-top">STUDENT REPORT CARD</div>
          <div class="rc-badge-bottom">${levelLbl}</div>
        </div>

        <div class="rc-logo-group">
          <div class="rc-logo-wrap">
            <img src="${Utils.escapeHtml(logoUrl)}" class="rc-logo-img" onerror="this.style.display='none'">
          </div>
          <div class="rc-logo-text">Knowledge <span style="font-size:12px;margin:0 2px">•</span> Skills <span style="font-size:12px;margin:0 2px">•</span> Future</div>
          <div class="rc-logo-rms">RMS-MIS</div>
        </div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-student-block">
        <div class="rc-stu-col1">
          <div><span class="rc-lbl-blue">Name:</span> <strong style="font-size:14px; margin-left:4px">${Utils.escapeHtml(learner.full_name || '-')}</strong></div>
          <div><span class="rc-lbl-blue">Student Unique Identifier:</span> <span style="margin-left:4px">${Utils.escapeHtml(learner.learner_code || '-')}</span></div>
        </div>
        <div class="rc-stu-col2">
          <div><span class="rc-lbl-blue">Academic Year:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.year?.name || '-')}</span></div>
          <div><span class="rc-lbl-blue">Level:</span> <span style="margin-left:4px">${levelLbl}</span></div>
          <div><span class="rc-lbl-blue">Class:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.cls?.name || '-')}</span></div>
        </div>
      </div>
      <div class="rc-table-wrapper rc-summary-table-wrapper">
        <table class="rc-data-table rc-data-table-dynamic rc-compact-term-table rc-summary-table">
          <thead>${headingRow}</thead>
          <tbody>${tbody}</tbody>
          <tfoot>${totalRow}</tfoot>
        </table>
      </div>
      ${finalDesc}
      <div class="rc-absolute-bottom">
        Generated by RMS-MIS &nbsp;|&nbsp; ${Utils.dateStr(new Date())} ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
        <span style="float:right; font-weight:700; color:#f59e0b; font-style:italic">Excellence Through Education</span>
      </div>
      </div>
    </div>`;
}

async function rcExportPdf() {
  const paper = document.getElementById('rc-paper');
  if (!paper) return Utils.toast('Generate a report card first', 'error');
  if (typeof ReportCenter === 'undefined') return Utils.toast('The report download service is unavailable. Please reload and try again.', 'error');
  const filename = rcBuildOutputFilename();
  await ReportCenter.downloadPdfDocument(paper.innerHTML, filename, 'portrait');
}

function rcBuildOutputFilename() {
  const safe = value => String(value || '').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const className = document.querySelector('#rc-class option:checked')?.textContent;
  const yearName = document.querySelector('#rc-year option:checked')?.textContent;
  return ['RMS-MIS', 'Student_Report_Card', safe(className), safe(yearName)].filter(Boolean).join('_') + '.pdf';
}

function rcPrintReport() {
  const paper = document.getElementById('rc-paper');
  if (!paper) return Utils.toast('Generate a report card first', 'error');
  if (typeof ReportCenter === 'undefined') return Utils.toast('The report print service is unavailable. Please reload and try again.', 'error');
  const filename = rcBuildOutputFilename();
  ReportCenter.printDocument(paper.innerHTML, filename.replace(/\.pdf$/i, ''), filename, 'portrait');
}
