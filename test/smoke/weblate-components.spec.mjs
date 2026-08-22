import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';

const categories = [
  'category',
  'event',
  'information',
  'glossary',
  'user-types',
  'topics',
  'process',
  'document-types',
];
const sourceLang = process.env.MICADO_SOURCE_LANG?.trim() || 'en';

test.describe('Weblate content components', () => {
  for (const category of categories) {
    test(`content-${category} exists`, async ({request}) => {
      const virtualHost = `weblate.${environment.baseDomain}`;
      const gatewayUrl = `${environment.protocol}://host.docker.internal`;
      const response = await request.get(
        `${gatewayUrl}/api/components/micado/content-${category}/`,
        {headers: {Host: virtualHost}},
      );
      const body = await response.text();

      expect(response.status(), body.slice(0, 500)).toBe(200);
      const component = JSON.parse(body);
      expect(component.slug).toBe(`content-${category}`);
      expect(component.filemask).toBe(`${category}/*.arb`);
      expect(component.template).toBe(`${category}/${sourceLang}.arb`);
      expect(component.file_format).toBe('arb');
    });
  }
});
