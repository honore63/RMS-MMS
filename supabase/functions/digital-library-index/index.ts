import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { indexResource, isSupportedResource, resourceFingerprint } from '../_shared/rms-ai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_RESOURCES = 3;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const RESOURCE_FIELDS = 'id,title,description,resource_type,class_name,subject_name,education_level,topic,unit,file_name,storage_path,mime_type,file_size,ai_enabled,uploaded_by';

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Use POST to index RMS resources.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse(401, { error: 'Sign in with an authorized RMS account, then try again.' });
  if (Number(request.headers.get('Content-Length') || 0) > 8 * 1024) {
    return jsonResponse(413, { error: 'The indexing request is too large.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !geminiApiKey) {
    console.error('[DigitalLibraryIndex] Required Edge Function secrets are not configured.');
    return jsonResponse(503, { error: 'RMS AI indexing is not configured yet. Please contact the school administrator.' });
  }

  let payload: { resourceIds?: unknown };
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 8 * 1024) {
      return jsonResponse(413, { error: 'The indexing request is too large.' });
    }
    payload = JSON.parse(body);
  } catch {
    return jsonResponse(400, { error: 'The indexing request is invalid.' });
  }
  const resourceIds = Array.isArray(payload.resourceIds)
    ? [...new Set(payload.resourceIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (!resourceIds.length || resourceIds.length > MAX_RESOURCES
    || resourceIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return jsonResponse(400, { error: `Select between 1 and ${MAX_RESOURCES} resources to index.` });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return jsonResponse(401, { error: 'Your session could not be verified. Sign in again and retry.' });
    }
    const { data: profile, error: profileError } = await supabase
      .from('users').select('role,status').eq('id', userResult.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.status !== 'active' || !['teacher', 'dos'].includes(profile.role)) {
      return jsonResponse(403, { error: 'Only active RMS teachers and DOS accounts can index library resources.' });
    }

    const { data: settings, error: settingsError } = await supabase
      .from('digital_library_settings').select('ai_enabled').eq('id', true).maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings?.ai_enabled) return jsonResponse(503, { error: 'The RMS AI Learning Assistant is currently disabled.' });

    const { data: resources, error: resourceError } = await supabase
      .from('digital_library_resources')
      .select(RESOURCE_FIELDS)
      .in('id', resourceIds)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .eq('is_published', true)
      .eq('ai_enabled', true);
    if (resourceError) throw resourceError;
    if (!resources?.length || resources.length !== resourceIds.length) {
      return jsonResponse(403, { error: 'One or more resources are not currently authorized for public RMS AI indexing.' });
    }
    if (profile.role === 'teacher' && resources.some(resource => resource.uploaded_by !== userResult.user.id)) {
      return jsonResponse(403, { error: 'Teachers can only request indexing for resources they uploaded.' });
    }
    if (resources.some(resource => !isSupportedResource(resource))) {
      return jsonResponse(415, { error: 'RMS AI indexing currently supports PDF, TXT, JPG, PNG, and WebP resources.' });
    }
    if (resources.reduce((total, resource) => total + Number(resource.file_size || 0), 0) > MAX_TOTAL_BYTES) {
      return jsonResponse(413, { error: 'The selected files are too large to index together. Select fewer or smaller resources.' });
    }

    const fingerprints = Object.fromEntries(resources.map(resource => [
      resource.id, resourceFingerprint(resource),
    ]));
    const { data: indexed, error: indexedError } = await admin.rpc('rms_library_ai_indexed_resources', {
      p_resource_ids: resourceIds,
      p_fingerprints: fingerprints,
    });
    if (indexedError) throw indexedError;
    const alreadyIndexed = new Set((indexed || []).map(String));
    const pending = resources.filter(resource => !alreadyIndexed.has(String(resource.id)));
    let actualBytes = 0;
    let chunksCreated = 0;
    for (const resource of pending) {
      const result = await indexResource(
        resource, supabase, admin, geminiApiKey, MAX_TOTAL_BYTES - actualBytes,
      );
      actualBytes += result.bytes;
      chunksCreated += result.chunks;
    }

    return jsonResponse(200, {
      indexed: resources.map(resource => resource.id),
      chunksCreated,
    });
  } catch (error) {
    console.error('[DigitalLibraryIndex] Index request failed:', error);
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'RMS AI could not index the selected resources.' });
  }
});
