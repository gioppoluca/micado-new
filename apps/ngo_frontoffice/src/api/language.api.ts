/**
 * src/api/language.api.ts
 *
 * All HTTP calls related to the /languages resource.
 *
 * Real endpoints (from backend LanguageController):
 *   GET    /languages           → list (filterable by active, q)
 *   GET    /languages/:lang     → single language
 *   POST   /languages           → create  [admin roles only]
 *   PATCH  /languages/:lang     → partial update [admin roles only]
 *   PUT    /languages/:lang     → full replace   [admin roles only]
 *   DELETE /languages/:lang     → delete         [admin roles only]
 *
 * Mock handlers are registered at the bottom and only activate when
 * VITE_API_MOCK=true (see mock.ts).
 */

import { logger } from 'src/services/Logger';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from './client';
import type { MockRegistry, MockRequestConfig, MockReplyTuple } from './mock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Language {
    lang: string;        // Primary key (e.g. 'en', 'ar')
    isoCode?: string;    // BCP-47 (e.g. 'en-GB')
    name: string;        // Display name in English
    active: boolean;
    isDefault: boolean;
    sortOrder: number;
    voiceString?: string | undefined;
    voiceActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export type CreateLanguagePayload = Omit<Language, 'createdAt' | 'updatedAt'>;
export type PatchLanguagePayload = Partial<CreateLanguagePayload>;

export interface LanguageListParams {
    active?: boolean;
    q?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const languageApi = {
    /**
     * List all languages, optionally filtered.
     * Auth: migrant_user, pa_editor, ngo_editor, admin
     */
    async list(params?: LanguageListParams): Promise<Language[]> {
        logger.info('[language.api] list', params);
        return apiGet<Language[]>('/languages', { params });
    },

    /**
     * Fetch the platform default language (is_default = true).
     * Single source of truth — not the settings table.
     * Auth: public.
     */
    async getDefault(): Promise<Language> {
        logger.info('[language.api] getDefault');
        return apiGet<Language>('/languages/default');
    },

    /**
     * Fetch a single language by its lang key.
     * Auth: migrant_user, pa_editor, ngo_editor, admin
     */
    async getOne(lang: string): Promise<Language> {
        logger.info('[language.api] getOne', { lang });
        return apiGet<Language>(`/languages/${lang}`);
    },

    /**
     * Create a new language entry.
     * Auth: pa_editor, ngo_editor, admin
     */
    async create(payload: CreateLanguagePayload): Promise<Language> {
        logger.info('[language.api] create', { lang: payload.lang });
        return apiPost<Language>('/languages', payload);
    },

    /**
     * Partially update a language entry.
     * Auth: pa_editor, ngo_editor, admin
     */
    async patch(lang: string, payload: PatchLanguagePayload): Promise<void> {
        logger.info('[language.api] patch', { lang, fields: Object.keys(payload) });
        return apiPatch<void>(`/languages/${lang}`, payload);
    },

    /**
     * Fully replace a language entry.
     * Auth: pa_editor, ngo_editor, admin
     */
    async replace(lang: string, payload: CreateLanguagePayload): Promise<void> {
        logger.info('[language.api] replace', { lang });
        return apiPut<void>(`/languages/${lang}`, payload);
    },

    /**
     * Delete a language entry.
     * Auth: admin
     */
    async remove(lang: string): Promise<void> {
        logger.warn('[language.api] remove', { lang });
        return apiDelete(`/languages/${lang}`);
    },
};

// ─── Mock handlers ────────────────────────────────────────────────────────────
// These are only registered when VITE_API_MOCK=true.
// Keep them in sync with the real API signatures above.

const MOCK_LANGUAGES: Language[] = [
    { lang: 'en', isoCode: 'en-GB', name: 'English', active: true, isDefault: true, sortOrder: 1, voiceString: 'UK English Female', voiceActive: true },
    { lang: 'ar', isoCode: 'ar', name: 'Arabic', active: true, isDefault: false, sortOrder: 2, voiceString: 'Arabic Female', voiceActive: true },
    { lang: 'fr', isoCode: 'fr-FR', name: 'French', active: true, isDefault: false, sortOrder: 3, voiceString: 'French Female', voiceActive: false },
    { lang: 'uk', isoCode: 'uk', name: 'Ukrainian', active: true, isDefault: false, sortOrder: 4, voiceString: undefined, voiceActive: false },
    { lang: 'ti', isoCode: 'ti', name: 'Tigrinya', active: false, isDefault: false, sortOrder: 99, voiceString: undefined, voiceActive: false },
];

export function registerLanguageMocks(mock: MockRegistry): void {
    // GET /languages
    mock.onGet('/languages').reply((config: MockRequestConfig): MockReplyTuple => {
        const params = config.params ?? {};
        let result = [...MOCK_LANGUAGES];

        const active = params['active'];
        if (active !== undefined) {
            result = result.filter(l => l.active === (active === 'true' || active === true));
        }

        const q = params['q'];
        if (q) {
            const lq = String(q).toLowerCase();
            result = result.filter(
                l => l.lang.includes(lq) || l.name.toLowerCase().includes(lq) || (l.isoCode ?? '').toLowerCase().includes(lq),
            );
        }

        logger.debug('[mock] GET /languages', { count: result.length });
        return [200, result];
    });

    // GET /languages/default — registered before /:lang so axios-mock-adapter
    // matches the exact string before the wildcard regex.
    mock.onGet('/languages/default').reply((): MockReplyTuple => {
        const found = MOCK_LANGUAGES.find(l => l.isDefault);
        if (!found) return [404, { error: 'No default language configured' }];
        logger.debug('[mock] GET /languages/default', { lang: found.lang });
        return [200, found];
    });

    // GET /languages/:lang
    mock.onGet(/\/languages\/\w+/).reply((config: MockRequestConfig): MockReplyTuple => {
        const lang = (config.url ?? '').split('/').pop() ?? '';
        const found = MOCK_LANGUAGES.find(l => l.lang === lang);
        if (!found) return [404, { error: `Language '${lang}' not found` }];
        return [200, found];
    });

    // POST /languages
    mock.onPost('/languages').reply(201, MOCK_LANGUAGES[0]);

    // PATCH /languages/:lang
    mock.onPatch(/\/languages\/\w+/).reply(204);

    // PUT /languages/:lang
    mock.onPut(/\/languages\/\w+/).reply(204);

    // DELETE /languages/:lang
    mock.onDelete(/\/languages\/\w+/).reply(204);

    logger.debug('[mock] language handlers registered');
}