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
 



-- ---------------------------------------------------------------------------
-- Helper: upsert a content_type row by primary key (code).
-- Columns updated on conflict:
--   - name           : allows label corrections without data loss
--   - revision_schema / translation_schema : allows schema evolution
--   - weblate_namespace : allows namespace refactoring
--   - updated_at     : reflects the change timestamp
-- created_at is intentionally NOT updated on conflict.
-- ---------------------------------------------------------------------------

INSERT INTO content_type (
    code,
    name,
    revision_schema,
    translation_schema,
    weblate_namespace
)
VALUES

-- -------------------------------------------------------------------------
-- USER_TYPE
-- Classifies the user / migrant profile type used in the migrants app.
-- Legacy table: user_types (id serial, user_type text, description text)
-- -------------------------------------------------------------------------
(
    'USER_TYPE',
    'User Type',
    -- revision_schema: no type-specific non-translatable fields yet.
    '{}'::jsonb,
    -- translation_schema: only core title/description columns are used.
    '{}'::jsonb,
    'user-types'
),

-- -------------------------------------------------------------------------
-- NEWS
-- News articles published by the PA for migrants.
-- Legacy table: news / news_i18n
-- -------------------------------------------------------------------------
(
    'NEWS',
    'News',
    -- revision_schema: publication_date, image_url, category_id are
    -- non-translatable and will live in data_extra.
    '{
      "type": "object",
      "properties": {
        "publication_date": { "type": "string", "format": "date" },
        "image_url":        { "type": "string"  },
        "category_id":      { "type": "integer" }
      }
    }'::jsonb,
    -- translation_schema: content/body is translatable via i18n_extra.
    '{
      "type": "object",
      "properties": {
        "content": { "type": "string" }
      }
    }'::jsonb,
    'news'
),

-- -------------------------------------------------------------------------
-- PROCESS
-- Administrative processes / procedures for migrants.
-- -------------------------------------------------------------------------
(
    'PROCESS',
    'Process',
    '{
      "type": "object",
      "properties": {
        "category_id": { "type": "integer" },
        "icon":        { "type": "string"  }
      }
    }'::jsonb,
    '{
      "type": "object",
      "properties": {
        "content": { "type": "string" }
      }
    }'::jsonb,
    'processes'
),

-- -------------------------------------------------------------------------
-- STEP
-- A single step inside a PROCESS.
-- -------------------------------------------------------------------------
(
    'STEP',
    'Step',
    '{
      "type": "object",
      "properties": {
        "sort_order":  { "type": "integer" },
        "is_optional": { "type": "boolean" }
      }
    }'::jsonb,
    '{
      "type": "object",
      "properties": {
        "content": { "type": "string" }
      }
    }'::jsonb,
    'steps'
),

-- -------------------------------------------------------------------------
-- CATEGORY
-- Content categories shared across NEWS, PROCESS, etc.
-- -------------------------------------------------------------------------
(
    'CATEGORY',
    'Category',
    '{
      "type": "object",
      "properties": {
        "icon":       { "type": "string" },
        "color":      { "type": "string" },
        "sort_order": { "type": "integer" }
      }
    }'::jsonb,
    '{}'::jsonb,
    'categories'
),

-- -------------------------------------------------------------------------
-- FAQ
-- Frequently asked questions.
-- -------------------------------------------------------------------------
(
    'FAQ',
    'FAQ',
    '{
      "type": "object",
      "properties": {
        "category_id": { "type": "integer" },
        "sort_order":  { "type": "integer" }
      }
    }'::jsonb,
    '{
      "type": "object",
      "properties": {
        "answer": { "type": "string" }
      }
    }'::jsonb,
    'faqs'
)

ON CONFLICT (code) DO UPDATE SET
    name               = EXCLUDED.name,
    revision_schema    = EXCLUDED.revision_schema,
    translation_schema = EXCLUDED.translation_schema,
    weblate_namespace  = EXCLUDED.weblate_namespace,
    updated_at         = NOW();

-- ---------------------------------------------------------------------------
-- Verification: list the seeded types so the DBA / CI log shows what changed.
-- ---------------------------------------------------------------------------
SELECT code, name, weblate_namespace, updated_at
FROM   content_type
ORDER  BY code;