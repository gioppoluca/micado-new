import {test, expect, request} from '@playwright/test';
const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_ADMIN ?? '';

test('late active language is dispatched exactly once', async () => {
  const api = await request.newContext({baseURL, extraHTTPHeaders: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }});
  const lang = `z${Date.now().toString(36).slice(-7)}`;
  let topicId: number | undefined;
  try {
    const sourceLang = (await (await api.get('/languages/default')).json() as {lang: string}).lang;
    expect((await api.post('/languages', {data: {lang, isoCode: lang, name: 'Late E2E language',
      active: false, isDefault: false, sortOrder: 999, voiceActive: false}})).status()).toBe(200);
    const created = await api.post('/topics', {data: {topic: 'Late language probe', description: '',
      sourceLang, parentId: null, translations: {[sourceLang]: {title: 'Late language probe', description: ''}}}});
    topicId = (await created.json() as {id: number}).id;
    expect((await api.put(`/topics/${topicId}`, {data: {status: 'APPROVED', sourceLang, parentId: null,
      translations: {[sourceLang]: {title: 'Late language probe', description: ''}}}})).status()).toBe(204);
    expect((await api.patch(`/languages/${lang}`, {data: {active: true}})).status()).toBe(204);

    const rows = await (await api.get('/topics')).json() as Array<{id: number; revisionId: string;
      status: string; translationStates: Record<string, string>}>;
    const row = rows.find(candidate => candidate.id === topicId)!;
    expect(row.status).toBe('APPROVED');
    expect(row.translationStates[sourceLang]).toBeUndefined();
    expect(row.translationStates[lang]).toBe('MISSING');

    const url = `/api/translations/revisions/${row.revisionId}/dispatch-missing`;
    const first = await api.post(url, {data: {languages: [lang]}});
    expect((await first.json() as {dispatched: string[]}).dispatched).toEqual([lang]);
    await expect.poll(async () => {
      const current = await (await api.get('/topics')).json() as Array<{id: number;
        translationStates: Record<string, string>}>;
      return current.find(candidate => candidate.id === topicId)?.translationStates[lang];
    }).toBe('SENT');
    const second = await api.post(url, {data: {languages: [lang]}});
    const secondBody = await second.json() as {dispatched: string[]; alreadyQueued: string[]};
    expect(secondBody.dispatched).toEqual([]);
    expect(secondBody.alreadyQueued).toContain(lang);
  } finally {
    if (topicId !== undefined) await api.delete(`/topics/${topicId}`);
    await api.delete(`/languages/${lang}`);
    await api.dispose();
  }
});
