/* ============================================================
   RMS REPORT ENGINE — Shared report system
   All official reports (single assessment, combined EOU,
   class/subject) are built through this engine so they share
   the same school header, branding, summary, signatures and
   export behaviour.
   Depends on: Utils, DB, global getGrading()/getSchoolSettings()
   (defined in admin-reports.js; all calls happen at runtime).
   ============================================================ */

const ReportEngine = {
  current: null,
  containerId: '',

  /* ---------- Helpers ---------- */

  pct(n) {
    return Math.round(n * 10) / 10;
  },

  slug(v) {
    return String(v || '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  },

  fileName({ cls, sub, type, unit, term, year, ext }) {
    const parts = ['RMS-MIS'];
    if (cls) parts.push(this.slug(cls));
    if (sub) parts.push(this.slug(sub));
    if (type) parts.push(type);
    if (unit) parts.push(this.slug(unit));
    if (term) parts.push('Term' + this.slug(term).replace(/^Term/i, ''));
    if (year) parts.push(this.slug(year));
    return parts.join('_') + '.' + ext;
  },

  statusPill(status, isOfficial) {
    if (isOfficial || status === 'approved' || status === 'locked') {
      return '<span class="report-status-pill report-status-approved"><i data-lucide="check-circle-2"></i> OFFICIAL / APPROVED REPORT</span>';
    }
    return '<span class="report-status-pill report-status-draft"><i data-lucide="file-edit"></i> DRAFT / NOT YET APPROVED</span>';
  },

  ensurePrintFooter() {
    if (document.getElementById('rms-print-footer')) return;
    const el = document.createElement('div');
    el.id = 'rms-print-footer';
    el.className = 'print-page-footer';
    el.innerHTML =
      '<span class="pf-left">RMS-MIS | Rukara Model School Marks Information System</span>' +
      '<span class="pf-mid">Generated on: ' + Utils.dateTimeStr(new Date()) + '</span>' +
      '<span class="pf-right pg"></span>';
    document.body.appendChild(el);
  },

  ensureIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  /* ---------- Data builders ---------- */

  async buildSingle(assessmentId) {
    const [marks, assessments, settings, types] = await Promise.all([
      DB.query('marks', '*', { assessment_id: assessmentId }),
      DB.get('assessments'),
      this.settings(),
      getAssessmentTypes()
    ]);
    const assessment = assessments.find(a => a.id === assessmentId);
    if (!assessment) throw new Error('Assessment not found');

    const scale = await this.grading();
    const maxMark = Number(assessment.maximum_mark) || 30;
    const [classes, subjects, years, terms, learners, teacherRes] = await Promise.all([
      DB.get('classes'),
      DB.get('subjects'),
      DB.get('academic_years'),
      DB.get('terms'),
      DB.query('learners', '*', { class_id: assessment.class_id, status: 'active' }, { column: 'full_name', asc: true }),
      assessment.teacher_id ? DB.getRelated('teachers', '*', { id: assessment.teacher_id }).then(r => r[0]) : Promise.resolve(null)
    ]);

    const cls = classes.find(c => c.id === assessment.class_id);
    const sub = subjects.find(s => s.id === assessment.subject_id);
    const year = years.find(y => y.id === assessment.academic_year_id);
    const term = terms.find(t => t.id === assessment.term_id);

    const marksMap = {};
    marks.forEach(m => { marksMap[m.learner_id] = m; });

    const rows = learners.map(l => {
      const m = marksMap[l.id];
      const hasMark = !!(m && m.mark != null);
      const markVal = hasMark ? Number(m.mark) : null;
      const pct = hasMark ? Utils.pct(markVal, maxMark) : null;
      return {
        learnerId: l.id,
        learnerCode: l.learner_code || '-',
        name: l.full_name,
        gender: l.gender || '-',
        hasMark,
        mark: markVal,
        pct,
        grade: hasMark ? Utils.grade(pct, scale) : 'N/R',
        pf: hasMark ? Utils.passFail(pct, settings.pass_mark) : 'N/R',
        remark: hasMark ? Utils.remark(pct, scale) : '-',
        position: '-'
      };
    });

    this.applyRanking(rows, settings);

    const assessed = rows.filter(r => r.hasMark);
    const stats = this.computeStats(rows.length, assessed.map(r => r.pct), settings.pass_mark);
    const gradeDist = Utils.gradeDist(assessed.map(r => r.grade));

    const typeName = assessmentTypeName(types, assessment.assessment_type_id, '');
    const title = typeName
      ? (typeName.toUpperCase() + ' MARKS REPORT')
      : 'ASSESSMENT MARKS REPORT';

    return {
      type: 'single',
      settings,
      scale,
      assessments: [assessment],
      cls,
      sub,
      year,
      term,
      teacher: teacherRes?.full_name || '',
      status: assessment.status,
      isOfficial: ['approved', 'locked'].includes(assessment.status),
      assessmentType: typeName || 'End-of-Unit Assessment',
      maxMark,
      rows,
      stats,
      gradeDist,
      title,
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  async buildCombined(assessmentIds) {
    if (!assessmentIds || !assessmentIds.length) throw new Error('No assessments selected');
    const [allAssessments, types] = await Promise.all([DB.get('assessments'), getAssessmentTypes()]);
    const assessments = allAssessments
      .filter(a => assessmentIds.includes(a.id))
      .sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)) || String(a.name).localeCompare(String(b.name)));
    if (!assessments.length) throw new Error('No matching assessments found');

    const classId = assessments[0].class_id;
    const subjectId = assessments[0].subject_id;
    if (assessments.some(a => a.class_id !== classId || a.subject_id !== subjectId)) {
      throw new Error('All selected assessments must be for the same class and subject.');
    }

    const settings = await this.settings();
    const scale = await this.grading();
    const [classes, subjects, years, terms, learners, teacherRes] = await Promise.all([
      DB.get('classes'),
      DB.get('subjects'),
      DB.get('academic_years'),
      DB.get('terms'),
      DB.query('learners', '*', { class_id: classId, status: 'active' }, { column: 'full_name', asc: true }),
      assessments[0].teacher_id ? DB.getRelated('teachers', '*', { id: assessments[0].teacher_id }).then(r => r[0]) : Promise.resolve(null)
    ]);

    const typeWeightOf = a => {
      if (a == null) return null;
      if (a.weight != null) return Number(a.weight);
      const t = types.find(x => x.id === a.assessment_type_id);
      if (t && t.weight != null) return Number(t.weight);
      return null;
    };
    assessments.forEach(a => { a._typeName = assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'); a._effWeight = typeWeightOf(a); });

    const marksByAssess = {};
    for (const a of assessments) {
      const { data, error } = await sbClient.from('marks').select('*').eq('assessment_id', a.id);
      if (error) throw error;
      marksByAssess[a.id] = data || [];
    }

    const cls = classes.find(c => c.id === classId);
    const sub = subjects.find(s => s.id === subjectId);
    const year = years.find(y => y.id === assessments[0].academic_year_id);
    const term = terms.find(t => t.id === assessments[0].term_id);

    const rows = learners.map(l => {
      const units = assessments.map(a => {
        const m = (marksByAssess[a.id] || []).find(mm => mm.learner_id === l.id);
        const hasMark = !!(m && m.mark != null);
        return {
          assessmentId: a.id,
          unit: a.unit || a.name,
          typeName: a._typeName,
          weight: a._effWeight,
          max: Number(a.maximum_mark) || 0,
          mark: hasMark ? Number(m.mark) : null,
          pct: hasMark ? Utils.pct(m.mark, a.maximum_mark) : null,
          hasMark
        };
      });
      const marked = units.filter(u => u.hasMark);
      const weighted = marked.length && marked.every(u => u.weight != null && u.weight > 0);
      let pct = null;
      let obtained = 0;
      let denominator = 0;
      if (marked.length && weighted) {
        const num = marked.reduce((s, u) => s + (u.pct * u.weight), 0);
        const den = marked.reduce((s, u) => s + u.weight, 0);
        pct = den > 0 ? (num / den) : null;
        obtained = marked.reduce((s, u) => s + u.mark, 0);
        denominator = marked.reduce((s, u) => s + u.max, 0);
      } else if (marked.length) {
        obtained = marked.reduce((s, u) => s + u.mark, 0);
        denominator = marked.reduce((s, u) => s + u.max, 0);
        pct = denominator > 0 ? (obtained / denominator) * 100 : null;
      }
      return {
        learnerId: l.id,
        learnerCode: l.learner_code || '-',
        name: l.full_name,
        gender: l.gender || '-',
        units,
        weighted: pct != null && weighted,
        obtained,
        denominator,
        pct: pct == null ? null : Math.round(pct * 100) / 100,
        grade: pct == null ? 'N/R' : Utils.grade(pct, scale),
        pf: pct == null ? 'N/R' : Utils.passFail(pct, settings.pass_mark),
        position: '-'
      };
    });

    this.applyRanking(rows, settings);

    const assessed = rows.filter(r => r.pct != null);
    const stats = this.computeStats(rows.length, assessed.map(r => r.pct), settings.pass_mark);
    const gradeDist = Utils.gradeDist(assessed.map(r => r.grade));

    const unitAverages = assessments.map((a, i) => {
      const pcts = rows.map(r => r.units[i]).filter(u => u.hasMark).map(u => u.pct);
      return {
        unit: a.unit || a.name,
        name: a.name,
        typeName: a._typeName,
        max: Number(a.maximum_mark) || 0,
        weight: a._effWeight,
        avg: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length * 100) / 100 : 0,
        count: pcts.length,
        status: a.status
      };
    });

    const dateStrs = assessments.map(a => a.assessment_date).filter(Boolean).sort();
    const weighted = assessments.length > 0 && assessments.every(a => a._effWeight != null && a._effWeight > 0);

    return {
      type: 'combined',
      settings,
      scale,
      assessments,
      cls,
      sub,
      year,
      term,
      teacher: teacherRes?.full_name || '',
      status: '',
      dateRange: dateStrs.length > 1
        ? Utils.dateStr(dateStrs[0]) + ' - ' + Utils.dateStr(dateStrs[dateStrs.length - 1])
        : (dateStrs[0] ? Utils.dateStr(dateStrs[0]) : ''),
      isOfficial: assessments.every(a => ['approved', 'locked'].includes(a.status)),
      weighted,
      rows,
      stats,
      gradeDist,
      unitAverages,
      title: 'COMBINED ASSESSMENT PERFORMANCE REPORT',
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  async buildMissingMarks(assessmentIds) {
    if (!assessmentIds || !assessmentIds.length) throw new Error('No assessments selected');
    const [allAssessments, types] = await Promise.all([DB.get('assessments'), getAssessmentTypes()]);
    const assessments = allAssessments.filter(a => assessmentIds.includes(a.id)).sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)) || String(a.name).localeCompare(String(b.name)));
    if (!assessments.length) throw new Error('No matching assessments found');

    const classId = assessments[0].class_id;
    const subjectId = assessments[0].subject_id;
    if (assessments.some(a => a.class_id !== classId || a.subject_id !== subjectId)) {
      throw new Error('All selected assessments must be for the same class and subject.');
    }

    const settings = await this.settings();
    const [classes, subjects, years, terms, learners] = await Promise.all([
      DB.get('classes'),
      DB.get('subjects'),
      DB.get('academic_years'),
      DB.get('terms'),
      DB.query('learners', '*', { class_id: classId, status: 'active' }, { column: 'full_name', asc: true })
    ]);

    assessments.forEach(a => { a._typeName = assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'); });

    const marksByAssess = {};
    for (const a of assessments) {
      const { data, error } = await sbClient.from('marks').select('learner_id').eq('assessment_id', a.id);
      if (error) throw error;
      marksByAssess[a.id] = new Set((data || []).map(m => m.learner_id));
    }

    const rows = learners.map(l => {
      const units = assessments.map(a => ({
        assessmentId: a.id,
        name: a.unit || a.name,
        typeName: a._typeName,
        hasMark: marksByAssess[a.id].has(l.id)
      }));
      return {
        learnerId: l.id,
        learnerCode: l.learner_code || '-',
        name: l.full_name,
        gender: l.gender || '-',
        units,
        marksCount: units.filter(u => u.hasMark).length,
        hasAll: units.every(u => u.hasMark)
      };
    });

    const cls = classes.find(c => c.id === classId);
    const sub = subjects.find(s => s.id === subjectId);
    const year = years.find(y => y.id === assessments[0].academic_year_id);
    const term = terms.find(t => t.id === assessments[0].term_id);

    return {
      type: 'missing-marks',
      settings,
      cls,
      sub,
      year,
      term,
      assessments,
      rows,
      missing: rows.filter(r => !r.hasAll),
      methodsEnabled: '',
      title: 'MISSING MARKS REPORT',
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  renderMissingMarks(data, containerId) {
    this.current = data;
    this.containerId = containerId || this.containerId;
    this.ensurePrintFooter();

    const div = document.getElementById(this.containerId);
    if (!div) return;

    div.innerHTML = `
      <div class="report-preview-toolbar-flex no-print">
        <div class="report-preview-title"><h3 style="font-size:16px;font-weight:700;color:var(--gray-800)">Report Preview</h3>
        <p class="text-sm text-muted">${data.missing.length} of ${data.rows.length} learners missing at least one mark</p></div>
        ${this.toolbarHtml()}
      </div>
      <div class="report-paper-container report-orientation-${data.orientation}">
        ${this.dosHeaderHtml(data)}
        ${this.dosMissingBody(data)}
        ${this.dosSummaryHtml(data)}
        ${this.dosSignaturesHtml(data)}
        ${this.dosFooter(data)}
      </div>`;
    this.ensureIcons();
    if (div.scrollIntoView) div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  applyRanking(rows, settings) {
    const assessed = rows.filter(r => r.pct != null);
    if (settings.ranking_enabled === false || !assessed.length) return;
    const posList = Utils.positions(assessed.map(r => ({ id: r.learnerId, pct: r.pct })));
    assessed.forEach(r => {
      const p = posList.find(x => x.id === r.learnerId);
      if (p) r.position = p.position;
    });
    rows.sort((a, b) => {
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return (a.position || 9999) - (b.position || 9999);
    });
  },

  computeStats(total, pcts, passMark) {
    const assessed = pcts.length;
    const sum = pcts.reduce((a, b) => a + b, 0);
    const passed = pcts.filter(p => p >= passMark).length;
    return {
      total,
      assessed,
      passed,
      failed: assessed - passed,
      passRate: assessed ? Math.round((passed / assessed) * 10000) / 100 : 0,
      avg: sum ? Math.round(sum / assessed * 100) / 100 : 0,
      high: assessed ? Math.max(...pcts) : 0,
      low: assessed ? Math.min(...pcts) : 0
    };
  },

  /* ---------- HTML rendering ---------- */

  /* ---------- Class List (Student Roster) ---------- */

  async buildClassList({ classId, yearId = null, termId = null, includeInactive = false }) {
    if (!classId) throw new Error('Select a class');

    const [classes, years, terms, settings, allLearners] = await Promise.all([
      DB.get('classes'),
      DB.get('academic_years'),
      DB.get('terms'),
      this.settings(),
      DB.get('learners')
    ]);

    const cls = classes.find(c => c.id === classId);
    if (!cls) throw new Error('Class not found');

    const year = yearId ? years.find(y => y.id === yearId) : null;
    const term = termId ? terms.find(t => t.id === termId) : null;

    const learners = allLearners
      .filter(l => l.class_id === classId && (includeInactive || l.status === 'active'))
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

    const rows = learners.map(l => ({
      learnerId: l.id,
      learnerCode: l.learner_code || '-',
      name: l.full_name,
      gender: l.gender || '-',
      status: l.status || 'active'
    }));

    return {
      type: 'class-list',
      settings,
      cls,
      year,
      term,
      rows,
      stats: {
        total: rows.length,
        boys: rows.filter(r => r.gender === 'M').length,
        girls: rows.filter(r => r.gender === 'F').length
      },
      title: 'CLASS LIST / STUDENT ROSTER',
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  classListBody(data) {
    const th = `<tr><th style="width:44px">No.</th><th>Student Number</th><th>Student Name</th><th style="width:90px">Gender</th><th style="width:120px">Status</th></tr>`;
    const rows = data.rows.map((r, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-code">${Utils.escapeHtml(r.learnerCode)}</td>
        <td class="col-learner-name">${Utils.escapeHtml(r.name)}</td>
        <td class="text-center">${r.gender === 'M' ? 'M' : r.gender === 'F' ? 'F' : Utils.escapeHtml(r.gender)}</td>
        <td class="text-center"><span class="badge ${Utils.statusColor(r.status)}">${Utils.escapeHtml(r.status)}</span></td>
      </tr>`).join('');
    return `
      <div class="report-table-scroll">
        <table class="report-marks-table">
          <thead>${th}</thead>
          <tbody>${rows || '<tr><td colspan="5" class="text-center text-nr">No learners in this class</td></tr>'}</tbody>
        </table>
      </div>`;
  },

  renderClassList(data, containerId) {
    this.current = data;
    this.containerId = containerId || this.containerId;
    this.ensurePrintFooter();

    const div = document.getElementById(this.containerId);
    if (!div) return;

    const divHtml = `
      <div class="report-preview-toolbar-flex no-print">
        <div class="report-preview-title"><h3 style="font-size:16px;font-weight:700;color:var(--gray-800)">Report Preview</h3>
        <p class="text-sm text-muted">${data.stats?.total || 0} learners in this class</p></div>
        ${this.toolbarHtml()}
      </div>
      <div class="report-paper-container report-orientation-${data.orientation}">
        ${this.headerHtml(data)}
        ${this.classListBody(data)}
        ${this.dosSummaryHtml(data)}
        ${schoolSignatureSection(data.teacher, data.settings.dos_name, data.settings.headteacher_name, data.settings.school_name)}
      </div>`;
    div.innerHTML = divHtml;
    this.ensureIcons();
    if (div.scrollIntoView) div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  render(data, containerId) {
    if (data.type === 'class-list') return this.renderClassList(data, containerId);
    this.current = data;
    this.containerId = containerId || this.containerId;
    this.ensurePrintFooter();

    const div = document.getElementById(this.containerId);
    if (!div) return;

    const divHtml = `
      <div class="report-preview-toolbar-flex no-print">
        <div class="report-preview-title"><h3 style="font-size:16px;font-weight:700;color:var(--gray-800)">Report Preview</h3>
        <p class="text-sm text-muted">${data.rows.length} learners &bull; ${data.assessments.length} assessment${data.assessments.length !== 1 ? 's' : ''}</p></div>
        ${this.toolbarHtml()}
      </div>
      <div class="report-paper-container report-orientation-${data.orientation}">
        ${this.headerHtml(data)}
        ${this.tableHtml(data)}
        ${this.summaryHtml(data)}
        ${data.type === 'combined' ? this.unitPerfHtml(data) : ''}
        ${this.gradeDistRowsHtml(data) || ''}
        ${schoolSignatureSection(data.teacher, data.settings.dos_name, data.settings.headteacher_name, data.settings.school_name)}
      </div>`;
    div.innerHTML = divHtml;
    this.ensureIcons();
    if (div.scrollIntoView) div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  renderDOS(data, containerId) {
    this.current = data;
    this.containerId = containerId || this.containerId;
    this.ensurePrintFooter();

    document.body.classList.remove('report-orientation-portrait', 'report-orientation-landscape');
    document.body.classList.add('report-orientation-' + (data.orientation || 'landscape'));

    const div = document.getElementById(this.containerId);
    if (!div) return;

    const bodyHtml = data.type === 'learner-report' ? this.dosLearnerBody(data)
      : data.type === 'class-subject' ? this.dosClassSubjectBody(data)
      : data.type === 'complete-class' ? this.dosCompleteClassBody(data)
      : data.type === 'school-performance' ? this.dosSchoolPerformanceBody(data)
      : data.type === 'class-list' ? this.classListBody(data)
      : data.type === 'missing-marks' ? this.dosMissingBody(data)
      : (data.type === 'single' || data.type === 'combined')
        ? this.tableHtml(data) + this.summaryHtml(data) + this.gradeDistRowsHtml(data) + (data.type === 'combined' ? this.unitPerfHtml(data) : '')
      : '';

    const statsInfo = data.type === 'school-performance'
    ? `<p class="text-sm text-muted">${data.subjects?.length || 0} subjects &bull; ${data.classes?.length || 0} classes</p>`
    : data.type === 'class-list'
      ? `<p class="text-sm text-muted">${data.stats?.total || 0} learners in this class</p>`
      : data.type === 'missing-marks'
        ? `<p class="text-sm text-muted">${data.missing?.length || 0} learner${(data.missing?.length || 0) === 1 ? '' : 's'} missing marks out of ${data.rows?.length || 0}</p>`
      : data.type !== 'learner-report'
        ? `<p class="text-sm text-muted">${data.rows?.length || 0} learners &bull; ${data.assessments?.length || 0} assessments</p>`
        : `<p class="text-sm text-muted">${data.totalSubjects != null ? data.totalSubjects + ' subjects' : ''}</p>`;

    const divHtml = `
      <div class="report-preview-toolbar-flex no-print">
        <div class="report-preview-title"><h3 style="font-size:16px;font-weight:700;color:var(--gray-800)">Report Preview</h3>
        ${statsInfo}</div>
        ${this.toolbarHtml()}
      </div>
      <div class="report-paper-container report-orientation-${data.orientation}">
        ${this.dosHeaderHtml(data)}
        ${bodyHtml}
        ${this.dosSummaryHtml(data)}
        ${this.dosSignaturesHtml(data)}
        ${this.dosFooter(data)}
      </div>`;
    div.innerHTML = divHtml;
    this.ensureIcons();
    if (div.scrollIntoView) div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  dosHeaderHtml(data) {
    const headerOpts = {
      settings: data.settings,
      className: data.cls?.name,
      subject: data.sub?.name,
      academicYear: data.year?.name,
      term: data.term?.name,
      status: 'approved',
      isOfficial: true,
      generatedBy: data.generatedBy || ''
    };
    if (data.type === 'learner-report') {
      headerOpts.learner = data.learner;
    } else if (data.type === 'single') {
      headerOpts.unit = data.assessments?.[0]?.unit || data.assessments?.[0]?.name;
      headerOpts.assessmentType = data.assessmentType || 'End-of-Unit Assessment';
      headerOpts.date = Utils.dateStr(data.assessments?.[0]?.assessment_date);
    } else if (data.type === 'combined' || data.type === 'missing-marks') {
      headerOpts.assessmentsList = data.assessments;
      headerOpts.assessmentsCount = data.assessments?.length;
      headerOpts.totalMax = (data.assessments || []).reduce((s, a) => s + (Number(a.maximum_mark) || 0), 0);
      headerOpts.date = data.dateRange;
    }
    const extra = data.type === 'learner-report' && data.learner
      ? `<div class="report-info-item"><span class="label">Student</span><div class="value">${Utils.escapeHtml(data.learner.full_name || '')}</div></div>
         ${data.learner.learner_code ? `<div class="report-info-item"><span class="label">Student No.</span><div class="value">${Utils.escapeHtml(data.learner.learner_code)}</div></div>` : ''}
         ${data.learner.gender ? `<div class="report-info-item"><span class="label">Gender</span><div class="value">${Utils.escapeHtml(data.learner.gender)}</div></div>` : ''}`
      : '';
    return schoolReportHeader(data.title, headerOpts) + (extra ? `<div class="report-info-panel">${extra}</div>` : '');
  },

  dosSummaryHtml(data) {
    if (data.type === 'missing-marks') {
      const total = data.rows?.length || 0;
      const miss = data.missing?.length || 0;
      return `
        <div class="report-summary-section">
          <div class="report-summary-grid report-summary-grid-4">
            <div class="report-stat-card"><div class="val">${total}</div><div class="lbl">Total Learners</div></div>
            <div class="report-stat-card"><div class="val">${total - miss}</div><div class="lbl">Fully Recorded</div></div>
            <div class="report-stat-card"><div class="val">${miss}</div><div class="lbl">Missing Marks</div></div>
            <div class="report-stat-card"><div class="val">${data.assessments?.length || 0}</div><div class="lbl">Assessments</div></div>
          </div>
        </div>`;
    }
    if (data.type === 'class-list') {
      const st = data.stats || { total: 0, boys: 0, girls: 0 };
      return `
        <div class="report-summary-section">
          <div class="report-summary-grid report-summary-grid-4">
            <div class="report-stat-card"><div class="val">${st.total}</div><div class="lbl">Total Learners</div></div>
            <div class="report-stat-card"><div class="val">${st.boys}</div><div class="lbl">Boys (M)</div></div>
            <div class="report-stat-card"><div class="val">${st.girls}</div><div class="lbl">Girls (F)</div></div>
            <div class="report-stat-card"><div class="val">${Utils.dateStr(new Date())}</div><div class="lbl">List Date</div></div>
          </div>
        </div>`;
    }
    if (data.type === 'learner-report') {
      return `
        <div class="report-summary-section">
          <div class="report-summary-grid report-summary-grid-4">
            <div class="report-stat-card"><div class="val">${data.subjectsWithData.length}/${data.totalSubjects || 0}</div><div class="lbl">Subjects Assessed</div></div>
            <div class="report-stat-card"><div class="val">${data.subjectsPassed}</div><div class="lbl">Subjects Passed</div></div>
            <div class="report-stat-card"><div class="val">${data.subjectsFailed}</div><div class="lbl">Subjects Failed</div></div>
            <div class="report-stat-card"><div class="val">${data.overallPct != null ? data.overallPct + '%' : 'N/R'}</div><div class="lbl">Overall Average</div></div>
          </div>
          <div class="report-summary-section">
            <div class="report-summary-grid report-summary-grid-4">
              <div class="report-stat-card"><div class="val">${data.overallGrade}</div><div class="lbl">Overall Grade</div></div>
              <div class="report-stat-card"><div class="val">${data.overallRemark}</div><div class="lbl">Remark</div></div>
              <div class="report-stat-card"><div class="val">${data.overallObtained}/${data.overallMax}</div><div class="lbl">Total Marks</div></div>
              <div class="report-stat-card"><div class="val">${Utils.dateStr(new Date())}</div><div class="lbl">Report Date</div></div>
            </div>
          </div>
        </div>`;
    }
    if (data.stats) {
      return `
        <div class="report-summary-section">
          <div class="report-summary-grid report-summary-grid-4">
            <div class="report-stat-card"><div class="val">${data.stats.total}</div><div class="lbl">Total Learners</div></div>
            <div class="report-stat-card"><div class="val">${data.stats.assessed}</div><div class="lbl">Learners Assessed</div></div>
            <div class="report-stat-card"><div class="val">${data.stats.passRate !== null && data.stats.passRate !== undefined ? this.pct(data.stats.passRate) + '%' : '-'}</div><div class="lbl">Pass Rate</div></div>
            <div class="report-stat-card"><div class="val">${data.stats.avg != null ? this.pct(data.stats.avg) + '%' : '-'}</div><div class="lbl">Class Average</div></div>
          </div>
          ${this.gradeDistRowsHtml(data) || ''}
        </div>`;
    }
    return '';
  },

  dosFooter(data) {
    return `<div class="report-doc-footer">
      <div>${Utils.escapeHtml(data.settings.school_name || 'Rukara Model School')} | RMS-MIS - Rukara Model School Marks Information System</div>
      <div>Generated on: ${Utils.dateTimeStr(new Date())} &bull; By: ${Utils.escapeHtml(data.generatedBy || '')}</div>
    </div>`;
  },

  dosSignaturesHtml(data) {
    if (data.type === 'complete-class' || data.type === 'school-performance' || data.type === 'class-list') {
      return schoolSignatureSection(data.generatedBy, data.settings.dos_name, data.settings.headteacher_name, data.settings.school_name)
        .replace('<div class="sig-title">Prepared by:</div>', '<div class="sig-title">Prepared by / DOS:</div>')
        .replace('<div class="sig-sub">Teacher</div>', '<div class="sig-sub">Director of Studies</div>');
    }
    if (data.type === 'class-subject') {
      return schoolSignatureSection((data.cls && data.sub ? '' : '') + data.generatedBy, data.settings.dos_name, data.settings.headteacher_name, data.settings.school_name)
        .replace('<div class="sig-sub">Teacher</div>', '<div class="sig-sub">Subject Teacher</div>');
    }
    return schoolSignatureSection(data.generatedBy, data.settings.dos_name, data.settings.headteacher_name, data.settings.school_name);
  },

  dosLearnerBody(data) {
    const th = `<tr><th style="width:40px">No.</th><th>Subject</th><th style="width:80px">Assessments</th><th style="width:80px">Obtained</th><th style="width:80px">Maximum</th><th style="width:80px">Average %</th><th style="width:70px">Grade</th><th style="width:80px">Result</th><th>Remark</th></tr>`;
    const rows = data.subjects.map((s, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-learner-name">${Utils.escapeHtml(s.subjectName)}</td>
        <td class="text-center">${s.assessmentCount}</td>
        <td class="text-center">${s.totalObtained}</td>
        <td class="text-center">${s.totalMax}</td>
        <td class="text-center font-semibold">${s.pct != null ? s.pct + '%' : '<span class="text-nr">N/R</span>'}</td>
        <td class="text-center"><span class="badge ${Utils.statusColor(s.pf === 'PASS' ? 'approved' : 'rejected')}">${Utils.escapeHtml(s.grade)}</span></td>
        <td class="text-center">${s.pf === 'PASS' ? '<span class="badge-result-pass">PASS</span>' : s.pf === 'FAIL' ? '<span class="badge-result-fail">FAIL</span>' : '<span class="text-nr">N/R</span>'}</td>
        <td>${Utils.escapeHtml(s.remark || '-')}</td>
      </tr>`).join('');
    return `
      <table class="report-marks-table">
        <thead>${th}</thead>
        <tbody>${rows || '<tr><td colspan="9" class="text-center text-nr">No assessment data found</td></tr>'}</tbody>
      </table>
      <div class="report-sub-title" style="margin-bottom:8px">Subject Breakdown</div>
      ${data.subjects.filter(s => s.assessments.length).map(s => `
        <table class="report-assess-tbl" style="margin-bottom:16px">
          <thead><tr><th style="width:30px">No.</th><th>Assessment</th><th style="width:90px">Obtained</th><th style="width:90px">Max</th><th style="width:80px">%</th><th style="width:70px">Grade</th></tr></thead>
          <tbody>${s.assessments.map((a, i) => `
            <tr>
              <td class="text-center">${i + 1}</td>
              <td class="font-semibold">${Utils.escapeHtml(a.name)}</td>
              <td class="text-center">${a.obtained != null ? a.obtained : '<span class="text-nr">N/R</span>'}</td>
              <td class="text-center">${a.maximum_mark || 0}</td>
              <td class="text-center">${a.pct != null ? a.pct + '%' : '<span class="text-nr">N/R</span>'}</td>
              <td class="text-center">${Utils.escapeHtml(a.grade)}</td>
            </tr>`).join('')}</tbody>
        </table>`).join('')}`;
  },

  dosClassSubjectBody(data) {
    const th = `<tr><th style="width:40px">No.</th><th>Student No.</th><th>Learner Name</th><th>Gender</th><th>Mark</th><th>Max</th><th>Average %</th><th>Grade</th><th>Result</th>${data.rows.some(r => r.position !== '-') ? '<th>Rank</th>' : ''}<th>Remark</th></tr>`;
    const rows = data.rows.map((r, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-code">${Utils.escapeHtml(r.learnerCode)}</td>
        <td class="col-learner-name">${Utils.escapeHtml(r.name)}</td>
        <td class="text-center">${Utils.escapeHtml(r.gender)}</td>
        <td class="text-center font-semibold">${r.hasMark ? r.mark : '<span class="text-nr">N/R</span>'}</td>
        <td class="text-center">${r.maxMark}</td>
        <td class="text-center font-semibold">${r.hasMark ? r.pct + '%' : '<span class="text-nr">N/R</span>'}</td>
        <td class="text-center"><span class="badge ${Utils.statusColor(r.pf === 'PASS' ? 'approved' : 'rejected')}">${Utils.escapeHtml(r.grade)}</span></td>
        <td class="text-center">${r.pf === 'PASS' ? '<span class="badge-result-pass">PASS</span>' : r.pf === 'FAIL' ? '<span class="badge-result-fail">FAIL</span>' : '<span class="text-nr">N/R</span>'}</td>
        ${data.rows.some(x => x.position !== '-') ? `<td class="text-center font-semibold">${r.position}</td>` : ''}
        <td>${Utils.escapeHtml(r.remark || '-')}</td>
      </tr>`).join('');
    return `
      <table class="report-marks-table">
        <thead>${th}</thead>
        <tbody>${rows || '<tr><td colspan="10" class="text-center text-nr">No data found</td></tr>'}</tbody>
      </table>`;
  },

  dosCompleteClassBody(data) {
    const subCells = data.subjects.map(s => `<th>${Utils.escapeHtml(s.name)}</th>`).join('');
    const th = `<tr><th style="width:40px">No.</th><th>Student No.</th><th>Learner Name</th><th>Gender</th>${subCells}<th>Overall %</th><th>Grade</th><th>Result</th><th>Rank</th></tr>`;
    const rows = data.rows.map((r, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-code">${Utils.escapeHtml(r.learnerCode)}</td>
        <td class="col-learner-name">${Utils.escapeHtml(r.name)}</td>
        <td class="text-center">${Utils.escapeHtml(r.gender)}</td>
        ${data.subjects.map(s => {
          const sub = r.subjectSummary.find(x => x.subjectId === s.id);
          return `<td class="text-center ${sub && sub.hasMark ? 'font-semibold' : ''}">${sub && sub.hasMark ? sub.pct + '%' : '<span class="text-nr">N/R</span>'}</td>`;
        }).join('')}
        <td class="text-center font-semibold">${r.pct != null ? r.pct + '%' : '<span class="text-nr">N/R</span>'}</td>
        <td class="text-center"><span class="badge ${Utils.statusColor(r.pf === 'PASS' ? 'approved' : 'rejected')}">${Utils.escapeHtml(r.grade)}</span></td>
        <td class="text-center">${r.pf === 'PASS' ? '<span class="badge-result-pass">PASS</span>' : r.pf === 'FAIL' ? '<span class="badge-result-fail">FAIL</span>' : '<span class="text-nr">N/R</span>'}</td>
        <td class="text-center font-semibold">${r.position}</td>
      </tr>`).join('');
    const note = `<div class="report-sub-title" style="margin:6px 0 12px">Cells show subject average % based on all approved assessments. N/R = not recorded.</div>`;
    return `${note}
      <div class="report-table-scroll">
        <table class="report-marks-table">
          <thead>${th}</thead>
          <tbody>${rows || '<tr><td colspan="10" class="text-center text-nr">No data found</td></tr>'}</tbody>
        </table>
      </div>`;
  },

  dosSchoolPerformanceBody(data) {
    const subRows = data.subjects.map((s, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-learner-name">${Utils.escapeHtml(s.subjectName)}</td>
        <td class="text-center">${s.marksCount}</td>
        <td class="text-center font-semibold">${s.avg}%</td>
        <td class="text-center">${s.passRate}%</td>
      </tr>`).join('');
    const classRows = data.classes.map((c, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td class="col-learner-name">${Utils.escapeHtml(c.className)}</td>
        <td class="text-center">${c.marksCount}</td>
        <td class="text-center font-semibold">${c.avg}%</td>
        <td class="text-center">${c.passRate}%</td>
      </tr>`).join('');
    return `
      <div class="report-sub-title" style="margin-bottom:8px;text-align:center">School Average: ${data.schoolAvg}%</div>
      <div class="report-sub-title" style="margin:16px 0 8px">Subject Performance</div>
      <table class="report-marks-table">
        <thead><tr><th style="width:40px">No.</th><th>Subject</th><th>Marks Count</th><th>Average %</th><th>Pass Rate</th></tr></thead>
        <tbody>${subRows || '<tr><td colspan="5" class="text-center text-nr">No data found</td></tr>'}</tbody>
      </table>
      <div class="report-sub-title" style="margin:16px 0 8px">Class Performance</div>
      <table class="report-marks-table">
        <thead><tr><th style="width:40px">No.</th><th>Class</th><th>Marks Count</th><th>Average %</th><th>Pass Rate</th></tr></thead>
        <tbody>${classRows || '<tr><td colspan="5" class="text-center text-nr">No data found</td></tr>'}</tbody>
      </table>`;
  },

  dosMissingBody(data) {
    const th = data.assessments.map(a => `
      <th class="th-unit">
        <div class="unit-th-name">${Utils.escapeHtml(a.unit || a.name)}</div>
        <div class="unit-th-max">${Utils.escapeHtml(a._typeName || '')}</div>
      </th>`).join('');
    const rows = (data.missing && data.missing.length ? data.missing : data.rows).map((d, i) => `
      <tr>
        <td class="text-center text-muted">${i + 1}</td>
        <td class="col-code">${Utils.escapeHtml(d.learnerCode)}</td>
        <td class="col-learner-name">${Utils.escapeHtml(d.name)}</td>
        <td class="text-center">${Utils.escapeHtml(d.gender)}</td>
        ${data.assessments.map((a, j) => {
          const u = d.units[j];
          return `<td class="text-center ${u && u.hasMark ? '' : 'missing-cell'}">${u && u.hasMark ? 'Y' : 'MISSING'}</td>`;
        }).join('')}
        <td class="text-center font-bold">${d.marksCount}/${data.assessments.length}</td>
      </tr>`).join('');
    return `
      <div class="report-sub-title" style="margin:6px 0 12px">Learners missing marks for one or more selected assessments. Y = recorded.</div>
      <div class="report-table-scroll">
        <table class="report-marks-table compact">
          <thead><tr>
            <th style="width:32px">No.</th>
            <th>Student Number</th>
            <th class="th-left">Learner Name</th>
            <th style="width:38px">Gen</th>
            ${th}
            <th>Marks</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="text-center text-nr">All learners have complete marks</td></tr>'}</tbody>
        </table>
      </div>`;
  },

  headerHtml(data) {
    const headerOpts = {
      settings: data.settings,
      className: data.cls?.name,
      subject: data.sub?.name,
      academicYear: data.year?.name,
      term: data.term?.name,
      teacher: data.teacher,
      status: data.isOfficial ? 'approved' : '',
      isOfficial: data.isOfficial,
      generatedBy: data.generatedBy || ''
    };
    if (data.type === 'single') {
      headerOpts.unit = data.assessments[0].unit || data.assessments[0].name;
      headerOpts.assessmentType = data.assessmentType;
      headerOpts.date = Utils.dateStr(data.assessments[0].assessment_date);
    } else if (data.type !== 'class-list' && data.type !== 'missing-marks') {
      headerOpts.assessmentsList = data.assessments;
      headerOpts.assessmentsCount = data.assessments.length;
      headerOpts.totalMax = data.assessments.reduce((s, a) => s + (Number(a.maximum_mark) || 0), 0);
      headerOpts.date = data.dateRange;
    }
    return schoolReportHeader(data.title, headerOpts);
  },

  toolbarHtml() {
    const backTarget = this.containerId === 'trpt-content' ? 'showTeacherReportSelection()' : 'showAdminReportSelection()';
    const backBtn = ['rpt-content', 'trpt-content'].includes(this.containerId)
      ? `<button class="btn btn-secondary" onclick="${backTarget}"><i data-lucide="arrow-left"></i> Back</button>`
      : '';
    return `
      <div class="flex gap-2" style="flex-wrap:wrap">
        ${backBtn}
        <button class="btn btn-secondary" onclick="rmsPrintReport()"><i data-lucide="printer"></i> Print</button>
        <button class="btn btn-secondary" onclick="rmsExportPdf()"><i data-lucide="file-down"></i> Export PDF</button>
        <button class="btn btn-secondary" onclick="rmsExportWord()"><i data-lucide="file-text"></i> Export Word</button>
        <button class="btn btn-primary" onclick="rmsExportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
        <button class="btn btn-secondary" onclick="rmsExportCsv()"><i data-lucide="file-text"></i> Export CSV</button>
      </div>`;
  },

  tableHtml(data) {
    const unitCount = data.type === 'combined' ? data.assessments.length : 0;
    const compact = data.type === 'combined' || unitCount >= 3;
    const nr = '<span class="text-nr">N/R</span>';

    let head, body;
    if (data.type === 'single') {
      head = `
        <tr>
          <th style="width:32px">No.</th>
          <th>Student Number</th>
          <th class="th-left">Learner Name</th>
          <th style="width:38px">Gen</th>
          <th>Mark (${data.maxMark})</th>
          <th>%</th>
          <th>Grade</th>
          <th>Result</th>
          <th class="th-left">Remark</th>
          <th>Rank</th>
        </tr>`;
      body = data.rows.map((d, i) => `
        <tr>
          <td class="text-center text-muted">${i + 1}</td>
          <td class="col-code">${Utils.escapeHtml(d.learnerCode)}</td>
          <td class="col-learner-name">${Utils.escapeHtml(d.name)}</td>
          <td class="text-center">${Utils.escapeHtml(d.gender)}</td>
          <td class="text-center ${d.hasMark ? 'font-semibold' : 'text-nr'}">${d.hasMark ? d.mark + '/' + data.maxMark : 'N/R'}</td>
          <td class="text-center font-semibold">${d.hasMark ? this.pct(d.pct) + '%' : nr}</td>
          <td class="text-center">${d.hasMark ? '<span class="badge badge-info">' + d.grade + '</span>' : nr}</td>
          <td class="text-center">${d.hasMark ? this.resultBadge(d.pf) : nr}</td>
          <td class="text-sm">${Utils.escapeHtml(d.remark)}</td>
          <td class="text-center font-bold">${d.position}</td>
        </tr>`).join('');
    } else {
      head = `
        <tr>
          <th style="width:32px">No.</th>
          <th>Student Number</th>
          <th class="th-left">Learner Name</th>
          <th style="width:38px">Gen</th>
          ${data.assessments.map((a, i) => `
            <th class="th-unit">
              <div class="unit-th-name">${Utils.escapeHtml(String(a.unit || a.name).replace(/^Unit\s*/i, 'Unit '))}</div>
              <div class="unit-th-max">(${Number(a.maximum_mark) || 0})</div>
            </th>`).join('')}
          <th>Total</th>
          <th>Max</th>
          <th>${data.weighted ? 'Weighted %' : 'Avg %'}</th>
          <th>Grade</th>
          <th>Result</th>
          <th>Rank</th>
        </tr>`;
      body = data.rows.map((d, i) => `
        <tr>
          <td class="text-center text-muted">${i + 1}</td>
          <td class="col-code">${Utils.escapeHtml(d.learnerCode)}</td>
          <td class="col-learner-name">${Utils.escapeHtml(d.name)}</td>
          <td class="text-center">${Utils.escapeHtml(d.gender)}</td>
          ${d.units.map(u => `
            <td class="text-center ${u.hasMark ? '' : 'text-nr'}">${u.hasMark ? u.mark : 'N/R'}</td>`).join('')}
          <td class="text-center font-bold">${d.pct == null ? '—' : d.obtained}</td>
          <td class="text-center text-muted">${d.pct == null ? '—' : d.denominator}</td>
          <td class="text-center font-semibold">${d.pct == null ? nr : this.pct(d.pct) + '%'}</td>
          <td class="text-center">${d.pct == null ? nr : '<span class="badge badge-info">' + d.grade + '</span>'}</td>
          <td class="text-center">${d.pct == null ? nr : this.resultBadge(d.pf)}</td>
          <td class="text-center font-bold">${d.position}</td>
        </tr>`).join('');
    }

    return `
      <div class="report-table-scroll">
        <table class="report-marks-table ${compact ? 'compact' : ''}">
          <thead>${head}</thead>
          <tbody>${body || '<tr><td class="text-center text-muted" style="padding:24px">No learner marks found</td></tr>'}</tbody>
        </table>
      </div>`;
  },

  resultBadge(pf) {
    return pf === 'PASS'
      ? '<span class="badge-result-pass">PASS</span>'
      : pf === 'FAIL'
        ? '<span class="badge-result-fail">FAIL</span>'
        : '<span>N/R</span>';
  },

  summaryHtml(data) {
    const s = data.stats;
    return `
      <div class="report-summary-section">
        <h4 class="report-section-title">CLASS PERFORMANCE SUMMARY</h4>
        <div class="report-summary-grid report-summary-grid-4">
          ${this.statCard(s.total, 'Total Learners', 'var(--gray-900)')}
          ${this.statCard(s.assessed, 'Learners Assessed', 'var(--blue-600)')}
          ${this.statCard(s.passed, 'Passed', 'var(--green-600)')}
          ${this.statCard(s.failed, 'Failed', 'var(--red-600)')}
          ${this.statCard(this.pct(s.passRate) + '%', 'Pass Rate', 'var(--green-600)')}
          ${this.statCard(this.pct(s.avg) + '%', 'Class Average', 'var(--blue-600)')}
          ${this.statCard(this.pct(s.high) + '%', 'Highest Score', 'var(--green-600)')}
          ${this.statCard(this.pct(s.low) + '%', 'Lowest Score', 'var(--amber-600)')}
        </div>
      </div>`;
  },

  statCard(val, label, color) {
    return `<div class="report-stat-card"><div class="val" style="color:${color}">${val}</div><div class="lbl">${label}</div></div>`;
  },

  unitPerfHtml(data) {
    const entries = data.unitAverages.map((u, i) => {
      const pct = u.count ? this.pct(u.avg) : 0;
      const barClass = u.avg >= 70 ? 'green' : u.avg >= 50 ? 'amber' : 'red';
      return `
        <div class="unit-perf-row">
          <div class="unit-perf-name">${Utils.escapeHtml(u.typeName || '')} - ${Utils.escapeHtml(u.unit)} <span class="text-muted">(${u.max} marks${u.weight != null ? ', weight ' + u.weight : ''})</span></div>
          <div class="unit-perf-track"><div class="unit-perf-fill ${barClass}" style="width:${Math.max(2, Math.min(100, pct))}%"></div></div>
          <div class="unit-perf-val">${u.count ? pct + '%' : 'N/R'}</div>
        </div>`;
    }).join('');
    return `
      <div class="report-unit-section">
        <h4 class="report-section-title">ASSESSMENT PERFORMANCE</h4>
        <p class="text-sm text-muted mb-3">Average percentage per assessment across learners with recorded marks.</p>
        ${entries}
      </div>`;
  },

  gradeDistRowsHtml(data) {
    const dist = data?.gradeDist || this.current?.gradeDist;
    if (!dist || !Object.keys(dist).length) return '';
    const entries = Object.entries(dist).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    const max = Math.max(1, ...entries.map(e => e[1]));
    return `
      <div class="report-grade-section">
        <h4 class="report-section-title">GRADE DISTRIBUTION</h4>
        <div class="grade-chart">
          ${entries.map(([g, c]) => `
            <div class="grade-bar-row">
              <div class="grade-bar-label">Grade ${Utils.escapeHtml(g)}</div>
              <div class="grade-bar-track"><div class="grade-bar-fill" style="width:${(c / max) * 100}%"></div></div>
              <div class="grade-bar-count">${c} learner${c !== 1 ? 's' : ''}</div>
            </div>`).join('')}
        </div>
      </div>`;
  },

  /* ---------- School settings / grading ---------- */

  async settings() {
    return typeof getSchoolSettings === 'function' ? getSchoolSettings() : { pass_mark: 50, ranking_enabled: true, decimal_marks_enabled: false };
  },
  async grading() {
    return typeof getGrading === 'function' ? getGrading() : [];
  },

  /* ============================================================
     CROSS-TEACHER DOS REPORT BUILDERS
     ============================================================ */

  async _fetchApprovedMarks(filters) {
    const where = { status: filters.status || 'approved' };
    if (filters.class_id) where.class_id = filters.class_id;
    if (filters.subject_id) where.subject_id = filters.subject_id;
    if (filters.academic_year_id) where.academic_year_id = filters.academic_year_id;
    if (filters.term_id) where.term_id = filters.term_id;
    if (filters.assessment_type_id) where.assessment_type_id = filters.assessment_type_id;

    const assessments = await DB.query('assessments', '*', where);
    if (!assessments.length) return { assessments: [], marks: [], learners: [] };

    const learnerFilters = { class_id: filters.class_id, status: 'active' };
    const learners = await DB.query('learners', '*', learnerFilters, { column: 'full_name', asc: true });

    const assessmentIds = assessments.map(a => a.id);
    const marks = [];
    for (let i = 0; i < assessmentIds.length; i += 50) {
      const chunk = assessmentIds.slice(i, i + 50);
      const { data } = await sbClient.from('marks').select('*').in('assessment_id', chunk);
      if (data) marks.push(...data);
    }

    return { assessments, marks, learners };
  },

  async _fetchLocked() {
    return this._fetchApprovedMarks({ status: 'locked' });
  },

  _mergeApproved(lockedData, approvedData) {
    const merged = {
      assessments: [...(lockedData.assessments || []), ...(approvedData.assessments || [])],
      marks: [...(lockedData.marks || []), ...(approvedData.marks || [])],
      learners: (approvedData.learners && approvedData.learners.length ? approvedData.learners : (lockedData.learners || []))
    };
    return merged;
  },

  _subjectGrade(pct, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.calculateGradeSync(pct, scale);
    }
    for (const s of scale) { if (pct >= s.minimum_percentage && pct <= s.maximum_percentage) return { grade: s.grade, remark: s.remark }; }
    return { grade: 'F', remark: 'Needs Improvement' };
  },

  _pf(pct, passMark, scale) { 
    if (typeof GradingEngine !== 'undefined' && scale) {
      const info = GradingEngine.calculateGradeSync(pct, scale);
      return info.isPass ? 'PASS' : 'FAIL';
    }
    return pct >= passMark ? 'PASS' : 'FAIL'; 
  },

  /* --- A. Complete Learner Report (all subjects) --- */
  async buildLearnerReport(learnerId, classId, yearId, termId) {
    const [learner, cls, year, term, settings, scale, subjects] = await Promise.all([
      DB.get('learners', { id: learnerId }).then(r => r[0]),
      DB.get('classes', { id: classId }).then(r => r[0]),
      yearId ? DB.getRelated('academic_years', '*', { id: yearId }).then(r => r[0]) : null,
      termId ? DB.getRelated('terms', '*', { id: termId }).then(r => r[0]) : null,
      this.settings(),
      this.grading(),
      DB.get('subjects')
    ]);
    if (!learner) throw new Error('Learner not found');

    const approved = await this._fetchApprovedMarks({ class_id: classId, academic_year_id: yearId, term_id: termId, status: 'approved' });
    const locked = await this._fetchApprovedMarks({ class_id: classId, academic_year_id: yearId, term_id: termId, status: 'locked' });
    const allMarks = this._mergeApproved(locked, approved);
    const passMark = settings.pass_mark || 50;

    const subjectResults = subjects.map(sub => {
      const subAssessments = allMarks.assessments.filter(a => a.subject_id === sub.id);
      const subMarks = allMarks.marks.filter(m => subAssessments.some(a => a.id === m.assessment_id) && m.learner_id === learnerId && m.mark != null);
      const totalObtained = subMarks.reduce((s, m) => s + Number(m.mark), 0);
      const totalMax = subAssessments.reduce((s, a) => s + (Number(a.maximum_mark) || 0), 0);
      const hasData = subMarks.length > 0;
      const pct = hasData && totalMax > 0 ? (totalObtained / totalMax) * 100 : null;
      const gradeInfo = pct != null ? this._subjectGrade(pct, scale) : { grade: 'N/R', remark: 'N/R' };

      return {
        subjectId: sub.id,
        subjectName: sub.name,
        subjectCode: sub.code,
        assessmentCount: subMarks.length,
        totalObtained,
        totalMax,
        pct: pct != null ? Math.round(pct * 100) / 100 : null,
        grade: gradeInfo.grade,
        remark: gradeInfo.remark,
        pf: pct != null ? this._pf(pct, passMark, scale) : 'N/R',
        assessments: subAssessments.map(a => {
          const mark = allMarks.marks.find(m => m.assessment_id === a.id && m.learner_id === learnerId);
          const mk = mark && mark.mark != null ? Number(mark.mark) : null;
          const p = mk != null ? Utils.pct(mk, Number(a.maximum_mark) || 0) : null;
          const gi = p != null ? this._subjectGrade(p, scale) : { grade: 'N/R', remark: 'N/R' };
          return {
            name: a.name,
            type: a.unit || a.name,
            assessmentTypeId: a.assessment_type_id,
            maximum_mark: Number(a.maximum_mark) || 0,
            obtained: mk,
            pct: p != null ? Math.round(p * 10) / 10 : null,
            grade: gi.grade,
            remark: gi.remark
          };
        })
      };
    }).filter(s => s.totalMax > 0 || s.assessmentCount > 0);

    const subjectsWithData = subjectResults.filter(s => s.pct != null);
    const overallObtained = subjectsWithData.reduce((s, r) => s + r.totalObtained, 0);
    const overallMax = subjectsWithData.reduce((s, r) => s + r.totalMax, 0);
    const overallPct = overallMax > 0 ? (overallObtained / overallMax) * 100 : null;
    const overallGrade = overallPct != null ? this._subjectGrade(overallPct, scale) : { grade: 'N/R', remark: 'N/R' };

    const posList = Utils.positions(subjectsWithData.map((s, i) => ({ id: i, pct: s.pct })));
    subjectsWithData.forEach((s, i) => { const p = posList.find(x => x.id === i); if (p) s.position = p.position; });

    return {
      type: 'learner-report',
      settings,
      learner,
      cls,
      year,
      term,
      subjects: subjectResults,
      subjectsWithData,
      overallObtained,
      overallMax,
      overallPct: overallPct != null ? Math.round(overallPct * 100) / 100 : null,
      overallGrade: overallGrade.grade,
      overallRemark: overallGrade.remark,
      subjectsPassed: subjectsWithData.filter(s => s.pf === 'PASS').length,
      subjectsFailed: subjectsWithData.filter(s => s.pf === 'FAIL').length,
      totalSubjects: subjectResults.length,
      title: 'STUDENT ACADEMIC PERFORMANCE REPORT',
      orientation: 'portrait',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  /* --- B. Class Subject Report (all learners for one subject) --- */
  async buildClassSubjectReport(classId, subjectId, yearId, termId) {
    const [cls, sub, year, term, settings, scale] = await Promise.all([
      DB.getRelated('classes', '*', { id: classId }).then(r => r[0]),
      DB.getRelated('subjects', '*', { id: subjectId }).then(r => r[0]),
      yearId ? DB.getRelated('academic_years', '*', { id: yearId }).then(r => r[0]) : null,
      termId ? DB.getRelated('terms', '*', { id: termId }).then(r => r[0]) : null,
      this.settings(),
      this.grading()
    ]);

    const approved = await this._fetchApprovedMarks({ class_id: classId, subject_id: subjectId, academic_year_id: yearId, term_id: termId, status: 'approved' });
    const locked = await this._fetchApprovedMarks({ class_id: classId, subject_id: subjectId, academic_year_id: yearId, term_id: termId, status: 'locked' });
    const allMarks = this._mergeApproved(locked, approved);
    const passMark = settings.pass_mark || 50;
    const maxMark = allMarks.assessments.reduce((s, a) => s + (Number(a.maximum_mark) || 0), 0);

    const rows = allMarks.learners.map(l => {
      const lMarks = allMarks.marks.filter(m => m.learner_id === l.id && m.mark != null);
      const obtained = lMarks.reduce((s, m) => s + Number(m.mark), 0);
      const hasMark = lMarks.length > 0;
      const pct = hasMark && maxMark > 0 ? (obtained / maxMark) * 100 : null;
      const gradeInfo = pct != null ? this._subjectGrade(pct, scale) : { grade: 'N/R', remark: 'N/R' };
      return {
        learnerId: l.id,
        learnerCode: l.learner_code || '-',
        name: l.full_name,
        gender: l.gender || '-',
        mark: obtained,
        maxMark,
        pct,
        grade: gradeInfo.grade,
        remark: gradeInfo.remark,
        pf: pct != null ? this._pf(pct, passMark, scale) : 'N/R',
        position: '-',
        hasMark
      };
    });

    this.applyRanking(rows, settings);
    const assessed = rows.filter(r => r.hasMark);
    const stats = this.computeStats(rows.length, assessed.map(r => r.pct), passMark);
    const gradeDist = Utils.gradeDist(assessed.map(r => r.grade));

    return {
      type: 'class-subject',
      settings,
      scale,
      cls,
      sub,
      year,
      term,
      maxMark,
      assessments: allMarks.assessments,
      rows,
      stats,
      gradeDist,
      title: `${cls?.name || ''} ${sub?.name || ''} PERFORMANCE REPORT`,
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  /* --- C. Complete Class Report (all learners, all subjects) --- */
  async buildCompleteClassReport(classId, yearId, termId) {
    const [cls, year, term, settings, scale, subjects] = await Promise.all([
      DB.getRelated('classes', '*', { id: classId }).then(r => r[0]),
      yearId ? DB.getRelated('academic_years', '*', { id: yearId }).then(r => r[0]) : null,
      termId ? DB.getRelated('terms', '*', { id: termId }).then(r => r[0]) : null,
      this.settings(),
      this.grading(),
      DB.get('subjects')
    ]);

    const approved = await this._fetchApprovedMarks({ class_id: classId, academic_year_id: yearId, term_id: termId, status: 'approved' });
    const locked = await this._fetchApprovedMarks({ class_id: classId, academic_year_id: yearId, term_id: termId, status: 'locked' });
    const allMarks = this._mergeApproved(locked, approved);
    const passMark = settings.pass_mark || 50;

    const rows = allMarks.learners.map(l => {
      const subjectSummary = subjects.map(sub => {
        const subAssessments = allMarks.assessments.filter(a => a.subject_id === sub.id);
        const subMarks = allMarks.marks.filter(m => subAssessments.some(a => a.id === m.assessment_id) && m.learner_id === l.id && m.mark != null);
        const obtained = subMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = subAssessments.reduce((s, a) => s + (Number(a.maximum_mark) || 0), 0);
        const hasMark = subMarks.length > 0;
        const pct = hasMark && totalMax > 0 ? (obtained / totalMax) * 100 : null;
        return { subjectId: sub.id, subjectName: sub.name, obtained, max: totalMax, pct, hasMark };
      });

      const subsWithData = subjectSummary.filter(s => s.hasMark && s.pct != null);
      const overallObtained = subsWithData.reduce((s, r) => s + r.obtained, 0);
      const overallMax = subsWithData.reduce((s, r) => s + r.max, 0);
      const overallPct = overallMax > 0 ? (overallObtained / overallMax) * 100 : null;
      const gradeInfo = overallPct != null ? this._subjectGrade(overallPct, scale) : { grade: 'N/R', remark: 'N/R' };

      return {
        learnerId: l.id,
        learnerCode: l.learner_code || '-',
        name: l.full_name,
        gender: l.gender || '-',
        subjectSummary,
        overallObtained,
        overallMax,
        pct: overallPct != null ? Math.round(overallPct * 100) / 100 : null,
        grade: gradeInfo.grade,
        remark: gradeInfo.remark,
        pf: overallPct != null ? this._pf(overallPct, passMark) : 'N/R',
        position: '-'
      };
    });

    this.applyRanking(rows, settings);
    const assessed = rows.filter(r => r.pct != null);
    const stats = this.computeStats(rows.length, assessed.map(r => r.pct), passMark);
    const gradeDist = Utils.gradeDist(assessed.map(r => r.grade));

    return {
      type: 'complete-class',
      settings,
      scale,
      cls,
      year,
      term,
      subjects: subjects.filter(sub => allMarks.assessments.some(a => a.subject_id === sub.id)),
      rows,
      stats,
      gradeDist,
      title: `${cls?.name || ''} COMPLETE CLASS REPORT`,
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  /* --- D. School Performance Report --- */
  async buildSchoolPerformance(yearId, termId) {
    const [allClasses, subjects, settings, scale, year, term] = await Promise.all([
      DB.get('classes'),
      DB.get('subjects'),
      this.settings(),
      this.grading(),
      yearId ? DB.getRelated('academic_years', '*', { id: yearId }).then(r => r[0]) : null,
      termId ? DB.getRelated('terms', '*', { id: termId }).then(r => r[0]) : null
    ]);

    const subjectPerf = [];
    const classPerf = [];

    for (const sub of subjects) {
      let totalPct = 0, count = 0, passCount = 0;
      for (const cls of allClasses) {
        const approved = await this._fetchApprovedMarks({ class_id: cls.id, subject_id: sub.id, academic_year_id: yearId, term_id: termId, status: 'approved' });
        const locked = await this._fetchApprovedMarks({ class_id: cls.id, subject_id: sub.id, academic_year_id: yearId, term_id: termId, status: 'locked' });
        const allM = [...approved.marks, ...locked.marks].filter(m => m.mark != null);
        for (const m of allM) {
          const a = [...approved.assessments, ...locked.assessments].find(x => x.id === m.assessment_id);
          if (a) {
            const p = Utils.pct(Number(m.mark), Number(a.maximum_mark) || 0);
            totalPct += p;
            count++;
            if (p >= (settings.pass_mark || 50)) passCount++;
          }
        }
      }
      subjectPerf.push({
        subjectId: sub.id,
        subjectName: sub.name,
        avg: count ? Math.round(totalPct / count * 100) / 100 : 0,
        passRate: count ? Math.round(passCount / count * 10000) / 100 : 0,
        marksCount: count
      });
    }

    for (const cls of allClasses) {
      let totalPct = 0, count = 0, passCount = 0;
      const approved = await this._fetchApprovedMarks({ class_id: cls.id, academic_year_id: yearId, term_id: termId, status: 'approved' });
      const locked = await this._fetchApprovedMarks({ class_id: cls.id, academic_year_id: yearId, term_id: termId, status: 'locked' });
      const allM = [...approved.marks, ...locked.marks].filter(m => m.mark != null);
      for (const m of allM) {
        const a = [...approved.assessments, ...locked.assessments].find(x => x.id === m.assessment_id);
        if (a) {
          const p = Utils.pct(Number(m.mark), Number(a.maximum_mark) || 0);
          totalPct += p;
          count++;
          if (p >= (settings.pass_mark || 50)) passCount++;
        }
      }
      classPerf.push({
        classId: cls.id,
        className: cls.name,
        avg: count ? Math.round(totalPct / count * 100) / 100 : 0,
        passRate: count ? Math.round(passCount / count * 10000) / 100 : 0,
        marksCount: count
      });
    }

    const schoolAvg = subjectPerf.filter(s => s.marksCount > 0).length
      ? subjectPerf.filter(s => s.marksCount > 0).reduce((s, x) => s + x.avg, 0) / subjectPerf.filter(s => s.marksCount > 0).length
      : 0;

    return {
      type: 'school-performance',
      settings,
      year,
      term,
      subjects: subjectPerf.sort((a, b) => b.avg - a.avg),
      classes: classPerf.sort((a, b) => b.avg - a.avg),
      schoolAvg: Math.round(schoolAvg * 100) / 100,
      title: 'SCHOOL PERFORMANCE REPORT',
      orientation: 'landscape',
      generatedBy: (typeof Auth !== 'undefined' && Auth.currentUser?.full_name) || ''
    };
  },

  /* ---------- Exports ---------- */

  exportName(data, ext) {
    const y = data.year?.name;
    const t = data.term?.name;
    const c = data.cls?.name;
    if (data.type === 'learner-report') {
      const lName = (data.learner?.full_name || 'Learner').replace(/[^A-Za-z0-9]/g, '_');
      return this.fileName({ cls: c, sub: lName, type: 'Student_Report', term: t, year: y, ext });
    }
    if (data.type === 'class-subject') {
      return this.fileName({ cls: c, sub: data.sub?.name, type: 'Subject_Report', term: t, year: y, ext });
    }
    if (data.type === 'complete-class') {
      return this.fileName({ cls: c, type: 'Complete_Class', term: t, year: y, ext });
    }
    if (data.type === 'class-list') {
      return this.fileName({ cls: c, type: 'Class_List', term: t, year: y, ext });
    }
    if (data.type === 'school-performance') {
      return this.fileName({ type: 'School_Performance', term: t, year: y, ext });
    }
    if (data.type === 'combined') {
      return this.fileName({ cls: c, sub: data.sub?.name, type: 'Combined_Assessments', term: t, year: y, ext });
    }
    if (data.type === 'missing-marks') {
      return this.fileName({ cls: c, sub: data.sub?.name, type: 'Missing_Marks', term: t, year: y, ext });
    }
    const a = data.assessments[0];
    return this.fileName({ cls: c, sub: data.sub?.name, type: this.slug(data.assessmentType || 'End-of-Unit Assessment'), unit: a.unit || a.name, term: t, year: y, ext });
  },

  buildExportTable(data) {
    if (data.type === 'learner-report') {
      const cols = ['No.', 'Subject', 'Assessments', 'Total Obtained', 'Total Maximum', 'Average %', 'Grade', 'Result', 'Remark'];
      const body = data.subjects.map((s, i) => [i + 1, s.subjectName, s.assessmentCount, s.totalObtained, s.totalMax, s.pct != null ? s.pct + '%' : 'N/R', s.grade, s.pf, s.remark]);
      body.push([]);
      body.push(['', 'OVERALL', '', data.overallObtained, data.overallMax, data.overallPct != null ? data.overallPct + '%' : 'N/R', data.overallGrade, data.subjectsPassed + '/' + data.totalSubjects + ' Passed', data.overallRemark]);
      return { cols, body };
    }
    if (data.type === 'class-subject') {
      const cols = ['No.', 'Student Number', 'Learner Name', 'Gender', 'Mark', 'Max', 'Average %', 'Grade', 'Result', 'Remark'];
      if (data.rows.some(r => r.position !== '-')) cols.push('Rank');
      const body = data.rows.map((r, i) => {
        const row = [i + 1, r.learnerCode, r.name, r.gender, r.hasMark ? r.mark : 'N/R', r.maxMark, r.hasMark ? this.pct(r.pct) + '%' : 'N/R', r.hasMark ? r.grade : 'N/R', r.pf, r.hasMark ? r.remark : 'N/R'];
        if (data.rows.some(x => x.position !== '-')) row.push(r.position);
        return row;
      });
      return { cols, body };
    }
    if (data.type === 'complete-class') {
      const cols = ['No.', 'Student Number', 'Learner Name', 'Gender'];
      data.subjects.forEach(s => cols.push(s.name));
      cols.push('Overall %', 'Grade', 'Result', 'Rank');
      const body = data.rows.map((r, i) => {
        const row = [i + 1, r.learnerCode, r.name, r.gender];
        data.subjects.forEach(s => {
          const sub = r.subjectSummary.find(x => x.subjectId === s.id);
          row.push(sub && sub.hasMark ? sub.pct + '%' : 'N/R');
        });
        row.push(r.pct != null ? r.pct + '%' : 'N/R', r.grade, r.pf, r.position);
        return row;
      });
      return { cols, body };
    }
    if (data.type === 'class-list') {
      const cols = ['No.', 'Student Number', 'Student Name', 'Gender', 'Status'];
      const body = data.rows.map((r, i) => [i + 1, r.learnerCode, r.name, r.gender, r.status]);
      return { cols, body };
    }
    if (data.type === 'school-performance') {
      const cols = ['No.', 'Subject', 'Marks Count', 'Average %', 'Pass Rate'];
      const body = data.subjects.map((s, i) => [i + 1, s.subjectName, s.marksCount, s.avg + '%', s.passRate + '%']);
      return { cols, body };
    }
    if (data.type === 'missing-marks') {
      const cols = ['No.', 'Student Number', 'Learner Name', 'Gender'];
      data.assessments.forEach(a => cols.push((a.unit || a.name) + ' (' + (a._typeName || '') + ')'));
      cols.push('Marks', 'Status');
      const body = (data.missing && data.missing.length ? data.missing : data.rows).map((d, i) => {
        const row = [i + 1, d.learnerCode, d.name, d.gender];
        data.assessments.forEach((a, j) => row.push(d.units[j] && d.units[j].hasMark ? 'Y' : 'MISSING'));
        row.push(d.marksCount + '/' + data.assessments.length, d.hasAll ? 'Complete' : 'Incomplete');
        return row;
      });
      return { cols, body };
    }
    const cols = ['No.', 'Student Number', 'Learner Name', 'Gender'];
    if (data.type === 'single') {
      cols.push('Mark (' + data.maxMark + ')', 'Percentage %', 'Grade', 'Result', 'Remark');
      if (data.rows.some(r => r.position !== '-')) cols.push('Rank');
    } else {
      data.assessments.forEach(a => cols.push((a.unit || a.name).replace(/^Unit\s*/i, 'Unit ') + ' (' + (Number(a.maximum_mark) || 0) + ')'));
      cols.push('Total', 'Maximum', data.weighted ? 'Weighted %' : 'Average %', 'Grade', 'Result');
      if (data.rows.some(r => r.position !== '-')) cols.push('Rank');
    }
    const body = data.rows.map((r, i) => {
      const row = [i + 1, r.learnerCode, r.name, r.gender];
      if (data.type === 'single') {
        row.push(r.hasMark ? r.mark : 'N/R', r.hasMark ? this.pct(r.pct) : 'N/R', r.hasMark ? r.grade : 'N/R', r.hasMark ? r.pf : 'N/R', r.remark);
      } else {
        r.units.forEach(u => row.push(u.hasMark ? u.mark : 'N/R'));
        row.push(r.pct == null ? 'N/R' : r.obtained, r.pct == null ? 'N/R' : r.denominator, r.pct == null ? 'N/R' : this.pct(r.pct), r.pct == null ? 'N/R' : r.grade, r.pct == null ? 'N/R' : r.pf);
      }
      if (data.rows.some(x => x.position !== '-')) row.push(r.position);
      return row;
    });
    return { cols, body };
  },

  colLetter(n) {
    let s = '';
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  },

  async exportExcel() {
    const data = this.current;
    if (!data) return Utils.toast('No report to export', 'error');
    if (typeof XLSX === 'undefined') return Utils.toast('Excel export library not loaded', 'error');

    const { cols, body } = this.buildExportTable(data);
    const s = data.settings;
    const wb = XLSX.utils.book_new();
    const rows = [];

    const infoLine = [
      data.cls?.name || '', data.sub?.name || '',
      data.type === 'single' ? (data.assessmentType || '') + ' - ' + ((data.assessments[0]?.unit) || data.assessments[0]?.name)
        : data.type === 'combined' ? 'Combined Assessment' : data.type === 'missing-marks' ? 'Missing Marks'
        : data.type === 'class-list' ? 'Class List' : (data.year?.name || '') && data.term?.name ? 'Term Report' : 'Performance Report',
      data.year?.name || '', data.term?.name || ''
    ].filter(Boolean).join(' | ');

    rows.push([s.school_name || 'Rukara Model School']);
    rows.push([data.title]);
    rows.push([infoLine]);
    rows.push([`Generated on: ${new Date().toLocaleString()}`]);
    rows.push([]);
    rows.push(cols);
    body.forEach(r => rows.push(r));

    rows.push([]);
    if (data.stats && data.type !== 'class-list') {
      rows.push(['CLASS PERFORMANCE SUMMARY']);
      rows.push(['Total Learners', data.stats.total]);
      rows.push(['Learners Assessed', data.stats.assessed]);
      rows.push(['Passed', data.stats.passed]);
      rows.push(['Failed', data.stats.failed]);
      rows.push(['Pass Rate (%)', this.pct(data.stats.passRate)]);
      rows.push(['Class Average (%)', this.pct(data.stats.avg)]);
      rows.push(['Highest Score (%)', this.pct(data.stats.high)]);
      rows.push(['Lowest Score (%)', this.pct(data.stats.low)]);
    } else if (data.type === 'class-list') {
      rows.push(['CLASS LIST SUMMARY']);
      rows.push(['Total Learners', data.stats?.total || 0]);
      rows.push(['Boys (M)', data.stats?.boys || 0]);
      rows.push(['Girls (F)', data.stats?.girls || 0]);
    } else if (data.type === 'school-performance') {
      rows.push(['SCHOOL PERFORMANCE SUMMARY']);
      rows.push(['School Average (%)', this.pct(data.schoolAvg)]);
      rows.push(['Subjects Tracked', data.subjects.length]);
      rows.push(['Classes Tracked', data.classes.length]);
    } else if (data.type === 'learner-report') {
      rows.push(['STUDENT SUMMARY']);
      rows.push(['Overall Average (%)', data.overallPct != null ? data.overallPct : 'N/R']);
      rows.push(['Overall Grade', data.overallGrade]);
      rows.push(['Overall Remark', data.overallRemark]);
      rows.push(['Subjects Passed', data.subjectsPassed]);
      rows.push(['Subjects Failed', data.subjectsFailed]);
      rows.push(['Total Subjects', data.totalSubjects]);
    }

    if (data.type === 'combined') {
      rows.push([]);
      rows.push(['ASSESSMENT PERFORMANCE']);
      data.unitAverages.forEach(u => rows.push([u.typeName + ' - ' + u.unit, u.max + ' marks', u.weight != null ? 'weight ' + u.weight : '', u.count ? this.pct(u.avg) + ' (%)' : 'N/R', u.count + ' learners']));
      if (data.weighted) rows.push(['', '', '', 'Method: weighted average (all assessments have weights)']);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const headerRow = 6; // 1-indexed row of column headers
    const lastDataRow = headerRow + body.length;
    const lastCol = this.colLetter(cols.length - 1);

    // Header style (bold white on dark fill)
    for (let c = 0; c < cols.length; c++) {
      const ref = this.colLetter(c) + headerRow;
      ws[ref] = { t: 's', v: cols[c], s: {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '1F2937' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { bottom: { style: 'thin', color: { rgb: 'D1D5DB' } } }
      } };
    }

    // Column widths
    const widths = [5, 16, 30, 8];
    if (data.type === 'single') widths.push(8, 9, 8, 9, 26);
    else if (data.type === 'combined') { data.assessments.forEach(() => widths.push(7)); widths.push(8, 8, 8, 8, 9); }
    else while (widths.length < cols.length) widths.push(10);
    if (data.rows && data.rows.some(r => r.position !== '-')) widths.push(6);
    ws['!cols'] = widths.map(w => ({ wch: w }));

    // Freeze header + filters on the data range
    if (lastCol && cols.length) {
      ws['!autofilter'] = { ref: `A${headerRow}:${lastCol}${lastDataRow}` };
    }
    if (ws['!freeze'] === undefined) {
      // SheetJS community: freeze panes unsupported; set a view hint where supported
      try { ws['!views'] = [{ state: 'frozen', ySplit: headerRow, xSplit: 0 }]; } catch (e) {}
    }

    const sheetName = data.type === 'combined' ? 'Combined Marks' : data.type === 'missing-marks' ? 'Missing Marks' : data.type === 'class-list' ? 'Class List' : 'Marks Report';
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    // Title row styling
    ['A1', 'A2', 'A3'].forEach((ref, i) => {
      if (ws[ref]) ws[ref].s = { font: { bold: true } };
    });

    XLSX.writeFile(wb, this.exportName(data, 'xlsx'));
    Utils.toast('Excel report downloaded', 'success');
  },

  async exportCsv() {
    const data = this.current;
    if (!data) return Utils.toast('No report to export', 'error');
    const { cols, body } = this.buildExportTable(data);
    const esc = v => {
      const str = String(v == null ? '' : v);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const lines = [];
    lines.push(cols.map(esc).join(','));
    body.forEach(r => lines.push(r.map(esc).join(',')));
    lines.push('');
    if (data.type === 'class-list') {
      lines.push('CLASS LIST SUMMARY');
      lines.push('Total Learners,' + (data.stats?.total || 0));
      lines.push('Boys (M),' + (data.stats?.boys || 0));
      lines.push('Girls (F),' + (data.stats?.girls || 0));
    } else if (data.stats) {
      lines.push('CLASS PERFORMANCE SUMMARY');
      lines.push('Total Learners,' + data.stats.total);
      lines.push('Learners Assessed,' + data.stats.assessed);
      lines.push('Passed,' + data.stats.passed);
      lines.push('Failed,' + data.stats.failed);
      lines.push('Pass Rate (%),' + this.pct(data.stats.passRate));
      lines.push('Class Average (%),' + this.pct(data.stats.avg));
      lines.push('Highest Score (%),' + this.pct(data.stats.high));
      lines.push('Lowest Score (%),' + this.pct(data.stats.low));
    } else if (data.type === 'school-performance') {
      lines.push('SCHOOL PERFORMANCE SUMMARY');
      lines.push('School Average (%),' + this.pct(data.schoolAvg));
    } else if (data.type === 'learner-report') {
      lines.push('STUDENT SUMMARY');
      lines.push('Overall Average (%),' + (data.overallPct != null ? data.overallPct : 'N/R'));
      lines.push('Overall Grade,' + data.overallGrade);
      lines.push('Subjects Passed,' + data.subjectsPassed);
      lines.push('Subjects Failed,' + data.subjectsFailed);
      lines.push('Total Subjects,' + data.totalSubjects);
    }

    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.exportName(data, 'csv');
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('CSV report downloaded', 'success');
  },

  /* ---------- Word (.doc) & PDF exports ---------- */

  async inlineImages(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const imgs = Array.from(tmp.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (!src || /^data:/i.test(src)) continue;
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const imageUrl = await new Promise(resolve => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => resolve(src);
          fr.readAsDataURL(blob);
        });
        img.setAttribute('src', imageUrl);
      } catch (e) { /* keep original src */ }
    }
    return tmp.innerHTML;
  },

  async buildDocumentHtml() {
    const data = this.current;
    if (!data) return '';
    const containerId = 'rms-export-container';
    let holder = document.getElementById('rms-export-holder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'rms-export-holder';
      holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:1100px;';
      document.body.appendChild(holder);
    }
    if (!holder.querySelector('#' + containerId)) {
      const c = document.createElement('div');
      c.id = containerId;
      holder.appendChild(c);
    }
    this.renderDOS(data, containerId);
    const paper = holder.querySelector('#' + containerId + ' .report-paper-container');
    if (!paper) return '';
    let html = await this.inlineImages(paper.outerHTML);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('[data-lucide]').forEach(el => el.remove());
    return tmp.innerHTML;
  },

  async exportWord() {
    const data = this.current;
    if (!data) return Utils.toast('No report to export', 'error');
    const body = await this.buildDocumentHtml();
    if (!body) return Utils.toast('Could not build the report', 'error');
    const css = `
      body { font-family: 'Times New Roman', serif; color: #1a1a1a; font-size: 11pt; margin: 16px; }
      h2, h3, p { margin: 4px 0; }
      img.school-logo-img { height: 70px; }
      table { border-collapse: collapse; width: 100%; margin: 10px 0; }
      th, td { border: 1px solid #444; padding: 3px 6px; font-size: 9.5pt; text-align: left; vertical-align: top; }
      th { background: #eeeeee; }
      .school-report-header { text-align: center; margin-bottom: 12px; }
      .contact-line, .motto { margin: 2px 0; font-size: 10pt; }
      .report-title-section { text-align: center; margin: 8px 0; }
      .report-main-title { font-weight: bold; font-size: 13pt; }
      .report-status-pill { border: 1px solid #444; padding: 1px 6px; font-size: 8.5pt; }
      .report-info-panel { margin: 8px 0; }
      .report-info-item { margin: 2px 0; }
      .label { font-weight: bold; }
      .report-table-scroll { overflow: visible; }
      .report-signatures { margin-top: 26px; }
      .sig-box { display: inline-block; width: 33%; vertical-align: top; padding-top: 8px; }
      .sig-title { font-weight: bold; }
      .sig-line { margin-top: 18px; }
      .report-summary-section, .report-assess-included, .report-grade-dist, .report-unit-perf { margin-top: 12px; }
      .text-center { text-align: center !important; }
      .col-learner-name, .col-code, .font-semibold { font-weight: bold; }
      .text-nr { color: #999; font-style: italic; }
      .text-xs { font-size: 8pt; }
      .text-sm { font-size: 9pt; }
      .text-muted { color: #555; }
      .badge { border: 1px solid #444; padding: 0 5px; font-size: 8.5pt; }
    `;
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8"><title>${Utils.escapeHtml(data.title || 'Report')}</title>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.exportName(data, 'doc');
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('Word document downloaded', 'success');
  },

  async exportPdf() {
    const data = this.current;
    if (!data) return Utils.toast('No report to export', 'error');
    const body = await this.buildDocumentHtml();
    if (!body) return Utils.toast('Could not build the report', 'error');
    const cssUrl = new URL('css/styles.css', window.location.href).href;
    const orientation = data.orientation || 'landscape';
    const w = window.open('', '_blank');
    if (!w) return Utils.toast('Please allow pop-ups to export PDF', 'error');
    w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"><title>${Utils.escapeHtml(data.title || 'Report')}</title>
<link rel="stylesheet" href="${Utils.escapeHtml(cssUrl)}">
</head>
<body class="report-orientation-${Utils.escapeHtml(orientation)} printable-report">${body}
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.focus(); window.print(); }, 400); });</script>
</body></html>`);
    w.document.close();
    Utils.toast('In the print dialog choose "Save as PDF".', 'info');
  }
};

/* ---------- Global export triggers (used by inline onclick) ---------- */

function rmsPrintReport() {
  if (typeof ReportEngine.current === 'object') {
    document.body.classList.add('printing-report');
  }
  window.print();
}

async function rmsExportPdf() {
  try { await ReportEngine.exportPdf(); }
  catch (e) { Utils.toast('PDF export error: ' + e.message, 'error'); }
}

function rmsExportWord() {
  try { ReportEngine.exportWord(); }
  catch (e) { Utils.toast('Word export error: ' + e.message, 'error'); }
}

async function rmsExportExcel() {
  try { await ReportEngine.exportExcel(); }
  catch (e) { Utils.toast('Excel export error: ' + e.message, 'error'); }
}

function rmsExportCsv() {
  try { ReportEngine.exportCsv(); }
  catch (e) { Utils.toast('CSV export error: ' + e.message, 'error'); }
}