import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function canDosAccessLevel(scope: string | null, classLevel: string | null) {
  if (!scope || !classLevel) return false;
  const dosLevel = scope.trim().toUpperCase();
  const target = (classLevel || '').trim().toUpperCase();
  if (dosLevel === 'PRIMARY') return target === 'PRIMARY';
  if (dosLevel === 'SECONDARY') return target === 'SECONDARY' || target === 'LOWER SECONDARY' || target === 'UPPER SECONDARY';
  return dosLevel === 'ALL' || dosLevel === 'BOTH';
}

function generateTemporaryPassword() {
  const random = new Uint8Array(24);
  crypto.getRandomValues(random);
  return `Rms-${Array.from(random, value => value.toString(16).padStart(2, '0')).join('')}!`;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[rms-create-learner-account] Required Supabase secrets are not configured.');
    return respond(500, { error: 'Learner account provisioning is not configured.' });
  }

  let learnerId: string;
  let email: string;
  try {
    const body = await request.json();
    learnerId = typeof body.learner_id === 'string' ? body.learner_id : '';
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  } catch {
    return respond(400, { error: 'Request body must be valid JSON.' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(learnerId)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'Provide a valid learner ID and email address.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Sign in as DOS before creating a learner login.' });
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await caller.auth.getUser(authorization.slice('Bearer '.length));
  if (authError || !authData.user) return respond(401, { error: 'Your DOS session is invalid or expired.' });
  const { data: dos, error: dosError } = await service.from('users')
    .select('id,role,status,education_level').eq('id', authData.user.id).maybeSingle();
  if (dosError) {
    console.error('[rms-create-learner-account] DOS profile lookup failed:', dosError.message);
    return respond(500, { error: 'Could not verify DOS account permissions.' });
  }
  if (!dos || dos.role !== 'dos' || dos.status !== 'active') {
    return respond(403, { error: 'Only active DOS accounts can create learner logins.' });
  }

  const { data: learner, error: learnerError } = await service.from('learners')
    .select('id,full_name,learner_code,class_id,status')
    .eq('id', learnerId).maybeSingle();
  if (learnerError) {
    console.error('[rms-create-learner-account] Learner lookup failed:', learnerError.message);
    return respond(500, { error: 'Could not verify the learner record.' });
  }
  if (!learner || learner.status !== 'active' || !learner.class_id) {
    return respond(404, { error: 'Choose an active learner assigned to a class.' });
  }
  const { data: learnerClass, error: classError } = await service.from('classes')
    .select('education_level,level,name').eq('id', learner.class_id).maybeSingle();
  if (classError) {
    console.error('[rms-create-learner-account] Class lookup failed:', classError.message);
    return respond(500, { error: 'Could not verify the learner class.' });
  }
  const classLevel = learnerClass?.education_level || learnerClass?.level || learnerClass?.name || null;
  if (!canDosAccessLevel(dos.education_level, classLevel)) {
    return respond(403, { error: 'This learner is outside your education-level scope.' });
  }

  const { data: existingLink, error: linkError } = await service.from('users')
    .select('id').eq('learner_id', learner.id).maybeSingle();
  if (linkError) {
    console.error('[rms-create-learner-account] Existing link lookup failed:', linkError.message);
    return respond(500, { error: 'Could not verify whether the learner already has a login.' });
  }
  if (existingLink) return respond(409, { error: 'This learner already has a linked RMS login.' });

  const temporaryPassword = generateTemporaryPassword();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: learner.full_name, rms_account_type: 'learner' }
  });
  if (createError || !created.user) {
    if (createError) console.warn('[rms-create-learner-account] Auth user creation failed:', createError.message);
    return respond(createError?.message.toLowerCase().includes('already') ? 409 : 400, {
      error: createError?.message.toLowerCase().includes('already')
        ? 'An authentication account already uses this email.'
        : 'Could not create the learner authentication account. Check the email address and try again.'
    });
  }

  const { error: profileError } = await caller.rpc('rms_link_learner_account', {
    p_learner_id: learner.id,
    p_email: email
  });
  if (profileError) {
    const { error: rollbackError } = await service.auth.admin.deleteUser(created.user.id);
    if (rollbackError) console.error('[rms-create-learner-account] Failed to remove unlinked auth account:', rollbackError.message);
    console.warn('[rms-create-learner-account] Learner linking failed:', profileError.message);
    return respond(400, { error: profileError.message || 'Could not link the authentication account to the learner.' });
  }

  return respond(201, { email, temporary_password: temporaryPassword, learner_name: learner.full_name });
});
