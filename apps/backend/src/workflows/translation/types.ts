/**
 * src/workflows/translation/types.ts
 *
 * Shared types, ID conventions, and event key conventions for the
 * content translation + TTS workflow.
 *
 * ── Design note on multi-field revisions ────────────────────────────────────
 *
 * A content_revision has TWO translatable text fields: title and description.
 * Rather than spawning separate workflows per field, we treat the whole revision
 * as one atomic unit per language.  The Gitea JSON file stores both fields under
 * their own keys; one Weblate webhook signals that the entire revision/lang is done.
 *
 * TranslationJobInput.fields = { title: "...", description: "..." }
 *
 * ── Feature flags ────────────────────────────────────────────────────────────
 *
 * Two flags gate optional behaviour:
 *   ai_translation  — if true, pre-fill empty translation rows via AI before
 *                     pushing to Gitea (human translator sees a suggestion, not blank)
 *   tts             — if true, generate MP3 audio for each translated revision.
 *                     The source language is TTS-ed immediately on APPROVED;
 *                     target languages are TTS-ed after their Weblate webhook arrives.
 */

// ── Input ─────────────────────────────────────────────────────────────────────

export type TranslationJobInput = {
    /**
     * Stable UUID of the content_revision row.
     * Used as the durable workflow ID and for DB lookups.
     */
    revisionId: string;

    /**
     * Content type category — used as the Gitea folder name.
     * Matches the content_type.code pattern but lowercased and hyphenated.
     * Examples: 'user-types', 'news', 'processes', 'categories'
     */
    category: string;

    /**
     * The external/legacy numeric key of the content_item.
     * Used to build the Gitea file path and translation keys.
     */
    itemId: string;

    /**
     * Source language code (ISO 639-1, e.g. 'en', 'it').
     */
    sourceLang: string;

    /**
     * All translatable fields of the source revision.
     * Keys are field names ('title', 'description'), values are source text.
     * Empty-string values are skipped (not pushed to Gitea).
     */
    fields: Record<string, string>;

    /**
     * Language codes to translate into.
     * Already filtered by the caller: active languages minus source lang
     * minus langs with existing non-STALE translations.
     */
    targetLangs: string[];

    /**
     * Feature flags snapshot at workflow launch time.
     * Captured once by the facade so the workflow behaves consistently
     * even if flags change mid-run (durable workflow guarantee).
     */
    flags: {
        aiTranslation: boolean;  // pre-fill via AI before pushing to Gitea
        tts: boolean;  // generate MP3 for each translation
    };
};

// ── Webhook payload (Weblate → backend) ──────────────────────────────────────

export type WeblateWebhookPayload = {
    revisionId: string;
    lang: string;
    /** SHA-256 of the source fields JSON — idempotency key for re-deliveries. */
    sourceHash: string;
    /**
     * All translated fields for this revision/lang.
     * Keys match TranslationJobInput.fields keys ('title', 'description').
     */
    fields: Record<string, string>;
};

// ── Child workflow input ──────────────────────────────────────────────────────

export type ChildWorkflowInput = {
    revisionId: string;
    category: string;
    itemId: string;
    sourceLang: string;
    lang: string;
    fields: Record<string, string>;  // source fields (for hash + AI pre-fill ref)
    flags: TranslationJobInput['flags'];
};

// ── States ────────────────────────────────────────────────────────────────────

export type TranslationStatus =
    | 'WAITING_TRANSLATION'
    | 'RECEIVED_TRANSLATION'
    | 'GENERATING_MP3'
    | 'SAVING_TO_DB'
    | 'DONE'
    | 'TIMEOUT'
    | 'ERROR';

// ── ID and key conventions (single source of truth) ──────────────────────────

export const wfId = {
    master: (revisionId: string) => `tr:${revisionId}`,
    child: (revisionId: string, lang: string) => `tr:${revisionId}:${lang}`,
    /** Source-lang TTS runs as a sibling of the master, not inside a child. */
    srcTts: (revisionId: string) => `tr:${revisionId}:src-tts`,
};

export const evKey = {
    childStatus: (lang: string) => `lang:${lang}:status`,
    childMp3: (lang: string) => `lang:${lang}:mp3Url`,
    masterDone: () => `master:done`,
};

export const recvTopic = (lang: string) => `weblate-import:${lang}`;

export const sendKey = (revisionId: string, lang: string, sourceHash: string) =>
    `weblate:${revisionId}:${lang}:${sourceHash}`;