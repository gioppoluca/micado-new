import {test} from '@playwright/test';
import {webServices} from '../helpers/environment.mjs';
import {verifyWebService} from '../helpers/web-service.mjs';

test.describe('Traefik web services', () => {
  for (const service of webServices) {
    test(`${service.label} serves a valid page`, async ({page}, testInfo) => {
      await verifyWebService({page, testInfo, service});
    });
  }
});
