const puppeteer = require('puppeteer');
const archiver = require('archiver');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const body = req.body || {};
    const items = body.items || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Missing items array in request body' });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="reports.zip"`);

    archive.pipe(res);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const html = it.html || '';
      const filename = (it.filename || `report_${i + 1}.pdf`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      archive.append(Buffer.from(pdf), { name: filename });
      await page.close();
    }

    await browser.close();
    await archive.finalize();
  } catch (err) {
    console.error('ZIP generation error', err && err.stack ? err.stack : err);
    if (!res.headersSent) res.status(500).json({ error: 'ZIP generation failed', detail: String(err && err.message ? err.message : err) });
  }
};
