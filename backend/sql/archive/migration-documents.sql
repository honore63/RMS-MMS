-- ============================================================
-- RMS Documents & Attachments
-- Run ONCE in the Supabase SQL Editor.
-- Creates a documents table + a public storage bucket so the
-- app can upload/download images, Excel, Word and PDF files.
-- ============================================================

-- 1. Documents metadata table
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  learner_id UUID REFERENCES public.learners(id) ON DELETE CASCADE,
  uploaded_by UUID,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_documents_all ON public.documents;
CREATE POLICY rms_documents_all ON public.documents FOR ALL USING (true) WITH CHECK (true);

-- 2. Public storage bucket named "documents"
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage object policies (uploads / downloads / deletes / updates)
DROP POLICY IF EXISTS rms_documents_select ON storage.objects;
DROP POLICY IF EXISTS rms_documents_insert ON storage.objects;
DROP POLICY IF EXISTS rms_documents_update ON storage.objects;
DROP POLICY IF EXISTS rms_documents_delete ON storage.objects;
CREATE POLICY rms_documents_select ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY rms_documents_insert ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY rms_documents_update ON storage.objects FOR UPDATE USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');
CREATE POLICY rms_documents_delete ON storage.objects FOR DELETE USING (bucket_id = 'documents');

-- 4. Permissions
GRANT ALL ON storage.objects TO anon, authenticated;
GRANT ALL ON storage.buckets TO anon, authenticated;

-- 5. Verification (expect the documents table + the bucket row)
SELECT id, title, file_name, file_type, file_size, learner_id, created_at FROM public.documents LIMIT 5;
SELECT id, name, public FROM storage.buckets WHERE id = 'documents';