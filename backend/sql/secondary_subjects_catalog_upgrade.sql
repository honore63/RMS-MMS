-- Ensure the full Secondary curriculum is present and correctly classified.
INSERT INTO public.subjects (name, code, status, level, education_level)
SELECT subject.name, subject.code, 'active', subject.level, subject.level
FROM (VALUES
  ('Mathematics', 'MATH', 'Both'),
  ('English', 'ENG', 'Both'),
  ('Kinyarwanda', 'KIN', 'Both'),
  ('French', 'FRE', 'Both'),
  ('Kiswahili', 'KISW', 'Secondary'),
  ('Physics', 'PHY', 'Secondary'),
  ('Chemistry', 'CHEM', 'Secondary'),
  ('Biology and Health Sciences', 'BIO', 'Secondary'),
  ('Geography and Environment', 'GEO', 'Secondary'),
  ('History and Citizenship', 'HIST', 'Secondary'),
  ('Entrepreneurship', 'ENT', 'Secondary'),
  ('ICT', 'ICT', 'Secondary'),
  ('Computer Science', 'CS', 'Secondary'),
  ('Economics', 'ECON', 'Secondary'),
  ('Psychology', 'PSY', 'Secondary'),
  ('Literature in English', 'LIT', 'Secondary'),
  ('General Studies and Communication Skills (GSCS)', 'GSCS', 'Secondary'),
  ('Subsidiary Mathematics', 'SUB_MATH', 'Secondary'),
  ('Religion and Ethics', 'REL_ETH', 'Secondary'),
  ('Religious Studies', 'REL_STU', 'Secondary'),
  ('Physical Education and Sports', 'PES', 'Secondary'),
  ('Music, Dance and Drama', 'MDD', 'Secondary'),
  ('Fine Arts and Crafts', 'FAC', 'Secondary'),
  ('Home Sciences', 'HS', 'Secondary'),
  ('Farming (Agriculture and Animal Husbandry)', 'FARM', 'Secondary')
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
      WHEN 'MATH' THEN 'Both'
      WHEN 'ENG' THEN 'Both'
      WHEN 'KIN' THEN 'Both'
      WHEN 'FRE' THEN 'Both'
      ELSE 'Secondary'
    END,
    education_level = CASE upper(btrim(code))
      WHEN 'MATH' THEN 'Both'
      WHEN 'ENG' THEN 'Both'
      WHEN 'KIN' THEN 'Both'
      WHEN 'FRE' THEN 'Both'
      ELSE 'Secondary'
    END
WHERE upper(btrim(code)) IN (
  'MATH', 'ENG', 'KIN', 'FRE', 'KISW', 'PHY', 'CHEM', 'BIO', 'GEO',
  'HIST', 'ENT', 'ICT', 'CS', 'ECON', 'PSY', 'LIT', 'GSCS', 'SUB_MATH',
  'REL_ETH', 'REL_STU', 'PES', 'MDD', 'FAC', 'HS', 'FARM'
);
