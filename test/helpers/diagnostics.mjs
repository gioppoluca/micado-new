import {expect} from '@playwright/test';

export function attachPageDiagnostics(page, service) {
  const errors = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      const detail = `[browser console] ${message.text()}`;
      errors.push(detail);
      console.error(`[MICADO][${service}] ${detail}`);
    }
  });

  page.on('pageerror', error => {
    const detail = `[page error] ${error.message}`;
    errors.push(detail);
    console.error(`[MICADO][${service}] ${detail}`);
  });

  page.on('requestfailed', request => {
    const detail = `[request failed] ${request.method()} ${request.url()} - ${request.failure()?.errorText}`;
    errors.push(detail);
    console.error(`[MICADO][${service}] ${detail}`);
  });

  return {
    errors,
    async attach(testInfo) {
      await testInfo.attach(`${service.toLowerCase()}-browser-errors`, {
        body: Buffer.from(errors.length ? errors.join('\n') : 'No browser errors captured.'),
        contentType: 'text/plain',
      });
    },
  };
}

export async function expectSuccessfulResponse(response, label) {
  expect(response, `${label} navigation did not return an HTTP response`).not.toBeNull();
  console.log(`[MICADO][${label}] HTTP ${response.status()} ${response.url()}`);
  expect(response.status(), `${label} returned HTTP ${response.status()}`).toBeGreaterThanOrEqual(200);
  expect(response.status(), `${label} returned HTTP ${response.status()}`).toBeLessThan(400);
  console.log(`[MICADO][${label}][SUCCESS] HTTP response accepted (${response.status()})`);
}
