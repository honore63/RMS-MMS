const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReportStudent(assessmentRows, learners = []) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'js', 'reports', 'report-student.js'),
    'utf8'
  );
  const markQueries = [];
  const context = {
    EducationLevels: {
      getCategory(cls) {
        return String(cls.education_level || cls.level || cls.name || '').toUpperCase().includes('PRIMARY')
          || /^P[1-6]/i.test(String(cls.level || cls.name || ''))
          ? 'Primary'
          : 'Lower Secondary';
      },
      subjectMatchesClass(subject, cls) {
        const category = this.getCategory(cls);
        const subjectLevel = String(subject.level || subject.education_level || 'Both').toLowerCase();
        return subjectLevel === 'both'
          || (category === 'Primary' && subjectLevel === 'primary')
          || (category !== 'Primary' && subjectLevel.includes('secondary'));
      }
    },
    sbClient: {
      from(table) {
        assert.equal(table, 'marks');
        const query = {
          assessmentIds: [],
          learnerIds: null,
          select(columns) {
            assert.equal(columns, 'id,assessment_id,learner_id,mark');
            return this;
          },
          in(column, values) {
            if (column === 'assessment_id') this.assessmentIds = values;
            if (column === 'learner_id') this.learnerIds = values;
            return this;
          },
          then(resolve, reject) {
            markQueries.push({
              assessmentIds: [...this.assessmentIds],
              learnerIds: this.learnerIds && [...this.learnerIds]
            });
            const data = this.assessmentIds.flatMap(assessmentId =>
              (this.learnerIds || learners.map(learner => learner.id))
                .map(learnerId => ({ id: `${assessmentId}-${learnerId}`, assessment_id: assessmentId, learner_id: learnerId, mark: 5 }))
            );
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
        };
        return query;
      }
    },
    DB: {
      async query(table, columns, filter) {
        assert.equal(table, 'assessments');
        return assessmentRows.filter(assessment =>
          (!filter.id || filter.id.some(id => String(id) === String(assessment.id)))
          && (!filter.term_id || filter.term_id.some(id => String(id) === String(assessment.term_id)))
        );
      },
      async getFreshQuery(table, columns, filter) {
        assert.equal(table, 'learners');
        return learners.filter(learner => String(learner.class_id || 'class-1') === String(filter.class_id));
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
      getGradeDistribution: () => [],
      getLearners: async () => learners
    },
    ReportHeader: {
      getSchoolContact: () => ({ email: 'school@example.test', phone: '000' })
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.ReportStudent = ReportStudent;`, context);
  context.ReportStudent.gradeBars = () => '';
  context.ReportStudent.passDonut = () => '';
  context.ReportStudent.markQueries = markQueries;
  return context.ReportStudent;
}

test('Primary report cards include the complete active curriculum despite partial class assignments', () => {
  const studentReport = loadReportStudent();
  const primarySubjects = [
    { id: 'math', name: 'Mathematics', level: 'Both' },
    { id: 'english', name: 'English', level: 'Both' },
    { id: 'kin', name: 'Kinyarwanda', level: 'Both' },
    { id: 'french', name: 'French', level: 'Both' },
    { id: 'set', name: 'Science and Elementary Technology', level: 'Primary' },
    { id: 'srs', name: 'Social and Religious Studies', level: 'Primary' },
    { id: 'ca', name: 'Creative Arts', level: 'Primary' },
    { id: 'pe', name: 'Physical Education', level: 'Primary' }
  ];
  const selected = studentReport.subjectsForClass(
    primarySubjects,
    { education_level: 'Primary', level: 'P5', name: 'P5A' },
    [{ id: 'set' }],
    'P5'
  );

  assert.deepEqual(Array.from(selected, subject => subject.id), [
    'ca', 'english', 'french', 'kin', 'math', 'pe', 'set', 'srs'
  ]);
});

test('Secondary report cards include shared and Secondary subjects but exclude Primary-only subjects', () => {
  const studentReport = loadReportStudent();
  const subjects = [
    { id: 'math', name: 'Mathematics', level: 'Both' },
    { id: 'english', name: 'English', level: 'Both' },
    { id: 'kin', name: 'Kinyarwanda', level: 'Both' },
    { id: 'french', name: 'French', level: 'Both' },
    { id: 'kisw', name: 'Kiswahili', level: 'Secondary' },
    { id: 'physics', name: 'Physics', level: 'Secondary' },
    { id: 'set', name: 'Science and Elementary Technology', level: 'Primary' }
  ];
  const selected = studentReport.subjectsForClass(
    subjects,
    { education_level: 'Lower Secondary', level: 'S1', name: 'S1A' },
    [{ id: 'kisw' }],
    'S1'
  );

  assert.deepEqual(Array.from(selected, subject => subject.id), [
    'english', 'french', 'kin', 'kisw', 'math', 'physics'
  ]);
});

test('class report marks are fetched in small assessment and learner batches', async () => {
  const studentReport = loadReportStudent();
  const assessmentIds = Array.from({ length: 12 }, (_, index) => `assessment-${index}`);
  const learnerIds = Array.from({ length: 21 }, (_, index) => `learner-${index}`);

  const marks = await studentReport.fetchMarksByAssessments(assessmentIds, learnerIds);

  assert.equal(marks.length, assessmentIds.length * learnerIds.length);
  assert.equal(studentReport.markQueries.length, 6);
  for (const query of studentReport.markQueries) {
    assert.ok(query.assessmentIds.length <= 10);
    assert.ok(query.learnerIds.length <= 10);
  }
});

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
    termIds: ['term-1'],
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

test('selected saved assessments remain visible while approval is pending', async () => {
  const studentReport = loadReportStudent([{
    id: 'draft-assessment',
    subject_id: 'math',
    term_id: 'term-1',
    status: 'draft'
  }]);

  const result = await studentReport.loadAssessments({
    classId: 'class-1',
    yearId: 'year-1',
    termIds: ['term-1'],
    assessmentIds: ['draft-assessment']
  });

  assert.deepEqual(Array.from(result.official, assessment => assessment.id), ['draft-assessment']);
  assert.equal(result.approval, 'PENDING APPROVAL');
});

test('whole-class report cards include one card per active learner without assessment marks', async () => {
  const learners = Array.from({ length: 52 }, (_, index) => ({
    id: `student-${index + 1}`,
    full_name: `Student ${index + 1}`
  }));
  const studentReport = loadReportStudent([], learners);
  studentReport.loadContext = async () => ({
    year: { id: 'year-1' },
    term: { id: 'term-1' },
    terms: [{ id: 'term-1', name: 'Term 1' }],
    cls: { id: 'class-1', name: 'P5A' },
    subjects: [],
    types: [],
    settings: {},
    scale: [],
    passMark: 50
  });
  studentReport.loadAssessments = async () => ({ official: [], approval: 'DRAFT' });
  studentReport.fetchMarksByAssessments = async () => [];
  studentReport.buildCard = async ({ learner }) => ({ learner });
  studentReport.normalizeCardTotals = () => {};
  studentReport.computePositions = async cards => cards;

  const result = await studentReport.fetchClassCards({
    classId: 'class-1',
    yearId: 'year-1',
    termId: 'term-1'
  });

  assert.equal(result.cards.length, 52);
  assert.equal(result.meta.count, 52);
  assert.equal(result.meta.activeLearnerCount, 52);
  assert.deepEqual(
    Array.from(result.cards, card => card.learner.id),
    learners.map(learner => learner.id)
  );
});

test('report table groups component scores under maximum, terms, and total', () => {
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

  assert.match(html, /<th class="src-group-heading src-maximum-group" colspan="4">MAXIMUM<\/th>/);
  assert.match(html, /<th class="src-group-heading src-term-group" colspan="5">Term 1 \/ 2026<\/th>/);
  assert.match(html, /<th class="src-group-heading src-term-group" colspan="4">Term 2 \/ 2026<\/th>/);
  assert.match(html, /<th class="src-group-heading src-overall-group" colspan="4">TOTAL<\/th>/);
  assert.match(html, /<th class="src-subject-heading">WEIGHT<\/th>/);
  assert.match(html, /<th title="Mid-Term Test">MTT<\/th><th title="Weekly Quiz">QZ<\/th><th title="Project">PRJ<\/th><th>TOT<\/th>/);
  assert.match(html, /<td class="src-maximum-cell">20<\/td><td class="src-maximum-cell">10<\/td><td class="src-maximum-cell">50<\/td><td class="src-maximum-cell">80<\/td>/);
  assert.match(html, /<td>15<\/td><td>8<\/td><td class="src-term-total">23<\/td>/);
  assert.match(html, /<tfoot><tr class="src-total-row">/);
  assert.match(html, /src-reference-matrix/);
  assert.match(html, /src-compact-term-table/);
  assert.doesNotMatch(html, /src-reference-summary-table/);
  assert.match(html, /Term\(s\)/);
});
