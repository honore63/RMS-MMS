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
    return [
      { id:'student-card', label:'Student Report Card', icon:'file-badge', desc:'Per-learner card · batch prints one A4 per student', route:'admin/reports/cards', color:'var(--blue-600)', bg:'var(--blue-50)' },
      { id:'student-performance', label:'Student Performance', icon:'user-round-check', desc:'Detailed learner performance, comments and ranking', route:'admin/reports/student', color:'#2563eb', bg:'#eff6ff' },
      { id:'class-performance', label:'Class Report', icon:'school', desc:'Class averages, pass rates and rankings', route:'admin/reports/class', color:'var(--green-600)', bg:'var(--green-50)' },
      { id:'subject-performance', label:'Subject Report', icon:'book-open', desc:'Subject performance across learners', route:'admin/reports/subject', color:'#7c3aed', bg:'#f5f3ff' },
      { id:'exam-class-summary', label:'Assessment Report', icon:'clipboard-check', desc:'Per-assessment class summary', route:'admin/reports/assessment', color:'#ea580c', bg:'#fff7ed' },
      { id:'missing-marks', label:'Marks Report', icon:'list-checks', desc:'Missing marks / completion tracking', route:'admin/reports/marks', color:'#dc2626', bg:'#fef2f2' },
      { id:'teacher-performance', label:'Teacher Report', icon:'users', desc:'Teacher workload and learner outcomes', route:'admin/reports/teacher', color:'#0891b2', bg:'#ecfeff' },
      { id:'school-performance', label:'Performance / Analytics', icon:'bar-chart-3', desc:'School-wide analytics and trends', route:'admin/reports/school', color:'#16a34a', bg:'#f0fdf4' },
      { id:'grade-distribution', label:'Grade Distribution', icon:'pie-chart', desc:'Grade buckets across scope', route:'admin/reports/grades', color:'#9333ea', bg:'#faf5ff' }
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

  buildPdfDocument(html){
    const base = new URL('.', window.location.href).href;
    const css = [
      'css/styles.css',
      'css/report-card.css',
      'css/student-report-card.css',
      'css/report-wizard.css'
    ].map(path => `<link rel="stylesheet" href="${new URL(path, base).href}">`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RMS-MIS Report</title>${css}<style>html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${html}</body></html>`;
  },

  printDocument(html, title, filename, orientation){
    const w = window.open('', '_blank');
    if (!w){ Utils.toast('Allow pop-ups to print','error'); return; }
    const pageRule = orientation==='landscape' ? 'size: A4 landscape; margin: 10mm 11mm;' : 'size: A4 portrait; margin: 10mm 11mm;';
    const base = new URL('.', window.location.href).href;
    const cssLinks = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="${new URL('css/styles.css', base).href}"><link rel="stylesheet" href="${new URL('css/report-card.css', base).href}"><link rel="stylesheet" href="${new URL('css/student-report-card.css', base).href}"><link rel="stylesheet" href="${new URL('css/report-wizard.css', base).href}">`;
    const printCss = `<style>
      @page{${pageRule}}
      *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      html,body{margin:0 !important; padding:0 !important; background:#fff !important; font-family:'Poppins', Arial, Helvetica, sans-serif !important; font-size:10pt !important; color:#0f172a !important; line-height:1.45 !important; -webkit-font-smoothing:antialiased !important;}
      .rms-a4-container, .rc-paper{box-shadow:none !important; border:1.2px solid #1e3a5f !important; margin:0 auto !important; background:#fff !important; padding:9mm 10mm !important; width:210mm !important;}
      .rms-a4-container.rms-a4-landscape{width:297mm !important;}
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
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${Utils.escapeHtml(title||filename||'Report')}</title>${cssLinks}${printCss}</head><body style="background:#fff">${html}<script>window.onload=function(){setTimeout(function(){window.focus(); window.print();}, 750);};<\/script></body></html>`);
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
    try{
      const pdfHtml = this.buildPdfDocument(html);
      const r=await fetch('/api/reports/pdf',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({html: pdfHtml, filename})});
      if (r.ok){ const b=await r.blob(); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); Utils.toast('PDF downloaded (server)','success'); return; }
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
    setHeader('Report Center', 'Choose a report type — each has its own guided wizard');
    const defs = this._hubDefs();
    const scopeBadge = (typeof Scope!=='undefined')? Scope.label() : 'Global';
    const scopeSub = (typeof Scope!=='undefined' && Scope.subLabel)? Scope.subLabel() : '';
    const hubHtml = `
      <div class="rw-head" style="margin-bottom:18px">
        <div class="rw-head-icon"><i data-lucide="layout-grid" style="width:28px;height:28px"></i></div>
        <div><div class="rw-head-title">Report Center</div><div class="rw-head-sub">Professional Academic Reporting · each type is a separate wizard · scope enforced</div></div>
        <span class="rw-scope-badge"><i data-lucide="shield-check" style="width:12px;height:12px"></i> ${Utils.escapeHtml(scopeBadge)}${scopeSub?' · '+Utils.escapeHtml(scopeSub):''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:18px">
        ${defs.map(d=> `
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px;border-top:3px solid ${d.color}">
            <div style="width:36px;height:36px;border-radius:10px;background:${d.bg};color:${d.color};display:flex;align-items:center;justify-content:center"><i data-lucide="${d.icon}" style="width:18px;height:18px"></i></div>
            <div style="font-weight:800;color:var(--gray-800)">${Utils.escapeHtml(d.label)}</div>
            <div style="font-size:12px;color:var(--gray-500);min-height:34px">${Utils.escapeHtml(d.desc)}</div>
            <div style="margin-top:auto;display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="Router.go('${d.route}')"><i data-lucide="arrow-right"></i> Start wizard</button>
              <button class="btn btn-outline btn-sm" onclick="ReportCenter.open('${d.id}')"><i data-lucide="eye"></i> Open</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="card" style="padding:14px 16px;background:var(--gray-50)">
        <h4 style="font-size:13px;font-weight:700;margin:0 0 6px"><i data-lucide="info" style="width:14px;height:14px;vertical-align:middle"></i> How it works</h4>
        <p class="text-sm text-muted" style="margin:0;line-height:1.6">Each wizard is a guided multi-step flow: <strong>Period → Class(es) → Students/Subjects/Assessments/Terms → Preview → Generate</strong>. Selections are dependent — e.g., pick a class and only its students/subjects/assessments appear. Education level is locked to your DOS scope (<strong>${Utils.escapeHtml(scopeBadge)}</strong>); manipulating the URL or client state cannot bypass it — RLS rejects cross-scope requests.</p>
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
