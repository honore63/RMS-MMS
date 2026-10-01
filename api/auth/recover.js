const crypto = require('crypto');

// RMS-MIS password recovery endpoint (on-screen temporary passwords).
// Same Vercel serverless conventions as api/reports/pdf.js. Uses only the
// service role (never exposed to the browser) for all database + Auth admin
// calls. Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY (anon key is public; used only to validate the caller's
// JWT on the 'complete' action).
//
// Actions (POST JSON { action, ... }):
//   issue    { email, credential } -> verifies email + teacher code (teachers)
//            or email + phone (DOS), rate-limits, sets a temporary password
//            via the Auth admin API, flags must_change_password with expiry.
//            Returns { tempPassword, expiresAt } on success.
//   complete {} + Authorization: Bearer <user JWT> -> clears the
//            must_change_password flag after the user sets a personal password.
//
// Nothing here is ever sent by email. Temporary passwords and credentials
// are never written to logs.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const TEMP_TTL_HOURS = 24; // configurable temporary-password lifetime
const MAX_ATTEMPTS = 5; // max failed verifications per window, per email
const WINDOW_MINUTES = 15;
const TEMP_LENGTH = 12;
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I

const GENERIC_FAIL = 'Verification failed. Check your details and try again.';

function svcHeaders(json) {
  const h = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function genTempPassword() {
  const bytes = crypto.randomBytes(TEMP_LENGTH);
  let out = '';
  for (let i = 0; i < TEMP_LENGTH; i++) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return out;
}

async function rest(path, options) {
  const r = await fetch(SUPABASE_URL + path, options);
  let data = null;
  try { data = await r.json(); } catch (e) { /* non-JSON ignored */ }
  return { status: r.status, ok: r.ok, data };
}

async function getAttempts(emailKey) {
  const { ok, data } = await rest('/rest/v1/password_recovery_attempts?email=eq.' + encodeURIComponent(emailKey) + '&select=*', { headers: svcHeaders(false) });
  if (!ok || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function recordAttempt(emailKey) {
  const row = await getAttempts(emailKey);
  const now = Date.now();
  if (!row) {
    await rest('/rest/v1/password_recovery_attempts', {
      method: 'POST', headers: Object.assign(svcHeaders(true), { Prefer: 'return=minimal' }),
      body: JSON.stringify({ email: emailKey, attempts: 1, window_start: new Date(now).toISOString() })
    });
    return;
  }
  const windowStart = new Date(row.window_start).getTime();
  const fresh = (now - windowStart) > WINDOW_MINUTES * 60 * 1000;
  await rest('/rest/v1/password_recovery_attempts?id=eq.' + row.id, {
    method: 'PATCH', headers: svcHeaders(true),
    body: JSON.stringify(fresh
      ? { attempts: 1, window_start: new Date(now).toISOString() }
      : { attempts: (row.attempts || 0) + 1 })
  });
}

async function clearAttempts(emailKey) {
  const row = await getAttempts(emailKey);
  if (row) {
    await rest('/rest/v1/password_recovery_attempts?id=eq.' + row.id, { method: 'DELETE', headers: svcHeaders(false) });
  }
}

function rateLimited(row) {
  if (!row) return false;
  if ((row.attempts || 0) < MAX_ATTEMPTS) return false;
  return (Date.now() - new Date(row.window_start).getTime()) <= WINDOW_MINUTES * 60 * 1000;
}

async function handleIssue(body, res) {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const credential = typeof body.credential === 'string' ? body.credential.trim() : '';
  if (!email || !credential) return res.status(400).json({ error: GENERIC_FAIL });
  const key = email.toLowerCase();

  const attemptRow = await getAttempts(key);
  if (rateLimited(attemptRow)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }

  // Look up the RMS account (service role bypasses RLS; nothing is exposed).
  const found = await rest('/rest/v1/users?email=ilike.' + encodeURIComponent(key) + '&select=id,email,role,status,phone', { headers: svcHeaders(false) });
  const user = found.ok && Array.isArray(found.data) && found.data[0] ? found.data[0] : null;
  let verified = false;
  if (user && user.status === 'active') {
    if (user.role === 'teacher') {
      const tr = await rest('/rest/v1/teachers?user_id=eq.' + user.id + '&select=teacher_code', { headers: svcHeaders(false) });
      const code = tr.ok && Array.isArray(tr.data) && tr.data[0] ? String(tr.data[0].teacher_code || '') : '';
      verified = code !== '' && code === credential;
    } else if (user.role === 'dos') {
      verified = !!user.phone && String(user.phone) === credential;
    }
  }
  if (!verified) {
    await recordAttempt(key);
    return res.status(400).json({ error: GENERIC_FAIL });
  }

  const temp = genTempPassword();
  const expiresAt = new Date(Date.now() + TEMP_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const updated = await rest('/auth/v1/admin/users/' + user.id, {
    method: 'PUT', headers: svcHeaders(true), body: JSON.stringify({ password: temp })
  });
  if (!updated.ok) {
    console.error('Recovery: auth admin update failed for user', user.id);
    return res.status(500).json({ error: 'Could not issue a temporary password right now. Please try again later.' });
  }
  await rest('/rest/v1/users?id=eq.' + user.id, {
    method: 'PATCH', headers: svcHeaders(true),
    body: JSON.stringify({
      must_change_password: true,
      temporary_password_hash: sha256(temp),
      password_reset_expires_at: expiresAt
    })
  });
  await clearAttempts(key);
  return res.status(200).json({ tempPassword: temp, expiresAt });
}

async function handleComplete(req, res) {
  const auth = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return res.status(401).json({ error: 'Not authenticated.' });
  const me = await rest('/auth/v1/user', { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + jwt } });
  if (!me.ok || !me.data || !me.data.id) return res.status(401).json({ error: 'Not authenticated.' });
  await rest('/rest/v1/users?id=eq.' + me.data.id, {
    method: 'PATCH', headers: svcHeaders(true),
    body: JSON.stringify({ must_change_password: false, temporary_password_hash: null, password_reset_expires_at: null })
  });
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Recovery endpoint misconfigured: missing env vars.');
      return res.status(500).json({ error: 'Recovery is temporarily unavailable. Please contact the school administrator.' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const body = req.body || {};
    if (body.action === 'complete') return handleComplete(req, res);
    if (body.action === 'issue' || (!body.action && body.email)) return handleIssue(body, res);
    return res.status(400).json({ error: GENERIC_FAIL });
  } catch (err) {
    console.error('Recovery endpoint error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Recovery is temporarily unavailable. Please try again later.' });
  }
};
