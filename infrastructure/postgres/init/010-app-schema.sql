-- App schema (DDL)
SET ROLE micado;

SET search_path TO micado;

-- This runs inside APP_DB (the app database)
CREATE TABLE IF NOT EXISTS languages (
    lang varchar(10) PRIMARY KEY,
    iso_code varchar(32),
    name varchar(255) NOT NULL,
    active boolean NOT NULL DEFAULT false,
    is_default boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 100,
    voice_string varchar(255),
    voice_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Ensure only one default language
CREATE UNIQUE INDEX IF NOT EXISTS ux_languages_single_default ON languages ((is_default))
WHERE is_default = true;

-- Auto-update updated_at
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_languages_updated_at'
) THEN
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN NEW.updated_at = now();
RETURN NEW;
END $fn$;
CREATE TRIGGER trg_languages_updated_at BEFORE
UPDATE ON languages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_settings (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    description text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
 
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_app_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;
 
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_app_settings_updated_at();
 
 

-- Main flags table
CREATE TABLE IF NOT EXISTS features_flags (
    id          serial      PRIMARY KEY,
    flag_key    text        NOT NULL UNIQUE,
    enabled     boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
 
-- i18n labels — managed directly via API, no Weblate/DBOS
CREATE TABLE IF NOT EXISTS features_flags_i18n (
    flag_id  integer     NOT NULL REFERENCES features_flags(id) ON DELETE CASCADE,
    lang     varchar(10) NOT NULL REFERENCES languages(lang)    ON DELETE CASCADE,
    label    text        NOT NULL,
    PRIMARY KEY (flag_id, lang)
);
 
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_features_flags_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
 
DROP TRIGGER IF EXISTS trg_features_flags_updated_at ON features_flags;
CREATE TRIGGER trg_features_flags_updated_at
    BEFORE UPDATE ON features_flags
    FOR EACH ROW EXECUTE FUNCTION set_features_flags_updated_at();
 
-- View — shape kept identical to legacy /active-features response:
--   [{ features: ['KEY1', 'KEY2'] }]
CREATE OR REPLACE VIEW active_features AS
    SELECT array_agg(flag_key) AS features
    FROM   features_flags
    WHERE  enabled = true;


-- ----------------------------------------------------------------------------
-- ENUM: revision workflow state
-- DRAFT      -> editable working copy
-- APPROVED   -> validated and no longer editable
-- PUBLISHED  -> revision that may be referenced as live
-- ARCHIVED   -> historical revision no longer active
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'content_revision_status'
  ) THEN
    CREATE TYPE content_revision_status AS ENUM (
      'DRAFT',
      'APPROVED',
      'PUBLISHED',
      'ARCHIVED'
    );
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- ENUM: translation workflow state for a single language row
-- DRAFT      -> imported or manually edited, not validated yet
-- APPROVED   -> validated and ready for publication
-- PUBLISHED  -> language currently published for the revision
-- STALE      -> source changed, translation may need refresh
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'translation_status'
  ) THEN
    CREATE TYPE translation_status AS ENUM (
      'DRAFT',
      'APPROVED',
      'PUBLISHED',
      'STALE'
    );
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- TABLE: content_type
-- Defines the business content type (NEWS, EVENT, CATEGORY, USER_TYPE, ...)
-- and the schemas that validate extra data for revisions and translations.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_type (
  -- Stable symbolic code of the business type, used by APIs and filters.
  code               VARCHAR(64) PRIMARY KEY,

  -- Human-readable label for admin / diagnostics.
  name               VARCHAR(128) NOT NULL,

  -- JSON Schema for extra non-translatable fields stored in content_revision.data_extra.
  revision_schema    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- JSON Schema for extra translatable fields stored in content_revision_translation.i18n_extra.
  translation_schema JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Optional namespace or mapping hint used for Weblate export/import grouping.
  weblate_namespace  VARCHAR(255),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE content_type IS
  'Metadata for each business content type. Provides JSON Schemas and optional Weblate mapping namespace.';
COMMENT ON COLUMN content_type.revision_schema IS
  'JSON Schema for content_revision.data_extra for this type.';
COMMENT ON COLUMN content_type.translation_schema IS
  'JSON Schema for content_revision_translation.i18n_extra for this type.';
COMMENT ON COLUMN content_type.weblate_namespace IS
  'Optional namespace/grouping used to organize exported translations.';

CREATE INDEX IF NOT EXISTS idx_content_type_weblate_namespace
  ON content_type (weblate_namespace);

-- ----------------------------------------------------------------------------
-- TABLE: content_item
-- Stable identity of a content entity, independent from its revisions.
-- This is the anchor used by relations and domain-specific facade controllers.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_item (
  -- Stable UUID of the logical content item.
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business type of the content item, points to content_type.code.
  type_code             VARCHAR(64) NOT NULL REFERENCES content_type(code),

  -- Optional stable slug, generally unique within type_code.
  slug                  VARCHAR(255),

  -- Optional external/legacy identifier used to map previous systems.
  external_key          VARCHAR(255),

  -- Reference to the currently published revision for this item.
  -- FK is added later because of circular dependency with content_revision.
  published_revision_id UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            VARCHAR(255),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            VARCHAR(255)
);

COMMENT ON TABLE content_item IS
  'Stable identity of a content entity. One item can have many revisions and many relations to other content items.';
COMMENT ON COLUMN content_item.type_code IS
  'Business content type, for example NEWS, EVENT, CATEGORY, USER_TYPE.';
COMMENT ON COLUMN content_item.external_key IS
  'Optional legacy key used to maintain backward compatibility with previous applications.';
COMMENT ON COLUMN content_item.published_revision_id IS
  'Currently live revision for the item. Null when item has never been published.';

CREATE INDEX IF NOT EXISTS idx_content_item_type_code
  ON content_item (type_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_item_type_slug
  ON content_item (type_code, slug)
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_item_type_external_key
  ON content_item (type_code, external_key)
  WHERE external_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- TABLE: content_revision
-- Stores versioned non-translatable data and workflow state.
-- One item may have many revisions but at most one active DRAFT.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_revision (
  -- Stable UUID of the revision.
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent content item.
  item_id       UUID NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,

  -- Monotonic revision number inside the item (1, 2, 3, ...).
  revision_no   INTEGER NOT NULL,

  -- Workflow state of the whole revision.
  status        content_revision_status NOT NULL DEFAULT 'DRAFT',

  -- Source language used as canonical language for this revision.
  source_lang   VARCHAR(16) NOT NULL,

  -- Extra non-translatable business data, validated by content_type.revision_schema.
  data_extra    JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(255),
  approved_at   TIMESTAMPTZ,
  approved_by   VARCHAR(255),
  published_at  TIMESTAMPTZ,
  published_by  VARCHAR(255),

  CONSTRAINT uq_content_revision_item_revision_no
    UNIQUE (item_id, revision_no)
);

COMMENT ON TABLE content_revision IS
  'Versioned non-translatable payload and workflow state of a content item.';
COMMENT ON COLUMN content_revision.source_lang IS
  'Canonical language of the revision, typically the source exported to Weblate.';
COMMENT ON COLUMN content_revision.data_extra IS
  'JSONB for type-specific non-translatable fields, for example event dates or boolean flags.';

CREATE INDEX IF NOT EXISTS idx_content_revision_item_id
  ON content_revision (item_id);

CREATE INDEX IF NOT EXISTS idx_content_revision_status
  ON content_revision (status);

CREATE INDEX IF NOT EXISTS idx_content_revision_source_lang
  ON content_revision (source_lang);

CREATE INDEX IF NOT EXISTS idx_content_revision_data_extra_gin
  ON content_revision USING GIN (data_extra);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_revision_single_draft
  ON content_revision (item_id)
  WHERE status = 'DRAFT';

-- ----------------------------------------------------------------------------
-- Circular FK now that content_revision exists.
-- Application layer should also verify that published_revision_id belongs to
-- the same content_item.id, because plain FK does not enforce the pair.
-- ----------------------------------------------------------------------------
ALTER TABLE content_item
  DROP CONSTRAINT IF EXISTS fk_content_item_published_revision;

ALTER TABLE content_item
  ADD CONSTRAINT fk_content_item_published_revision
  FOREIGN KEY (published_revision_id)
  REFERENCES content_revision(id);

-- ----------------------------------------------------------------------------
-- TABLE: content_revision_translation
-- One row per revision/language with core title/description and extra i18n data.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_revision_translation (
  -- Stable UUID of the translation row.
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent revision.
  revision_id     UUID NOT NULL REFERENCES content_revision(id) ON DELETE CASCADE,

  -- Target language of the row (en, it, fr, ar, ...).
  lang            VARCHAR(16) NOT NULL,

  -- Core translatable title. Kept as explicit column for easy listing/search.
  title           TEXT NOT NULL DEFAULT '',

  -- Core translatable description. Optional because some content types may not need it.
  description     TEXT,

  -- Extra translatable fields, validated by content_type.translation_schema.
  i18n_extra      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Workflow state of this language row.
  t_status        translation_status NOT NULL DEFAULT 'DRAFT',

  -- Hash of source payload used to detect stale translations after source changes.
  source_hash     VARCHAR(128),

  -- Stable export key or prefix used in Weblate/Gitea synchronization.
  weblate_key     VARCHAR(255),

  -- Audit fields for synchronization jobs.
  last_import_at  TIMESTAMPTZ,
  last_export_at  TIMESTAMPTZ,

  CONSTRAINT uq_content_revision_translation_revision_lang
    UNIQUE (revision_id, lang)
);

COMMENT ON TABLE content_revision_translation IS
  'One row per revision/language. Contains core title/description plus extra translatable JSONB fields.';
COMMENT ON COLUMN content_revision_translation.i18n_extra IS
  'JSONB for type-specific translatable fields, for example CTA labels or location name.';
COMMENT ON COLUMN content_revision_translation.source_hash IS
  'Hash of the source language payload used to detect whether a translation became stale.';
COMMENT ON COLUMN content_revision_translation.weblate_key IS
  'Optional stable key/prefix used during import/export with Weblate.';

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_revision_id
  ON content_revision_translation (revision_id);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_lang
  ON content_revision_translation (lang);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_t_status
  ON content_revision_translation (t_status);

CREATE INDEX IF NOT EXISTS idx_content_revision_translation_i18n_extra_gin
  ON content_revision_translation USING GIN (i18n_extra);

-- ----------------------------------------------------------------------------
-- TABLE: content_item_relation
-- Generic relation table between two content items.
-- This supports both hierarchical relations and loose graph relations.
-- Examples:
--   PARENT_CHILD   -> generic parent-child hierarchy
--   CATEGORY_TREE  -> category nesting
--   ITEM_CATEGORY  -> content assigned to category
--   RELATED_ITEM   -> arbitrary relation
--
-- Design note:
--   parent_item_id / child_item_id naming is intentional even for non-tree
--   relations, to keep a consistent directional model. relation_type defines
--   how the edge should be interpreted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_item_relation (
  -- Stable UUID of the relation row.
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relation semantic type.
  relation_type    VARCHAR(64) NOT NULL,

  -- Source/parent side of the relation.
  parent_item_id   UUID NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,

  -- Target/child side of the relation.
  child_item_id    UUID NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,

  -- Optional ordering among siblings / outgoing edges.
  sort_order       INTEGER NOT NULL DEFAULT 0,

  -- Optional JSONB for edge-specific metadata.
  relation_extra   JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       VARCHAR(255),

  CONSTRAINT chk_content_item_relation_not_self
    CHECK (parent_item_id <> child_item_id),

  CONSTRAINT uq_content_item_relation_unique
    UNIQUE (relation_type, parent_item_id, child_item_id)
);

COMMENT ON TABLE content_item_relation IS
  'Generic directed relation between two content items. Supports hierarchy and typed associations.';
COMMENT ON COLUMN content_item_relation.relation_type IS
  'Meaning of the edge, for example PARENT_CHILD, CATEGORY_TREE, ITEM_CATEGORY.';
COMMENT ON COLUMN content_item_relation.sort_order IS
  'Ordering among sibling edges, useful for menus, category trees, curated lists.';
COMMENT ON COLUMN content_item_relation.relation_extra IS
  'Optional JSONB metadata stored on the edge itself.';

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

-- ----------------------------------------------------------------------------
-- Trigger helper for updated_at maintenance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_type_updated_at ON content_type;
CREATE TRIGGER trg_content_type_updated_at
BEFORE UPDATE ON content_type
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_content_item_updated_at ON content_item;
CREATE TRIGGER trg_content_item_updated_at
BEFORE UPDATE ON content_item
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
