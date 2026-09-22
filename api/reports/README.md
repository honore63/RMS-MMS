Server-side PDF endpoints

This folder provides two serverless endpoints used by the frontend to generate production-grade PDFs:

- `POST /api/reports/pdf` - accepts JSON { html, filename } and returns a PDF blob.
- `POST /api/reports/zip` - accepts JSON { items: [{ html, filename }, ...] } and returns a ZIP containing separate PDFs.

Dependencies

Install the required packages in the project root:

```bash
npm install puppeteer archiver
```

Deployment notes

- These endpoints require a Node server environment with Chromium available. On Vercel, ensure the function has sufficient memory and set `NPM_CONFIG_PRODUCTION=false` if needed.
- For AWS Lambda or other serverless platforms, consider using `puppeteer-core` + `chrome-aws-lambda` for smaller bundles.
- Generating many PDFs in one request can exceed function memory/time limits; prefer batching or background jobs for large classes.

Security

- Add authentication & RBAC checks to these endpoints before deploying to production. The current examples do not perform authentication — update to verify the requesting user (e.g., via cookies, JWT, or Supabase auth) and enforce role checks.

Performance

- Reuse a persistent browser instance if your platform supports it to reduce cold-start overhead.
- Limit concurrent PDF generation to avoid memory exhaustion.
