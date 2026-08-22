import {test, expect} from '@playwright/test';
import {environment} from '../helpers/environment.mjs';

async function applicationJavascript(request, app) {
  const virtualHost = `${app}.${environment.baseDomain}`;
  const gatewayUrl = `${environment.protocol}://host.docker.internal`;
  const requestOptions = {headers: {Host: virtualHost}};
  const documentResponse = await request.get(gatewayUrl, requestOptions);
  expect(documentResponse.ok(), `${app} document: ${documentResponse.status()}`).toBeTruthy();

  const html = await documentResponse.text();
  const assetReferences = [...html.matchAll(
    /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi,
  )].map(match => new URL(match[1], gatewayUrl).href);

  expect(assetReferences.length, `${app} has no JavaScript assets`).toBeGreaterThan(0);

  const pending = [...assetReferences];
  const visited = new Set();
  const sources = [];

  while (pending.length > 0) {
    const asset = pending.shift();
    if (!asset || visited.has(asset)) continue;
    visited.add(asset);

    const response = await request.get(asset, requestOptions);
    expect(response.ok(), asset).toBeTruthy();
    const source = await response.text();
    sources.push(source);

    // In dev mode the HTML references only Quasar's client-entry module.
    // Follow its same-host application imports until the actual i18n modules;
    // production builds are covered by the same traversal through /assets/.
    const imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g,
    );
    for (const match of imports) {
      const imported = new URL(match[1], asset);
      if (imported.origin !== new URL(gatewayUrl).origin) continue;
      if (!/^\/(?:src|assets|\.quasar)\//.test(imported.pathname)) continue;
      if (!visited.has(imported.href)) pending.push(imported.href);
    }
  }

  return sources.join('\n');
}

test.describe('German i18n bundles', () => {
  test('Migrant build contains the complete German UI bundle', async ({request}) => {
    const javascript = await applicationJavascript(request, 'migrants');
    expect(javascript).toContain('Sprache auswählen');
    expect(javascript).toContain('Dokument hinzufügen');
    expect(javascript).toContain('Wir legen Wert auf Ihre Privatsphäre');
  });

  test('PA build contains the German administration bundle', async ({request}) => {
    const javascript = await applicationJavascript(request, 'pa');
    expect(javascript).toContain('Meine Werkzeuge');
    expect(javascript).toContain('Dateneinstellungen');
    expect(javascript).toContain('Übersetzungen verwalten');
  });
});
