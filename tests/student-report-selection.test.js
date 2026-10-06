const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReportStudent(assessmentRows) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'js', 'reports', 'report-student.js'),
    'utf8'
  );
  const context = {
    DB: {
      async query(table, columns, filter) {
        assert.equal(table, 'assessments');
        return assessmentRows.filter(assessment =>
          (!filter.id || filter.id.some(id => String(id) === String(assessment.id)))
          && (!filter.term_id || filter.term_id.some(id => String(id) === String(assessment.term_id)))
        );
      }
    },
    Utils: {
      isConversionHelper: () => false,
      pct: (obtained, maximum) => maximum > 0 ? obtained / maximum * 100 : null,
      escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]),
      dateStr: () => '2026-10-06'
    },
    ReportUtils: {
      calcGrade: percentage => ({ grade: percentage >= 50 ? 'P' : 'F' }),
      getGradeDistribution: () => []
    },
    ReportHeader: {
      getSchoolContact: () => ({ email: 'school@example.test', phone: '000' })
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.ReportStudent = ReportStudent;`, context);
  context.ReportStudent.gradeBars = () => '';
  context.ReportStudent.passDonut = () => '';
  return context.ReportStudent;
}

test('selected assessment IDs restrict the report card periods and marks', async () => {
  const rows = [
    {
      id: 'selected-eu',
      subject_id: 'math',
      term_id: 'term-1',
      assessment_type_id: 'unit',
      maximum_mark: 10,
      status: 'approved',
      weight: 100
    },
    {
      id: 'unselected-et',
      subject_id: 'math',
      term_id: 'term-2',
      assessment_type_id: 'exam',
      maximum_mark: 50,
      status: 'approved',
      weight: 100
    }
  ];
  const studentReport = loadReportStudent(rows);
  const result = await studentReport.loadAssessments({
    classId: 'class-1',
    yearId: 'year-1',
    termIds: ['term-1', 'term-2'],
    assessmentIds: ['selected-eu']
  });
  const periods = studentReport.buildPeriodReports({
    subjects: [{ id: 'math', name: 'Mathematics' }],
    assessments: result.official,
    marks: [{ assessment_id: 'selected-eu', mark: 8 }],
    types: [{ id: 'unit', name: 'End of Unit', period_hint: 'unit', weight: 100 }],
    terms: [
      { id: 'term-1', name: 'Term 1', term_no: 1 },
      { id: 'term-2', name: 'Term 2', term_no: 2 }
    ],
    scale: []
  });

  assert.deepEqual(Array.from(result.official, assessment => assessment.id), ['selected-eu']);
  assert.deepEqual(Array.from(periods, period => period.id), ['term-1']);
  assert.equal(periods[0].rows[0].obtained, 8);
  assert.equal(periods[0].rows[0].maximum, 10);
});

test('selected assessments that are not reportable fail explicitly', async () => {
  const studentReport = loadReportStudent([{
    id: 'draft-assessment',
    subject_id: 'math',
    term_id: 'term-1',
    status: 'draft'
  }]);

  await assert.rejects(
    studentReport.loadAssessments({
      classId: 'class-1',
      yearId: 'year-1',
      termIds: ['term-1'],
      assessmentIds: ['draft-assessment']
    }),
    /Every selected assessment must be submitted, approved, or locked/
  );
});

test('report table dynamically renders configured type columns by selected term', () => {
  const studentReport = loadReportStudent([]);
  const subjects = [{ id: 'math', name: 'Mathematics' }];
  const types = [
    { id: 'mid', name: 'Mid-Term Test', code: 'MTT', period_hint: 'unit', weight: 30, display_order: 1 },
    { id: 'quiz', name: 'Weekly Quiz', code: 'QZ', period_hint: 'unit', weight: 10, display_order: 2 },
    { id: 'project', name: 'Project', code: 'PRJ', period_hint: 'unit', weight: 60, display_order: 3 }
  ];
  const assessments = [
    { id: 'mid-1', subject_id: 'math', term_id: 'term-1', assessment_type_id: 'mid', maximum_mark: 20, weight: 30 },
    { id: 'quiz-1', subject_id: 'math', term_id: 'term-1', assessment_type_id: 'quiz', maximum_mark: 10, weight: 10 },
    { id: 'project-2', subject_id: 'math', term_id: 'term-2', assessment_type_id: 'project', maximum_mark: 50, weight: 60 }
  ];
  const periods = studentReport.buildPeriodReports({
    subjects,
    assessments,
    marks: [
      { assessment_id: 'mid-1', mark: 15 },
      { assessment_id: 'quiz-1', mark: 8 },
      { assessment_id: 'project-2', mark: 40 }
    ],
    types,
    terms: [
      { id: 'term-1', name: 'Term 1', term_no: 1 },
      { id: 'term-2', name: 'Term 2', term_no: 2 }
    ],
    scale: []
  });
  const html = studentReport.renderCardInner({
    settings: {},
    learner: { full_name: 'A Student', learner_code: 'S001' },
    cls: { name: 'P5A', stream: 'A' },
    year: { name: '2026' },
    term: { name: 'All terms' },
    level: { label: 'PRIMARY LEVEL' },
    subjRows: [{
      subject: subjects[0],
      obtained: 63,
      maxMark: 80,
      pct: 80,
      grade: 'P',
      hasMarks: true
    }],
    periodReports: periods,
    maximumWeights: { mid: 30, quiz: 10, project: 60 },
    totalSubjects: 1,
    passed: 1,
    failed: 0,
    totalObtained: 63,
    totalMax: 80,
    overallPct: 80,
    overallGrade: { grade: 'P' },
    gradeDist: [],
    scale: []
  });

  assert.match(html, /<th title="Mid-Term Test">MTT<\/th>/);
  assert.match(html, /<th title="Weekly Quiz">QZ<\/th>/);
  assert.match(html, /<th title="Project">PRJ<\/th>/);
  assert.match(html, /Term 1 \/ 2026/);
  assert.match(html, /Term 2 \/ 2026/);
  assert.match(html, /<th colspan="5">Term 1 \/ 2026<\/th>/);
  assert.match(html, /<th colspan="4">Term 2 \/ 2026<\/th>/);
  assert.match(html, /30%<\/th><th>10%<\/th>/);
  assert.doesNotMatch(html, /<th>EU<\/th>|<th>ET<\/th>/);
  assert.match(html, /Term\(s\)/);
});
