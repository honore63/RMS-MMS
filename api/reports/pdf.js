const puppeteer = require('puppeteer');

// Simple Vercel-style serverless handler that converts HTML -> PDF
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const body = req.body || {};
    const html = body.html;
    const filename = body.filename || 'report.pdf';
    if (!html) return res.status(400).json({ error: 'Missing html in request body' });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\"/g, '')}"`);
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('PDF generation error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'PDF generation failed', detail: String(err && err.message ? err.message : err) });
  }
};
