export type TranslationJobInput = {
    revisionId: string;      // e.g. "article:42:title"
    category: string;      // e.g. "articles"
    fieldKey: string;      // e.g. "title"
    itemId: string;      // e.g. "42"
    sourceText: string;      // the EN string to translate
    targetLangs: string[];   // e.g. ["it", "de", "fr"]
};

export type WeblateWebhookPayload = {
    revisionId: string;
    lang: string;
    sourceHash: string;     // hash of EN source — used as idempotency key
    translation: string;     // the translated string
};

export type ChildWorkflowInput = {
    revisionId: string;
    category: string;
    fieldKey: string;
    itemId: string;
    lang: string;
    sourceText: string;     // needed to detect source changes
};

// All possible child states — stored via DBOS.setEvent()
export type TranslationStatus =
    | 'WAITING_TRANSLATION'
    | 'RECEIVED_TRANSLATION'
    | 'GENERATING_MP3'
    | 'SAVING_TO_DB'
    | 'DONE'
    | 'TIMEOUT'
    | 'ERROR';

// ---- workflow ID conventions (centralised here to avoid typos) ----
export const wfId = {
    master: (revisionId: string) => `tr:${revisionId}`,
    child: (revisionId: string, lang: string) => `tr:${revisionId}:${lang}`,
};

// ---- event key conventions ----
export const evKey = {
    childStatus: (lang: string) => `lang:${lang}:status`,
    childMp3: (lang: string) => `lang:${lang}:mp3Url`,
    masterDone: () => `master:done`,
};

// ---- DBOS.recv topic convention ----
export const recvTopic = (lang: string) => `weblate-import:${lang}`;

// ---- DBOS.send idempotency key ----
export const sendKey = (revisionId: string, lang: string, sourceHash: string) =>
    `weblate:${revisionId}:${lang}:${sourceHash}`;