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
      pct: (obtained, maximum) => maximum > 0 ? obtained / maximum * 100 : null
    },
    ReportUtils: {
      calcGrade: percentage => ({ grade: percentage >= 50 ? 'P' : 'F' })
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.ReportStudent = ReportStudent;`, context);
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

  assert.deepEqual(result.official.map(assessment => assessment.id), ['selected-eu']);
  assert.deepEqual(periods.map(period => period.id), ['term-1']);
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
