const SUPABASE_URL = 'https://ztlfidglxfwjpxkqfviy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0bGZpZGdseGZ3anB4a3Fmdml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODkwMTQsImV4cCI6MjEwMzg2NTAxNH0.DCh03-ooJBtNEetmvWHkzz-mOAaZwuJ6kOr_sNw369c';
const sbClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
if (!sbClient) {
  console.error('[RMS-MIS] Supabase client library is unavailable. The offline portal will remain accessible; sign-in and live data require a connection.');
}
window.sbClient = sbClient;
