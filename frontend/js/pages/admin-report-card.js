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
        <button class="btn btn-secondary" onclick="window.print()"><i data-lucide="printer"></i> Print</button>
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

  const preview = document.getElementById('rc-preview');
  preview.innerHTML = Utils.loading();
  preview.scrollIntoView({ behavior:'smooth', block:'start' });

  try {
    if (rtype === 'class') {
      await rcBuildClassReport({ classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview });
    } else {
      await rcBuildIndividualReport({ learnerId, classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview });
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    preview.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:#dc2626"><p>${Utils.escapeHtml(e.message)}</p></div>`;
  }
}

async function rcFetchLearnerData({ learnerId, classId, yearId, termIds, allSubjects, selSubjects }) {
  const [learner, cls, allYears, terms, subjects, settings, scale, learnersList] = await Promise.all([
    learnerId ? DB.get('learners', { id: learnerId }).then(r => r[0]) : Promise.resolve(null),
    DB.get('classes', { id: classId }).then(r => r[0]),
    DB.get('academic_years'),
    DB.get('terms'),
    DB.get('subjects'),
    typeof getSchoolSettings === 'function' ? getSchoolSettings() : {},
    typeof getGrading === 'function' ? getGrading() : [],
    DB.query('learners', '*', { class_id: classId, status: 'active' }, { column: 'full_name', asc: true })
  ]);
  const year = allYears.find(y => y.id === yearId);
  const selectedTerms = terms.filter(t => termIds.includes(t.id)).sort((a,b)=> (a.term_no||0)-(b.term_no||0));
  
  const clsLevelStr = cls?.level?.toUpperCase().startsWith('S') ? 'Secondary' : 'Primary';
  const activeSubjects = (allSubjects ? subjects.filter(s => s.status === 'active') : subjects.filter(s => selSubjects.includes(s.id)))
    .filter(s => !s.level || s.level === 'Both' || s.level === clsLevelStr)
    .sort((a,b) => a.name.localeCompare(b.name));

  const [approvedA, lockedA] = await Promise.all([
    DB.query('assessments','*',{ class_id: classId, academic_year_id: yearId || undefined, status:'approved' }),
    DB.query('assessments','*',{ class_id: classId, academic_year_id: yearId || undefined, status:'locked' })
  ]);
  const allAssessments = [...lockedA, ...approvedA];
  
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
    posData[termId] = rcClassPositions(learnersList, allAssessments, allMarks, termId);
  }

  return { learner, cls, year, selectedTerms, activeSubjects, allAssessments, allMarks, settings, scale, learnersList, posData };
}

// Check if an assessment is End of Term (ET) vs End of Unit (EU)
function rcIsET(name) {
  const n = String(name).toLowerCase();
  return n.includes('term') || n.includes('exam') || n.includes('et');
}

function rcCalcSubject(sub, termAssessments, marksForLearner, scale, passMark) {
  const subAssess = termAssessments.filter(a => a.subject_id === sub.id);
  if (!subAssess.length) return null;

  let euMax = 0, euObt = 0, hasEu = false;
  let etMax = 0, etObt = 0, hasEt = false;

  subAssess.forEach(a => {
    const m = marksForLearner.find(x => x.assessment_id === a.id);
    const mVal = (m && m.mark != null) ? Number(m.mark) : null;
    const maxVal = Number(a.maximum_mark) || 0;
    
    if (rcIsET(a.name) || rcIsET(a.unit)) {
      etMax += maxVal;
      if (mVal != null) { etObt += mVal; hasEt = true; }
    } else {
      euMax += maxVal;
      if (mVal != null) { euObt += mVal; hasEu = true; }
    }
  });

  const totMax = euMax + etMax;
  const totObt = (hasEu ? euObt : 0) + (hasEt ? etObt : 0);
  const hasMarks = hasEu || hasEt;

  const pct = (hasMarks && totMax > 0) ? Math.round((totObt/totMax)*1000)/10 : null;
  const gr = pct != null ? rcGrade(pct, scale) : 'N/R';

  return {
    subjectId: sub.id,
    euMax, etMax, totMax,
    euObt: hasEu ? euObt : null, 
    etObt: hasEt ? etObt : null, 
    totObt: hasMarks ? totObt : null,
    pct, gr, hasMarks
  };
}

function rcGrade(pct, scale) {
  if (typeof GradingEngine !== 'undefined' && scale && scale.length) {
    return GradingEngine.calculateGradeSync(pct, scale).grade;
  }
  if (!scale || !scale.length) return 'N/R';
  for (const s of scale) {
    if (pct >= Number(s.minimum_percentage) && pct <= Number(s.maximum_percentage)) return s.grade;
  }
  return 'F';
}

function rcClassPositions(learnersList, allAssessments, allMarks, termId) {
  const termAssess = allAssessments.filter(a => a.term_id === termId);
  const scores = learnersList.map(l => {
    const totalMax = termAssess.reduce((s,a) => s+(Number(a.maximum_mark)||0), 0);
    const obtained = termAssess.reduce((s,a) => {
      const m = allMarks.find(mk => mk.assessment_id===a.id && mk.learner_id===l.id);
      return s + (m && m.mark!=null ? Number(m.mark) : 0);
    }, 0);
    return { id: l.id, pct: totalMax>0 ? (obtained/totalMax)*100 : null };
  }).filter(x => x.pct != null);
  
  scores.sort((a,b) => b.pct - a.pct);
  const pos = {};
  let rank = 1, prev = null, prevRank = 1;
  scores.forEach((s,i) => {
    if (i===0) { pos[s.id]=1; prev=s.pct; prevRank=1; }
    else if (s.pct===prev) pos[s.id]=prevRank;
    else { rank=i+1; pos[s.id]=rank; prev=s.pct; prevRank=rank; }
  });
  return { positions: pos, total: scores.length };
}

async function rcBuildIndividualReport({ learnerId, classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview }) {
  const d = await rcFetchLearnerData({ learnerId, classId, yearId, termIds, allSubjects, selSubjects });
  if (!d.learner) throw new Error('Learner not found');
  const html = rcRenderCard(d.learner, d);
  preview.innerHTML = `
    <div class="report-preview-toolbar-flex no-print" style="margin-bottom:16px">
      <div><h3 style="font-size:16px;font-weight:700">Preview</h3><p class="text-sm text-muted">${Utils.escapeHtml(d.learner.full_name)}</p></div>
    </div>
    <div id="rc-paper" class="rc-paper-outer">${html}</div>`;
}

async function rcBuildClassReport({ classId, yearId, termIds, allSubjects, selSubjects, annualMode, preview }) {
  const d = await rcFetchLearnerData({ classId, yearId, termIds, allSubjects, selSubjects });
  d.annualMode = annualMode;
  const cards = d.learnersList.map(l => rcRenderCard(l, d));
  preview.innerHTML = `<div id="rc-paper" class="rc-paper-outer">${cards.join('<div style="page-break-after:always; width:100%; height:1px;"></div>')}</div>`;
}

function rcRenderCard(learner, d) {
  const logoUrl = d.settings.logo_url || 'public/logo.webp';
  const levelLbl = rcLevelLabel(d.cls?.level);
  const mMarks = d.allMarks.filter(m => m.learner_id === learner.id);
  const passMark = d.settings.pass_mark || 50;
  
  // Calculate max possible values dynamically across ALL assessments for the MAXIMUM column
  const subjMaxVals = {};
  d.activeSubjects.forEach(s => {
    let smeu=0, smet=0;
    d.allAssessments.filter(a=>a.subject_id===s.id).forEach(a=>{
      if (rcIsET(a.name) || rcIsET(a.unit)) smet += Number(a.maximum_mark)||0;
      else smeu += Number(a.maximum_mark)||0;
    });
    subjMaxVals[s.id] = { eu: smeu, et: smet, tot: smeu+smet };
  });

  /* ───── HEADER ───── */
  const header = `
    <div class="rc-header">
      <div class="rc-title-group">
        <div class="rc-main-title">RUKARA MODEL SCHOOL</div>
        <div class="rc-sub-title">RMS-MIS</div>
        <div class="rc-tagline">Rukara Model School Marks Information System</div>
        <div class="rc-contact-info">
          <div>P.O. Box 1234, Rukara, Rwanda</div>
          <div>Email: ${Utils.escapeHtml(d.settings.school_email || 'info@rukaramodelschool.rw')}</div>
          <div>Phone: ${Utils.escapeHtml(d.settings.school_phone || '+250 788 123 456')}</div>
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
    <div class="rc-divider"></div>`;

  /* ───── STUDENT PROPS ───── */
  const studentInfo = `
    <div class="rc-student-block">
      <div class="rc-stu-col1">
        <div><span class="rc-lbl-blue">Name:</span> <strong style="font-size:14px; margin-left:4px">${Utils.escapeHtml(learner.full_name)}</strong></div>
        <div><span class="rc-lbl-blue">Student Unique Identifier:</span> <span style="margin-left:4px">${Utils.escapeHtml(learner.learner_code||'-')}</span></div>
      </div>
      <div class="rc-stu-col2">
        <div><span class="rc-lbl-blue">Academic Year:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.year?.name||'-')}</span></div>
        <div><span class="rc-lbl-blue">Level:</span> <span style="margin-left:4px">${levelLbl}</span></div>
        <div><span class="rc-lbl-blue">Class:</span> <span style="margin-left:4px">${Utils.escapeHtml(d.cls?.name||'-')}</span></div>
      </div>
    </div>`;

  /* ───── TABLE HEADER ───── */
  const termCols = d.selectedTerms.map(t =>({ id: t.id, name: t.name }));
  const showAnn = d.annualMode;
  
  let th1 = `<tr>
    <th rowspan="4" class="rc-th-sub rc-align-left">SUBJECT</th>
    <th colspan="3" class="rc-th-top">MAXIMUM</th>
    ${termCols.map(t => `<th colspan="5" class="rc-th-top">${Utils.escapeHtml(t.name)}</th>`).join('')}
    ${showAnn ? `<th colspan="4" class="rc-th-top">Annual Total</th>` : ''}
  </tr>`;
  
  let th2 = `<tr class="rc-th-row2">
    <th>EU</th><th>ET</th><th>TOT</th>
    ${termCols.map(() => `<th>EU</th><th>ET</th><th>TOT</th><th>%</th><th>GR</th>`).join('')}
    ${showAnn ? `<th>TOT</th><th>MAX</th><th>%</th><th>GR</th>` : ''}
  </tr>`;

  let th3Weight = `<tr>
    <th class="rc-align-left rc-blue-text">WEIGHT</th>
    <th>50%</th><th>30%</th><th>100%</th>
    ${termCols.map(() => `<th>50%</th><th>30%</th><th>100%</th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th>`).join('')}
    ${showAnn ? `<th class="rc-empty-cell"></th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th>` : ''}
  </tr>`;

  // Conduct (stubbed to 40 max as per reference, if not dynamic)
  let th4Conduct = `<tr>
    <th class="rc-align-left rc-blue-text">Conduct</th>
    <th class="rc-empty-cell"></th><th class="rc-empty-cell"></th><th>40</th>
    ${termCols.map(() => `<th class="rc-empty-cell"></th><th class="rc-empty-cell"></th><th>40/40</th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th>`).join('')}
    ${showAnn ? `<th>39/40</th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th><th class="rc-empty-cell"></th>` : ''}
  </tr>`;

  let th5All = `<tr class="rc-all-subjects-row"><td colspan="${showAnn?4+termCols.length*5+4:4+termCols.length*5}">All Subjects</td></tr>`;

  // Pre-calculate per-term subject data
  const tData = {}; 
  termCols.forEach(t=>{
    const ta = d.allAssessments.filter(a=>a.term_id===t.id);
    tData[t.id] = d.activeSubjects.map(s => rcCalcSubject(s, ta, mMarks, d.scale, passMark)).filter(Boolean);
  });

  /* ───── TABLE BODY ───── */
  let tbody = '';
  // Grand totals
  let maxTotEU=0, maxTotET=0, maxTotTOT=0;
  let termTotals = {}; termCols.forEach(t=>{ termTotals[t.id] = { eu:0,et:0,tot:0, hasData:false }; });
  
  // Group Subjects by Level
  const cat = EducationLevels.getCategory(d.cls);
  let groupedSubjects = [];
  
  if (cat.includes('Primary')) {
    groupedSubjects = [{ groupName: 'All Subjects', subjects: d.activeSubjects }];
  } else if (cat.includes('Lower Secondary')) {
    const core = d.activeSubjects.filter(s => ['Mathematics', 'English', 'Kinyarwanda', 'Physics', 'Biology', 'Chemistry'].some(n => s.name.includes(n)));
    const elective = d.activeSubjects.filter(s => !core.includes(s));
    groupedSubjects = [
      { groupName: 'Core Subjects', subjects: core },
      { groupName: 'Elective Subjects', subjects: elective }
    ].filter(g => g.subjects.length > 0);
  } else {
    // Upper Secondary
    const stream = (d.cls?.stream || '').toUpperCase();
    let majorKeywords = [];
    if (stream.includes('PCM')) majorKeywords = ['Physics', 'Chemistry', 'Mathematics'];
    else if (stream.includes('MCB')) majorKeywords = ['Mathematics', 'Chemistry', 'Biology'];
    else if (stream.includes('MEG')) majorKeywords = ['Mathematics', 'Economics', 'Geography'];
    else if (stream.includes('HEG')) majorKeywords = ['History', 'Economics', 'Geography'];

    const major = d.activeSubjects.filter(s => majorKeywords.some(k => s.name.toLowerCase().includes(k.toLowerCase())));
    const minor = d.activeSubjects.filter(s => !major.includes(s));
    
    groupedSubjects = [
      { groupName: 'Major Subjects', subjects: major },
      { groupName: 'Minor / Subsidiary Subjects', subjects: minor }
    ].filter(g => g.subjects.length > 0);
  }

  const colspanAll = showAnn ? 4 + termCols.length * 5 + 4 : 4 + termCols.length * 5;

  groupedSubjects.forEach(group => {
    tbody += `<tr class="rc-all-subjects-row"><td colspan="${colspanAll}" style="text-align:left;padding-left:12px;background:var(--blue-50);color:var(--blue-900)">${group.groupName}</td></tr>`;
    
    group.subjects.forEach(s => {
      const sm = subjMaxVals[s.id];
      let row = `<tr><td class="rc-align-left rc-blue-text" style="font-weight:600">${Utils.escapeHtml(s.name)}</td>`;
      row += `<td>${sm.eu||''}</td><td>${sm.et||''}</td><td>${sm.tot||''}</td>`;
      maxTotEU += sm.eu; maxTotET += sm.et; maxTotTOT += sm.tot;

      let annObt=0, annMax=0, hasAnn=false;
      
      termCols.forEach(t => {
        const td = tData[t.id].find(x => x.subjectId === s.id);
        if (td && td.hasMarks) {
          row += `
            <td>${td.euObt!=null?td.euObt:''}</td>
            <td>${td.etObt!=null?td.etObt:''}</td>
            <td style="font-weight:700">${td.totObt}</td>
            <td>${td.pct!=null?td.pct.toFixed(1)+'%':''}</td>
            <td style="font-weight:700">${td.gr}</td>`;
          termTotals[t.id].eu += (td.euObt||0);
          termTotals[t.id].et += (td.etObt||0);
          termTotals[t.id].tot += td.totObt;
          termTotals[t.id].hasData = true;
          annObt += td.totObt; annMax += td.totMax; hasAnn = true;
        } else {
          row += `<td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td>`;
        }
      });

      if (showAnn) {
        if (hasAnn && annMax>0) {
          const apct = Math.round((annObt/annMax)*1000)/10;
          const agr = rcGrade(apct, d.scale);
          row += `<td>${annObt}</td><td>${annMax}</td><td>${apct.toFixed(1)}%</td><td style="font-weight:700">${agr}</td>`;
        } else {
          row += `<td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td>`;
        }
      }
      row += `</tr>`;
      tbody += row;
    });
  });

  /* ───── TOTAL ROW ───── */
  let tfTotal = `<tr><td class="rc-align-left rc-blue-bg-text font-bold">Total</td>`;
  tfTotal += `<td>${maxTotEU}</td><td>${maxTotET}</td><td>${maxTotTOT}</td>`;
  
  let gAnnObt=0, gAnnMax=0, hasGAnn=false;
  
  termCols.forEach(t => {
    const tt = termTotals[t.id];
    let tMax=0;
    d.activeSubjects.forEach(s=>{
      const ta = d.allAssessments.filter(a=>a.term_id===t.id && a.subject_id===s.id);
      tMax += ta.reduce((su,a)=>su+(Number(a.maximum_mark)||0),0);
    });
    if (tt.hasData) {
      const pct = Math.round((tt.tot/tMax)*1000)/10;
      tfTotal += `<td>${tt.eu}</td><td>${tt.et}</td><td>${tt.tot}</td><td>${pct.toFixed(1)}%</td><td class="rc-empty-cell"></td>`;
      gAnnObt += tt.tot; gAnnMax += tMax; hasGAnn = true;
    } else {
      tfTotal += `<td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td>`;
    }
  });

  if (showAnn) {
    if (hasGAnn && gAnnMax>0) {
      const pct = Math.round((gAnnObt/gAnnMax)*1000)/10;
      tfTotal += `<td>${gAnnObt}</td><td>${gAnnMax}</td><td>${pct.toFixed(1)}%</td><td class="rc-empty-cell"></td>`;
    } else {
      tfTotal += `<td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td><td class="rc-empty-cell"></td>`;
    }
  }
  tfTotal += `</tr>`;

  /* ───── PERCENTAGE ROW ───── */
  let tfPct = `<tr><td class="rc-align-left rc-blue-text font-bold">Percentage</td><td colspan="3" class="rc-empty-cell"></td>`;
  termCols.forEach(t => {
    const tt = termTotals[t.id];
    let tMax = d.allAssessments.filter(a=>a.term_id===t.id).reduce((s,a)=>s+(Number(a.maximum_mark)||0),0);
    if (tt.hasData && tMax>0) tfPct += `<td colspan="5">${(Math.round((tt.tot/tMax)*1000)/10).toFixed(1)}%</td>`;
    else tfPct += `<td colspan="5" class="rc-empty-cell"></td>`;
  });
  if (showAnn) tfPct += `<td colspan="4">${hasGAnn && gAnnMax>0 ? (Math.round((gAnnObt/gAnnMax)*1000)/10).toFixed(1)+'%' : ''}</td>`;
  tfPct += `</tr>`;

  /* ───── POSITION ROW ───── */
  let tfPos = `<tr><td class="rc-align-left rc-blue-text font-bold">Position</td><td colspan="3" class="rc-empty-cell"></td>`;
  termCols.forEach(t => {
    if (d.posData && d.posData[t.id]) {
      const pd = d.posData[t.id];
      const pos = pd.positions[learner.id];
      tfPos += `<td colspan="5">${pos ? pos + ' out of ' + pd.total : ''}</td>`;
    } else tfPos += `<td colspan="5" class="rc-empty-cell"></td>`;
  });
  if (showAnn) {
    // Annual position requires across all terms
    const scores = d.learnersList.map(l => {
      let lObt=0, lMax=0;
      d.allAssessments.forEach(a=>{
         lMax += Number(a.maximum_mark)||0;
         const m = d.allMarks.find(mk=>mk.assessment_id===a.id && mk.learner_id===l.id);
         if(m&&m.mark!=null) lObt+=Number(m.mark);
      });
      return { id: l.id, pct: lMax>0 ? lObt/lMax*100 : null };
    }).filter(x=>x.pct!=null);
    let annPos = '';
    if (scores.length) {
      scores.sort((a,b)=>b.pct-a.pct);
      let r=1, pr=null, prr=1;
      scores.forEach((s,i)=>{
        if(i===0){pr=s.pct; prr=1;} else if(s.pct!==pr){r=i+1; pr=s.pct; prr=r;}
        if(s.id===learner.id) annPos = prr + ' out of ' + scores.length;
      });
    }
    tfPos += `<td colspan="4">${annPos}</td>`;
  }
  tfPos += `</tr>`;

  /* ───── COMMENT ROW ───── */
  // Use centralized GradingEngine for automatic comments from database grading scale
  const getComment = (pct) => {
    if (typeof GradingEngine !== 'undefined' && d.scale && d.scale.length) {
      const info = GradingEngine.calculateGradeSync(pct, d.scale);
      if (info.comment) return info.comment;
      // Fallback to descriptor if no custom comment
      return info.descriptor || info.grade;
    }
    // Legacy fallback
    if (pct >= 80) return "Excellent progress! Keep it up.";
    if (pct >= 65) return "Good performance. Keep up the good work.";
    if (pct >= 50) return "Fair performance. You can do better next time.";
    return "You need to work harder. Seek help from teachers.";
  };

  let tfCom = `<tr><td class="rc-align-left rc-blue-text font-bold">Comment</td><td colspan="3" class="rc-empty-cell"></td>`;
  termCols.forEach(t => {
    const tt = termTotals[t.id];
    let tMax = d.allAssessments.filter(a=>a.term_id===t.id).reduce((s,a)=>s+(Number(a.maximum_mark)||0),0);
    if (tt.hasData && tMax>0) {
      const p = (tt.tot/tMax)*100;
      tfCom += `<td colspan="5" class="rc-comment-td">${getComment(p)}</td>`;
    } else {
      tfCom += `<td colspan="5" class="rc-empty-cell"></td>`;
    }
  });
  if (showAnn) {
    let cp = '';
    if (hasGAnn && gAnnMax>0) cp = getComment((gAnnObt/gAnnMax)*100);
    tfCom += `<td colspan="4" class="rc-comment-td">${cp}</td>`;
  }
  tfCom += `</tr>`;

  /* ───── SIGNATURE ROW ───── */
  const teacherSig = `<div>${d.settings.dos_name || 'EMMANUEL UWIMANA'}</div><img src="public/sig_teacher.png" onerror="this.outerHTML='<div class=&quot;rc-sig-stub&quot;></div>'" class="rc-sig-img">`;
  const parentSig = `<img src="public/sig_parent.png" onerror="this.outerHTML='<div class=&quot;rc-sig-stub&quot;></div>'" class="rc-sig-img">`;
  
  let tfSig = `<tr>
    <td colspan="4" class="rc-align-left rc-blue-text font-bold" style="border-right:none; padding-top:15px; padding-bottom:15px; line-height:2.2">
      Class Teacher's Signature  <br> 
      Parent's Signature 
    </td>
    <td colspan="${showAnn?termCols.length*5+4:termCols.length*5}" style="border-left:none" class="rc-sig-area">
      <div style="display:flex; justify-content:space-around; width:100%">
         <div style="text-align:center">${termCols.length>0 ? teacherSig : ''}</div>
         <div style="text-align:center">${termCols.length>1 ? parentSig : ''}</div>
         ${showAnn ? `<div style="text-align:center">${termCols.length>0 ? '' : ''}</div>` : ''}
      </div>
    </td>
  </tr>`;

  // Scale table
  const sRow1 = d.scale.length ? d.scale.sort((a,b)=>Number(b.minimum_percentage)-Number(a.minimum_percentage)).map(s=>`<td>${s.maximum_percentage}-${s.minimum_percentage}</td>`).join('') : '';
  const sRow2 = d.scale.length ? d.scale.map(s=>`<td>${s.grade}</td>`).join('') : '';
  const sRow3 = d.scale.length ? d.scale.map((s,i)=>`<td>${Math.max(6-i,0)}</td>`).join('') : '';
  
  const finalDesc = `
    <div class="rc-footer-panels">
      <div class="rc-scale-panel">
        <table class="rc-scale-tbl">
          <tr><td rowspan="3" class="rc-scale-title">Grading scale</td> <td class="rc-scale-blue">Final Grade</td> ${sRow1}</tr>
          <tr><td class="rc-scale-blue">Letter Grade</td> ${sRow2}</tr>
          <tr><td class="rc-scale-blue">Grade Value</td> ${sRow3}</tr>
        </table>
      </div>
      <div class="rc-desc-panel">
        <div class="rc-desc-box">
          <div class="rc-desc-label">Final Decision</div>
        </div>
        <div class="rc-desc-box">
          <div class="rc-desc-label">Abbreviations</div>
          <div style="font-size:10px; margin-top:2px;">
            EU: End of Unit Assessment<br>
            ET: End of Term Assessment<br>
            GR: Grade<br>
            TOT: Total<br>
            MAX: Maximum
          </div>
        </div>
        <div class="rc-desc-box" style="align-items:center; text-align:center;">
           <div class="rc-desc-label">Class Teacher</div>
           <div style="margin:2px 0 6px 0; font-weight:600">${Utils.escapeHtml(d.settings.dos_name || 'EMMANUEL UWIMANA')}</div>
        </div>
        <div class="rc-desc-box" style="align-items:center; border:none; text-align:center;">
           <div class="rc-desc-label">Signature</div>
           <img class="rc-sig-img" style="margin-top:2px" src="public/sig_teacher.png" onerror="this.outerHTML='<div class=&quot;rc-sig-stub-sm&quot;></div>'">
        </div>
      </div>
    </div>`;

  return `
    <div class="rc-paper">
      ${header}
      ${studentInfo}
      <div class="rc-table-wrapper">
        <table class="rc-data-table">
          <thead>${th1}${th2}${th3Weight}${th4Conduct}${th5All}</thead>
          <tbody>${tbody}</tbody>
          <tfoot>${tfTotal}${tfPct}${tfPos}${tfCom}${tfSig}</tfoot>
        </table>
      </div>
      ${finalDesc}
      <div class="rc-absolute-bottom">
        Generated by RMS-MIS &nbsp;|&nbsp; ${Utils.dateStr(new Date())} ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
        <span style="float:right; font-weight:700; color:#f59e0b; font-style:italic">Excellence Through Education</span>
      </div>
    </div>`;
}

async function rcExportPdf() {
  const paper = document.getElementById('rc-paper');
  if (!paper) return Utils.toast('Generate a report card first', 'error');
  const w = window.open('', '_blank');
  if (!w) return Utils.toast('Allow pop-ups to export PDF', 'error');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report Card</title>
  <link rel="stylesheet" href="${new URL('css/styles.css', window.location.href).href}">
  <link rel="stylesheet" href="${new URL('css/report-card.css', window.location.href).href}">
  </head><body class="printable-report rc-print-body">${paper.innerHTML}
  <script>window.onload=function(){setTimeout(function(){window.print();},500);};<\/script>
  </body></html>`);
  w.document.close();
}
