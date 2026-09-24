/* admin-reports.js – Report Center hub + wizard delegation
   Each report type has its own generation page/wizard (ReportWizard).
   Scope enforcement via Scope; RLS is authoritative.
   This file keeps legacy helpers (buildFilename, printDocument) for ReportWizard.
*/
const ReportCenter = {
  state: {
    reportType: 'student-card',
    academicYear: '',
    term: '',
    classId: '',
    subjectIds: [],
    teacherId: '',
    assessmentId: '',
    studentId: '',
    assessmentTypeId: '',
    cardMode: 'individual',
    cardLevel: 'all',
    cardStream: '',
    teacherComment: '',
    dosComment: '',
    decisionOverride: '',
    orientation: 'auto',
    loading: false,
    previewHtml: '',
    previewOrientation: 'portrait',
    previewFilename: ''
  },

  _hubDefs(){
    if (typeof Auth !== 'undefined' && Auth.isTeacher && Auth.isTeacher()) {
      return [
        { id:'subject-performance', label:'Subject Performance Summary', icon:'book-open', category:'Teacher Reports', desc:'Overall subject and assessment performance', route:'teacher/reports', color:'#2563eb', bg:'#eff6ff', filters:'Year · Term · Class · Stream · Subject · Assessment Type · Assessment' },
        { id:'teacher-student-performance', label:'Student Performance & Analysis', icon:'user-round-check', category:'Teacher Reports', desc:'Individual learner performance and intervention analysis', route:'teacher/reports', color:'#16a34a', bg:'#f0fdf4', filters:'Year · Term · Class · Stream · Subject · Assessment' },
        { id:'teacher-assessment-class', label:'Assessment & Class Analysis', icon:'bar-chart-3', category:'Teacher Reports', desc:'Assessment comparison, trends and class performance', route:'teacher/reports', color:'#ea580c', bg:'#fff7ed', filters:'Year · Term · Class · Stream · Subject · Assessment Type · Assessments' }
      ];
    }
    return [
      // STUDENT
      { id:'student-card', label:'Student Report Card', icon:'file-badge', category:'Student', desc:'Official A4 card · one page per student · batch prints', route:'admin/reports/cards', color:'var(--blue-600)', bg:'var(--blue-50)', filters:'Year · Term · Class · Student' },
      { id:'student-performance', label:'Student Academic Report', icon:'user-round-check', category:'Student', desc:'Detailed learner performance, comments, decision and ranking', route:'admin/reports/student', color:'#2563eb', bg:'#eff6ff', filters:'Year · Term · Class · Student' },
      { id:'student-marks', label:'Student Marks Report', icon:'list-checks', category:'Student', desc:'Every assessment mark for one student with totals and grades', route:'admin/reports/student-marks', color:'#0ea5e9', bg:'#e0f2fe', filters:'Year · Term · Class · Student' },
      // CLASS
      { id:'class-performance', label:'Class Performance Report', icon:'school', category:'Class', desc:'Class averages, pass rates and ranked leaderboard', route:'admin/reports/class', color:'var(--green-600)', bg:'var(--green-50)', filters:'Year · Term · Class · Subjects' },
      { id:'class-ranking', label:'Class Ranking Report', icon:'trophy', category:'Class', desc:'Ranked class leaderboard with grade distribution', route:'admin/reports/class-ranking', color:'#eab308', bg:'#fefce8', filters:'Year · Term · Class' },
      { id:'class-marks-sheet', label:'Class Marks Sheet', icon:'table-2', category:'Class', desc:'Full learner × assessment marks grid per class', route:'admin/reports/class-marks-sheet', color:'#84cc16', bg:'#f7fee7', filters:'Year · Term · Class · Subjects · Assessments' },
      { id:'grade-distribution', label:'Grade Distribution', icon:'pie-chart', category:'Class', desc:'Grade buckets across selected scope', route:'admin/reports/grades', color:'#9333ea', bg:'#faf5ff', filters:'Year · Term · Classes · Subjects' },
      // SUBJECT
      { id:'subject-performance', label:'Subject Performance Summary', icon:'book-open', category:'Subject', desc:'Subject performance across learners with charts', route:'admin/reports/subject', color:'#7c3aed', bg:'#f5f3ff', filters:'Year · Term · Class · Subject · Teacher' },
      { id:'subject-marks-sheet', label:'Subject Marks Sheet', icon:'table-2', category:'Subject', desc:'Learner × assessment marks grid for one subject', route:'admin/reports/subject-marks-sheet', color:'#a855f7', bg:'#f5f0ff', filters:'Year · Term · Class · Subject · Assessments' },
      { id:'subject-grade-distribution', label:'Subject Grade Distribution', icon:'pie-chart', category:'Subject', desc:'Grade buckets for a single subject', route:'admin/reports/subject-grade-distribution', color:'#c026d3', bg:'#fdf4ff', filters:'Year · Term · Classes · Subject' },
      { id:'subject-assessment-comparison', label:'Subject Assessment Comparison', icon:'git-compare', category:'Subject', desc:'Compare every assessment of a subject side by side', route:'admin/reports/subject-assessment-comparison', color:'#d946ef', bg:'#fae8ff', filters:'Year · Term · Class · Subject' },
      // ASSESSMENT
      { id:'exam-class-summary', label:'Assessment Performance Report', icon:'clipboard-check', category:'Assessment', desc:'Per-assessment class performance summary', route:'admin/reports/assessment', color:'#ea580c', bg:'#fff7ed', filters:'Year · Term · Class · Assessment' },
      { id:'assessment-summary', label:'Assessment Summary', icon:'clipboard-list', category:'Assessment', desc:'Statistics for many assessments across classes', route:'admin/reports/assessment-summary', color:'#f97316', bg:'#fff7ed', filters:'Year · Term · Classes · Subjects · Assessments' },
      { id:'assessment-completion', label:'Assessment Completion Report', icon:'check-check', category:'Assessment', desc:'Completion %, missing marks and status per assessment', route:'admin/reports/assessment-completion', color:'#fb923c', bg:'#fff7ed', filters:'Year · Term · Classes · Assessments' },
      { id:'missing-marks', label:'Missing Marks Report', icon:'list-checks', category:'Assessment', desc:'Missing / completion tracking across classes', route:'admin/reports/marks', color:'#dc2626', bg:'#fef2f2', filters:'Year · Term · Classes · Subjects · Assessments' },
      // SCHOOL
      { id:'school-performance', label:'School Performance Summary', icon:'building-2', category:'School', desc:'School-wide averages, pass rates and class comparison', route:'admin/reports/school', color:'#16a34a', bg:'#f0fdf4', filters:'Year · Term · Classes · Subjects' },
      { id:'term-performance-summary', label:'Term Performance Summary', icon:'calendar-range', category:'School', desc:'Per-class performance summary for one term', route:'admin/reports/term-performance-summary', color:'#059669', bg:'#ecfdf5', filters:'Year · Term · Classes' },
      { id:'academic-year-performance', label:'Academic Year Performance', icon:'calendar', category:'School', desc:'Annual performance across all terms of the year', route:'admin/reports/academic-year-performance', color:'#10b981', bg:'#ecfdf5', filters:'Year · All Terms · Classes' },
      // TEACHER
      { id:'teacher-performance', label:'Teacher Performance Report', icon:'users', category:'Teacher', desc:'Teacher workload and learner outcomes', route:'admin/reports/teacher', color:'#0891b2', bg:'#ecfeff', filters:'Year · Term · Teacher · Classes' },
      { id:'teacher-assessment-submission', label:'Teacher Submission Report', icon:'send', category:'Teacher', desc:'Assessment submission and approval status per teacher', route:'admin/reports/teacher-assessment-submission', color:'#06b6d4', bg:'#ecfeff', filters:'Year · Term · Teacher · Classes' }
    ];
  },

  buildFilename(data, orientation){
    const safe = (v) => String(v||'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||'Report';
    const title = safe(data.title);
    const parts=['RMS-MIS', title];
    if (data.cls?.name) parts.push(safe(data.cls.name));
    if (data.subject?.name) parts.push(safe(data.subject.name));
    if (data.learner?.full_name) parts.push(safe(data.learner.full_name));
    if (data.year?.name) parts.push(safe(data.year.name));
    if (data.term?.name) parts.push(safe(data.term.name));
    parts.push(orientation==='landscape'?'A4-Landscape':'A4-Portrait');
    return parts.join('_')+'.pdf';
  },

  buildPdfDocument(html, orientation = 'portrait'){
    const base = new URL('.', window.location.href).href;
    const css = [
      'css/styles.css',
      'css/report-card.css',
      'css/student-report-card.css?v=20260924-9',
      'css/report-wizard.css'
    ].map(path => `<link rel="stylesheet" href="${new URL(path, base).href}">`).join('');
    const landscape = orientation === 'landscape';
    const page = landscape ? 'A4 landscape' : 'A4 portrait';
    const width = landscape ? '297mm' : '210mm';
    const height = landscape ? '210mm' : '297mm';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RMS-MIS Report</title>${css}<style>@page{size:${page};margin:0}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.rms-a4-container,.rc-paper{box-sizing:border-box;width:${width}!important;height:${height}!important;min-height:0!important;max-width:none!important;margin:0!important;padding:10mm!important;overflow:hidden!important;page-break-after:avoid!important;break-after:avoid-page!important}.rms-a4-container.rms-a4-landscape,.rc-paper.rms-a4-landscape{width:297mm!important;height:210mm!important}.rms-a4-container.rms-report-document{height:auto!important;min-height:0!important;overflow:visible!important;page-break-after:auto!important;break-after:auto!important}.rms-page-break{height:0!important;margin:0!important;padding:0!important;page-break-after:always!important;break-after:page!important}</style></head><body>${html}</body></html>`;
  },

  openPreviewDocument(html, title, orientation = 'portrait'){
    const w=window.open('', '_blank');
    if (!w){ Utils.toast('Allow pop-ups to open the preview','error'); return; }
    const documentHtml=this.buildPdfDocument(html, orientation).replace('<title>RMS-MIS Report</title>', `<title>${Utils.escapeHtml(title || 'RMS-MIS Report Preview')}</title>`);
    w.document.write(documentHtml);
    w.document.close();
  },

  printDocument(html, title, filename, orientation){
    const w = window.open('', '_blank');
    if (!w){ Utils.toast('Allow pop-ups to print','error'); return; }
    const pageRule = orientation==='landscape' ? 'size: A4 landscape; margin: 0;' : 'size: A4 portrait; margin: 0;';
    const base = new URL('.', window.location.href).href;
    const cssLinks = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="${new URL('css/styles.css', base).href}"><link rel="stylesheet" href="${new URL('css/report-card.css', base).href}"><link rel="stylesheet" href="${new URL('css/student-report-card.css?v=20260924-9', base).href}"><link rel="stylesheet" href="${new URL('css/report-wizard.css', base).href}">`;
    const printCss = `<style>
      @page{${pageRule}}
      *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      html,body{margin:0 !important; padding:0 !important; background:#fff !important; font-family:'Poppins', Arial, Helvetica, sans-serif !important; font-size:10pt !important; color:#0f172a !important; line-height:1.45 !important; -webkit-font-smoothing:antialiased !important;}
      .rms-a4-container, .rc-paper{box-sizing:border-box !important; width:210mm !important; height:297mm !important; min-height:0 !important; max-width:none !important; box-shadow:none !important; border:1.2px solid #1e3a5f !important; margin:0 !important; background:#fff !important; padding:10mm !important; overflow:hidden !important; page-break-after:avoid !important; break-after:avoid-page !important;}
      .rms-a4-container.rms-a4-landscape, .rc-paper.rms-a4-landscape{width:297mm !important; height:210mm !important;}
      .rms-a4-container.rms-report-document{height:auto !important; min-height:0 !important; overflow:visible !important; page-break-after:auto !important; break-after:auto !important;}
      .rms-report-header, .rc-header{border-bottom:2px solid #1e3a5f !important; padding-bottom:7px !important; margin-bottom:8px !important;}
      table{width:100% !important; border-collapse:collapse !important; font-size:8.5pt !important; border:1.5px solid #1e3a5f !important;}
      th{background:#dbe7f2 !important; color:#1e3a5f !important; font-weight:800 !important; border:1px solid #1e3a5f !important; padding:5px 5px !important; text-transform:uppercase; font-size:8pt !important;}
      td{border:1px solid #1e3a5f !important; padding:4px 5px !important; color:#111827 !important;}
      tr{page-break-inside:avoid !important; break-inside:avoid !important;}
      thead{display:table-header-group !important;} tfoot{display:table-footer-group !important;}
      .rms-page-break{page-break-after:always !important; break-after:page !important;}
      .no-print, .report-preview-toolbar-flex, .rw-head, .rw-progress {display:none !important;}
      img{max-height:58px !important; object-fit:contain !important;}
    </style>`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${Utils.escapeHtml(title||filename||'Report')}</title>${cssLinks}${printCss}</head><body style="background:#fff">${html}<script>window.onload=function(){setTimeout(function(){var m=document.querySelectorAll('.rms-page-break');var total=Math.max(m.length+1,1);var n=document.querySelectorAll('.rms-page-num');var i=0;document.querySelectorAll('.rms-page-break').forEach(function(el){var p=el.previousElementSibling;var s=p&&p.querySelectorAll?p.querySelectorAll('.rms-page-num'):[];s.forEach(function(x){x.textContent=String(++i);});});document.querySelectorAll('.rms-total-pages').forEach(function(x){x.textContent=String(total);});window.focus();window.print();},750);};<\/script></body></html>`);
    w.document.close();
  },
  print(){
    const html = this.state.previewHtml || (document.getElementById('rw-report-container')? document.getElementById('rw-report-container').innerHTML : '');
    if (!html){ Utils.toast('Generate a report first','error'); return; }
    const orientation = this.state.previewOrientation || 'portrait';
    this.printDocument(html, 'RMS-MIS Report — Print (A4 '+orientation+')', this.state.previewFilename, orientation);
  },
  async downloadPDF(){
    let html = this.state.previewHtml;
    if (!html && typeof ReportWizard!=='undefined' && ReportWizard.state.previewHtml) html = ReportWizard.state.previewHtml;
    if (!html){ Utils.toast('Generate a report first','error'); return; }
    const orientation = this.state.previewOrientation || (ReportWizard? ReportWizard.state.previewOrientation : 'portrait') || 'portrait';
    const filename = this.state.previewFilename || (ReportWizard? ReportWizard.state.previewFilename : 'RMS-MIS_Report.pdf') || 'RMS-MIS_Report.pdf';
    const localPreview = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    try{
      if (localPreview) throw new Error('Local PDF endpoint unavailable');
      const pdfHtml = this.buildPdfDocument(html, orientation);
      const r=await fetch('/api/reports/pdf',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({html: pdfHtml, filename})});
      if (r.ok){ const b=await r.blob(); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); Utils.toast('PDF downloaded (server)','success'); return; }
      if (r.status !== 405) console.warn('[Reports] server PDF unavailable:', r.status);
    }catch(e){ console.warn('server pdf failed',e); }
    Utils.toast('In print dialog choose Save as PDF ('+filename+')','info');
    this.printDocument(html, filename, filename, orientation);
  },
  exportExcel(){
    if (typeof XLSX==='undefined'){ Utils.toast('Excel library not loaded','error'); return; }
    const c=document.getElementById('rw-report-container') || document.getElementById('rc-report-container');
    if(!c){ Utils.toast('Generate a report first','error'); return; }
    const t=c.querySelector('table'); if(!t){ Utils.toast('No table in report','error'); return; }
    const ws=XLSX.utils.table_to_sheet(t); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Report');
    const base=(this.state.previewFilename||'RMS-MIS_Report').replace(/\.pdf$/i,''); XLSX.writeFile(wb, base+'.xlsx'); Utils.toast('Excel exported','success');
  },

  async render(){
    return this.renderHub();
  },

  async renderHub(){
    setHeader('Report Center', 'Professional Academic Reporting — categories, dynamic filters, print-ready A4');
    const defs = this._hubDefs();
    const scopeBadge = (typeof Scope!=='undefined')? Scope.label() : 'Global';
    const scopeSub = (typeof Scope!=='undefined' && Scope.subLabel)? Scope.subLabel() : '';
    const catMeta = { Student:{icon:'user-round', color:'#2563eb'}, Class:{icon:'school', color:'var(--green-600)'}, Subject:{icon:'book-open', color:'#7c3aed'}, Assessment:{icon:'clipboard-check', color:'#ea580c'}, School:{icon:'building-2', color:'#16a34a'}, Teacher:{icon:'users', color:'#0891b2'} };
    const grouped = {};
    defs.forEach(d => { (grouped[d.category] = grouped[d.category] || []).push(d); });

    const sections = Object.keys(grouped).map(cat => {
      const meta = catMeta[cat] || { icon:'layout-grid', color:'#334155' };
      const cards = grouped[cat].map(d => `
        <div class="card rms-hub-card" style="border-top:3px solid ${d.color}">
          <div class="rms-hub-card-top">
            <div class="rms-hub-icon" style="background:${d.bg};color:${d.color}"><i data-lucide="${d.icon}" style="width:18px;height:18px"></i></div>
            <div class="rms-hub-title">${Utils.escapeHtml(d.label)}</div>
          </div>
          <div class="rms-hub-desc">${Utils.escapeHtml(d.desc)}</div>
          <div class="rms-hub-filters"><i data-lucide="sliders-horizontal" style="width:12px;height:12px"></i> Filters: ${Utils.escapeHtml(d.filters)}</div>
          <div class="rms-hub-actions">
            <button class="btn btn-primary btn-sm" onclick="ReportCenter.open('${d.id}')"><i data-lucide="sparkles"></i> Generate & Preview</button>
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.open('${d.id}')"><i data-lucide="printer"></i> Print / PDF / Excel</button>
          </div>
        </div>`).join('');
      return `
        <div class="rms-hub-section">
          <div class="rms-hub-cat">
            <i data-lucide="${meta.icon}" style="width:18px;height:18px"></i>
            <span>${Utils.escapeHtml(cat)} Reports</span>
            <span class="rms-hub-count">${grouped[cat].length}</span>
          </div>
          <div class="rms-hub-grid">${cards}</div>
        </div>`;
    }).join('');

    const hubHtml = `
      <div class="rw-head rms-hub-head">
        <div class="rw-head-icon"><i data-lucide="layout-grid" style="width:28px;height:28px"></i></div>
        <div><div class="rw-head-title">Report Center</div><div class="rw-head-sub">Academic Reporting · ${defs.length} report types · every report supports Generate, Preview, Print, PDF, Excel</div></div>
        <span class="rw-scope-badge"><i data-lucide="shield-check" style="width:12px;height:12px"></i> ${Utils.escapeHtml(scopeBadge)}${scopeSub?' · '+Utils.escapeHtml(scopeSub):''}</span>
      </div>
      ${sections}
      <div class="card" style="padding:14px 16px;background:var(--gray-50)">
        <h4 style="font-size:13px;font-weight:700;margin:0 0 6px"><i data-lucide="info" style="width:14px;height:14px;vertical-align:middle"></i> How it works</h4>
        <p class="text-sm text-muted" style="margin:0;line-height:1.6">Each report opens a guided wizard: <strong>Period → Class(es) → Students/Subjects/Assessments/Terms → Preview</strong>. Dependent filters keep options relevant. Education level is locked to your DOS scope (<strong>${Utils.escapeHtml(scopeBadge)}</strong>); the reporting engine re-validates subjects by class level and server RLS rejects cross-scope requests, so a Primary card can never contain Secondary subjects.</p>
      </div>`;
    setContent(hubHtml);
    if (typeof lucide!=='undefined') lucide.createIcons();
  },

  async open(reportType){
    if (typeof ReportWizard==='undefined'){
      Utils.toast('Report wizard not loaded','error');
      return;
    }
    await ReportWizard.open(reportType);
  },

  // Legacy compatibility stubs (delegates)
  getReportCategories(){ return typeof ReportWizard!=='undefined' ? Object.keys(ReportWizard.DEFS).map(k=> ({id:k, label: ReportWizard.DEFS[k].label})) : []; },
  async generate(){ if (typeof ReportWizard!=='undefined') return ReportWizard.generate(); },
  async preview(){ if (typeof ReportWizard!=='undefined') return ReportWizard.preview(); },
  closePreview(){ const el=document.getElementById('rw-preview')||document.getElementById('rc-preview-area'); if(el) el.innerHTML=''; },
  fullscreenPreview(){ const c=document.getElementById('rw-report-container'); if(!c){Utils.toast('Generate preview first','error');return;} if(c.requestFullscreen) c.requestFullscreen(); else Utils.toast('Fullscreen not supported','error'); },
  resetFilters(){ if (typeof ReportWizard!=='undefined'){ ReportWizard.state.classIds=[]; ReportWizard.state.studentIds=[]; ReportWizard.state.subjectIds=[]; ReportWizard.state.assessmentIds=[]; ReportWizard.state.termIds=[]; ReportWizard.renderShell(); } }
};

function renderReportCenter(){ return ReportCenter.render(); }
function renderReportHub(){ return ReportCenter.renderHub(); }
