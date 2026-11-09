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
  context.Utils.EducationLevels = vm.runInNewContext('EducationLevels', context);
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

test('assessment normalization keeps raw values separate and rejects an invalid maximum', () => {
  const Utils = loadUtils();
  assert.deepEqual(Utils.assessmentResult(57, 60, []), {
    normalized_mark: 95,
    percentage: 95,
    grade: 'A',
    remark: 'Excellent'
  });
  assert.deepEqual(Utils.assessmentResult(8, 0, []), {
    normalized_mark: null,
    percentage: null,
    grade: null,
    remark: null
  });
  assert.equal(Utils.normalizedMark(null, 10), null);
});

test('subject availability is isolated by class education level and configured grades', () => {
  const Utils = loadUtils();
  const primaryClass = { education_level: 'Primary', level: 'P5', name: 'P5A' };
  const lowerSecondaryClass = { education_level: 'Lower Secondary', level: 'S2', name: 'S2' };

  assert.equal(Utils.EducationLevels.subjectMatchesClass({ level: 'Secondary' }, primaryClass), false);
  assert.equal(Utils.EducationLevels.subjectMatchesClass({ level: 'Lower Secondary' }, lowerSecondaryClass), true);
  assert.equal(Utils.EducationLevels.subjectMatchesClass({ level: 'Primary' }, lowerSecondaryClass), false);
  assert.equal(Utils.EducationLevels.subjectMatchesClass({ level: 'Both' }, primaryClass), true);
  assert.equal(Utils.EducationLevels.subjectMatchesClass({ level: 'Both', grades: 'P1,P2,P3' }, primaryClass), false);
});

test('French is Primary-only, supports Lower Primary labels, and respects configured grades', () => {
  const Utils = loadUtils();
  const french = {
    name: 'French',
    code: 'FRE',
    level: 'Primary',
    education_level: 'Primary',
    grades: 'P1,P2,P3,P4,P5,P6'
  };
  const primaryClasses = ['P1A', 'P2', 'P3', 'P4A', 'P5', 'P6'].map((name, index) => ({
    education_level: index === 0 ? 'lower_primary' : 'Primary',
    level: `P${index + 1}`,
    name
  }));
  const secondaryClass = { education_level: 'Lower Secondary', level: 'S1', name: 'S1' };

  assert.ok(primaryClasses.every(cls => Utils.EducationLevels.subjectMatchesClass(french, cls)));
  assert.equal(Utils.EducationLevels.subjectMatchesClass(french, secondaryClass), false);
  assert.equal(Utils.EducationLevels.subjectMatchesClass(
    { ...french, level: 'Lower Primary', education_level: 'Lower Primary' },
    primaryClasses[0]
  ), true);
  assert.equal(Utils.EducationLevels.subjectMatchesClass(
    { ...french, level: 'Lower Primary', education_level: 'Lower Primary' },
    primaryClasses[3]
  ), false);
  assert.equal(Utils.EducationLevels.subjectMatchesClass(
    { ...french, grades: 'P1,P2,P3' },
    primaryClasses[3]
  ), false);
});

test('all standard Primary subjects are available to Primary classes, not Secondary classes', () => {
  const Utils = loadUtils();
  const primarySubjects = [
    { name: 'Mathematics', level: 'Both' },
    { name: 'English', level: 'Both' },
    { name: 'Kinyarwanda', level: 'Both' },
    { name: 'French', level: 'Primary' },
    { name: 'Science and Elementary Technology', level: 'Primary' },
    { name: 'Social and Religious Studies', level: 'Primary' },
    { name: 'Creative Arts', level: 'Primary' },
    { name: 'Physical Education', level: 'Primary' }
  ];
  const primaryClasses = ['P1A', 'P2B', 'P3', 'P4A', 'P5', 'P6B'].map((name, index) => ({
    education_level: index < 3 ? 'Lower Primary' : 'Primary',
    level: name.match(/P[1-6]/)[0],
    name
  }));
  const secondaryClass = { education_level: 'Lower Secondary', level: 'S1', name: 'S1' };

  for (const cls of primaryClasses) {
    for (const subject of primarySubjects) {
      assert.equal(Utils.EducationLevels.subjectMatchesClass(subject, cls), true, `${subject.name} should match ${cls.name}`);
    }
  }
  for (const subject of primarySubjects.filter(subject => subject.level === 'Primary')) {
    assert.equal(Utils.EducationLevels.subjectMatchesClass(subject, secondaryClass), false, `${subject.name} must not match Secondary`);
  }
});

test('assignment teacher filtering requires a compatible active education level', () => {
  const Utils = loadUtils();
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'js', 'pages', 'admin-assignments.js'),
    'utf8'
  );
  const context = { EducationLevels: Utils.EducationLevels };
  vm.runInNewContext(source, context);
  const matches = vm.runInContext('assignmentTeacherLevelAllows', context);
  const lowerPrimaryClass = { education_level: 'Lower Primary', level: 'P2', name: 'P2A' };
  const french = { level: 'Primary', education_level: 'Primary' };

  assert.equal(matches({ education_level: 'PRIMARY' }, lowerPrimaryClass, french), true);
  assert.equal(matches({ education_level: 'SECONDARY' }, lowerPrimaryClass, french), false);
  assert.equal(matches({ education_level: 'BOTH' }, lowerPrimaryClass, french), true);
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
