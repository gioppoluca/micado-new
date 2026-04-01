/**
 * src/models/document-type-full.model.ts
 *
 * Rich DTO for the PA form: GET /document-types/:id and PUT /document-types/:id.
 *
 * ── Data layout in the DB ────────────────────────────────────────────────────
 *
 *  content_item [DOCUMENT_TYPE]
 *    content_revision
 *      data_extra          → icon, issuer, model_template, validable,
 *                            validity_duration, pictures[]
 *      content_revision_translation (per lang)
 *        title             → document name
 *        description       → document description
 *        i18n_extra: {}    → (no extra translatable fields for DOCUMENT_TYPE)
 *
 *  content_item_relation  relation_type='hotspot'
 *    parent_item_id        → DOCUMENT_TYPE content_item
 *    child_item_id         → PICTURE_HOTSPOT content_item
 *    sort_order            → hotspot display order
 *    relation_extra        → { picture_id, x, y }
 *
 *  content_item [PICTURE_HOTSPOT]
 *    content_revision
 *      data_extra: {}      → empty (all positioning is in relation_extra)
 *      content_revision_translation (per lang)
 *        title             → pin label (short)
 *        i18n_extra        → { message: "tooltip body" }
 *
 *  content_item_relation  relation_type='validator'
 *    parent_item_id        → DOCUMENT_TYPE content_item
 *    child_item_id         → TENANT content_item
 *
 * ── PUT semantics ────────────────────────────────────────────────────────────
 *
 *  The facade diffs hotspots[] and validatorIds against the DB state:
 *    • hotspot in payload, absent in DB   → create PICTURE_HOTSPOT content_item + relation
 *    • hotspot in DB, absent in payload   → delete relation + content_item
 *    • hotspot in both                    → update relation_extra + upsert translations
 *    • validatorIds: full replace (delete removed, add new)
 *
 *  Languages absent from any translations map are left untouched (concurrent
 *  translator work on other languages is always preserved).
 */

import { Model, model, property } from '@loopback/repository';

// ─── Revision summary (version history panel) ─────────────────────────────────

@model()
export class RevisionSummary extends Model {
    @property({ type: 'number' })
    revisionNo: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    createdAt?: string;

    /** Unpacked from createdBy.name — frontend never drills into the JSONB. */
    @property({ type: 'string' })
    createdByName?: string;

    @property({ type: 'string' })
    publishedAt?: string;

    constructor(data?: Partial<RevisionSummary>) {
        super(data);
    }
}

// ─── Picture (binary asset, no translations) ──────────────────────────────────

/**
 * One document image stored inside dataExtra.pictures[].
 *
 * Pictures have NO translatable text — they are pure binary assets.
 * Annotated regions (pins) are PICTURE_HOTSPOT content_items referenced
 * via the stable `id` field.
 */
@model()
export class DocumentPicture extends Model {
    /**
     * Stable UUID assigned by the facade on first creation.
     * Used as `picture_id` in every hotspot's relation_extra.
     * Must not change across saves — hotspot links would break.
     */
    @property({ type: 'string', required: true })
    id: string;

    /** Base64 data URI of the picture (data:image/png;base64,...). */
    @property({ type: 'string', required: true })
    image: string;

    /** 1-based display order within this document type. */
    @property({ type: 'number', required: true })
    order: number;

    constructor(data?: Partial<DocumentPicture>) {
        super(data);
    }
}

// ─── Hotspot translation entry ────────────────────────────────────────────────

/**
 * Per-language content for a single PICTURE_HOTSPOT pin.
 *
 * title   → content_revision_translation.title     (pin label, kept short)
 * message → content_revision_translation.i18n_extra.message  (tooltip body)
 * tStatus → read-only on PUT input; populated on GET for per-tab badges.
 */
@model()
export class HotspotTranslationEntry extends Model {
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    message?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<HotspotTranslationEntry>) {
        super(data);
    }
}

// ─── Hotspot ──────────────────────────────────────────────────────────────────

/**
 * A PICTURE_HOTSPOT content_item as surfaced in DocumentTypeFull.
 *
 * Positioning fields (pictureId, x, y) are stored in
 * content_item_relation.relation_extra — NOT in the hotspot's data_extra —
 * because position is contextual to a specific picture of a specific document.
 *
 * id = undefined → new hotspot; facade creates the PICTURE_HOTSPOT content_item
 *                  and relation on save.
 * id = uuid      → existing hotspot; facade updates in place.
 */
@model()
export class DocumentHotspot extends Model {
    /**
     * UUID of the PICTURE_HOTSPOT content_item.
     * Absent when the PA editor adds a new pin — the facade assigns it.
     */
    @property({ type: 'string' })
    id?: string;

    /**
     * Must match one entry in dataExtra.pictures[].id.
     * Stored in content_item_relation.relation_extra.picture_id.
     */
    @property({ type: 'string', required: true })
    pictureId: string;

    /**
     * Horizontal pixel coordinate from the picture's left edge.
     * Stored in content_item_relation.relation_extra.x.
     */
    @property({ type: 'number', required: true })
    x: number;

    /**
     * Vertical pixel coordinate from the picture's top edge.
     * Stored in content_item_relation.relation_extra.y.
     */
    @property({ type: 'number', required: true })
    y: number;

    /** Display / tab order for this hotspot. Stored in content_item_relation.sort_order. */
    @property({ type: 'number' })
    sortOrder?: number;

    /**
     * Per-language translations for this pin.
     * On GET: populated from PICTURE_HOTSPOT content_revision_translation rows.
     * On PUT: upserted per language; absent languages are left untouched.
     */
    @property({
        type: 'object',
        jsonSchema: {
            additionalProperties: {
                type: 'object',
                required: ['title'],
                properties: {
                    title: { type: 'string' },
                    message: { type: 'string' },
                    tStatus: { type: 'string' },
                },
            },
        },
    })
    translations?: Record<string, HotspotTranslationEntry>;

    constructor(data?: Partial<DocumentHotspot>) {
        super(data);
    }
}

// ─── Document-level translation entry ────────────────────────────────────────

@model()
export class DocumentTypeTranslationEntry extends Model {
    /**
     * Document name in this language.
     * Maps to legacy `document` column → content_revision_translation.title.
     */
    @property({ type: 'string', required: true })
    title: string;

    @property({ type: 'string' })
    description?: string;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'STALE'] },
    })
    tStatus?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'STALE';

    constructor(data?: Partial<DocumentTypeTranslationEntry>) {
        super(data);
    }
}

// ─── DocumentTypeFull ─────────────────────────────────────────────────────────

@model({
    description: 'Full Document Type DTO — used by the PA form (GET/:id and PUT/:id)',
})
export class DocumentTypeFull extends Model {
    /** Legacy numeric id — maps to content_item.external_key. */
    @property({ type: 'number' })
    id?: number;

    @property({
        type: 'string',
        jsonSchema: { enum: ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] },
    })
    status?: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

    @property({ type: 'string' })
    sourceLang?: string;

    /**
     * Non-translatable metadata — stored in content_revision.data_extra.
     *
     * {
     *   icon:              string   data:image/png;base64,...
     *   issuer:            string   issuing authority, max 20 chars
     *   model_template:    string   nullable template reference
     *   validable:         boolean  required — master validation switch
     *   validity_duration: number   days until expiry; null = never expires
     *   pictures: [
     *     { id: uuid, image: "data:image/...", order: 1 },
     *     ...
     *   ]
     * }
     */
    @property({
        type: 'object',
        jsonSchema: { additionalProperties: true },
    })
    dataExtra?: Record<string, unknown>;

    /**
     * Document-level translations.
     * title → document name (legacy: `document` column)
     * description → long description
     * Keyed by lang code. On PUT: upserted; absent langs left untouched.
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
    translations?: Record<string, DocumentTypeTranslationEntry>;

    /**
     * Hotspot pins across all pictures, as a flat array.
     * Each entry carries its pictureId so the UI knows which picture
     * it belongs to without a nested structure.
     *
     * On GET: assembled from content_item_relation (relation_type='hotspot')
     *         + PICTURE_HOTSPOT revision translations.
     * On PUT: full diff against DB state — create / update / delete.
     */
    @property({
        type: 'array',
        itemType: DocumentHotspot,
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                required: ['pictureId', 'x', 'y'],
                properties: {
                    id: { type: 'string' },
                    pictureId: { type: 'string' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    sortOrder: { type: 'number' },
                    translations: {
                        type: 'object',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                message: { type: 'string' },
                                tStatus: { type: 'string' },
                            },
                        },
                    },
                },
            },
        },
    })
    hotspots?: DocumentHotspot[];

    /**
     * UUIDs of TENANT content_items authorised to validate this document.
     * Meaningful only when dataExtra.validable = true.
     *
     * On GET: populated from content_item_relation (relation_type='validator').
     * On PUT: full replace — facade deletes removed, adds new.
     */
    @property({
        type: 'array',
        jsonSchema: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
        },
    })
    validatorIds?: string[];

    /**
     * All revisions sorted ascending by revision_no.
     * Read-only on PUT (ignored by the backend if sent back).
     */
    @property({
        type: 'array',
        itemType: RevisionSummary,
        jsonSchema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    revisionNo: { type: 'number' },
                    status: { type: 'string' },
                    createdAt: { type: 'string' },
                    createdByName: { type: 'string' },
                    publishedAt: { type: 'string' },
                },
            },
        },
    })
    revisions?: RevisionSummary[];

    constructor(data?: Partial<DocumentTypeFull>) {
        super(data);
    }
}