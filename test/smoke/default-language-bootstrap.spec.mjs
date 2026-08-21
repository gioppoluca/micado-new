import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';

for (const app of ['pa', 'migrants']) {
  test(`${app} bootstrap loads the official default language endpoint`, async ({page}) => {
    const defaultLanguageResponse = page.waitForResponse(response =>
      response.url().includes('/languages/default'),
    );

    await page.goto(`${environment.protocol}://${app}.${environment.baseDomain}`);

    const response = await defaultLanguageResponse;
    expect(response.status()).toBe(200);
    const language = await response.json();
    expect(language.active).toBe(true);
    expect(language.isDefault).toBe(true);
    expect(language.lang).toBeTruthy();
  });
}
