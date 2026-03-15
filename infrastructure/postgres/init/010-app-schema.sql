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