SET search_path TO micado;


INSERT INTO languages (lang, iso_code, name, active, is_default, sort_order, voice_string, voice_active)
VALUES
  ('it', 'it',    'Italiano', true,  true,  10, NULL, false),
  ('en', 'en-US', 'English',  true,  false, 20, NULL, false)
ON CONFLICT (lang) DO NOTHING;