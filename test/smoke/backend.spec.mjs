import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';

test('public backend endpoint responds', async ({request}) => {
  const path = environment.backendPublicPath.startsWith('/')
    ? environment.backendPublicPath
    : `/${environment.backendPublicPath}`;
  const url = `${environment.backendBaseUrl}${path}`;

  console.log(`[MICADO][BACKEND] GET ${url}`);
  const startedAt = Date.now();
  const response = await request.get(url);
  const elapsed = Date.now() - startedAt;
  const body = await response.text();

  console.log(`[MICADO][BACKEND] HTTP ${response.status()} in ${elapsed} ms`);
  console.log(`[MICADO][BACKEND] Content-Type: ${response.headers()['content-type'] || 'not provided'}`);

  await test.info().attach('backend-response.txt', {
    body: Buffer.from(body),
    contentType: response.headers()['content-type'] || 'text/plain',
  });

  expect(response.ok(), `Unexpected response body: ${body.slice(0, 500)}`).toBeTruthy();
  expect(body.trim().length, 'The backend returned an empty response body').toBeGreaterThan(0);
  console.log(`[MICADO][BACKEND][SUCCESS] Public endpoint responded in ${elapsed} ms with a non-empty body`);
});
