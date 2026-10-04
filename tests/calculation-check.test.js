const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUtils(overrides = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'utils.js'), 'utf8');
  const context = {
    console,
    document: {
      createElement() {
        return { textContent: '', innerHTML: '' };
      }
    },
    DB: { get: async () => [] },
    GradingEngine: {
      calculateGradeSync(pct, scale) {
        if (!scale || !scale.length) {
          if (pct >= 80) return { grade: 'A', descriptor: 'Excellent', isPass: true };
          if (pct >= 75) return { grade: 'B', descriptor: 'Very Good', isPass: true };
          if (pct >= 70) return { grade: 'C', descriptor: 'Good', isPass: true };
          if (pct >= 65) return { grade: 'D', descriptor: 'Satisfactory', isPass: true };
          if (pct >= 60) return { grade: 'E', descriptor: 'Adequate', isPass: true };
          if (pct >= 50) return { grade: 'S', descriptor: 'Minimum Pass', isPass: true };
          return { grade: 'F', descriptor: 'Fail', isPass: false };
        }
        const byMin = [...scale].sort((a, b) => Number(b.minimum_percentage) - Number(a.minimum_percentage));
        for (const range of byMin) {
          if (pct >= Number(range.minimum_percentage)) {
            return {
              grade: range.grade,
              descriptor: range.descriptor || range.remark,
              isPass: range.is_pass === true
            };
          }
        }
        return { grade: 'F', descriptor: 'Fail', isPass: false };
      }
    },
    ...overrides
  };
  context.window = context;

  vm.runInNewContext(code, context);
  return context.Utils;
}

test('grade selection should prefer the highest matching percentage band', () => {
  const Utils = loadUtils();
  const scale = [
    { minimum_percentage: 70, maximum_percentage: 100, grade: 'C', descriptor: 'Good', remark: 'Good' },
    { minimum_percentage: 80, maximum_percentage: 100, grade: 'A', descriptor: 'Excellent', remark: 'Excellent' },
    { minimum_percentage: 0, maximum_percentage: 69, grade: 'F', descriptor: 'Fail', remark: 'Fail' }
  ];

  assert.equal(Utils.grade(92, scale), 'A');
  assert.equal(Utils.remark(92, scale), 'Excellent');
});

test('DOS assessment type catalog should include exactly the official RMS-MIS set', () => {
  const Utils = loadUtils();
  const required = [
    'CAT',
    'Monthly Test',
    'Weekly Test',
    'Beginning Exam',
    'Mid-Term Exam',
    'End of Term Exam',
    'End of Unit',
    'Assignment',
    'Quiz',
    'Project',
    'Homework',
    'Classwork',
    'Practical',
    'Portfolio',
    'Oral Test',
    'Participation',
    'Diagnostic Test',
    'Other'
  ];

  assert.deepEqual(Utils.ASSESSMENT_TYPES, required);
  assert.deepEqual([...new Set(Utils.ASSESSMENT_TYPES)], Utils.ASSESSMENT_TYPES);
  for (const type of required) {
    assert.ok(Utils.ASSESSMENT_TYPES.includes(type), `Missing assessment type: ${type}`);
  }
});

test('forced assessment type refresh bypasses the in-memory and DB caches', async () => {
  let databaseRows = [];
  let refreshCount = 0;
  const Utils = loadUtils({
    DB: {
      invalidate(table) { assert.equal(table, 'assessment_types'); },
      async getFresh(table) {
        assert.equal(table, 'assessment_types');
        refreshCount++;
        return databaseRows;
      }
    },
    sbClient: {},
    Auth: { getRole: () => 'teacher' }
  });
  databaseRows = Utils.canonicalAssessmentTypeRows().map((row, index) => ({ ...row, id: `fresh-${index}` }));
  Utils.assessmentTypesCache = [{ id: 'stale', name: 'Old Type' }];

  const rows = await Utils.ensureAssessmentTypes({ forceRefresh: true });

  assert.equal(refreshCount, 1);
  assert.equal(rows[0].id, 'fresh-0');
  assert.equal(Utils.assessmentTypesCache, rows);
});

test('forced assessment type synchronization seeds missing canonical rows for DOS', async () => {
  let databaseRows = [];
  let refreshCount = 0;
  const Utils = loadUtils({
    DB: {
      invalidate(table) { assert.equal(table, 'assessment_types'); },
      async getFresh(table) {
        assert.equal(table, 'assessment_types');
        refreshCount++;
        return databaseRows;
      }
    },
    sbClient: {
      from(table) {
        assert.equal(table, 'assessment_types');
        return {
          async upsert(rows) {
            databaseRows = databaseRows.concat(rows.map((row, index) => ({ ...row, id: `seeded-${index}` })));
            return { error: null };
          }
        };
      }
    },
    Auth: { getRole: () => 'dos' }
  });
  databaseRows = Utils.canonicalAssessmentTypeRows().slice(0, -1)
    .map((row, index) => ({ ...row, id: `existing-${index}` }));

  const rows = await Utils.ensureAssessmentTypes({ forceRefresh: true });

  assert.equal(refreshCount, 2);
  assert.equal(rows.length, Utils.ASSESSMENT_TYPES.length);
  assert.ok(rows.some(row => row.name === 'Other' && row.id.startsWith('seeded-')));
});

test('grade info fallback should expose a boolean pass status', () => {
  const Utils = loadUtils();
  assert.deepEqual(Utils.gradeInfo(82, null), {
    grade: 'A',
    descriptor: 'Excellent',
    isPass: true
  });
  assert.deepEqual(Utils.gradeInfo(49, null), {
    grade: 'F',
    descriptor: 'Fail',
    isPass: false
  });
});
