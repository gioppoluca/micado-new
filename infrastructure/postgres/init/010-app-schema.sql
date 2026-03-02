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