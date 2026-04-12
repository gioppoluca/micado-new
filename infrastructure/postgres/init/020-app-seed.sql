SET search_path TO micado;


-- -----------------------------------------------------------------------------
-- 1) LANGUAGES
-- Legacy source: languages
-- New target: languages
-- -----------------------------------------------------------------------------
INSERT INTO languages (
  lang, iso_code, name, active, is_default, sort_order, voice_string, voice_active
) VALUES
  ('en',    'en-us', 'english',    true,  true,  10, 'UK English Female', true),
  ('it',    'it',    'italiano',   true,  false, 20, 'Italian Female',    true),
  ('es',    'es',    'español',    true,  false, 30, 'Spanish Female',    true),
  ('de',    'de',    'deutsch',    true,  false, 40, 'Deutsch Female',    true),
  ('nl',    'nl',    'nederlands', true,  false, 50, 'Dutch Female',      true),
  ('fa_IR', 'fa-IR', 'Darii',      true,  false, 60, NULL,                false),
  ('ur',    'he',    'urdu',       true,  false, 70, NULL,                false),
  ('uk',    'uk',    'ukrainian',  true,  false, 80, NULL,                false),
  ('ru',    'ru',    'russian',    true,  false, 90, NULL,                false)
ON CONFLICT (lang) DO UPDATE
SET
  iso_code     = EXCLUDED.iso_code,
  name         = EXCLUDED.name,
  active       = EXCLUDED.active,
  is_default   = EXCLUDED.is_default,
  sort_order   = EXCLUDED.sort_order,
  voice_string = EXCLUDED.voice_string,
  voice_active = EXCLUDED.voice_active;



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
INSERT INTO features_flags (id, flag_key, enabled) VALUES
  (1,  'FEAT_DOCUMENTS',     true),
  (2,  'FEAT_GLOSSARY',      true),
  (3,  'FEAT_ASSISTANT',     true),
  (4,  'FEAT_PROCESSES',     true),
  (5,  'FEAT_TASKS',         true),
  (6,  'FEAT_EVENTS',        true),
  (7,  'FEAT_GEOPORTAL',     true),
  (8,  'FEAT_DEFAULT',       true),
  (9,  'FEAT_INFO',          true),
  (10, 'FEAT_MIGRANT_LOGIN', true)
ON CONFLICT (flag_key) DO NOTHING;


INSERT INTO features_flags_i18n (flag_id, lang, label) VALUES
  (1,  'it', 'Portafoglio documenti'),
  (1,  'en', 'Document wallet'),
  (2,  'en', 'Glossary'),
  (2,  'it', 'Glossario'),
  (3,  'en', 'Chatbot assistant'),
  (4,  'it', 'Gestione processi'),
  (4,  'en', 'Process management'),
  (5,  'it', 'Piano individuale integrazione'),
  (5,  'en', 'Individual integration plan'),
  (6,  'it', 'Gestione eventi'),
  (6,  'en', 'Event management'),
  (7,  'it', 'GeoPortale'),
  (7,  'en', 'GeoPortal'),
  (8,  'it', 'Funzionalità standard'),
  (8,  'en', 'Core features'),
  (9,  'it', 'Area notizie'),
  (9,  'en', 'Information portal'),
  (10, 'it', 'Il migrante può fare login'),
  (10, 'en', 'Migrant can login')
ON CONFLICT (flag_id, lang) DO UPDATE
SET label = EXCLUDED.label;

-- keep serial aligned
SELECT setval(
  pg_get_serial_sequence('features_flags', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM features_flags), 1),
  true
);





-- ---------------------------------------------------------------------------
-- content_type seed
--
-- CONVENTIONS
-- ---------------------------------------------------------------------------
-- revision_schema  → JSON Schema for data_extra (non-translatable fields).
--                    Only fields that are NOT title/description go here.
--                    Actor stamps (created_by/published_by) and status
--                    lifecycle are handled by content_revision itself.
--
-- translation_schema → JSON Schema for i18n_extra (extra translatable fields
--                    beyond the standard title + description columns).
--                    Empty object {} means only standard columns are used.
--
-- weblate_namespace → Weblate component slug; matches Gitea repo path.
--
-- ON CONFLICT behaviour:
--   - name, schemas, namespace are always updated (allows evolution).
--   - created_at is intentionally NOT updated.
-- ---------------------------------------------------------------------------

INSERT INTO content_type (
    code,
    name,
    revision_schema,
    translation_schema,
    weblate_namespace
)
VALUES

-- ---------------------------------------------------------------------------
-- USER_TYPE
-- Classifies the migrant profile type shown in the migrants frontend.
-- Legacy tables: user_types, user_types_translation
--
-- CORRECTION vs previous seed:
--   revision_schema was empty {}. The legacy table stores a base64-encoded
--   data URI (data:image/...) in the `icon` column. This is a non-translatable
--   binary blob embedded as text — it belongs in data_extra.
-- ---------------------------------------------------------------------------
(
    'USER_TYPE',
    'User Type',
    '{
      "type": "object",
      "properties": {
        "icon": {
          "type": "string",
          "description": "Base64 data URI of the icon image (data:image/png;base64,...). Stored as text in data_extra."
        }
      }
    }'::jsonb,
    -- translation_schema: standard title (user_type label) + description
    -- are sufficient. No i18n_extra fields needed.
    '{}'::jsonb,
    'user-types'
),

-- ---------------------------------------------------------------------------
-- NEWS (= legacy `information`)
-- News articles published by PA operators for migrants.
-- Legacy tables: information, information_translation
--
-- CORRECTIONS vs previous seed:
--   - Renamed conceptually from information → NEWS to match the UI label.
--   - `image_url` removed — did not exist in legacy `information` table.
--   - `link` (varchar 70), `publication_date` added — present in the legacy
--     table and non-translatable.
--   - `category_id` kept (FK to CATEGORY content_item).
--   - `username` and `realm` removed — already carried in content_revision
--     created_by actor stamp ({ sub, username, name, realm }).
-- ---------------------------------------------------------------------------
(
    'INFORMATION',
    'Information',
    '{
      "type": "object",
      "properties": {
        "link":             { "type": "string", "maxLength": 70, "description": "Optional external URL associated with this news item." },
        "category_id":      { "type": "string", "format": "uuid", "description": "FK to content_item.id of type CATEGORY." },
        "publication_date": { "type": "string", "format": "date", "description": "Date the article is considered published (display date)." }
      }
    }'::jsonb,
    -- translation_schema: title (= article headline) and description (= body)
    -- cover all translatable content. No i18n_extra needed.
    '{}'::jsonb,
    'news'
),

-- ---------------------------------------------------------------------------
-- PROCESS
-- Administrative procedures/processes that migrants must follow.
-- Legacy tables: process, process_translation
--
-- CORRECTIONS vs previous seed:
--   - `category_id` removed — the legacy `process` table has NO category column.
--   - `icon` removed — the legacy `process` table has NO icon column.
--     (Icons in the legacy system were on steps via the mixed_icons FK, not on
--     the process itself.)
--   - `link` and `publication_date` added — present in the legacy table.
--   - Relations to user_types and topics are expressed via content_item_relation,
--     not stored in data_extra.
-- ---------------------------------------------------------------------------
(
    'PROCESS',
    'Process',
    '{
      "type": "object",
      "properties": {
        "link":             { "type": "string", "maxLength": 70, "description": "Optional URL for an external resource about this process." },
        "publication_date": { "type": "string", "format": "date", "description": "Date the process becomes visible to migrants." }
      }
    }'::jsonb,
    -- translation_schema: title (= process name) + description cover all
    -- translatable fields. No i18n_extra needed.
    '{}'::jsonb,
    'processes'
),

-- ---------------------------------------------------------------------------
-- STEP
-- A single step within a PROCESS.
-- Legacy tables: step, step_translation
--
-- CORRECTIONS vs previous seed:
--   - `sort_order` and `is_optional` kept (were already in seed).
--   - `process_id` added — FK to parent PROCESS content_item (UUID in new arch).
--   - `cost`, `location_specific`, `location`, `location_lat`, `location_lon` added —
--     all present in the legacy `step` table.
--   - `step_icon_id` added — in legacy this is an INTEGER FK to the `mixed_icons`
--     table (NOT a base64 data URI). The icon registry will be migrated separately;
--     for now the FK value is preserved in data_extra.
--   - `link` added — the legacy `step` table has a `link` text column.
--   - Parent relation (PROCESS → STEP) is also expressed via content_item_relation
--     for graph traversal, but process_id is kept in data_extra for direct queries.
-- ---------------------------------------------------------------------------
(
    'STEP',
    'Step',
    '{
      "type": "object",
      "required": ["process_id"],
      "properties": {
        "process_id":        { "type": "string", "format": "uuid", "description": "FK to content_item.id of the parent PROCESS." },
        "sort_order":        { "type": "integer", "description": "Display order within the parent process." },
        "is_optional":       { "type": "boolean", "description": "Whether this step can be skipped by the migrant." },
        "cost":              { "type": "number", "description": "Monetary cost associated with this step (legacy: money type)." },
        "location_specific": { "type": "boolean", "description": "Whether this step applies only to a specific geographic location." },
        "location":          { "type": "string", "maxLength": 100, "description": "Human-readable location name if location_specific is true." },
        "location_lat":      { "type": "number", "description": "Latitude of the step location (WGS84)." },
        "location_lon":      { "type": "number", "description": "Longitude of the step location (WGS84)." },
        "step_icon_id":      { "type": "integer", "description": "FK to legacy mixed_icons.id. Preserved during migration; to be replaced by an asset reference." },
        "link":              { "type": "string", "description": "Optional URL associated with this step (e.g. booking page, form)." }
      }
    }'::jsonb,
    -- translation_schema: title (= step name) + description cover all
    -- translatable fields. No i18n_extra needed.
    '{}'::jsonb,
    'steps'
),

-- ---------------------------------------------------------------------------
-- CATEGORY
-- Unified category entity for both NEWS (information_category) and EVENT
-- content types. The two legacy tables (information_category, event_category)
-- are structurally identical; the `subtype` field in data_extra discriminates
-- which domain(s) a category belongs to.
--
-- Legacy tables: information_category, event_category (and their _translation
-- counterparts). Both share: icon (data:image text), link_integration_plan
-- (boolean), published (boolean).
--
-- Decision: single CATEGORY code, subtype in data_extra.
--   Subtype values: "information" | "event" | "both"
--   This avoids duplicating the category management UI and the weblate
--   component while still allowing filtered queries per domain.
-- ---------------------------------------------------------------------------
(
    'CATEGORY',
    'Category',
    '{
      "type": "object",
      "required": ["subtype"],
      "properties": {
        "subtype": {
          "type": "string",
          "enum": ["information", "event", "both"],
          "description": "Which content domain(s) use this category. Maps to legacy information_category (information), event_category (event), or shared (both)."
        },
        "icon": {
          "type": "string",
          "description": "Base64 data URI of the category icon (data:image/png;base64,...). Stored as text in data_extra."
        },
        "link_integration_plan": {
          "type": "boolean",
          "description": "Whether this category is linked to the individual integration plan feature (legacy: link_integration_plan column)."
        },
        "sort_order": {
          "type": "integer",
          "description": "Display order in category lists."
        }
      }
    }'::jsonb,
    -- translation_schema: category name maps to the standard `title` column.
    -- No description or extra translatable fields in the legacy tables.
    '{}'::jsonb,
    'categories'
),

-- ---------------------------------------------------------------------------
-- GLOSSARY (= legacy `glossary`)
-- Dictionary of terms with definitions, published by PA for migrants.
-- Legacy tables: glossary, glossary_translation
--
-- NOTE: The legacy seed had this entry as FAQ, which was architecturally
-- incorrect — the legacy table is named glossary and contains term/definition
-- pairs, not question/answer pairs. Renamed to GLOSSARY for fidelity.
-- If a separate FAQ content type is needed in future it can be added
-- independently with its own weblate_namespace.
--
-- The `username` and `realm` fields are already carried by the
-- content_revision created_by actor stamp and are not duplicated here.
-- ---------------------------------------------------------------------------
(
    'GLOSSARY',
    'Glossary',
    '{
      "type": "object",
      "properties": {
        "publication_date": { "type": "string", "format": "date", "description": "Date the glossary term becomes publicly visible." }
      }
    }'::jsonb,
    -- translation_schema: title (= term) + description (= definition).
    -- No i18n_extra fields needed.
    '{}'::jsonb,
    'glossary'
),

-- ---------------------------------------------------------------------------
-- TOPIC
-- Thematic topics used to tag PROCESS and NEWS items.
-- Legacy tables: topic, topic_translation
--
-- The `father` column in the legacy table implements a self-referential
-- hierarchy (topic → parent topic). In the new system the parent FK is
-- preserved in data_extra for direct queries; the hierarchical relation is
-- also expressible via content_item_relation for graph traversal.
--
-- The icon field stores a base64 data URI (same pattern as USER_TYPE and
-- CATEGORY — confirmed by the commented-out postgresql annotation in the
-- legacy model referencing `dataType: 'text'`).
-- ---------------------------------------------------------------------------
(
    'TOPIC',
    'Topic',
    '{
      "type": "object",
      "properties": {
        "icon": {
          "type": "string",
          "description": "Base64 data URI of the topic icon (data:image/png;base64,...)."
        },
        "parent_topic_id": {
          "type": "string",
          "format": "uuid",
          "description": "FK to content_item.id of the parent TOPIC (maps to legacy `father` integer FK). Null for root topics."
        }
      }
    }'::jsonb,
    -- translation_schema: title (= topic name) + description cover the
    -- two translatable fields in the legacy topic_translation table.
    '{}'::jsonb,
    'topics'
),

-- ---------------------------------------------------------------------------
-- EVENT
-- Events published by PA/NGO operators for migrants.
-- Legacy tables: event, event_translation
--
-- The `category` column in legacy references event_category, which is now
-- the unified CATEGORY content type (subtype = "event").
-- `cost` in legacy is a text column (not numeric) — preserved as string.
-- `username` and `realm` removed — already in content_revision created_by
-- actor stamp. Relations to event_tags are handled via content_item_relation
-- (per architectural decision). Relations to user_types and topics are also
-- via content_item_relation.
-- ---------------------------------------------------------------------------
(
    'EVENT',
    'Event',
    '{
      "type": "object",
      "properties": {
        "category_id":      { "type": "string", "format": "uuid", "description": "FK to content_item.id of type CATEGORY (subtype=event)." },
        "start_date":       { "type": "string", "format": "date-time", "description": "Event start datetime (ISO 8601, stored as timestamptz in legacy)." },
        "end_date":         { "type": "string", "format": "date-time", "description": "Event end datetime (ISO 8601)." },
        "location":         { "type": "string", "description": "Human-readable venue or address of the event." },
        "cost":             { "type": "string", "description": "Cost description as free text (legacy: text column, not numeric)." },
        "publication_date": { "type": "string", "format": "date", "description": "Date the event becomes visible to migrants." }
      }
    }'::jsonb,
    -- translation_schema: title (= event name) + description cover all
    -- translatable fields in the legacy event_translation table.
    '{}'::jsonb,
    'events'
),

-- ---------------------------------------------------------------------------
-- DOCUMENT_TYPE
-- Types of official documents that migrants must obtain or present.
-- Legacy tables: document_type, document_type_translation,
--               document_type_picture, document_type_validator.
--
-- ── Pictures ─────────────────────────────────────────────────────────────────
-- Document images are stored as an ordered array in data_extra.pictures[].
-- Each picture entry has a stable UUID generated by the facade on first save,
-- a base64 data URI, and a sort order.  Pictures have NO translatable content
-- of their own — they are pure binary assets.
--
-- Annotated regions on each picture are PICTURE_HOTSPOT content_items linked
-- via content_item_relation (relation_type='hotspot').  The picture reference
-- and pixel coordinates live in relation_extra, NOT in the hotspot's data_extra,
-- because position is contextual to a specific picture.
--
-- ── Validators ───────────────────────────────────────────────────────────────
-- Which tenants/NGOs can validate this document is expressed via
-- content_item_relation (relation_type='validator', child = TENANT content_item).
-- The `validable` boolean in data_extra is the master switch; if false the
-- validator relations are ignored by the frontend.
-- ---------------------------------------------------------------------------
(
    'DOCUMENT_TYPE',
    'Document Type',
    '{
      "type": "object",
      "required": ["validable"],
      "properties": {
        "icon": {
          "type": "string",
          "description": "Base64 data URI of the document type icon (data:image/png;base64,...)."
        },
        "issuer": {
          "type": "string",
          "maxLength": 20,
          "description": "Issuing authority code or short label (e.g. MOIT, EU)."
        },
        "model_template": {
          "type": "string",
          "description": "Document template reference (maps to legacy model text column)."
        },
        "validable": {
          "type": "boolean",
          "description": "Master switch: whether this document type supports digital validation."
        },
        "validity_duration": {
          "type": "integer",
          "description": "Validity period in days. Null means the document does not expire."
        },
        "pictures": {
          "type": "array",
          "description": "Ordered array of document images. Each is a pure binary asset. Annotated regions are PICTURE_HOTSPOT content_items linked via content_item_relation.",
          "items": {
            "type": "object",
            "required": ["id", "image", "order"],
            "properties": {
              "id":    { "type": "string", "format": "uuid", "description": "Stable UUID generated by the facade on first insert. Referenced as picture_id in hotspot relation_extra." },
              "image": { "type": "string", "description": "Base64 data URI of the picture (data:image/png;base64,...)." },
              "order": { "type": "integer", "description": "1-based display order within the document type." }
            }
          }
        }
      }
    }'::jsonb,
    -- translation_schema: title (= document name) + description are the only
    -- translatable fields. Hotspot annotations are translated independently
    -- via PICTURE_HOTSPOT content_type (i18n_extra.message).
    '{}'::jsonb,
    'document-types'
),

-- ---------------------------------------------------------------------------
-- STEP_LINK
-- A directed transition between two STEPs within a PROCESS.
-- Legacy tables: step_link, step_link_translation
--
-- This entity is structurally unusual:
--   - It has NO title — only a `description` translatable field (the label
--     shown on the graph edge in the migrants frontend).
--   - Standard `title` column in content_revision_translation will be stored
--     as an empty string for this type; the real content is in `description`.
--   - `from_step` and `to_step` are UUID FKs to STEP content_items.
--   - `process_id` is an integer in legacy (FK to `process.id`); during
--     migration this is replaced by the UUID of the PROCESS content_item.
--
-- IMPORTANT for controller layer: when creating a STEP_LINK revision, the
-- facade must ensure both referenced STEPs belong to the same PROCESS.
-- ---------------------------------------------------------------------------
(
    'STEP_LINK',
    'Step Link',
    '{
      "type": "object",
      "required": ["from_step_id", "to_step_id", "process_id"],
      "properties": {
        "from_step_id": {
          "type": "string",
          "format": "uuid",
          "description": "FK to content_item.id of the source STEP."
        },
        "to_step_id": {
          "type": "string",
          "format": "uuid",
          "description": "FK to content_item.id of the destination STEP."
        },
        "process_id": {
          "type": "string",
          "format": "uuid",
          "description": "FK to content_item.id of the parent PROCESS. Both steps must belong to this process."
        }
      }
    }'::jsonb,
    -- translation_schema: no title — only description (the edge label text).
    -- The `description` standard column of content_revision_translation is used.
    -- title will be set to an empty string '' on insert by the facade.
    '{}'::jsonb,
    'step-links'
),

-- ---------------------------------------------------------------------------
-- PICTURE_HOTSPOT
-- An annotated region (pin) overlaid on a DOCUMENT_TYPE picture.
-- Legacy tables: picture_hotspot, picture_hotspot_translation
--
-- ── Relation to DOCUMENT_TYPE ────────────────────────────────────────────────
-- Each hotspot is a content_item linked to its parent DOCUMENT_TYPE via
-- content_item_relation (relation_type = 'hotspot').
--
-- Pixel coordinates and picture reference live in relation_extra — NOT in
-- data_extra — because position is contextual to a specific picture:
--   relation_extra = { "picture_id": "<uuid from data_extra.pictures[]>",
--                      "x": 120, "y": 340 }
--
-- The picture_id is the stable UUID assigned to each entry in
-- DOCUMENT_TYPE.data_extra.pictures[].id. This makes hotspot positioning
-- immune to picture reordering.
--
-- ── Translatable content ─────────────────────────────────────────────────────
-- title   (content_revision_translation.title)       → pin label, short
-- message (content_revision_translation.i18n_extra)  → tooltip/modal body, long
--
-- Both fields are exported to Weblate under the PICTURE_HOTSPOT namespace.
-- Weblate keys follow the {externalKey}:{fieldKey} pattern:
--   e.g. "42:title", "42:message"
--
-- ── data_extra ───────────────────────────────────────────────────────────────
-- Empty — all non-translatable positioning data lives in relation_extra.
-- ---------------------------------------------------------------------------
(
    'PICTURE_HOTSPOT',
    'Picture Hotspot',
    '{}'::jsonb,
    -- translation_schema: `message` is a long-form translatable field
    -- stored in i18n_extra alongside the standard `title` column.
    '{
      "type": "object",
      "properties": {
        "message": {
          "type": "string",
          "description": "Tooltip or modal body shown when the migrant taps the hotspot pin. Translatable via Weblate."
        }
      }
    }'::jsonb,
    'picture-hotspots'
),

-- ---------------------------------------------------------------------------
-- INTERVENTION_CATEGORY
-- Top-level grouping for social intervention types (NGO back-office).
-- Legacy tables: intervention_category, intervention_category_translation
--
-- The `external_id` field is a varchar(100) used to sync with an external
-- social services registry. It has no equivalent in the content_revision
-- standard columns and must be preserved in data_extra.
-- ---------------------------------------------------------------------------
(
    'INTERVENTION_CATEGORY',
    'Intervention Category',
    '{
      "type": "object",
      "properties": {
        "external_id": {
          "type": "string",
          "maxLength": 100,
          "description": "External registry identifier for sync with social services systems. Maps to legacy intervention_category.external_id."
        }
      }
    }'::jsonb,
    -- translation_schema: title (= category name). No description or
    -- i18n_extra in the legacy intervention_category_translation table.
    '{}'::jsonb,
    'intervention-categories'
),

-- ---------------------------------------------------------------------------
-- INTERVENTION_TYPE
-- A specific type of social intervention offered to migrants by NGOs.
-- Legacy tables: intervention_types, intervention_types_translation
--
-- `category_type` is a FK to INTERVENTION_CATEGORY.
-- In the new system this relation is also expressed via content_item_relation,
-- but the FK UUID is kept in data_extra for direct queries.
-- `external_id` serves the same external-sync purpose as on INTERVENTION_CATEGORY.
-- ---------------------------------------------------------------------------
(
    'INTERVENTION_TYPE',
    'Intervention Type',
    '{
      "type": "object",
      "required": ["intervention_category_id"],
      "properties": {
        "intervention_category_id": {
          "type": "string",
          "format": "uuid",
          "description": "FK to content_item.id of the parent INTERVENTION_CATEGORY (maps to legacy category_type integer FK)."
        },
        "external_id": {
          "type": "string",
          "maxLength": 100,
          "description": "External registry identifier for sync with social services systems. Maps to legacy intervention_types.external_id."
        }
      }
    }'::jsonb,
    -- translation_schema: title (= intervention_title) + description.
    -- No i18n_extra needed.
    '{}'::jsonb,
    'intervention-types'
),

-- ---------------------------------------------------------------------------
-- TENANT
-- An organisation (PA department, NGO, social service) that operates within
-- the Micado ecosystem. Tenants are linked to Keycloak realms for identity.
--
-- In the legacy system: `tenant` table (id, name, link, email, address, realm).
--
-- ── Role in DOCUMENT_TYPE validation ────────────────────────────────────────
-- When a DOCUMENT_TYPE is validable, specific tenants are authorised to
-- perform digital validation. This is expressed via content_item_relation:
--   relation_type = 'validator'
--   parent_item_id → DOCUMENT_TYPE content_item
--   child_item_id  → TENANT content_item
--
-- ── No translatable content ──────────────────────────────────────────────────
-- Tenant names, addresses and contact details are administrative data —
-- not editorial content for migrants. translation_schema is empty.
-- ---------------------------------------------------------------------------
(
    'TENANT',
    'Tenant',
    '{
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "maxLength": 50,
          "description": "Display name of the organisation (maps to legacy tenant.name)."
        },
        "email": {
          "type": "string",
          "maxLength": 100,
          "description": "Contact email of the organisation."
        },
        "address": {
          "type": "string",
          "maxLength": 100,
          "description": "Physical address of the organisation."
        },
        "link": {
          "type": "string",
          "maxLength": 70,
          "description": "Website or information URL for the organisation."
        },
        "realm": {
          "type": "string",
          "description": "Keycloak realm identifier that maps this tenant to an identity domain."
        }
      }
    }'::jsonb,
    '{}'::jsonb,
    NULL
)

ON CONFLICT (code) DO UPDATE SET
    name               = EXCLUDED.name,
    revision_schema    = EXCLUDED.revision_schema,
    translation_schema = EXCLUDED.translation_schema,
    weblate_namespace  = EXCLUDED.weblate_namespace,
    updated_at         = NOW();

-- ---------------------------------------------------------------------------
-- Verification query — shown in migration logs and CI output.
-- Columns: code, total schemas keys, has i18n_extra fields, namespace.
-- ---------------------------------------------------------------------------
SELECT
    code,
    name,
    weblate_namespace,
    jsonb_object_keys(revision_schema->'properties')    AS revision_field,
    updated_at
FROM   content_type,
       LATERAL (SELECT 1) AS x  -- unfold for readability
ORDER  BY code, revision_field;




-- ============================================================================
-- TOPIC
-- external_key riordinate:
-- 1 Administration (old 25)
-- 2 Cultural       (old 7)
-- 3 Finance        (old 13)
-- 4 House          (old 1)
-- 5 Health         (old 3)
-- 6 Education      (old 4)
-- 7 Employment     (old 2)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TOPIC 1 - Administration
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '1');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTkuODAwMDUgMTYuM0M5LjYwMDA1IDEyLjYgMTIuNiA5LjQgMTYuMiA5LjJDMTcuMyA5LjIgMTguMyA5LjQgMTkuMiA5LjhWNC42QzE5LjIgMy4yIDE4IDIgMTYuNiAySDYuMzAwMDVDNC45MDAwNSAyIDMuODAwMDUgMy4yIDMuODAwMDUgNC42VjE5LjRDMy44MDAwNSAyMC44IDUuMDAwMDUgMjIgNi40MDAwNSAyMkgxMy41QzExLjQgMjAuOSA5LjkwMDA1IDE4LjggOS44MDAwNSAxNi4zWiIgZmlsbD0iIzVDODFBMiIvPgo8cGF0aCBkPSJNNi41IDUuOTAwMDJIMTYuOCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxwYXRoIGQ9Ik02LjUgMTBIMTYuOCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxwYXRoIGQ9Ik02LjUgMTRIMTYuOCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CjxwYXRoIGQ9Ik0yMC45OTk5IDExLjdDMjAuODk5OSAxMS43IDIwLjg5OTkgMTEuNyAyMC44OTk5IDExLjhMMTYuNjk5OSAxNkwxNi41OTk5IDE2LjFDMTYuNDk5OSAxNi4xIDE2LjQ5OTkgMTYuMSAxNi40OTk5IDE2TDE1LjE5OTkgMTQuN0wxNS4wOTk5IDE0LjZDMTUuMDk5OSAxNC42IDE0Ljk5OTkgMTQuNiAxNC45OTk5IDE0LjdMMTMuOTk5OSAxNS41QzEzLjg5OTkgMTUuNiAxMy44OTk5IDE1LjcgMTMuOTk5OSAxNS44TDE1LjM5OTkgMTcuMkwxNi4yOTk5IDE4LjFMMTYuMzk5OSAxOC4yQzE2LjQ5OTkgMTguMiAxNi40OTk5IDE4LjIgMTYuNDk5OSAxOC4xTDIwLjA5OTkgMTQuNUwyMC43OTk5IDEzLjhMMjEuNzk5OSAxMi44QzIxLjg5OTkgMTIuNyAyMS44OTk5IDEyLjYgMjEuNzk5OSAxMi41TDIwLjk5OTkgMTEuN0MyMC45OTk5IDExLjcgMjEuMDk5OSAxMS43IDIwLjk5OTkgMTEuN1oiIGZpbGw9IiM1QzgxQTIiLz4KPHBhdGggZD0iTTIxLjIgMTUuNEwyMC42IDE2QzIwLjYgMTguMiAxOC44IDIwIDE2LjYgMjBDMTQuNCAyMCAxMi42IDE4LjIgMTIuNiAxNkMxMi42IDEzLjggMTQuNCAxMiAxNi42IDEyQzE3LjMgMTIgMTcuOSAxMi4yIDE4LjQgMTIuNEwxOS4xIDExLjdDMTguNCAxMS4zIDE3LjUgMTEgMTYuNiAxMUMxNS4zIDExIDE0IDExLjUgMTMuMSAxMi40QzEyLjIgMTMuMyAxMS43IDE0LjYgMTEuNyAxNS45QzExLjcgMTcuMiAxMi4yIDE4LjUgMTMuMSAxOS40QzE0IDIwLjMgMTUuMyAyMC44IDE2LjYgMjAuOEMxNy45IDIwLjggMTkuMiAyMC4zIDIwLjEgMTkuNEMyMSAxOC41IDIxLjUgMTcuMiAyMS41IDE1LjlDMjEuNSAxNS42IDIxLjUgMTUuNCAyMS40IDE1LjFMMjEuMiAxNS40WiIgZmlsbD0iIzVDODFBMiIvPgo8L3N2Zz4K'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '1';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Administration', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 2 - Cultural
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '2');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIxLjg3MjYgMTAuNDQ1OUMyMS4zMjQxIDEwLjUzNzMgMjAuNjg0MiAxMC41MzczIDIwLjEzNTcgMTAuNTM3M0MxOC45NDc0IDEwLjUzNzMgMTcuNjY3NiAxMC40NDU5IDE2LjM4NzggMTAuMjYzMUMxNS42NTY1IDEzLjQ2MjUgMTMuNzM2OSAxNi4wMjIxIDExLjA4NTkgMTYuOTM2MkMxMC43MjAyIDE3LjAyNzYgMTAuMzU0NiAxNy4xMTkgOS45ODg5MiAxNy4yMTA0QzkuODA2MSAxNy4yMTA0IDkuNzE0NjkgMTcuMjEwNCA5LjUzMTg2IDE3LjIxMDRDMTAuMjYzMiAxOS41ODcyIDExLjkwODYgMjEuNDE1NCAxNC4wMTExIDIxLjc4MTFDMTQuMjg1MyAyMS43ODExIDE0LjU1OTYgMjEuODcyNSAxNC44MzM4IDIxLjg3MjVDMTguMDMzMyAyMS44NzI1IDIxLjA0OTkgMTguNTgxNiAyMS43ODEyIDE0LjI4NTJDMjIuMDU1NCAxMy4wMDU0IDIyLjA1NTQgMTEuNjM0MyAyMS44NzI2IDEwLjQ0NTlaTTE3LjQ4NDggMjAuMjI3MUMxNy40ODQ4IDIwLjIyNzEgMTYuNzUzNSAxOS4wMzg3IDE1LjEwOCAxOC43NjQ1QzEzLjczNjkgMTguNDkwMiAxMy4yNzk4IDE4Ljc2NDUgMTIuMjc0MiAxOS4xMzAxQzEyLjI3NDIgMTkuMTMwMSAxMi4xODI4IDE2LjkzNjIgMTQuNjUxIDE2Ljg0NDhDMTYuOTM2MyAxNi44NDQ4IDE4LjMwNzUgMTguOTQ3MyAxNy40ODQ4IDIwLjIyNzFaTTE4LjEyNDcgMTUuNzQ3OEMxNy4zMDIgMTUuNzQ3OCAxNi42NjIxIDE1LjEwNzkgMTYuNjYyMSAxNC4yODUyQzE2LjY2MjEgMTMuNDYyNSAxNy4zMDIgMTIuODIyNiAxOC4xMjQ3IDEyLjgyMjZDMTguOTQ3NCAxMi44MjI2IDE5LjU4NzMgMTMuNDYyNSAxOS41ODczIDE0LjI4NTJDMTkuNTg3MyAxNS4xMDc5IDE4Ljk0NzQgMTUuNzQ3OCAxOC4xMjQ3IDE1Ljc0NzhaIiBmaWxsPSIjNUM4MUEyIi8+CjxwYXRoIGQ9Ik0xNC43NDI0IDUuNzgzODNDMTQuNTU5NiA0LjUwNDA1IDE0LjEwMjUgMy4yMjQyNyAxMy42NDU0IDIuMTI3MzJDMTMuMDk3IDIuMzEwMTUgMTIuNTQ4NSAyLjU4NDM4IDEyIDIuNzY3MjFDMTAuNzIwMiAzLjIyNDI3IDkuNDQwNDUgMy40OTg1MSA3Ljk3Nzg0IDMuNjgxMzRDNS45NjY3NiA0LjA0Njk5IDMuOTU1NjggNC4xMzg0IDIuMjE4ODMgMy44NjQxNkMxLjk0NDU5IDUuMTQzOTQgMS45NDQ1OSA2LjQyMzcyIDIuMTI3NDIgNy43MDM1QzIuODU4NzIgMTIuNDU3IDYuMjQxIDE1LjgzOTIgOS43MTQ2OCAxNS4yOTA4QzkuOTg4OTIgMTUuMjkwOCAxMC4yNjMyIDE1LjE5OTQgMTAuNTM3NCAxNS4xMDc5QzEzLjU1NCAxNC4xMDI0IDE1LjM4MjMgMTAuMDgwMiAxNC43NDI0IDUuNzgzODNaTTQuNTk1NTcgNy43OTQ5MkM0LjMyMTMzIDcuMDYzNjEgNC43NzgzOSA2LjE0OTQ4IDUuNTA5NjkgNS45NjY2NkM2LjI0MSA1LjY5MjQyIDcuMTU1MTIgNi4xNDk0OCA3LjMzNzk1IDYuODgwNzlDNy42MTIxOSA3LjYxMjA5IDcuMTU1MTIgOC41MjYyMiA2LjQyMzgyIDguNzA5MDRDNS42OTI1MiA5LjA3NDcgNC44Njk4IDguNjE3NjMgNC41OTU1NyA3Ljc5NDkyWk0xMC4yNjMyIDEyLjkxNEM3Ljk3Nzg0IDEzLjczNjggNi4wNTgxNyAxMi4wOTEzIDYuNDIzODIgMTAuNjI4N0M2LjQyMzgyIDEwLjYyODcgNy43MDM2IDExLjI2ODYgOS4yNTc2MiAxMS4wODU4QzEwLjA4MDMgMTAuOTk0NCAxMC45MDMxIDEwLjcyMDEgMTEuODE3MiAxMC4wODAyQzExLjcyNTggMTAuMDgwMiAxMi41NDg1IDEyLjA5MTMgMTAuMjYzMiAxMi45MTRaTTExLjM2MDEgOC4zNDMzOUMxMC42Mjg4IDguNjE3NjMgOS43MTQ2OCA4LjE2MDU3IDkuNTMxODYgNy40MjkyNkM5LjI1NzYyIDYuNjk3OTYgOS43MTQ2OCA1Ljc4MzgzIDEwLjQ0NiA1LjYwMTAxQzExLjE3NzMgNS4zMjY3NyAxMi4wOTE0IDUuNzgzODMgMTIuMjc0MiA2LjUxNTE0QzEyLjU0ODUgNy4yNDY0NCAxMi4wOTE0IDguMDY5MTUgMTEuMzYwMSA4LjM0MzM5WiIgZmlsbD0iIzVDODFBMiIvPgo8L3N2Zz4K'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '2';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Cultural', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_rezvision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '2'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '2'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 3 - Finance
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '3');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMiAyMkMxNy41MjI4IDIyIDIyIDE3LjUyMjggMjIgMTJDMjIgNi40NzcxNSAxNy41MjI4IDIgMTIgMkM2LjQ3NzE1IDIgMiA2LjQ3NzE1IDIgMTJDMiAxNy41MjI4IDYuNDc3MTUgMjIgMTIgMjJaTTE0LjA1MjQgMTYuMTE1OEMxMy42NjAyIDE2LjIxNTEgMTMuMTkyMSAxNi4yNjQ4IDEyLjY0ODIgMTYuMjY0OEMxMS45MjcxIDE2LjI2NDggMTEuMjc1NiAxNi4wODQ3IDEwLjY5MzcgMTUuNzI0N0MxMC4xMjQ1IDE1LjM1MjIgOS43MzIzMSAxNC43MzE0IDkuNTE3MjUgMTMuODYyM0gxNC4xODUyVjEyLjcyNjNIOS4yODk1NUM5LjI3NjkgMTIuNTQwMSA5LjI3MDU3IDEyLjM5MTEgOS4yNzA1NyAxMi4yNzkzVjExLjkyNTVWMTEuNzAySDE0LjE4NTJWMTAuNTY2SDkuNDIyMzhDOS40OTgyOCAxMC4wNjkzIDkuNjM3NDMgOS42NDcyMSA5LjgzOTgzIDkuMjk5NTdDMTAuMDU0OSA4LjkzOTUyIDEwLjMwNzkgOC42NDc3NSAxMC41OTg4IDguNDI0MjdDMTAuOTAyNSA4LjE4ODM3IDExLjIzMTQgOC4wMTQ1NSAxMS41ODU2IDcuOTAyODFDMTEuOTUyNCA3Ljc5MTA3IDEyLjMzMTkgNy43MzUyIDEyLjcyNDEgNy43MzUyQzEzLjE5MjEgNy43MzUyIDEzLjYxNTkgNy43OTEwNyAxMy45OTU0IDcuOTAyODFDMTQuMzg3NiA4LjAxNDU1IDE0Ljc3MzQgOC4xNjM1NCAxNS4xNTI5IDguMzQ5NzhMMTUuNjg0MiA2LjYzNjQyQzE1LjMxNzQgNi40NTAxOCAxNC44ODczIDYuMjg4NzggMTQuMzkzOSA2LjE1MjIxQzEzLjkxMzIgNi4wMTU2MyAxMy4yNjggNS45NDczNSAxMi40NTg0IDUuOTQ3MzVDMTAuOTQwNCA1Ljk0NzM1IDkuNzEzMzMgNi4zNTA4NiA4Ljc3NzIxIDcuMTU3ODdDNy44NDExIDcuOTY0ODkgNy4yNDY1NCA5LjEwMDkyIDYuOTkzNTMgMTAuNTY2SDUuNjg0MjNWMTEuNzAySDYuODQxNzNWMTEuOTgxNFYxMi4zMTY2QzYuODQxNzMgMTIuNDE1OSA2Ljg0ODA1IDEyLjU1MjUgNi44NjA3MSAxMi43MjYzSDUuNjg0MjNWMTMuODYyM0g3LjAzMTQ4QzcuMTgzMjkgMTQuNTU3NiA3LjQxNzMyIDE1LjE2NiA3LjczMzU3IDE1LjY4NzRDOC4wNjI0OCAxNi4yMDg5IDguNDYwOTYgMTYuNjQzNCA4LjkyOTAyIDE2Ljk5MTFDOS4zOTcwOCAxNy4zMzg3IDkuOTIyMDYgMTcuNjA1NiAxMC41MDQgMTcuNzkxOUMxMS4wOTg1IDE3Ljk2NTcgMTEuNzMxIDE4LjA1MjYgMTIuNDAxNSAxOC4wNTI2QzEzLjE4NTggMTguMDUyNiAxMy44MzEgMTcuOTkwNSAxNC4zMzcgMTcuODY2NEMxNC44NTU2IDE3Ljc0MjIgMTUuMjkyMSAxNy41OTMyIDE1LjY0NjMgMTcuNDE5NEwxNS4xNTI5IDE1LjcwNjFDMTQuODI0IDE1Ljg3OTkgMTQuNDU3MiAxNi4wMTY0IDE0LjA1MjQgMTYuMTE1OFoiIGZpbGw9IiM1QzgxQTIiLz4KPC9zdmc+Cg=='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '3';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Finance', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 4 - House
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '4');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE3LjA0ODggMTFWM0g3VjdIM1YyMUgxMVYxN0gxM1YyMUgyMVYxMUgxNy4wNDg4Wk03IDE5LjA0ODhINVYxNy4wNDg4SDdWMTkuMDQ4OFpNNyAxNS4wNDg4SDVWMTMuMDQ4OEg3VjE1LjA0ODhaTTcgMTFINVY5SDdWMTFaTTExIDE1LjA0ODhIOVYxMy4wNDg4SDExVjE1LjA0ODhaTTExIDExSDlWOUgxMVYxMVpNMTEgN0g5VjVIMTFWN1pNMTUuMDQ4OCAxNS4wNDg4SDEzLjA0ODhWMTMuMDQ4OEgxNS4wNDg4VjE1LjA0ODhaTTE1LjA0ODggMTFIMTMuMDQ4OFY5SDE1LjA0ODhWMTFaTTE1LjA0ODggN0gxMy4wNDg4VjVIMTUuMDQ4OFY3Wk0xOS4wNDg4IDE5LjA0ODhIMTcuMDQ4OFYxNy4wNDg4SDE5LjA0ODhWMTkuMDQ4OFpNMTkuMDQ4OCAxNS4wNDg4SDE3LjA0ODhWMTMuMDQ4OEgxOS4wNDg4VjE1LjA0ODhaIiBmaWxsPSIjNUM4MUEyIi8+Cjwvc3ZnPgo='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '4';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'House', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '4'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'it', 'Casa', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '4'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'de', 'aggiornato', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '4'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '4'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 5 - Health
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '5');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDIwLjczNjFDMTEuODA4IDIwLjczNjEgMTEuNjY0IDIwLjY4ODEgMTEuNTIgMjAuNTkyMUM3LjgyNDA1IDE4LjA0ODEgNS4xODQwNSAxNS40NTYxIDMuNjk2MDUgMTIuOTEyMUg2LjcyMDA1QzcuMDU2MDUgMTIuOTEyMSA3LjM0NDA1IDEyLjcyMDEgNy40NDAwNSAxMi40MzIxTDguMzA0MDUgMTAuMTc2MUw5Ljc0NDA1IDE1Ljg4ODFDOS44NDAwNSAxNi4yMjQxIDEwLjA4IDE2LjQ2NDEgMTAuNDE2IDE2LjQ2NDFDMTAuNDY0IDE2LjQ2NDEgMTAuNDY0IDE2LjQ2NDEgMTAuNTEyIDE2LjQ2NDFDMTAuOCAxNi40NjQxIDExLjA4OCAxNi4zMjAxIDExLjIzMiAxNi4wMzIxTDEyLjgxNiAxMi45MTIxSDE1Ljg4OEMxNi4wOCAxMi45MTIxIDE2LjMyIDEyLjgxNjEgMTYuNDY0IDEyLjY3MjFDMTYuNjA4IDEyLjUyODEgMTYuNzA0IDEyLjMzNjEgMTYuNzA0IDEyLjA5NjFDMTYuNzA0IDExLjY2NDEgMTYuMzIgMTEuMzI4MSAxNS44ODggMTEuMzI4MUgxMi4zMzZDMTIuMDQ4IDExLjMyODEgMTEuNzYgMTEuNDcyMSAxMS42MTYgMTEuNzYwMUwxMC43NTIgMTMuNDQwMUw5LjI2NDA1IDcuMzkyMDdDOS4xNjgwNSA3LjEwNDA2IDguOTI4MDUgNi44NjQwNyA4LjY0MDA1IDYuNzY4MDdDOC41OTIwNSA2Ljc2ODA3IDguNTQ0MDUgNi43NjgwNyA4LjQ5NjA1IDYuNzY4MDdDOC4xNjAwNSA2Ljc2ODA3IDcuODcyMDUgNi45NjAwNyA3Ljc3NjA1IDcuMjQ4MDdMNi4xOTIwNSAxMS4zMjgxSDIuOTI4MDVDMi4wNjQwNSA5LjEyMDA3IDIuMTYwMDUgNy4wNTYwNyAzLjIxNjA1IDUuNDcyMDZDNC4xNzYwNSA0LjAzMjA2IDUuODA4MDUgMy4yMTYwNiA3LjYzMjA1IDMuMjE2MDZDOS4xNjgwNSAzLjIxNjA2IDEwLjY1NiAzLjg0MDA2IDExLjg1NiA0Ljk0NDA2TDEyLjA0OCA1LjA4ODA3TDEyLjI0IDQuOTQ0MDZDMTMuMzkyIDMuODQwMDYgMTQuODggMy4yNjQwNiAxNi40MTYgMy4yNjQwNkMxOC43NjggMy4yNjQwNiAyMC43ODQgNC43MDQwNiAyMS40MDggNi44MTYwN0MyMi42NTYgMTAuODAwMSAxOS4yOTYgMTUuOTM2MSAxMi40OCAyMC41OTIxQzEyLjMzNiAyMC42ODgxIDEyLjE5MiAyMC43MzYxIDEyIDIwLjczNjFaIiBmaWxsPSIjNUM4MUEyIi8+Cjwvc3ZnPgo='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '5';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Health', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '5'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '5'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 6 - Education
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '6');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xLjIwODU4IDkuMjk1NDRDMC45MzA1MjggOS4xNDM5IDAuOTMwNDU4IDguNzQ0NyAxLjIwODQ2IDguNTkzMDZMMTEuMzcyOSAzLjA0ODg0QzExLjQ5MjMgMi45ODM3MiAxMS42MzY2IDIuOTgzNzIgMTEuNzU1OSAzLjA0ODg0TDIyLjM1NTkgOC44MzA2NkMyMi40ODQ0IDguOTAwNzUgMjIuNTY0NCA5LjAzNTQ0IDIyLjU2NDQgOS4xODE4MlYxNi41NDQ0QzIyLjU2NDQgMTYuNzY1MyAyMi4zODUzIDE2Ljk0NDQgMjIuMTY0NCAxNi45NDQ0SDIwLjk2NDRDMjAuNzQzNSAxNi45NDQ0IDIwLjU2NDQgMTYuNzY1MyAyMC41NjQ0IDE2LjU0NDRWMTAuNzA3OUMyMC41NjQ0IDEwLjQwNDQgMjAuMjM5NSAxMC4yMTE0IDE5Ljk3MyAxMC4zNTY3TDE4Ljc3MyAxMS4wMTA3QzE4LjY0NDQgMTEuMDgwOCAxOC41NjQ0IDExLjIxNTUgMTguNTY0NCAxMS4zNjE5VjE2Ljg4N0MxOC41NjQ0IDE3LjAzMzMgMTguNDg0NSAxNy4xNjggMTguMzU2IDE3LjIzODFMMTEuNzU2IDIwLjgzOThDMTEuNjM2NiAyMC45MDUgMTEuNDkyMiAyMC45MDUgMTEuMzcyOCAyMC44Mzk4TDQuNzcyNzkgMTcuMjM4MUM0LjY0NDMyIDE3LjE2OCA0LjU2NDQgMTcuMDMzMyA0LjU2NDQgMTYuODg3VjExLjM2MTlDNC41NjQ0IDExLjIxNTUgNC40ODQzOSAxMS4wODA4IDQuMzU1ODIgMTEuMDEwN0wxLjIwODU4IDkuMjk1NDRaTTExLjM3MjcgMTguNTU5N0MxMS40OTIyIDE4LjYyNDkgMTEuNjM2NiAxOC42MjQ5IDExLjc1NjEgMTguNTU5N0wxNi4zNTYxIDE2LjA0ODFDMTYuNDg0NSAxNS45NzggMTYuNTY0NCAxNS44NDMzIDE2LjU2NDQgMTUuNjk3VjEyLjg4ODVDMTYuNTY0NCAxMi41ODQ4IDE2LjIzOTMgMTIuMzkxOSAxNS45NzI3IDEyLjUzNzRMMTEuNzU2MSAxNC44Mzk3QzExLjYzNjYgMTQuOTA0OSAxMS40OTIyIDE0LjkwNDkgMTEuMzcyNyAxNC44Mzk3TDcuMTU2MDkgMTIuNTM3NEM2Ljg4OTU0IDEyLjM5MTkgNi41NjQ0IDEyLjU4NDggNi41NjQ0IDEyLjg4ODVWMTUuNjk3QzYuNTY0NCAxNS44NDMzIDYuNjQ0MjkgMTUuOTc4IDYuNzcyNzEgMTYuMDQ4MUwxMS4zNzI3IDE4LjU1OTdaIiBmaWxsPSIjNUM4MUEyIi8+Cjwvc3ZnPgo='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '6';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Education', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '6'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '6'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC 7 - Employment
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('TOPIC', '7');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyLjU2NDIgMTQuOTI4NkgxMS4yNzQ2QzEwLjYyOTkgMTQuOTI4NiAxMC4xNDYzIDE0LjQ0NSAxMC4wOTI1IDEzLjg1MzlMMyAxMi43NzkzVjE4LjM2NzRDMyAxOS40OTU3IDMuOTEzNDMgMjAuMzU1NCA0Ljk4ODA2IDIwLjM1NTRIMTguOTU4MkMyMC4wODY2IDIwLjM1NTQgMjAuOTQ2MyAxOS40NDIgMjAuOTQ2MyAxOC4zNjc0VjEyLjc3OTNMMTMuNzQ2MyAxMy44NTM5QzEzLjY5MjUgMTQuNDk4NyAxMy4yMDkgMTQuOTI4NiAxMi41NjQyIDE0LjkyODZaIiBmaWxsPSIjNUM4MUEyIi8+CjxwYXRoIGQ9Ik0xOC45NTgyIDcuMDgzNThIMTUuOTQ5M1Y1Ljc5NDAzQzE1Ljk0OTMgNC4yMzU4MiAxNC43MTM0IDMgMTMuMTU1MiAzSDEwLjczNzNDOS4xNzkxMSAzIDcuOTQzMjggNC4yMzU4MiA3Ljk0MzI4IDUuNzk0MDNWNy4wODM1OEg0Ljk4ODA2QzMuODU5NyA3LjA4MzU4IDMgNy45OTcwMiAzIDkuMDcxNjRWMTEuOTczMUwxMC4zMDc1IDEzLjA0NzhDMTAuNTIyNCAxMi43MjU0IDEwLjg5ODUgMTIuNTEwNCAxMS4zMjg0IDEyLjUxMDRIMTIuNjE3OUMxMy4wNDc4IDEyLjUxMDQgMTMuNDIzOSAxMi43MjU0IDEzLjYzODggMTMuMTAxNUwyMSAxMS45NzMxVjkuMDcxNjRDMjAuOTQ2MyA3Ljk5NzAyIDIwLjAzMjggNy4wODM1OCAxOC45NTgyIDcuMDgzNThaTTkuNTAxNDkgNS43OTQwM0M5LjUwMTQ5IDUuMTQ5MjUgMTAuMDM4OCA0LjYxMTk0IDEwLjY4MzYgNC42MTE5NEgxMy4xMDE1QzEzLjc0NjMgNC42MTE5NCAxNC4yODM2IDUuMTQ5MjUgMTQuMjgzNiA1Ljc5NDAzVjcuMDgzNThIOS40NDc3NlY1Ljc5NDAzSDkuNTAxNDlaIiBmaWxsPSIjNUM4MUEyIi8+Cjwvc3ZnPgo='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '7';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Employment', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '7'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'it', 'Lavoro', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '7'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'de', 'Werk', NULL, 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'TOPIC'
  AND ci.external_key = '7'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'TOPIC'
  AND ci.external_key = '7'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- TOPIC RELATIONS
-- 1 Administration
--   2 Cultural
--     3 Finance
--       4 House
--   5 Health
--   6 Education
-- ----------------------------------------------------------------------------
INSERT INTO content_item_relation (relation_type, parent_item_id, child_item_id, sort_order)
SELECT 'parent', p.id, c.id, 0
FROM content_item p, content_item c
WHERE p.type_code = 'TOPIC' AND p.external_key = '1'
  AND c.type_code = 'TOPIC' AND c.external_key = '2';

INSERT INTO content_item_relation (relation_type, parent_item_id, child_item_id, sort_order)
SELECT 'parent', p.id, c.id, 0
FROM content_item p, content_item c
WHERE p.type_code = 'TOPIC' AND p.external_key = '2'
  AND c.type_code = 'TOPIC' AND c.external_key = '3';

INSERT INTO content_item_relation (relation_type, parent_item_id, child_item_id, sort_order)
SELECT 'parent', p.id, c.id, 0
FROM content_item p, content_item c
WHERE p.type_code = 'TOPIC' AND p.external_key = '3'
  AND c.type_code = 'TOPIC' AND c.external_key = '4';

INSERT INTO content_item_relation (relation_type, parent_item_id, child_item_id, sort_order)
SELECT 'parent', p.id, c.id, 0
FROM content_item p, content_item c
WHERE p.type_code = 'TOPIC' AND p.external_key = '1'
  AND c.type_code = 'TOPIC' AND c.external_key = '5';

INSERT INTO content_item_relation (relation_type, parent_item_id, child_item_id, sort_order)
SELECT 'parent', p.id, c.id, 0
FROM content_item p, content_item c
WHERE p.type_code = 'TOPIC' AND p.external_key = '1'
  AND c.type_code = 'TOPIC' AND c.external_key = '6';

-- ============================================================================
-- USER_TYPE
-- external_key riordinate:
-- 1 Refugee       (old 1)
-- 2 Migrant       (old 7)
-- 3 Asylum Seeker (old 9)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USER_TYPE 1 - Refugee
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('USER_TYPE', '1');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTExLjcxMiAxNC4yNTU5SDkuNjk2VjE5LjY3OTlINlY0LjMxOTk1SDEyLjA0OEMxMy44NzIgNC4zMTk5NSAxNS4zMTIgNC43MDM5NSAxNi4zMiA1LjUxOTk1QzE3LjMyOCA2LjMzNTk1IDE3Ljg1NiA3LjQ4Nzk1IDE3Ljg1NiA4LjkyNzk1QzE3Ljg1NiA5Ljk4Mzk1IDE3LjYxNiAxMC44OTU5IDE3LjE4NCAxMS41Njc5QzE2Ljc1MiAxMi4yMzk5IDE2LjA4IDEyLjgxNTkgMTUuMTY4IDEzLjI5NTlMMTguMzg0IDE5LjQ4NzlWMTkuNjc5OUgxNC40TDExLjcxMiAxNC4yNTU5Wk05LjY5NiAxMS4zNzU5SDEyLjA0OEMxMi43NjggMTEuMzc1OSAxMy4yOTYgMTEuMTgzOSAxMy42MzIgMTAuNzk5OUMxMy45NjggMTAuNDE1OSAxNC4xNiA5LjkzNTk1IDE0LjE2IDkuMjYzOTVDMTQuMTYgOC41OTE5NSAxMy45NjggOC4wNjM5NSAxMy42MzIgNy43Mjc5NUMxMy4yOTYgNy4zOTE5NSAxMi43NjggNy4xNTE5NSAxMi4wNDggNy4xNTE5NUg5LjY5NlYxMS4zNzU5WiIgZmlsbD0iI0ZCQTU1QSIvPgo8L3N2Zz4K'
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Refugee', '<p>Refugee</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'it', 'Rifugiato', ' ', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'de', 'Flüchtling', '<p>Flüchtling</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'nl', 'Vluchteling', '<p>Vluchteling</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'USER_TYPE'
  AND ci.external_key = '1'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- USER_TYPE 2 - Migrant
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('USER_TYPE', '2');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTguODk2IDRMMTIuMzA0IDE0LjcwNEwxNS43MTIgNEgyMC42MDhWMTkuMzZIMTYuOTEyVjE1Ljc2TDE3LjI0OCA4LjQxNkwxMy41MDQgMTkuMzZIMTEuMDU2TDcuMzEyIDguNDE2TDcuNjQ4IDE1Ljc2VjE5LjM2SDRWNEg4Ljg5NloiIGZpbGw9IiNGQkE1NUEiLz4KPC9zdmc+Cg=='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '2';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Migrant ', '', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '2'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'it', 'Migrante ', '', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '2'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'USER_TYPE'
  AND ci.external_key = '2'
  AND cr.revision_no = 1;

-- ----------------------------------------------------------------------------
-- USER_TYPE 3 - Asylum Seeker
-- ----------------------------------------------------------------------------
INSERT INTO content_item (type_code, external_key)
VALUES ('USER_TYPE', '3');

INSERT INTO content_revision (
  item_id, revision_no, status, source_lang, data_extra, published_at
)
SELECT
  ci.id,
  1,
  'PUBLISHED',
  'en',
  jsonb_build_object(
    'icon',
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE0LjkzNiAxNi40OEg5Ljg0OEw4Ljk4NCAxOS4zNkg1TDEwLjYxNiA0SDE0LjEyTDE5Ljc4NCAxOS4zNkgxNS44TDE0LjkzNiAxNi40OFpNMTAuNzEyIDEzLjY0OEgxNC4wMjRMMTIuMzkyIDguMzJMMTAuNzEyIDEzLjY0OFoiIGZpbGw9IiNGQkE1NUEiLz4KPC9zdmc+Cg=='
  ),
  NOW()
FROM content_item ci
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '3';

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'en', 'Asylum Seeker', '<p>Asylum Seeker</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'de', 'Asylsuchender', '<p>Asylsuchender</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

INSERT INTO content_revision_translation (
  revision_id, lang, title, description, t_status
)
SELECT cr.id, 'nl', 'Asielzoeker', '<p>Asielzoeker</p>', 'PUBLISHED'
FROM content_item ci
JOIN content_revision cr ON cr.item_id = ci.id
WHERE ci.type_code = 'USER_TYPE'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

UPDATE content_item ci
SET published_revision_id = cr.id
FROM content_revision cr
WHERE cr.item_id = ci.id
  AND ci.type_code = 'USER_TYPE'
  AND ci.external_key = '3'
  AND cr.revision_no = 1;

COMMIT;

