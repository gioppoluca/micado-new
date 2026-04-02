/**
 * src/api/micado-entities.api.ts
 *
 * HTTP calls per le entità MICADO linkabili nel rich-text editor:
 *   Glossary, Information Centre, Guided Process (flows), Event.
 *
 * Segue esattamente lo stesso pattern di src/api/language.api.ts:
 *  - Tipi TypeScript espliciti
 *  - apiGet<T> dal client centrale
 *  - Mock handlers in fondo (attivi con VITE_API_MOCK=true)
 *  - Logging tramite logger di src/services/Logger.ts
 *
 * Le entità "temp" includono sia bozze che pubblicate, perché gli autori
 * devono poter linkare contenuti non ancora pubblici (stesso comportamento
 * del legacy con glossaryTemp, informationTemp, ecc.).
 *
 * TODO: adattare i percorsi API (/glossary-items, ecc.) ai reali endpoint
 * LoopBack 4 del backend quando saranno disponibili. Attualmente i path
 * seguono la convenzione kebab-case del modello LoopBack 4.
 */

import { logger } from 'src/services/Logger';
import { apiGet } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Tipi ─────────────────────────────────────────────────────────────────────

/** Traduzione di un'entità per una singola lingua */
export interface EntityTranslation {
    lang: string;
    title?: string;
    /** Solo per Guided Process: il titolo è nel campo 'process' */
    process?: string;
    description: string;
    translationState?: number;
}

/**
 * Entità base condivisa da tutti i tipi linkabili.
 * Il campo `title` è assente per i Guided Process (usano `process`).
 */
export interface MicadoEntity {
    id: number;
    title?: string;
    /** Solo Guided Process */
    process?: string;
    description?: string;
    published: boolean;
    translations: EntityTranslation[];
}

/** Parametri comuni di lista per le entità linkabili */
export interface EntityListParams {
    /** Lingua di default (per il fallback nelle traduzioni) */
    defaultLang?: string;
    /** Lingua dell'utente corrente */
    userLang?: string;
    /** Se true, include anche le bozze (default: true per uso nell'editor) */
    includeDraft?: boolean;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const micadoEntitiesApi = {

    /**
     * Lista tutti i Glossary items (bozze + pubblicati).
     * Auth: public (@authenticate.skip) — necessario per il mention picker
     * nell'editor anche prima dell'autenticazione Keycloak.
     *
     * Endpoint: GET /glossary-items?defaultlang=&currentlang=&includeDraft=true
     * Implementato in GlossariesController.mentionPickerList().
     *
     * Il backend restituisce { id, title, lang, published }[] — mappiamo
     * a MicadoEntity[] qui per mantenere compatibilità con il mention system.
     */
    async listGlossary(params?: EntityListParams): Promise<MicadoEntity[]> {
        logger.info('[micado-entities.api] listGlossary', params);
        const raw = await apiGet<Array<{ id: number; title: string; lang: string; published: boolean }>>('/glossary-items', { params });
        return raw.map(item => ({
            id: item.id,
            title: item.title,
            published: item.published,
            translations: [{ lang: item.lang, title: item.title, description: '' }],
        }));
    },

    /**
     * Lista tutti gli Information Centre items (bozze + pubblicati).
     * Auth: pa_editor, admin
     *
     * TODO: adattare path al reale endpoint LoopBack 4.
     */
    async listInformation(params?: EntityListParams): Promise<MicadoEntity[]> {
        logger.info('[micado-entities.api] listInformation', params);
        return apiGet<MicadoEntity[]>('/information-items', { params });
    },

    /**
     * Lista tutti i Guided Process (bozze + pubblicati).
     * Auth: pa_editor, admin
     *
     * NOTA: il titolo è nel campo `process`, non `title`.
     * TODO: adattare path al reale endpoint LoopBack 4.
     */
    async listProcesses(params?: EntityListParams): Promise<MicadoEntity[]> {
        logger.info('[micado-entities.api] listProcesses', params);
        return apiGet<MicadoEntity[]>('/processes', { params });
    },

    /**
     * Lista tutti gli Event (bozze + pubblicati).
     * Auth: pa_editor, admin
     *
     * TODO: adattare path al reale endpoint LoopBack 4.
     */
    async listEvents(params?: EntityListParams): Promise<MicadoEntity[]> {
        logger.info('[micado-entities.api] listEvents', params);
        return apiGet<MicadoEntity[]>('/events', { params });
    },
};

// ─── Mock handlers ─────────────────────────────────────────────────────────────
// Attivi solo con VITE_API_MOCK=true. Seguono il pattern di language.api.ts.

const MOCK_GLOSSARY: MicadoEntity[] = [
    {
        id: 1, title: 'asylum seeker', published: true,
        description: 'Person who has applied for refugee status.',
        translations: [
            { lang: 'en', title: 'asylum seeker', description: 'Person who has applied for refugee status.' },
            { lang: 'it', title: 'richiedente asilo', description: 'Persona che ha richiesto lo status di rifugiato.' },
        ],
    },
    {
        id: 2, title: 'residence permit', published: true,
        description: 'Official document authorising stay in a country.',
        translations: [
            { lang: 'en', title: 'residence permit', description: 'Official document authorising stay.' },
        ],
    },
    {
        id: 3, title: 'draft glossary term', published: false,
        description: 'Draft term not yet published.',
        translations: [
            { lang: 'en', title: 'draft glossary term', description: 'Draft term not yet published.' },
        ],
    },
];

const MOCK_INFORMATION: MicadoEntity[] = [
    {
        id: 10, title: 'health rights', published: true,
        description: 'Information about healthcare rights for migrants.',
        translations: [
            { lang: 'en', title: 'health rights', description: 'Information about healthcare rights.' },
        ],
    },
];

const MOCK_PROCESSES: MicadoEntity[] = [
    {
        id: 20, process: 'visa application', published: true,
        description: 'Steps to apply for a visa.',
        translations: [
            { lang: 'en', process: 'visa application', description: 'Steps to apply for a visa.' },
        ],
    },
];

const MOCK_EVENTS: MicadoEntity[] = [
    {
        id: 30, title: 'community event', published: true,
        description: 'Monthly community gathering.',
        translations: [
            { lang: 'en', title: 'community event', description: 'Monthly community gathering.' },
        ],
    },
];

export function registerMicadoEntitiesMocks(mock: MockRegistry): void {
    mock.onGet('/glossary-items').reply((_config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /glossary-items', _config);
        return [200, MOCK_GLOSSARY];
    });

    mock.onGet('/information-items').reply((_config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /information-items', _config);
        return [200, MOCK_INFORMATION];
    });

    mock.onGet('/processes').reply((_config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /processes', _config);
        return [200, MOCK_PROCESSES];
    });

    mock.onGet('/events').reply((_config: MockRequestConfig): MockReplyTuple => {
        logger.debug('[mock] GET /events', _config);
        return [200, MOCK_EVENTS];
    });

    logger.debug('[mock] micado-entities handlers registered');
}