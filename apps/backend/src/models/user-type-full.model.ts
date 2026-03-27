/**
 * src/models/user-type-full.model.ts
 *
 * Rich DTO returned by GET /user-types/:id (PA form context).
 *
 * ── Why a separate model from UserTypeLegacy ────────────────────────────────
 *
 * UserTypeLegacy is the flat, legacy-compatible shape used by:
 *   - GET  /user-types        (list — lightweight, sourceLang only)
 *   - POST /user-types        (create response)
 *   - PATCH /user-types/:id   (partial update, no body on 204)
 *
 * UserTypeFull is the rich shape used by:
 *   - GET  /user-types/:id    (form open — needs all translations for tab editors)
 *   - PUT  /user-types/:id    (form save — sends all translations back in one shot)
 *
 * Having two distinct models keeps the OpenAPI spec self-documenting:
 * the list endpoint stays lean (no N×langs overhead), the single-item
 * endpoint is explicit about carrying the full translation map.
 *
 * ── translations shape ───────────────────────────────────────────────────────
 *
 * translations: {
 *   "en": { title: "Migrant", description: "...", tStatus: "DRAFT"     },
 *   "ar": { title: "مهاجر",  description: "...", tStatus: "STALE"    },
 *   "fr": { title: "",        description: "",    tStatus: "STALE"    }
 * }
 *
 * Keys present = languages that have a row in content_revision_translation.
 * Keys absent  = never translated yet; the PA form shows an empty editor.
 * tStatus is read-only on input (PUT) — the backend always resets it to DRAFT
 * on write; it is only meaningful on GET for displaying per-tab badges.
 */

import { Model, model, property } from '@loopback/repository';

/** Single per-language entry within the translations map. */
@model()
export class UserTypeTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    description?: string;

    /**
     * Read-only workflow state for this language row.
     * Ignored on PUT input; populated on GET output.
     * DRAFT     → being edited
     * STALE     → source changed after this translation was saved
     * APPROVED  → validated, ready for publication
     * PUBLISHED → live on migrant frontend
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<UserTypeTranslationEntry>) {
        super(data);
    }
}

@model({
    description: 'Full User Type DTO including all per-language translations — used by PA form',
})
export class UserTypeFull extends Model {
    /** Legacy numeric id (maps to content_item.external_key) */
    @property({ type: 'number' })
    id?: number;

    /**
     * Workflow state of the content revision.
     *
     * DRAFT    : source text editable; NOT exported to Weblate yet.
     * APPROVED : source text frozen ("Send to translation" toggle ON).
     *            Non-source translations are marked STALE automatically.
     * PUBLISHED: live on the migrant frontend.
     * ARCHIVED : retired.
     */
    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    /** ISO 639-1 code of the authoring/source language (e.g. 'en') */
    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * Opaque extra metadata stored in content_revision.data_extra.
     * Convention: { icon: "<base64 data-URL | absolute URL>" }
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    /**
     * All per-language translation rows for the current preferred revision.
     * Keyed by lang code (e.g. "en", "ar", "fr").
     *
     * On GET: populated with every existing content_revision_translation row.
     * On PUT: the full map is sent back; each entry is upserted; languages
     *         absent from the payload are left untouched.
     */
    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: {
                type: 'object',
                required: ['title'],
                properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    tStatus: { type: 'string' },
                },
            },
        },
    })
    translations?: Record<string, UserTypeTranslationEntry>;

    constructor(data?: Partial<UserTypeFull>) {
        super(data);
    }
}