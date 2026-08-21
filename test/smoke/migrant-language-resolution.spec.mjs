import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';

const migrantUrl = `${environment.protocol}://migrants.${environment.baseDomain}/glossary`;

function hasPath(candidate, expectedPath) {
  return new URL(candidate).pathname === expectedPath;
}

function expectLanguageQuery(request, {official, selected}) {
  const url = new URL(request.url());
  expect(url.searchParams.get('defaultlang')).toBe(official);
  expect(url.searchParams.get('currentlang')).toBe(selected);
}

test.describe('Migrant language resolution', () => {
  test.use({locale: 'it-IT'});

  test('official default is the fallback and a persisted user choice wins', async ({page}) => {
    await page.addInitScript(() => localStorage.removeItem('micado:lang'));

    const defaultResponsePromise = page.waitForResponse(response =>
      hasPath(response.url(), '/languages/default'),
    );
    const languagesResponsePromise = page.waitForResponse(response =>
      hasPath(response.url(), '/languages'),
    );
    const initialGlossaryRequestPromise = page.waitForRequest(request =>
      hasPath(request.url(), '/glossaries-migrant'),
    );

    await page.goto(migrantUrl);

    const [defaultResponse, languagesResponse, initialGlossaryRequest] = await Promise.all([
      defaultResponsePromise,
      languagesResponsePromise,
      initialGlossaryRequestPromise,
    ]);
    expect(defaultResponse.ok()).toBeTruthy();
    expect(languagesResponse.ok()).toBeTruthy();

    const official = await defaultResponse.json();
    const languages = await languagesResponse.json();
    expect(official.active).toBe(true);
    expect(official.isDefault).toBe(true);
    expectLanguageQuery(initialGlossaryRequest, {
      official: official.lang,
      selected: official.lang,
    });

    const userChoice = languages.find(language =>
      language.active && language.lang !== official.lang,
    );
    test.skip(!userChoice, 'No second active language is configured for the user-choice check');

    await page.evaluate(lang => localStorage.setItem('micado:lang', lang), userChoice.lang);

    const selectedGlossaryRequestPromise = page.waitForRequest(request =>
      hasPath(request.url(), '/glossaries-migrant'),
    );
    await page.reload();
    const selectedGlossaryRequest = await selectedGlossaryRequestPromise;

    expectLanguageQuery(selectedGlossaryRequest, {
      official: official.lang,
      selected: userChoice.lang,
    });
  });
});
