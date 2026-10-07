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
        { id:'student-card', label:'Class Report Cards', icon:'file-badge', category:'Class Reports', desc:'Complete report cards for learners in your assigned classes', route:'teacher/reports', color:'#2563eb', bg:'#eff6ff', filters:'Year · Term · Class · Students' },
        { id:'student-performance', label:'Student Performance Report', icon:'user-round-check', category:'Class Reports', desc:'Learner academic performance and ranking', route:'teacher/reports', color:'#16a34a', bg:'#f0fdf4', filters:'Year · Term · Class · Student' },
        { id:'student-marks', label:'Student Marks Report', icon:'list-checks', category:'Class Reports', desc:'Assessment marks and totals for learners in assigned classes', route:'teacher/reports', color:'#0ea5e9', bg:'#e0f2fe', filters:'Year · Term · Class · Student' },
        { id:'class-performance', label:'Class Performance Summary', icon:'school', category:'Class Reports', desc:'Class averages, pass rates and ranked results', route:'teacher/reports', color:'#15803d', bg:'#f0fdf4', filters:'Year · Term · Class · Subjects' },
        { id:'class-ranking', label:'Class Position / Ranking', icon:'trophy', category:'Class Reports', desc:'Rank learners within an assigned class', route:'teacher/reports', color:'#ca8a04', bg:'#fefce8', filters:'Year · Term · Class' },
        { id:'class-marks-sheet', label:'Class Marks Summary', icon:'table-2', category:'Class Reports', desc:'Learner by assessment marks for an assigned class', route:'teacher/reports', color:'#65a30d', bg:'#f7fee7', filters:'Year · Term · Class · Subjects · Assessments' },
        { id:'grade-distribution', label:'Class Mark Distribution', icon:'pie-chart', category:'Class Reports', desc:'Grade distribution within assigned classes', route:'teacher/reports', color:'#9333ea', bg:'#faf5ff', filters:'Year · Term · Classes · Subjects' },
        { id:'subject-performance', label:'Subject Performance Summary', icon:'book-open', category:'Teacher Reports', desc:'Overall subject and assessment performance', route:'teacher/reports', color:'#2563eb', bg:'#eff6ff', filters:'Year · Term · Class · Stream · Subject · Assessment Type · Assessment' },
        { id:'subject-marks-sheet', label:'Subject Marks Sheet', icon:'table-2', category:'Teacher Reports', desc:'Learner marks for a selected subject', route:'teacher/reports', color:'#a855f7', bg:'#f5f0ff', filters:'Year · Term · Class · Subject · Assessments' },
        { id:'subject-grade-distribution', label:'Subject Grade Distribution', icon:'pie-chart', category:'Teacher Reports', desc:'Grade distribution for a subject in an assigned class', route:'teacher/reports', color:'#c026d3', bg:'#fdf4ff', filters:'Year · Term · Class · Subject' },
        { id:'subject-assessment-comparison', label:'Subject Assessment Comparison', icon:'git-compare', category:'Teacher Reports', desc:'Compare subject assessment results in an assigned class', route:'teacher/reports', color:'#d946ef', bg:'#fae8ff', filters:'Year · Term · Class · Subject' },
        { id:'exam-class-summary', label:'Assessment Performance Report', icon:'clipboard-check', category:'Teacher Reports', desc:'Assessment results and class performance', route:'teacher/reports', color:'#ea580c', bg:'#fff7ed', filters:'Year · Term · Class · Assessment' },
        { id:'assessment-summary', label:'Class Assessment Summary', icon:'clipboard-list', category:'Teacher Reports', desc:'Summary of assessments for assigned classes', route:'teacher/reports', color:'#f97316', bg:'#fff7ed', filters:'Year · Term · Classes · Subjects · Assessments' },
        { id:'assessment-completion', label:'Assessment Completion Report', icon:'check-check', category:'Teacher Reports', desc:'Completion and missing marks within assigned classes', route:'teacher/reports', color:'#fb923c', bg:'#fff7ed', filters:'Year · Term · Classes · Assessments' },
        { id:'missing-marks', label:'Missing Marks Report', icon:'list-checks', category:'Teacher Reports', desc:'Missing marks for assigned classes and subjects', route:'teacher/reports', color:'#dc2626', bg:'#fef2f2', filters:'Year · Term · Classes · Subjects · Assessments' },
        { id:'term-performance-summary', label:'Term Performance Summary', icon:'calendar-range', category:'Class Reports', desc:'Per-class performance summary for a selected term', route:'teacher/reports', color:'#0891b2', bg:'#ecfeff', filters:'Year · Term · Classes · Subjects' },
        { id:'academic-year-performance', label:'Academic Year Performance', icon:'calendar', category:'Class Reports', desc:'Annual performance across the terms of the selected year', route:'teacher/reports', color:'#0e7490', bg:'#ecfeff', filters:'Year · Terms · Classes · Subjects' },
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
    if (data.learner?.learner_code || data.learner?.full_name) parts.push(safe(data.learner.learner_code || data.learner.full_name));
    if (data.year?.name) parts.push(safe(data.year.name));
    if (data.term?.name) parts.push(safe(data.term.name));
    parts.push(orientation==='landscape'?'A4-Landscape':'A4-Portrait');
    return parts.join('_')+'.pdf';
  },

  buildPdfDocument(html, orientation = 'portrait'){
    const base = new URL('.', window.location.href).href;
    const css = [
      'css/styles.css?v=20261004-9',
      'css/report-card.css?v=20261006-9',
      'css/student-report-card.css?v=20261008-3',
      'css/report-wizard.css?v=20261006-2'
    ].map(path => `<link rel="stylesheet" href="${new URL(path, base).href}">`).join('');
    const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
    const landscape = orientation === 'landscape';
    const page = landscape ? 'A4 landscape' : 'A4 portrait';
    const width = landscape ? '297mm' : '210mm';
    const height = landscape ? '210mm' : '297mm';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RMS-MIS Report</title>${fonts}${css}<style>
      @page{size:${page};margin:0}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      html,body{width:100%;min-height:100%;height:auto!important;margin:0;padding:0;background:#fff;overflow-x:hidden!important;overflow-y:auto!important}
      body{font-family:'Poppins',Arial,Helvetica,sans-serif;color:#0f172a}
      body>*:not(.report-tab-toolbar){max-height:none!important;overflow:visible!important}
      .rms-a4-container,.rc-paper{width:${width}!important;max-width:none!important;height:auto!important;min-height:${height}!important;max-height:none!important;margin:0 auto!important;padding:10mm!important;overflow:visible!important;box-shadow:none!important;break-inside:auto!important;page-break-inside:auto!important;break-after:auto!important;page-break-after:auto!important}
      .rms-a4-container.rms-a4-landscape,.rc-paper.rms-a4-landscape{width:297mm!important;min-height:210mm!important}
      @media print{.rms-student-card-page{--src-view-scale:1!important;width:210mm!important;height:297mm!important;min-height:297mm!important;max-height:297mm!important;max-width:210mm!important;padding:0!important;overflow:hidden!important}.rms-student-card-page>.src-sheet{top:5mm!important;left:5mm!important;transform:scale(var(--src-fit-scale,1))!important}.rc-paper-fit{--rc-view-scale:1!important;width:210mm!important;height:297mm!important;min-height:297mm!important;max-height:297mm!important;padding:0!important;overflow:hidden!important}.rc-paper-fit .rc-fit-content{top:5mm!important;left:5mm!important;transform:scale(var(--rc-fit-scale,1))!important}}
      .rms-a4-container.rms-report-document{height:auto!important;min-height:0!important;overflow:visible!important;break-inside:auto!important;page-break-inside:auto!important}
      .rms-page-break{display:block!important;height:0!important;margin:0!important;padding:0!important;break-after:page!important;page-break-after:always!important}
      .rms-student-card-page{break-inside:avoid!important;page-break-inside:avoid!important}
      @media print{.rms-student-card-page{break-after:auto!important;page-break-after:auto!important}}
      @media screen{.rms-student-card-page:not(:last-child){margin-bottom:16px!important}}
      table{width:100%;border-collapse:collapse;break-inside:auto;page-break-inside:auto}
      thead{display:table-header-group}tfoot{display:table-footer-group}
      tr{break-inside:avoid;page-break-inside:avoid}
      img,svg{max-width:100%}
      .no-print,.report-preview-toolbar-flex,.rw-head,.rw-progress,button{display:none!important}
      @media print{body *{visibility:visible!important}}
    </style></head><body>${html}</body></html>`;
  },

  openPreviewDocument(html, title, orientation = 'portrait', filename = 'RMS-MIS_Report.pdf', previewWindow = null){
    const w=previewWindow || window.open('', '_blank');
    if (!w){ Utils.toast('Allow pop-ups to open the preview','error'); return; }
    const outputFilename = filename === 'RMS-MIS_Report.pdf'
      ? `RMS-MIS_${String(title || 'Report').replace(/^RMS-MIS\s*/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Report'}.pdf`
      : filename;
    const toolbar = `<nav class="report-tab-toolbar no-print" aria-label="Report actions">
      <strong>${Utils.escapeHtml(title || 'RMS-MIS Report')}</strong>
      <span>
        <button type="button" data-report-action="download">Download PDF</button>
        <button type="button" data-report-action="print">Print</button>
        <button type="button" data-report-action="close">Close</button>
      </span>
    </nav>`;
    const documentHtml=this.buildPdfDocument(`<main class="rms-full-report-preview">${html}</main>`, orientation)
      .replace('<title>RMS-MIS Report</title>', `<title>${Utils.escapeHtml(title || 'RMS-MIS Report Preview')}</title>`)
      .replace('</style>', `
      .rms-full-report-preview{width:100%;min-width:0;max-width:100%;overflow-x:hidden}
      .report-tab-toolbar{position:sticky;top:0;z-index:1000;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;background:#0f2e63;color:#fff;font:600 14px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .report-tab-toolbar span{display:flex;gap:8px;flex-wrap:wrap}
      .report-tab-toolbar button{display:inline-flex!important;border:1px solid rgba(255,255,255,.55);border-radius:6px;padding:8px 12px;background:#fff;color:#0f2e63;font-weight:700;cursor:pointer}
      @media(max-width:640px){.report-tab-toolbar{align-items:flex-start;flex-direction:column;padding:10px}.report-tab-toolbar span{width:100%}.report-tab-toolbar button{flex:1}}
      @media screen and (max-width:900px){.rms-full-report-preview .rms-a4-container,.rms-full-report-preview .rc-paper{width:210mm!important;max-width:210mm!important;min-height:297mm!important;margin:0 auto!important;padding:12mm!important;overflow:visible!important;box-shadow:none!important}.rms-full-report-preview .rms-student-card-page{width:calc(210mm * var(--src-view-scale,1))!important;max-width:calc(210mm * var(--src-view-scale,1))!important;height:calc(297mm * var(--src-view-scale,1))!important;min-height:calc(297mm * var(--src-view-scale,1))!important;max-height:calc(297mm * var(--src-view-scale,1))!important;padding:0!important;overflow:hidden!important}.rms-full-report-preview .rms-student-card-page>.src-sheet{top:calc(5mm * var(--src-view-scale,1))!important;left:calc(5mm * var(--src-view-scale,1))!important;transform:scale(calc(var(--src-fit-scale,1) * var(--src-view-scale,1)))!important}.rms-full-report-preview .rc-paper-fit{width:calc(210mm * var(--rc-view-scale,1))!important;max-width:calc(210mm * var(--rc-view-scale,1))!important;height:calc(297mm * var(--rc-view-scale,1))!important;min-height:calc(297mm * var(--rc-view-scale,1))!important;max-height:calc(297mm * var(--rc-view-scale,1))!important;padding:0!important;overflow:hidden!important}.rms-full-report-preview .rc-paper-fit .rc-fit-content{top:calc(5mm * var(--rc-view-scale,1))!important;left:calc(5mm * var(--rc-view-scale,1))!important;transform:scale(calc(var(--rc-fit-scale,1) * var(--rc-view-scale,1)))!important}.rms-full-report-preview .src-table{min-width:0!important}}
      @media print{.report-tab-toolbar{display:none!important}html,body{height:auto!important;overflow:visible!important}}
      @page{size:${orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'};margin:0}
      </style>`)
      .replace('<body>', `<body>${toolbar}`);
    w.document.write(documentHtml);
    w.document.close();
    const bindToolbar = () => {
      const buttons = w.document.querySelectorAll('[data-report-action]');
      buttons.forEach(button => button.addEventListener('click', () => {
        const action = button.dataset.reportAction;
        if (action === 'download') {
          const fallbackWindow = w.open('', '_blank');
          this.downloadPdfDocument(html, outputFilename, orientation, fallbackWindow);
        }
        else if (action === 'print') {
          w.focus();
          Promise.all([
            w.document.fonts?.ready || Promise.resolve(),
            ...Array.from(w.document.images).map(image => image.complete ? Promise.resolve() :
              new Promise(resolve => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }))
          ]).then(() => w.print());
        } else if (action === 'close') w.close();
      }));
    };
    if (w.document.readyState === 'complete') bindToolbar();
    else w.addEventListener('load', bindToolbar, { once: true });
    w.addEventListener('afterprint', () => w.focus());
    return w;
  },

  printDocument(html, title, filename, orientation){
    const w = window.open('', '_blank');
    if (!w){ Utils.toast('Allow pop-ups to print','error'); return; }
    const printDocument=this.buildPdfDocument(html, orientation).replace(
      '<title>RMS-MIS Report</title>',
      `<title>${Utils.escapeHtml(title||filename||'RMS-MIS Report')}</title>`
    ).replace('</body>', `<script>
      function numberReportPages(){
        const sections=Array.from(document.querySelectorAll('.rms-a4-container,.rc-paper'));
        if(!document.querySelector('.rms-page-break')) return;
        const total=Math.max(sections.length,1);
        let page=1;
        sections.forEach(function(section,index){
          if(index && section.previousElementSibling && section.previousElementSibling.classList.contains('rms-page-break')) page++;
          section.querySelectorAll('.rms-page-num').forEach(function(node){node.textContent=String(page);});
        });
        document.querySelectorAll('.rms-total-pages').forEach(function(node){node.textContent=String(total);});
      }
      window.addEventListener('load', async function(){
        if(document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(function(image){
          if(image.complete) return Promise.resolve();
          return new Promise(function(resolve){image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});});
        }));
        numberReportPages();
        setTimeout(function(){window.focus();window.print();},250);
      });
    <\/script></body>`);
    w.document.write(printDocument);
    w.document.close();
  },
  print(){
    const html = this.state.previewHtml || (document.getElementById('rw-report-container')? document.getElementById('rw-report-container').innerHTML : '');
    if (!html){ Utils.toast('Generate a report first','error'); return; }
    const orientation = this.state.previewOrientation || 'portrait';
    this.printDocument(html, 'RMS-MIS Report — Print (A4 '+orientation+')', this.state.previewFilename, orientation);
  },
  showPdfPrintFallback(html, filename, orientation, fallbackWindow){
    if (!fallbackWindow || fallbackWindow.closed) {
      Utils.toast('The PDF service is unavailable. Use the report Print button to print or save the complete report as PDF.', 'error');
      return;
    }
    const printDocument = this.buildPdfDocument(html, orientation)
      .replace('</style>', `
        .rms-pdf-fallback-actions{position:sticky;top:0;z-index:1000;display:flex;justify-content:center;gap:10px;padding:14px;background:#fff7ed;border-bottom:1px solid #fdba74;font:14px Arial,sans-serif}
        .rms-pdf-fallback-actions button{display:inline-flex!important;padding:9px 14px;border:0;border-radius:6px;background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer}
        .rms-pdf-fallback-message{align-self:center;color:#7c2d12}
        @media print{.rms-pdf-fallback-actions{display:none!important}}
      </style>`)
      .replace('<body>', `<body><nav class="rms-pdf-fallback-actions no-print"><span class="rms-pdf-fallback-message">Automatic PDF download is unavailable here. In the print dialog, choose “Save as PDF”.</span><button type="button" id="rms-pdf-print">Print / Save as PDF</button><button type="button" id="rms-pdf-close">Close</button></nav>`);
    fallbackWindow.document.open();
    fallbackWindow.document.write(printDocument);
    fallbackWindow.document.close();
    const printWhenReady = async () => {
      try {
        if (fallbackWindow.document.fonts?.ready) await fallbackWindow.document.fonts.ready;
        await Promise.all(Array.from(fallbackWindow.document.images).map(image => image.complete
          ? Promise.resolve()
          : new Promise(resolve => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            })));
      } catch (error) {
        console.warn('[Reports] Print fallback could not wait for all assets:', error);
      }
      if (!fallbackWindow.closed) {
        fallbackWindow.focus();
        fallbackWindow.print();
      }
    };
    const bindFallback = () => {
      fallbackWindow.document.getElementById('rms-pdf-print')?.addEventListener('click', printWhenReady);
      fallbackWindow.document.getElementById('rms-pdf-close')?.addEventListener('click', () => fallbackWindow.close());
      printWhenReady();
    };
    if (fallbackWindow.document.readyState === 'complete') bindFallback();
    else fallbackWindow.addEventListener('load', bindFallback, { once: true });
    Utils.toast(`PDF service unavailable. Printing the complete report; choose “Save as PDF” to download ${Utils.escapeHtml(filename)}.`, 'info');
  },
  async downloadPdfDocument(html, filename = 'RMS-MIS_Report.pdf', orientation = 'portrait', fallbackWindow = null){
    if (!html){ Utils.toast('Generate a report first','error'); return false; }
    if (!fallbackWindow) {
      fallbackWindow = window.open('', '_blank');
      if (fallbackWindow) {
        fallbackWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing RMS-MIS PDF</title></head><body style="font:16px Arial,sans-serif;padding:24px">Preparing your complete PDF download…</body></html>');
        fallbackWindow.document.close();
      }
    }
    try{
      const pdfHtml = this.buildPdfDocument(html, orientation);
      const r=await fetch('/api/reports/pdf',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({html: pdfHtml, filename})});
      if (!r.ok) {
        const detail = await r.text();
        throw new Error(`PDF service returned ${r.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
      }
      const blob = await r.blob();
      if (!blob.size) throw new Error('The PDF service returned an empty document.');
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      if (fallbackWindow && !fallbackWindow.closed) fallbackWindow.close();
      Utils.toast('Complete PDF downloaded','success');
      return true;
    }catch(error){
      console.error('[Reports] PDF download failed:', error);
      this.showPdfPrintFallback(html, filename, orientation, fallbackWindow);
      return false;
    }
  },
  async downloadPDF(){
    let html = this.state.previewHtml;
    const wizardHasPreview = typeof ReportWizard!=='undefined' && !!ReportWizard.state.previewHtml;
    if (wizardHasPreview) html = ReportWizard.state.previewHtml;
    if (!html){ Utils.toast('Generate a report first','error'); return; }
    const orientation = (wizardHasPreview ? ReportWizard.state.previewOrientation : this.state.previewOrientation) || 'portrait';
    const filename = (wizardHasPreview ? ReportWizard.state.previewFilename : this.state.previewFilename) || 'RMS-MIS_Report.pdf';
    return this.downloadPdfDocument(html, filename, orientation);
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
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.open('${d.id}')"><i data-lucide="printer"></i> Print / PDF</button>
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
        <div class="rw-head-icon"><i data-lucide="layout-grid" style="width:26px;height:26px"></i></div>
        <div class="rms-hub-head-main">
          <div class="rw-head-title">Report Center</div>
          <div class="rw-head-sub">Professional Academic Reporting — categories, dynamic filters, print-ready A4</div>
          <div class="rms-hub-stats">
            <span class="rms-hub-stat"><b>${defs.length}</b> report types</span>
            <span class="rms-hub-stat"><b>${Object.keys(grouped).length}</b> categories</span>
            <span class="rms-hub-stat"><b>A4</b> print-ready</span>
            <span class="rms-hub-stat"><b>PDF</b> export</span>
          </div>
        </div>
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
