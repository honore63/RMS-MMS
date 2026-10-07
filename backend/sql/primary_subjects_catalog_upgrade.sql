-- Ensure the full Primary curriculum is present and correctly classified.
INSERT INTO public.subjects (name, code, status, level, education_level)
SELECT subject.name, subject.code, 'active', subject.level, subject.level
FROM (VALUES
  ('Mathematics', 'MATH', 'Both'),
  ('English', 'ENG', 'Both'),
  ('Kinyarwanda', 'KIN', 'Both'),
  ('French', 'FRE', 'Both'),
  ('Science and Elementary Technology', 'SET', 'Primary'),
  ('Social and Religious Studies', 'SRS', 'Primary'),
  ('Creative Arts', 'CA', 'Primary'),
  ('Physical Education', 'PE', 'Primary')
) AS subject(name, code, level)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subjects AS existing
  WHERE upper(btrim(existing.code)) = upper(subject.code)
     OR upper(btrim(existing.name)) = upper(subject.name)
)
ON CONFLICT DO NOTHING;

UPDATE public.subjects
SET status = 'active',
    level = CASE upper(btrim(code))
      WHEN 'SET' THEN 'Primary'
      WHEN 'SRS' THEN 'Primary'
      WHEN 'CA' THEN 'Primary'
      WHEN 'PE' THEN 'Primary'
      ELSE 'Both'
    END,
    education_level = CASE upper(btrim(code))
      WHEN 'SET' THEN 'Primary'
      WHEN 'SRS' THEN 'Primary'
      WHEN 'CA' THEN 'Primary'
      WHEN 'PE' THEN 'Primary'
      ELSE 'Both'
    END
WHERE upper(btrim(code)) IN ('MATH', 'ENG', 'KIN', 'FRE', 'SET', 'SRS', 'CA', 'PE');
