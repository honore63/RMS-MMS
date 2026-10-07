-- Profile IDs in public.users are re-linked to auth.users IDs by database.sql.
-- Cascade those primary-key changes through notifications and every other
-- foreign key referencing users, preserving each FK's existing delete action.
DO $do$
DECLARE
  r RECORD;
  v_definition TEXT;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname, c.conrelid
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.users'::regclass
  LOOP
    v_definition := pg_get_constraintdef(r.oid);
    v_definition := regexp_replace(
      v_definition,
      ' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)',
      '',
      'i'
    );
    v_definition := regexp_replace(
      v_definition,
      'REFERENCES (public\.)?users\(id\)',
      'REFERENCES public.users(id) ON UPDATE CASCADE',
      'i'
    );
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
      r.conrelid::regclass, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',
      r.conrelid::regclass, r.conname, v_definition);
  END LOOP;
END $do$;
