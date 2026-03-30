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
    'NEWS',
    'News',
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
)

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
),

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