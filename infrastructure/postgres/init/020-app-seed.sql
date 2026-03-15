SET search_path TO micado;


INSERT INTO languages (lang, iso_code, name, active, is_default, sort_order, voice_string, voice_active)
VALUES
  ('it', 'it',    'Italiano', true,  true,  10, NULL, false),
  ('en', 'en-US', 'English',  true,  false, 20, NULL, false)
ON CONFLICT (lang) DO NOTHING;


-- Seed: default public settings
INSERT INTO app_settings (key, value, description) VALUES
  ('public.app_name',    'Micado',  'Application display name'),
  ('public.default_lang', 'it',    'Default UI language code')
ON CONFLICT (key) DO NOTHING;

-- Seed flags
INSERT INTO features_flags (flag_key, enabled) VALUES
    ('CHATBOT',        false),
    ('APPOINTMENTS',   false),
    ('DOCUMENTS',      false),
    ('NOTIFICATIONS',  false)
ON CONFLICT (flag_key) DO NOTHING;
 
-- Seed Italian labels
INSERT INTO features_flags_i18n (flag_id, lang, label)
SELECT f.id, 'it', v.label
FROM (VALUES
    ('CHATBOT',       'Chatbot'),
    ('APPOINTMENTS',  'Appuntamenti'),
    ('DOCUMENTS',     'Documenti'),
    ('NOTIFICATIONS', 'Notifiche')
) AS v(flag_key, label)
JOIN features_flags f USING (flag_key)
ON CONFLICT (flag_id, lang) DO NOTHING;
 
-- Seed English labels
INSERT INTO features_flags_i18n (flag_id, lang, label)
SELECT f.id, 'en', v.label
FROM (VALUES
    ('CHATBOT',       'Chatbot'),
    ('APPOINTMENTS',  'Appointments'),
    ('DOCUMENTS',     'Documents'),
    ('NOTIFICATIONS', 'Notifications')
) AS v(flag_key, label)
JOIN features_flags f USING (flag_key)
ON CONFLICT (flag_id, lang) DO NOTHING;
 
