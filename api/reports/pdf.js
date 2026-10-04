const puppeteer = require('puppeteer');

// Simple Vercel-style serverless handler that converts HTML -> PDF
module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const body = req.body || {};
    const html = body.html;
    const requestedFilename = body.filename || 'report.pdf';
    const filename = String(requestedFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!html) return res.status(400).json({ error: 'Missing html in request body' });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    let pdf;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(image => {
          if (image.complete) return Promise.resolve();
          return new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        }));
        const sections = Array.from(document.querySelectorAll('.rms-a4-container,.rc-paper'));
        if (!document.querySelector('.rms-page-break')) return;
        const total = Math.max(sections.length, 1);
        let pageNumber = 1;
        sections.forEach((section, index) => {
          if (index && section.previousElementSibling?.classList.contains('rms-page-break')) pageNumber += 1;
          section.querySelectorAll('.rms-page-num').forEach(node => { node.textContent = String(pageNumber); });
        });
        document.querySelectorAll('.rms-total-pages').forEach(node => { node.textContent = String(total); });
      });
      pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\"/g, '')}"`);
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF generation error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'PDF generation failed', detail: String(err && err.message ? err.message : err) });
  }
};
