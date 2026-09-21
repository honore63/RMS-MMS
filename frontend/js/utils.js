const Utils = {
  _gradingCache: null,
  _gradingPromise: null,

  pct(mark, max) {
    if (!max || !mark && mark !== 0) return 0;
    return Math.round((mark / max) * 10000) / 100;
  },

  grade(pct, scale) {
    if (!scale || !scale.length) {
      if (pct >= 80) return 'A';
      if (pct >= 75) return 'B';
      if (pct >= 70) return 'C';
      if (pct >= 65) return 'D';
      if (pct >= 60) return 'E';
      if (pct >= 50) return 'S';
      return 'F';
    }
    for (const s of scale) {
      if (pct >= s.minimum_percentage && pct <= s.maximum_percentage) return s.grade;
    }
    return 'F';
  },

  remark(pct, scale) {
    if (!scale || !scale.length) {
      if (pct >= 80) return 'Excellent';
      if (pct >= 75) return 'Very Good';
      if (pct >= 70) return 'Good';
      if (pct >= 65) return 'Satisfactory';
      if (pct >= 60) return 'Adequate';
      if (pct >= 50) return 'Minimum Pass';
      return 'Fail';
    }
    for (const s of scale) {
      if (pct >= s.minimum_percentage && pct <= s.maximum_percentage) return s.descriptor || s.remark;
    }
    return 'Fail';
  },

  passFail(pct, passMark = 50) {
    return pct >= passMark ? 'PASS' : 'FAIL';
  },

  /** @deprecated Use GradingEngine.calculateGradeSync instead */
  gradeInfo(pct, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.calculateGradeSync(pct, scale);
    }
    return { grade: this.grade(pct, scale), descriptor: this.remark(pct, scale), isPass: this.passFail(pct, 50) };
  },

  classStats(marks, maxMark) {
    const v = marks.filter(m => m !== null && m !== undefined);
    const n = v.length;
    if (!n) return { count: 0, avg: 0, high: 0, low: 0, pass: 0, fail: 0, passRate: 0, failRate: 0 };
    const pcts = v.map(m => this.pct(m, maxMark));
    const avg = pcts.reduce((a, b) => a + b, 0) / n;
    const pass = pcts.filter(p => p >= 50).length;
    return {
      count: n,
      avg: Math.round(avg * 100) / 100,
      high: Math.max(...pcts),
      low: Math.min(...pcts),
      pass,
      fail: n - pass,
      passRate: Math.round((pass / n) * 10000) / 100,
      failRate: Math.round(((n - pass) / n) * 10000) / 100
    };
  },

  gradeDist(grades) {
    const d = {};
    for (const g of grades) { if (g) d[g] = (d[g] || 0) + 1; }
    return d;
  },

  positions(items) {
    const sorted = [...items].sort((a, b) => b.pct - a.pct);
    const result = [];
    let pos = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].pct < sorted[i - 1].pct) pos = i + 1;
      result.push({ id: sorted[i].id, position: pos });
    }
    return result;
  },

  statusColor(s) {
    const m = { approved: 'success', locked: 'success', submitted: 'info', rejected: 'danger', draft: 'warning', active: 'success', inactive: 'gray', pending: 'warning', upcoming: 'info', archived: 'gray' };
    return 'badge-' + (m[s] || 'gray');
  },

  statusIcon(s) {
    const m = { approved: 'check-circle-2', locked: 'lock', submitted: 'send', rejected: 'x-circle', draft: 'file-edit', active: 'check-circle-2', inactive: 'x-circle', pending: 'clock', upcoming: 'calendar-clock', archived: 'archive' };
    return m[s] || 'circle';
  },

  dateStr(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  dateTimeStr(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  async getGradingScale() {
    if (this._gradingCache) return this._gradingCache;
    if (this._gradingPromise) return this._gradingPromise;
    this._gradingPromise = DB.get('grading_scales').then(data => {
      this._gradingCache = data;
      return data;
    });
    return this._gradingPromise;
  },

  toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const icons = { success: 'check-circle-2', error: 'x-circle', info: 'info' };
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i> ${msg}`;
    c.appendChild(t);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => t.remove(), 3500);
  },

  escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  initials(name) {
    return (name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  },

  loading() {
    return `<div class="empty-state"><div class="spinner" style="margin:0 auto;width:32px;height:32px"></div><p style="margin-top:12px;color:var(--gray-500)">Loading...</p></div>`;
  },

  skeleton(count = 4) {
    return Array.from({length: count}, () => 
      `<div class="card skeleton" style="background:linear-gradient(90deg,var(--gray-100) 25%,var(--gray-200) 50%,var(--gray-100) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>`
    ).join('');
  },

  empty(msg = 'No data found', icon = 'inbox') {
    return `<div class="empty-state"><div class="empty-icon"><i data-lucide="${icon}"></i></div><h3>${msg}</h3><p>Get started by adding some data.</p></div>`;
  },

  errorCard(msg = 'Unable to Load Data', detail = 'We couldn\u2019t retrieve this information. Please try again.') {
    return `<div class="error-card"><div class="error-icon"><i data-lucide="alert-triangle"></i></div><h3>${msg}</h3><p>${detail}</p></div>`;
  },

  compressImage(file, maxWidth = 300, maxHeight = 300, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
};

const EducationLevels = {
  CATEGORIES: {
    PRIMARY: 'Primary',
    LOWER_SECONDARY: 'Lower Secondary',
    UPPER_SECONDARY: 'Upper Secondary'
  },

  getCategory(cls) {
    if (!cls) return 'Lower Secondary';
    const levelStr = typeof cls === 'string' ? cls : (cls.education_level || cls.level || cls.name || '');
    const clean = levelStr.trim().toUpperCase();

    if (clean.includes('PRIMARY') || /^P[1-6]/.test(clean)) return 'Primary';
    if (clean.includes('UPPER SECONDARY') || clean.includes('UPPER') || /^(S[4-6])/.test(clean)) return 'Upper Secondary';
    if (clean.includes('LOWER SECONDARY') || clean.includes('LOWER') || /^(S[1-3])/.test(clean)) return 'Lower Secondary';
    if (clean.includes('NURSERY')) return 'Nursery';
    if (clean.includes('TVET')) return 'TVET';
    return 'Lower Secondary';
  },

  getAllowedGrades(category) {
    const cat = (category || '').trim().toUpperCase();
    if (cat.includes('PRIMARY')) return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    if (cat.includes('UPPER')) return ['S4', 'S5', 'S6'];
    if (cat.includes('LOWER')) return ['S1', 'S2', 'S3'];
    return ['P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6'];
  },

  getAllowedStreams(grade) {
    const g = (grade || '').trim().toUpperCase();
    if (g === 'S4' || g === 'S5') return ['Stream 1', 'Stream 2'];
    if (g === 'S6') return ['MEG', 'PCM', 'MCE'];
    if (g.startsWith('P') || g.startsWith('S')) return ['Stream 1', 'Stream 2', 'A', 'B'];
    return [];
  },

  isValidCombination(category, grade, stream) {
    const cat = this.getCategory(category || grade);
    const validGrades = this.getAllowedGrades(cat);
    const g = (grade || '').trim().toUpperCase();
    const st = (stream || '').trim().toUpperCase();

    if (g && !validGrades.includes(g)) {
      return { valid: false, message: `Class grade ${grade} is not valid for ${cat}` };
    }
    if (g === 'S6' && st && !['MEG', 'PCM', 'MCE', 'STREAM 1', 'STREAM 2'].includes(st)) {
      return { valid: false, message: `S6 stream must be MEG, PCM, or MCE (got ${stream})` };
    }
    if ((g === 'S1' || g === 'S2' || g === 'S3') && ['MEG', 'PCM', 'MCE'].includes(st)) {
      return { valid: false, message: `Lower Secondary (${g}) cannot have Upper Secondary stream ${stream}` };
    }
    if (cat === 'Primary' && (st === 'PCM' || st === 'MEG' || st === 'MCE' || g.startsWith('S'))) {
      return { valid: false, message: `Primary classes cannot be assigned Secondary grades/streams` };
    }
    return { valid: true };
  }
};


