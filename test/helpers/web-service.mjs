import {expect} from '@playwright/test';
import {attachPageDiagnostics, expectSuccessfulResponse} from './diagnostics.mjs';

export async function verifyWebService({page, testInfo, service}) {
  const diagnostics = attachPageDiagnostics(page, service.label);
  console.log(`[MICADO][${service.label}] Opening ${service.url}`);

  try {
    const response = await page.goto(service.url, {waitUntil: 'domcontentloaded'});
    await expectSuccessfulResponse(response, service.label);
    await expect(page.locator('body')).toBeVisible();

    const title = (await page.title()).trim();
    const bodyText = (await page.locator('body').innerText()).trim();
    const finalUrl = page.url();

    console.log(`[MICADO][${service.label}] Final URL: ${finalUrl}`);
    console.log(`[MICADO][${service.label}] Page title: ${title || '(empty)'}`);

    expect(title, `${service.label} returned an empty page title`).not.toBe('');
    // Keycloak's admin console is a client-rendered SPA whose initial document
    // can legitimately have no visible body text and can still be navigating.
    // The successful response and title validate its shell without racing the
    // SPA by requesting a full page snapshot here.
    if (!service.allowEmptyBody) {
      expect(bodyText.length, `${service.label} returned an empty page body`).toBeGreaterThan(0);
    }

    if (service.expectedTitle) {
      expect(
        title.toLocaleLowerCase(),
        `${service.label} title does not contain "${service.expectedTitle}"`,
      ).toContain(service.expectedTitle.toLocaleLowerCase());
    }

    if (!service.allowEmptyBody) {
      await testInfo.attach(`${service.id}-page.html`, {
        body: Buffer.from(await page.content()),
        contentType: 'text/html',
      });
    }

    console.log(
      `[MICADO][${service.label}][SUCCESS] Service is reachable and page title is valid: "${title}"`,
    );
  } finally {
    await diagnostics.attach(testInfo);
  }
}
