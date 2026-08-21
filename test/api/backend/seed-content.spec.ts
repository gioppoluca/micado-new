import {test, expect, request, APIRequestContext} from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

async function publicApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {'Content-Type': 'application/json'},
    });
}

async function adminApi(): Promise<APIRequestContext> {
    return request.newContext({
        baseURL,
        extraHTTPHeaders: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
}

async function list(api: APIRequestContext, path: string): Promise<Array<Record<string, unknown>>> {
    const response = await api.get(path);
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    return response.json() as Promise<Array<Record<string, unknown>>>;
}

function seeded(items: Array<Record<string, unknown>>, id = 1): Record<string, unknown> {
    const item = items.find(candidate => candidate.id === id);
    expect(item, `Seeded item ${id} is missing`).toBeTruthy();
    return item!;
}

test.describe('Published seed content', () => {
    test('covers migrant endpoints, preferred translations, fallback and relations', async () => {
        const api = await publicApi();

        const defaultResponse = await api.get('/languages/default');
        expect(defaultResponse.status()).toBe(200);
        const official = await defaultResponse.json() as Record<string, unknown>;
        expect(official.lang).toBe('en');
        expect(official.active).toBe(true);
        expect(official.isDefault).toBe(true);

        const topics = await list(api, '/topics-migrant?defaultlang=en&currentlang=it');
        expect(seeded(topics, 4)).toMatchObject({topic: 'Alloggio', lang: 'it'});

        const categories = await list(
            api,
            '/categories-migrant?subtype=information&defaultlang=en&currentlang=it',
        );
        expect(seeded(categories)).toMatchObject({title: 'Servizi pubblici', lang: 'it'});

        const documentTypes = await list(
            api,
            '/document-types-migrant?defaultlang=en&currentlang=it',
        );
        expect(seeded(documentTypes)).toMatchObject({
            document: 'Permesso di soggiorno',
            lang: 'it',
            validable: true,
        });

        const glossary = await list(api, '/glossaries-migrant?defaultlang=en&currentlang=de');
        expect(seeded(glossary)).toMatchObject({title: 'Aufenthaltserlaubnis', lang: 'de'});

        const information = seeded(await list(
            api,
            '/information-migrant?defaultlang=en&currentlang=it',
        ));
        expect(information).toMatchObject({
            title: 'Iscrizione al servizio sanitario',
            lang: 'it',
            categoryId: 1,
            topicIds: [5],
            userTypeIds: [2],
        });

        const events = seeded(await list(
            api,
            '/events-migrant?defaultlang=en&currentlang=it',
        ));
        expect(events).toMatchObject({
            title: 'Incontro di accoglienza e orientamento',
            lang: 'it',
            categoryId: 2,
            topicIds: [2],
            userTypeIds: [2],
        });

        const processes = seeded(await list(
            api,
            '/processes-migrant?defaultlang=en&currentlang=it',
        ));
        expect(processes).toMatchObject({
            title: 'Richiedere il permesso di soggiorno',
            lang: 'it',
            topicIds: [1],
            userTypeIds: [2],
        });

        // Spanish is registered but this sample has no Spanish translation:
        // the official English translation must be returned, never a guessed one.
        const fallbackProcesses = seeded(await list(
            api,
            '/processes-migrant?defaultlang=en&currentlang=es',
        ));
        expect(fallbackProcesses).toMatchObject({
            title: 'Apply for a residence permit',
            lang: 'en',
        });
    });

    test('published revisions contain the official translation and process relations', async () => {
        const api = await adminApi();

        const activeLanguagesResponse = await api.get('/languages?active=true');
        expect(activeLanguagesResponse.status()).toBe(200);
        const activeLanguages = await activeLanguagesResponse.json() as Array<{lang: string}>;
        expect(activeLanguages.map(language => language.lang).sort()).toEqual(['de', 'en', 'it']);

        const translationStateResponse = await api.get('/public/settings/translationState');
        expect(translationStateResponse.status()).toBe(200);
        const translationStateSetting = await translationStateResponse.json() as {value: string};
        const translationStates = JSON.parse(translationStateSetting.value) as Array<{
            value: string;
            translation: Array<{lang: string; state: string}>;
        }>;
        for (const state of translationStates) {
            expect(state.translation.map(entry => entry.lang).sort()).toEqual(['de', 'en', 'it']);
            expect(state.translation.find(entry => entry.lang === 'de')?.state).toBeTruthy();
        }

        const featureFlagsResponse = await api.get('/features-flags?lang=de');
        expect(featureFlagsResponse.status()).toBe(200);
        const featureFlags = await featureFlagsResponse.json() as Array<{label: string | null}>;
        expect(featureFlags.length).toBeGreaterThan(0);
        expect(featureFlags.every(flag => Boolean(flag.label))).toBe(true);

        for (const resource of [
            'categories',
            'document-types',
            'glossaries',
            'information',
            'events',
            'processes',
        ]) {
            const response = await api.get(`/${resource}/1`);
            expect(response.status(), `${resource}/1: ${await response.text()}`).toBe(200);
            const body = await response.json() as Record<string, unknown>;
            expect(body.status).toBe('PUBLISHED');
            expect(body.sourceLang).toBe('en');
            const translations = body.translations as Record<string, Record<string, unknown>>;
            expect(translations.en?.tStatus).toBe('PUBLISHED');
            expect(translations.it?.tStatus).toBe('PUBLISHED');
        }

        const processResponse = await api.get('/processes/1');
        const process = await processResponse.json() as Record<string, unknown>;
        expect(process.topicIds).toEqual([1]);
        expect(process.userTypeIds).toEqual([2]);
        expect(process.producedDocTypeIds).toEqual([1]);

        const graphResponse = await api.get('/processes/1/graph');
        expect(graphResponse.status()).toBe(200);
        const graph = await graphResponse.json() as {
            nodes: Array<Record<string, unknown>>;
            edges: Array<Record<string, unknown>>;
        };
        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);
        for (const node of graph.nodes) {
            const data = node.data as Record<string, unknown>;
            expect(data.status).toBe('PUBLISHED');
            const translations = data.translations as Record<string, Record<string, unknown>>;
            expect(translations.en?.tStatus).toBe('PUBLISHED');
            expect(translations.it?.tStatus).toBe('PUBLISHED');
        }
    });
});
