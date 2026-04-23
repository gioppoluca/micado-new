-- =============================================================================
-- 010-app-schema.sql
-- Full application schema — drop DB and run this from scratch.
--
-- Actor columns (created_by, updated_by, approved_by, published_by) are JSONB.
-- Shape stored: { "sub": "<keycloak-uuid>", "username": "...", "name": "...", "realm": "..." }
-- Build with buildActorStamp() from src/auth/actor-stamp.ts.
-- LoopBack reads them back as plain objects — no JSON.parse needed anywhere.
-- =============================================================================

SET ROLE micado;
SET search_path TO micado;

-- ─────────────────────────────────────────────────────────────────────────────
-- LANGUAGES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS languages (
    lang         varchar(10)  PRIMARY KEY,
    iso_code     varchar(32),
    name         varchar(255) NOT NULL,
    active       boolean      NOT NULL DEFAULT false,
    is_default   boolean      NOT NULL DEFAULT false,
    sort_order   integer      NOT NULL DEFAULT 100,
    voice_string varchar(255),
    voice_active boolean      NOT NULL DEFAULT false,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);

-- Only one default language allowed at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_languages_single_default
  ON languages ((is_default))
  WHERE is_default = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- SHARED updated_at TRIGGER FUNCTION
-- Defined once here; reused by all tables below.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_languages_updated_at ON languages;
CREATE TRIGGER trg_languages_updated_at
  BEFORE UPDATE ON languages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- APP SETTINGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key         text        PRIMARY KEY,
    value       text        NOT NULL,
    description text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- FEATURE FLAGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_flags (
    id         serial      PRIMARY KEY,
    flag_key   text        NOT NULL UNIQUE,
    enabled    boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- i18n labels — managed via API, no Weblate integration.
CREATE TABLE IF NOT EXISTS features_flags_i18n (
    flag_id  integer     NOT NULL REFERENCES features_flags(id) ON DELETE CASCADE,
    lang     varchar(10) NOT NULL REFERENCES languages(lang)    ON DELETE CASCADE,
    label    text        NOT NULL,
    PRIMARY KEY (flag_id, lang)
);

DROP TRIGGER IF EXISTS trg_features_flags_updated_at ON features_flags;
CREATE TRIGGER trg_features_flags_updated_at
  BEFORE UPDATE ON features_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- View — shape kept identical to legacy /active-features response:
--   [{ features: ['KEY1', 'KEY2'] }]
CREATE OR REPLACE VIEW active_features AS
    SELECT array_agg(flag_key) AS features
    FROM   features_flags
    WHERE  enabled = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

-- Revision workflow state.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_revision_status') THEN
    CREATE TYPE content_revision_status AS ENUM (
      'DRAFT',      -- editable working copy
      'APPROVED',   -- source text frozen, ready for translation
      'PUBLISHED',  -- live on the migrant frontend
      'ARCHIVED'    -- retired, no longer active
    );
  END IF;
END$$;

-- Per-language translation workflow state.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'translation_status') THEN
    CREATE TYPE translation_status AS ENUM (
      'DRAFT',      -- being edited, not validated yet
      'APPROVED',   -- validated, ready for publication
      'PUBLISHED',  -- live on the migrant frontend
      'STALE'       -- source changed after this translation was saved
    );
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ACTOR STAMP DOMAIN
-- Reusable inline comment for all actor columns.
-- Shape: { "sub": "<keycloak-uuid>", "username": "pa-admin",
--          "name": "PA Admin", "realm": "pa_frontoffice" }
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT_TYPE
-- Registry of business content types (USER_TYPE, NEWS, PROCESS, ...).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_type (
  code               VARCHAR(64)  PRIMARY KEY,
  name               VARCHAR(128) NOT NULL,
  revision_schema    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  translation_schema JSONB        NOT NULL DEFAULT '{}'::jsonb,
  weblate_namespace  VARCHAR(255),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  content_type IS
  'Registry of business content types. revision_schema / translation_schema are JSON Schemas for data_extra / i18n_extra validation.';
COMMENT ON COLUMN content_type.revision_schema IS
  'JSON Schema for content_revision.data_extra fields specific to this type.';
COMMENT ON COLUMN content_type.translation_schema IS
  'JSON Schema for content_revision_translation.i18n_extra fields specific to this type.';

CREATE INDEX IF NOT EXISTS idx_content_type_weblate_namespace
  ON content_type (weblate_namespace);

DROP TRIGGER IF EXISTS trg_content_type_updated_at ON content_type;
CREATE TRIGGER trg_content_type_updated_at
  BEFORE UPDATE ON content_type
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT_ITEM
-- Stable identity of a content entity, independent from its revisions.
-- Actor columns are JSONB: { sub, username, name, realm }.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_item (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code             VARCHAR(64) NOT NULL REFERENCES content_type(code),
  slug                  VARCHAR(255),
  external_key          VARCHAR(255),

  -- Set after first publication; NULL until then.
  -- FK to content_revision added below (circular dependency).
  published_revision_id UUID,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- { "sub": "...", "username": "...", "name": "...", "realm": "..." }
  created_by  JSONB,

  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same shape as created_by. Set on every write.
  updated_by  JSONB
);

COMMENT ON TABLE  content_item IS
  'Stable identity of a content entity. One item can have many revisions.';
COMMENT ON COLUMN content_item.type_code IS
  'Business content type, e.g. USER_TYPE, NEWS, PROCESS.';
COMMENT ON COLUMN content_item.external_key IS
  'Optional legacy numeric key for backward compatibility with the previous system.';
COMMENT ON COLUMN content_item.published_revision_id IS
  'Currently live revision. NULL until the item is published for the first time.';
COMMENT ON COLUMN content_item.created_by IS
  'Keycloak actor who created this item. Shape: { sub, username, name, realm }.';
COMMENT ON COLUMN content_item.updated_by IS
  'Keycloak actor who last updated this item. Shape: { sub, username, name, realm }.';

CREATE INDEX IF NOT EXISTS idx_content_item_type_code
  ON content_item (type_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_item_type_slug
  ON content_item (type_code, slug)
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_item_type_external_key
  ON content_item (type_code, external_key)
  WHERE external_key IS NOT NULL;

-- GIN index for querying by actor (e.g. WHERE created_by->>'sub' = '...')
CREATE INDEX IF NOT EXISTS idx_content_item_created_by_gin
  ON content_item USING GIN (created_by);

DROP TRIGGER IF EXISTS trg_content_item_updated_at ON content_item;
CREATE TRIGGER trg_content_item_updated_at
  BEFORE UPDATE ON content_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT_REVISION
-- Versioned non-translatable payload + workflow state.
-- At most one DRAFT per item (enforced by partial unique index).
-- Actor columns are JSONB: { sub, username, name, realm }.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_revision (
  id          UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID                    NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  revision_no INTEGER                 NOT NULL,
  status      content_revision_status NOT NULL DEFAULT 'DRAFT',
  source_lang VARCHAR(16)             NOT NULL,
  data_extra  JSONB                   NOT NULL DEFAULT '{}'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  JSONB,   -- { sub, username, name, realm }

  approved_at TIMESTAMPTZ,
  approved_by JSONB,   -- { sub, username, name, realm } — set when DRAFT → APPROVED

  published_at TIMESTAMPTZ,
  published_by JSONB,  -- { sub, username, name, realm } — set when APPROVED → PUBLISHED

  CONSTRAINT uq_content_revision_item_revision_no
    UNIQUE (item_id, revision_no)
);

COMMENT ON TABLE  content_revision IS
  'Versioned non-translatable payload and workflow state of a content item.';
COMMENT ON COLUMN content_revision.source_lang IS
  'Canonical authoring language for this revision; exported to Weblate as source strings.';
COMMENT ON COLUMN content_revision.data_extra IS
  'Type-specific non-translatable fields (e.g. event dates, icon URL). Validated by content_type.revision_schema.';
COMMENT ON COLUMN content_revision.created_by IS
  'Actor who created this revision. Shape: { sub, username, name, realm }.';
COMMENT ON COLUMN content_revision.approved_by IS
  'Actor who approved this revision (DRAFT → APPROVED). Shape: { sub, username, name, realm }.';
COMMENT ON COLUMN content_revision.published_by IS
  'Actor who published this revision (APPROVED → PUBLISHED). Shape: { sub, username, name, realm }.';

CREATE INDEX IF NOT EXISTS idx_content_revision_item_id
  ON content_revision (item_id);

CREATE INDEX IF NOT EXISTS idx_content_revision_status
  ON content_revision (status);

CREATE INDEX IF NOT EXISTS idx_content_revision_source_lang
  ON content_revision (source_lang);

CREATE INDEX IF NOT EXISTS idx_content_revision_data_extra_gin
  ON content_revision USING GIN (data_extra);

-- Enforces the "at most one DRAFT per item" business rule at DB level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_revision_single_draft
  ON content_revision (item_id)
  WHERE status = 'DRAFT';

-- ─────────────────────────────────────────────────────────────────────────────
-- Circular FK: content_item.published_revision_id → content_revision.id
-- Added here because content_revision did not exist when content_item was defined.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE content_item
  DROP CONSTRAINT IF EXISTS fk_content_item_published_revision;

ALTER TABLE content_item
  ADD CONSTRAINT fk_content_item_published_revision
  FOREIGN KEY (published_revision_id)
  REFERENCES content_revision(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT_REVISION_TRANSLATION
-- One row per revision/language. Core title + description + extra i18n JSONB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_revision_translation (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  UUID               NOT NULL REFERENCES content_revision(id) ON DELETE CASCADE,
  lang         VARCHAR(16)        NOT NULL,
  title        TEXT               NOT NULL DEFAULT '',
  description  TEXT,
  i18n_extra   JSONB              NOT NULL DEFAULT '{}'::jsonb,
  t_status     translation_status NOT NULL DEFAULT 'DRAFT',
  source_hash  VARCHAR(128),
  weblate_key  VARCHAR(255),
  last_import_at TIMESTAMPTZ,
  last_export_at TIMESTAMPTZ,

  CONSTRAINT uq_content_revision_translation_revision_lang
    UNIQUE (revision_id, lang)
);

COMMENT ON TABLE  content_revision_translation IS
  'One row per revision/language. Core title/description plus type-specific i18n JSONB.';
COMMENT ON COLUMN content_revision_translation.i18n_extra IS
  'Type-specific translatable fields. Validated by content_type.translation_schema.';
COMMENT ON COLUMN content_revision_translation.source_hash IS
  'Hash of source payload at export time; used to detect STALE translations.';
COMMENT ON COLUMN content_revision_translation.t_status IS
  'DRAFT: being edited. STALE: source changed. APPROVED: validated. PUBLISHED: live.';

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_revision_id
  ON content_revision_translation (revision_id);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_lang
  ON content_revision_translation (lang);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_t_status
  ON content_revision_translation (t_status);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_i18n_extra_gin
  ON content_revision_translation USING GIN (i18n_extra);

-- ─────────────────────────────────────────────────────────────────────────────
-- CONTENT_ITEM_RELATION
-- Generic directed edge between two content items.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_item_relation (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  relation_type  VARCHAR(64) NOT NULL,
  parent_item_id UUID        NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  child_item_id  UUID        NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  relation_extra JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     JSONB,   -- { sub, username, name, realm }

  CONSTRAINT chk_content_item_relation_not_self
    CHECK (parent_item_id <> child_item_id),

  CONSTRAINT uq_content_item_relation_unique
    UNIQUE (relation_type, parent_item_id, child_item_id)
);

COMMENT ON TABLE  content_item_relation IS
  'Generic directed relation between two content items. relation_type defines semantics (PARENT_CHILD, ITEM_CATEGORY, ...).';
COMMENT ON COLUMN content_item_relation.sort_order IS
  'Ordering among sibling edges — useful for menus, category trees, curated lists.';
COMMENT ON COLUMN content_item_relation.created_by IS
  'Actor who created this relation. Shape: { sub, username, name, realm }.';

CREATE INDEX IF NOT EXISTS idx_content_item_relation_parent
  ON content_item_relation (parent_item_id);

CREATE INDEX IF NOT EXISTS idx_content_item_relation_child
  ON content_item_relation (child_item_id);

CREATE INDEX IF NOT EXISTS idx_content_item_relation_type_parent
  ON content_item_relation (relation_type, parent_item_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_content_item_relation_type_child
  ON content_item_relation (relation_type, child_item_id);

CREATE INDEX IF NOT EXISTS idx_content_item_relation_extra_gin
  ON content_item_relation USING GIN (relation_extra);

--
-- Staging table for Weblate COMMIT webhook events (ActionEvents.COMMIT = 17).
--
-- Flow:
--   1. Weblate fires POST /api/webhooks/weblate/translation-committed
--      for every component commit (one per language).
--      → Row inserted with status = 'NEW'.
--
--   2. Weblate fires POST /api/webhooks/weblate/translation-pushed
--      when the repo is pushed to Gitea (project-level addon, no language field).
--      → Handler does SELECT ... FOR UPDATE SKIP LOCKED on ALL NEW rows
--        (no component filter — the component in the PUSH body is unreliable;
--        each row carries the correct component+lang from its COMMIT event).
--        Stamps rows with a unique worker_hash, processes each (component, lang),
--        then deletes by worker_hash.
--
-- This decouples the fast per-language commit events from the slower push event,
-- and makes the push handler idempotent: concurrent pushes get different hashes
-- and operate on different row sets without interfering.
--
-- Status lifecycle:
--   NEW        → row arrived, not yet picked up by a push handler
--   PROCESSING → selected by a push handler (stamped with worker_hash)
--   (deleted)  → after successful processing
--
-- worker_hash is a random UUID generated once per push-handler invocation.
-- Rows are deleted by worker_hash so only the rows THIS handler claimed are removed.

CREATE TABLE IF NOT EXISTS weblate_commit_event (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Raw Weblate webhook payload (full body as received)
    payload         JSONB       NOT NULL,

    -- Routing fields extracted from payload for efficient querying
    project         TEXT        NOT NULL,   -- e.g. 'micado'
    component       TEXT        NOT NULL,   -- e.g. 'user-types' (= Gitea category)
    lang            TEXT        NOT NULL,   -- e.g. 'it'
    change_id       INTEGER     NOT NULL,   -- Weblate change PK
    action          TEXT        NOT NULL,   -- e.g. 'Changes committed'

    -- Lifecycle
    status          TEXT        NOT NULL DEFAULT 'NEW'
                                CHECK (status IN ('NEW', 'PROCESSING')),
    worker_hash     TEXT,                   -- set during SELECT FOR UPDATE, used for deletion

    -- Timestamps
    weblate_ts      TIMESTAMPTZ NOT NULL,   -- timestamp from Weblate payload
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the push handler's SELECT FOR UPDATE SKIP LOCKED (claims by status only)
CREATE INDEX IF NOT EXISTS idx_weblate_commit_event_status
    ON weblate_commit_event (status)
    WHERE status = 'NEW';

-- Index on (component, lang) for diagnostics and monitoring queries
CREATE INDEX IF NOT EXISTS idx_weblate_commit_event_component_lang
    ON weblate_commit_event (component, lang);

-- Index for time-based cleanup / monitoring
CREATE INDEX IF NOT EXISTS idx_weblate_commit_event_received_at
    ON weblate_commit_event (received_at);

COMMENT ON TABLE weblate_commit_event IS
    'Staging table for Weblate COMMIT events awaiting the next PUSH event to process.';


-- =============================================================================
-- Migration: Migrant profile anchor + Intervention Plan operational tables
-- Schema: micado
--
-- Design decisions:
--   - migrant_profile.keycloak_id is the UUID from the Keycloak migrants realm.
--     It is the stable anchor for all migrant-related operational data.
--   - intervention_plan_item.intervention_type_id is an optional FK to
--     content_item (type = INTERVENTION_TYPE). NULL means ad-hoc item.
--   - No revision/translation cycle — these are operational records managed
--     by PA operators at the desk, not translatable content.
--   - created_by / validated_by are JSONB ActorStamps (self-contained audit).
-- =============================================================================

-- ── 1. Migrant profile anchor ────────────────────────────────────────────────
--
-- Thin anchor row: the actual user data lives in Keycloak.
-- Used as the FK target for plans, documents, and any future migrant data.
-- Created lazily on first PA action (auto-upsert in service layer).

CREATE TABLE IF NOT EXISTS migrant_profile (
  keycloak_id   UUID         PRIMARY KEY,
  realm         VARCHAR(100) NOT NULL DEFAULT 'migrants',
  notes         TEXT,                          -- PA internal notes (not shown to migrant)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE migrant_profile IS
  'Thin anchor for migrant users. Primary key = Keycloak UUID from the migrants realm. '
  'The actual identity data (name, email) stays in Keycloak; this row exists only to '
  'anchor operational data (plans, documents) without duplicating PII.';

-- ── 2. Intervention plan (header) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intervention_plan (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  migrant_id    UUID         NOT NULL
                               REFERENCES migrant_profile(keycloak_id)
                               ON DELETE CASCADE,
  title         VARCHAR(200),
  case_manager  VARCHAR(100),                 -- PA user display name or id
  start_date    DATE,
  end_date      DATE,
  completed     BOOLEAN      NOT NULL DEFAULT FALSE,
  notes         TEXT,
  created_by    JSONB,                        -- ActorStamp {sub, username, name, realm}
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intervention_plan_migrant_id
  ON intervention_plan (migrant_id);

COMMENT ON TABLE intervention_plan IS
  'Individual integration plan assigned to a migrant by a PA social assistant. '
  'Not translatable — created and managed at the desk in the contact language.';

-- ── 3. Intervention plan item (line) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intervention_plan_item (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                 UUID         NOT NULL
                                         REFERENCES intervention_plan(id)
                                         ON DELETE CASCADE,
  -- Optional FK to the catalogue (content_item with type = INTERVENTION_TYPE).
  -- NULL = ad-hoc item written by the PA.
  intervention_type_id    UUID         REFERENCES content_item(id)
                                         ON DELETE SET NULL,
  title                   VARCHAR(200),
  description             TEXT,
  assigned_date           DATE,
  due_date                DATE,
  completed               BOOLEAN      NOT NULL DEFAULT FALSE,
  completed_date          DATE,
  -- NGO validation workflow fields
  validation_requested_at TIMESTAMPTZ,        -- PA sets when requesting NGO sign-off
  validated_by            JSONB,              -- ActorStamp of the NGO validator
  validated_at            TIMESTAMPTZ,
  sort_order              INTEGER      NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intervention_plan_item_plan_id
  ON intervention_plan_item (plan_id);

CREATE INDEX IF NOT EXISTS idx_intervention_plan_item_type_id
  ON intervention_plan_item (intervention_type_id)
  WHERE intervention_type_id IS NOT NULL;

COMMENT ON TABLE intervention_plan_item IS
  'A single action / task within an intervention plan. '
  'intervention_type_id optionally references the translated catalogue (content_item). '
  'Ad-hoc items carry only a free-text title written by the PA.';

COMMENT ON COLUMN intervention_plan_item.validation_requested_at IS
  'Set by the PA when the item is ready for NGO validation. '
  'NULL = not yet submitted for validation.';


-- ── NGO Process Comment ──────────────────────────────────────────────────────
--
-- Design
-- ──────
-- Comments are written by NGO group members on a SPECIFIC PUBLISHED REVISION
-- of a process (not on the process item in general). This is intentional:
--
--   - When process v2 is published, comments on v1 are implicitly "expired"
--     because they reference the old revision UUID. The NGO page only shows
--     comments whose revision_id matches the current published_revision_id of
--     the process item. No deletion is needed — they just stop appearing.
--
--   - The group_id (Keycloak group UUID) scopes visibility: a user only sees
--     comments from their own NGO group.
--
--   - There is no translation; the comment is freeform text written once.
--
-- Table: micado.ngo_process_comment
--
--   id              UUID PK
--   revision_id     UUID FK → micado.content_revision.id ON DELETE CASCADE
--                   Points to the PUBLISHED revision at the time of writing.
--   ngo_group_id    VARCHAR(100)   Keycloak group UUID (from JWT groups claim
--                                  or ngoGroupId user attribute).
--   body            TEXT NOT NULL  The comment text.
--   published       BOOLEAN NOT NULL DEFAULT FALSE
--                   Simple on/off; false = saved but not visible to migrants.
--   created_by      JSONB          ActorStamp { sub, username, name, realm }
--   created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
--   updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Indexes
--   idx_ngo_comment_revision  — supports the main query: "comments for revision X"
--   idx_ngo_comment_group     — supports filtering by group

CREATE TABLE IF NOT EXISTS micado.ngo_process_comment (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    revision_id  UUID        NOT NULL
                     REFERENCES micado.content_revision(id) ON DELETE CASCADE,
    ngo_group_id VARCHAR(100) NOT NULL,
    body         TEXT        NOT NULL,
    published    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by   JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_ngo_process_comment PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_ngo_comment_revision
    ON micado.ngo_process_comment (revision_id);

CREATE INDEX IF NOT EXISTS idx_ngo_comment_group
    ON micado.ngo_process_comment (ngo_group_id);

COMMENT ON TABLE  micado.ngo_process_comment IS
    'Free-text comments written by NGO groups on a specific published process revision.';
COMMENT ON COLUMN micado.ngo_process_comment.revision_id IS
    'FK to the published content_revision at the time the comment was written. '
    'When a new revision is published the old comments silently stop appearing '
    '(they are not deleted, just no longer referenced by the active revision).';
COMMENT ON COLUMN micado.ngo_process_comment.ngo_group_id IS
    'Keycloak group UUID that owns this comment. Used to scope visibility '
    'so each NGO only sees its own comments.';
COMMENT ON COLUMN micado.ngo_process_comment.published IS
    'Simple publish flag. FALSE = draft (only visible in the NGO backoffice). '
    'TRUE  = visible to migrants on the process detail page.';

-- ── Migrant Document Wallet ───────────────────────────────────────────────────
--
-- Design
-- ──────
-- Each row is one personal document uploaded by a migrant.
-- The document binary is stored as BYTEA (BLOB) in the DB — no external object
-- storage required. For large deployments the column can be moved to a separate
-- large-object strategy, but BYTEA is correct for the current scale.
--
-- document_type_id references content_item.external_key (the legacy numeric id
-- of the DOCUMENT_TYPE content item).  It is nullable — a migrant may upload
-- a document before the PA has published any document types.
--
-- The migrant_id FK references migrant_profile.keycloak_id so the row is
-- automatically deleted if the migrant account is purged.
--
-- shareable: PA workers can see shareable documents in the migrant's profile.
--           Non-shareable documents are private and only visible to the migrant.
--
-- No translation columns — document labels/names are not translated.
-- The document_type name is resolved from the published CRT translation when
-- displayed on screen.
--
-- Table: micado.migrant_document
--
--   id               UUID PK
--   migrant_id       UUID FK → migrant_profile.keycloak_id ON DELETE CASCADE
--   document_type_id INTEGER  nullable — content_item.external_key of DOCUMENT_TYPE
--   file_name        VARCHAR(500)  original filename (e.g. "identity_card.jpg")
--   mime_type        VARCHAR(100)  e.g. "image/jpeg", "application/pdf"
--   file_data        BYTEA NOT NULL — binary content
--   shareable        BOOLEAN NOT NULL DEFAULT FALSE
--   created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
--   updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()

CREATE TABLE IF NOT EXISTS micado.migrant_document (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    migrant_id       UUID         NOT NULL
                         REFERENCES micado.migrant_profile(keycloak_id)
                         ON DELETE CASCADE,
    document_type_id INTEGER,          -- nullable: references content_item.external_key
    file_name        VARCHAR(500)  NOT NULL DEFAULT '',
    mime_type        VARCHAR(100)  NOT NULL DEFAULT 'application/octet-stream',
    file_data        BYTEA         NOT NULL,
    shareable        BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_migrant_document PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_migrant_document_migrant_id
    ON micado.migrant_document (migrant_id);

CREATE INDEX IF NOT EXISTS idx_migrant_document_type_id
    ON micado.migrant_document (document_type_id)
    WHERE document_type_id IS NOT NULL;

COMMENT ON TABLE  micado.migrant_document IS
    'Personal documents uploaded by a migrant to their Document Wallet. '
    'Binary content stored as BYTEA. Not translated.';
COMMENT ON COLUMN micado.migrant_document.document_type_id IS
    'Optional FK to content_item.external_key for a DOCUMENT_TYPE item. '
    'Nullable: a migrant may upload a document without selecting a type.';
COMMENT ON COLUMN micado.migrant_document.shareable IS
    'When TRUE, PA social assistants can see this document in the migrant profile. '
    'When FALSE, the document is private and only visible to the migrant.';
COMMENT ON COLUMN micado.migrant_document.file_data IS
    'Binary content of the document. Max recommended size: 10 MB per row. '
    'Served as base64 over the API; the backend enforces a size limit.';