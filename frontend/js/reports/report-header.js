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
    const schoolLogo = s.logo_url || 'public/logo.webp';
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
          <span>${Utils.escapeHtml(s.school_name || 'RMS-MIS')}</span>
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

  getPageBreak() {
    return '<div class="rms-page-break" style="page-break-after:always; height:0; margin:0; padding:0;"></div>';
  }
};

function schoolReportHeader(title, opts = {}) {
  const settings = typeof getSchoolSettings === 'function' ? getSchoolSettings() : {};
  const schoolName = settings.school_name || 'RUKARA MODEL SCHOOL';
  const schoolCode = settings.school_code || '541023';
  const email = settings.school_email || '';
  const phone = settings.school_phone || '';
  const ministryLogo = settings.ministry_logo_url || 'public/logo.webp';
  const schoolLogo = settings.logo_url || 'public/logo.webp';
  const academicYear = opts.academicYear || '';
  const term = opts.term || '';
  const className = opts.className || '';
  const subject = opts.subject || '';

  return `<div class="rms-report-header"><div class="rms-header-left"><img src="${Utils.escapeHtml(ministryLogo)}" class="rms-header-logo" alt="Ministry Logo"><div class="rms-header-text"><div style="font-weight:800;font-size:14px;color:#1e3a5f">${Utils.escapeHtml(schoolName)}</div><div style="font-size:10px;color:#666">School Code: ${schoolCode} | ${Utils.escapeHtml(email)} | ${Utils.escapeHtml(phone)}</div></div></div><div class="rms-header-center"><div style="font-weight:800;font-size:16px;color:#1e3a5f;text-transform:uppercase">${Utils.escapeHtml(title)}</div><div style="font-size:12px;color:#555;margin-top:4px">${Utils.escapeHtml(academicYear)} | ${Utils.escapeHtml(term)} | ${Utils.escapeHtml(className)} | ${Utils.escapeHtml(subject)}</div></div><div class="rms-header-right"><img src="${Utils.escapeHtml(schoolLogo)}" class="rms-header-logo" alt="School Logo"></div></div><div class="rms-header-divider"></div>`;
}

function schoolSignatureSection(teacherName, dosName, headteacherName) {
  const d = typeof getSchoolSettings === 'function' ? getSchoolSettings() : {};
  return `<div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">
    <div><strong>Class Teacher:</strong> ${Utils.escapeHtml(teacherName || '-')}<br><br>Signature: ______________________</div>
    <div><strong>DOS:</strong> ${Utils.escapeHtml(dosName || d.dos_name || '-')}<br><br>Signature: ______________________</div>
    <div><strong>Headteacher:</strong> ${Utils.escapeHtml(headteacherName || d.headteacher_name || '-')}<br><br>Signature: ______________________</div>
  </div>`;
}
