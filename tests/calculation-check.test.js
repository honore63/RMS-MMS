const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUtils() {
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
    }
  };

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
    'Beginning Exam'
  ];

  assert.deepEqual(Utils.ASSESSMENT_TYPES, required);
  for (const type of required) {
    assert.ok(Utils.ASSESSMENT_TYPES.includes(type), `Missing assessment type: ${type}`);
  }
});
