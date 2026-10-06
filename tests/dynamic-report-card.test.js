const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReportCard() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'js', 'pages', 'admin-report-card.js'),
    'utf8'
  );
  const context = {
    console,
    Utils: {
      escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character]);
      },
      isConversionHelper: () => false,
      dateStr: () => '2026-10-04'
    },
    AnalyticsEngine: {
      effWeight(assessment, types) {
        if (assessment.weight != null) return Number(assessment.weight);
        const type = types.find(item => String(item.id) === String(assessment.assessment_type_id));
        return type?.weight == null ? null : Number(type.weight);
      },
      learnerPct(marks, assessments, types) {
        const units = marks.map(mark => ({
          mark,
          assessment: assessments.find(item => String(item.id) === String(mark.assessment_id))
        })).filter(unit => unit.assessment);
        const weights = units.map(unit => this.effWeight(unit.assessment, types));
        if (weights.every(weight => weight != null && weight > 0)) {
          const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
          return units.reduce((sum, unit, index) =>
            sum + Number(unit.mark.mark) / Number(unit.assessment.maximum_mark) * 100 * weights[index], 0
          ) / totalWeight;
        }
        const obtained = units.reduce((sum, unit) => sum + Number(unit.mark.mark), 0);
        const maximum = units.reduce((sum, unit) => sum + Number(unit.assessment.maximum_mark), 0);
        return maximum ? obtained / maximum * 100 : null;
      }
    },
    GradingEngine: {
      calculateGradeSync(pct) {
        return { grade: pct >= 80 ? 'A' : pct >= 70 ? 'B' : 'C' };
      }
    },
    ReportHeader: {
      getSchoolContact: () => ({ email: 'school@example.test', phone: '000' })
    }
  };
  vm.runInNewContext(source, context);
  return context;
}

const types = [
  { id: 'unit', name: 'End of Unit', code: 'EU', weight: 40, display_order: 1 },
  { id: 'exam', name: 'End of Term Exam', code: 'ET', weight: 60, display_order: 2 }
];

const assessments = [
  { id: 'a1', subject_id: 'math', term_id: 't1', assessment_type_id: 'unit', unit_number: 1, unit_name: 'Fractions', maximum_mark: 20 },
  { id: 'a2', subject_id: 'math', term_id: 't1', assessment_type_id: 'exam', maximum_mark: 50 },
  { id: 'a3', subject_id: 'math', term_id: 't1', assessment_type_id: 'unit', unit_number: 2, unit_name: 'Geometry', maximum_mark: 10 },
  { id: 'a4', subject_id: 'math', term_id: 't2', assessment_type_id: 'exam', maximum_mark: 50 }
];

const marks = [
  { assessment_id: 'a1', learner_id: 'student', mark: 18 },
  { assessment_id: 'a2', learner_id: 'student', mark: 40 },
  { assessment_id: 'a4', learner_id: 'student', mark: 35 }
];

test('report card uses configured weights and excludes unmarked assessments', () => {
  const context = loadReportCard();
  const score = context.rcCalcSubject(
    { id: 'math' },
    assessments.slice(0, 3),
    marks,
    [],
    types
  );

  assert.equal(score.pct, 84);
  assert.equal(score.obtained, 58);
  assert.equal(score.maximum, 70);
  assert.equal(score.hasMarks, true);
  assert.equal(score.components.size, 2);
  assert.equal(score.components.get('unit').obtained, 18);
  assert.equal(score.components.get('unit').maximum, 30);
  assert.equal(score.components.get('unit').scoredMaximum, 20);
});

test('report card renders one grouped EU/ET grid across terms and annual totals', () => {
  const context = loadReportCard();
  const html = context.rcRenderCard(
    { id: 'student', full_name: 'A Student', learner_code: 'S001' },
    {
      settings: { school_name: 'Rukara Model School', pass_mark: 50 },
      cls: { level: 'P5', name: 'P5A' },
      year: { name: '2026' },
      selectedTerms: [{ id: 't1', name: 'Term 1' }, { id: 't2', name: 'Term 2' }],
      activeSubjects: [{ id: 'math', name: 'Mathematics' }],
      allAssessments: assessments,
      allMarks: marks,
      assessmentTypes: types,
      scale: [],
      annualMode: true,
      posData: { t1: { positions: { student: 1 }, total: 1 } },
      annualPosData: { positions: { student: 1 }, total: 1 }
    }
  );

  assert.match(html, /class="rc-data-table rc-data-table-dynamic"/);
  assert.match(html, /class="rc-all-subjects-row"/);
  assert.match(html, /Term 1 \/ 2026/);
  assert.match(html, /Term 2 \/ 2026/);
  assert.match(html, /Total<\/th>/);
  assert.match(html, /<th title="End of Unit">EU<\/th><th title="End of Term Exam">ET<\/th><th>TOT<\/th><th>%<\/th><th>GR<\/th>/);
  assert.match(html, /<th>TOTAL<\/th><th>MAX<\/th><th>%<\/th><th>GR<\/th>/);
  assert.match(html, /78\.8%/);
  assert.match(html, /40%/);
  assert.match(html, /60%/);
  assert.doesNotMatch(html, /Term 1 RESULTS|Term 2 RESULTS/);
});

test('report card columns follow configured assessment types rather than EU/ET rules', () => {
  const context = loadReportCard();
  const types = [
    { id: 'mid', name: 'Mid-Term Test', code: 'MTT', weight: 30, display_order: 1 },
    { id: 'quiz', name: 'Weekly Quiz', code: 'QZ', weight: 10, display_order: 2 },
    { id: 'project', name: 'Project', code: 'PRJ', weight: 60, display_order: 3 }
  ];
  const assessments = types.map((type, index) => ({
    id: `a${index + 1}`,
    subject_id: 'math',
    term_id: 't1',
    assessment_type_id: type.id,
    maximum_mark: 20
  }));
  const columns = context.rcComponentColumns(assessments, types);

  assert.deepEqual(Array.from(columns, column => column.key), ['mid', 'quiz', 'project']);
  assert.deepEqual(Array.from(columns, column => column.label), ['MTT', 'QZ', 'PRJ']);
});
