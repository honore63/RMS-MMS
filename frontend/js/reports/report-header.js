const ReportHeader = {
  getSchoolSettings() {
    return typeof getSchoolSettings === 'function' ? getSchoolSettings() : {};
  },

  getOfficialHeader(opts = {}) {
    const s = opts.settings || {};
    const title = opts.title || 'REPORT';
    const subtitle = opts.subtitle || '';
    const levelLabel = opts.levelLabel || '';
    const showLogoLeft = opts.showLogoLeft !== false;
    const showLogoRight = opts.showLogoRight !== false;
    const ministryLogo = s.ministry_logo_url || 'public/logo.webp';
    const schoolLogo = s.school_logo_url || s.logo_url || 'public/logo.webp';
    const schoolName = s.school_name || 'RUKARA MODEL SCHOOL';
    const schoolCode = s.school_code || '541023';
    const email = s.school_email || '';
    const phone = s.school_phone || '';
    const country = s.country || 'Republic of Rwanda';
    const ministry = s.ministry || 'Ministry of Education';
    const province = s.province || 'Eastern Province';
    const district = s.district || 'Kayonza';
    const sector = s.sector || 'Gahini';

    return `
      <div class="rms-report-header">
        <div class="rms-header-left">
          ${showLogoLeft ? `<img src="${Utils.escapeHtml(ministryLogo)}" class="rms-header-logo" alt="Ministry Logo" onerror="this.style.display='none'">` : ''}
          <div class="rms-header-text">
            <div class="rms-header-country">${Utils.escapeHtml(country)}</div>
            <div class="rms-header-ministry">${Utils.escapeHtml(ministry)}</div>
            <div class="rms-header-province">${Utils.escapeHtml(province)}</div>
            <div class="rms-header-district">${Utils.escapeHtml(district)}</div>
            <div class="rms-header-sector">${Utils.escapeHtml(sector)}</div>
            <div class="rms-header-school">${Utils.escapeHtml(schoolName)}</div>
            <div class="rms-header-code">School Code: ${schoolCode}</div>
            ${email ? `<div class="rms-header-email">Email: ${Utils.escapeHtml(email)}</div>` : ''}
            ${phone ? `<div class="rms-header-phone">Phone: ${Utils.escapeHtml(phone)}</div>` : ''}
          </div>
        </div>
        <div class="rms-header-center">
          <div class="rms-header-title">${Utils.escapeHtml(title)}</div>
          ${subtitle ? `<div class="rms-header-subtitle">${Utils.escapeHtml(subtitle)}</div>` : ''}
          ${levelLabel ? `<div class="rms-header-level">${Utils.escapeHtml(levelLabel)}</div>` : ''}
        </div>
        <div class="rms-header-right">
          ${showLogoRight ? `<img src="${Utils.escapeHtml(schoolLogo)}" class="rms-header-logo" alt="School Logo" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      <div class="rms-header-divider"></div>`;
  },

  getFooter(opts = {}) {
    const s = opts.settings || {};
    const year = opts.academicYear || '';
    const term = opts.term || '';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="rms-report-footer">
        <div class="rms-footer-left">
          <span>RMS-MIS | ${Utils.escapeHtml(s.school_name || 'RUKARA MODEL SCHOOL')}</span>
          <span>Marks Information System</span>
        </div>
        <div class="rms-footer-center">
          <span>Academic Year: ${Utils.escapeHtml(year)}</span>
          <span>Term: ${Utils.escapeHtml(term)}</span>
        </div>
        <div class="rms-footer-right">
          <span>Generated: ${dateStr} ${timeStr}</span>
          <span>Page <span class="rms-page-num"></span> of <span class="rms-total-pages"></span></span>
        </div>
      </div>`;
  },

  emptyState(message, options = {}) {
    const msg = message || 'No data is currently available for the selected options.';
    return `<div class="rms-empty-state">${options.icon ? `<i data-lucide="${options.icon}" style="width:22px;height:22px;opacity:.6"></i>` : ''}<div>${Utils.escapeHtml(msg)}</div></div>`;
  },

  warningBanner(message) {
    return `<div class="rms-warn-banner"><i data-lucide="alert-triangle" style="width:14px;height:14px;flex:none"></i><span>${Utils.escapeHtml(message || '')}</span></div>`;
  },

  infoBanner(message) {
    return `<div class="rms-info-banner"><i data-lucide="info" style="width:14px;height:14px;flex:none"></i><span>${Utils.escapeHtml(message || '')}</span></div>`;
  },

  applyPageNumbers(root) {
    try {
      const host = root || document;
      const pages = host.querySelectorAll('.rms-a4-page-break');
      const total = Math.max(pages.length + 1, 1);
      host.querySelectorAll('.rms-page-num').forEach(el => { el.textContent = '1'; });
      host.querySelectorAll('.rms-total-pages').forEach(el => { el.textContent = String(total); });
    } catch (e) { /* printable preview only */ }
  },

  numberPagesInPrint(page) {
    try {
      const doc = page.document;
      const markers = doc.querySelectorAll('.rms-page-break');
      const total = Math.max(markers.length + 1, 1);
      markers.forEach((m, i) => {
        const num = i + 1;
        m.querySelectorAll('.rms-page-num').forEach(el => { el.textContent = String(num); });
      });
      doc.querySelectorAll('.rms-total-pages').forEach(el => { el.textContent = String(total); });
    } catch (e) { /* ignore */ }
  },

  getPageBreak() {
    return '<div class="rms-page-break" style="page-break-after:always; height:0; margin:0; padding:0;"></div>';
  },

  getA4Container(html, orientation = 'portrait') {
    const isLandscape = orientation === 'landscape';
    const cls = isLandscape ? 'rms-a4-container rms-a4-landscape' : 'rms-a4-container';
    return `
      <div class="${cls}" data-report-orientation="${orientation}">
        ${html}
      </div>`;
  },

  getA4Page(html, orientation = 'portrait') {
    const isLandscape = orientation === 'landscape';
    const cls = isLandscape ? 'rms-a4-page rms-a4-landscape' : 'rms-a4-page';
    return `
      <div class="${cls}" data-report-orientation="${orientation}">
        ${html}
      </div>`;
  },

  getPageNumbers(count) {
    const pages = [];
    for (let i = 1; i <= count; i++) {
      pages.push(`<span class="rms-page-num">${i}</span> of ${count}`);
    }
    return pages.join('');
  },

  getOrientation(reportType) {
    const landscapeTypes = [
      'exam-class-summary', 'subject-performance', 'class-performance',
      'missing-marks', 'school-performance', 'grade-distribution',
      'teacher-performance'
    ];
    return landscapeTypes.includes(reportType) ? 'landscape' : 'portrait';
  }
};

function schoolReportHeader(title, opts = {}) {
  const settings = typeof getSchoolSettings === 'function' ? getSchoolSettings() : {};
  const academicYear = opts.academicYear || '';
  const term = opts.term || '';
  const className = opts.className || '';
  const subject = opts.subject || '';
  const subtitle = [academicYear, term, className, subject].filter(Boolean).join(' | ');
  const levelLabel = opts.levelLabel || (opts.level ? String(opts.level).toUpperCase() : '');
  return ReportHeader.getOfficialHeader({ settings, title, subtitle, levelLabel, showLogoLeft: true, showLogoRight: true });
}

function schoolSignatureSection(teacherName, dosName, headteacherName) {
  const d = typeof getSchoolSettings === 'function' ? getSchoolSettings() : {};
  return `<div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">
    <div><strong>Class Teacher:</strong> ${Utils.escapeHtml(teacherName || '-')}<br><br>Signature: ______________________</div>
    <div><strong>DOS:</strong> ${Utils.escapeHtml(dosName || d.dos_name || '-')}<br><br>Signature: ______________________</div>
    <div><strong>Headteacher:</strong> ${Utils.escapeHtml(headteacherName || d.headteacher_name || '-')}<br><br>Signature: ______________________</div>
  </div>`;
}
