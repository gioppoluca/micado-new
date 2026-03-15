SET search_path TO micado;


INSERT INTO languages (lang, iso_code, name, active, is_default, sort_order, voice_string, voice_active)
VALUES
  ('it', 'it',    'Italiano', true,  true,  10, NULL, false),
  ('en', 'en-US', 'English',  true,  false, 20, NULL, false)
ON CONFLICT (lang) DO NOTHING;


-- Seed: application settings
INSERT INTO app_settings (key, value, description) VALUES
  -- Bootstrap / public
  ('app_name',              'Micado',             'Application display name'),
  ('default_language',      'it',                 'Default UI language code (lang PK)'),
  ('pa_tenant',             'pa_frontoffice',     'Keycloak realm for the PA frontend'),
  ('migrant_tenant',        'migrants',           'Keycloak realm for the Migrant frontend'),
  ('migrant_domain_name',   'migrants.localhost', 'Public hostname of the Migrant frontend'),
  ('translationState',      '[{"value":"editing","translation":[{"lang":"it","state":"In modifica"},{"lang":"en","state":"Editing"}]},{"value":"translatable","translation":[{"lang":"it","state":"Traducibile"},{"lang":"en","state":"Translatable"}]},{"value":"translating","translation":[{"lang":"it","state":"In traduzione"},{"lang":"en","state":"Translating"}]},{"value":"translated","translation":[{"lang":"it","state":"Tradotto"},{"lang":"en","state":"Translated"}]}]', 'Translation workflow state options (JSON array)'),
  -- Survey settings
  ('internal_survey',       'false',              'Use internal survey (true) or external (false)'),
  ('survey_local',          '',                   'URL for the local survey'),
  ('survey_pa',             '',                   'URL for the PA survey'),
  ('survey_cso',            '',                   'URL for the CSO survey'),
  -- Helpdesk settings
  ('helpdesk_pa',           '',                   'Helpdesk URL for PA operators'),
  ('helpdesk_ngo',          '',                   'Helpdesk URL for NGO operators'),
  ('helpdesk_migrant',      '',                   'Helpdesk URL for migrants'),
  ('feedback_email',        '',                   'Support / feedback email address'),
  ('duration_of_new',       '7',                  'Number of days a content item is shown as new')
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
 
