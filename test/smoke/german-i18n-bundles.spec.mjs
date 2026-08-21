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

  const responses = await Promise.all(
    assetReferences.map(asset => request.get(asset, requestOptions)),
  );
  for (const [index, response] of responses.entries()) {
    expect(response.ok(), assetReferences[index]).toBeTruthy();
  }
  return (await Promise.all(responses.map(response => response.text()))).join('\n');
}

test.describe('German i18n bundles', () => {
  test('Migrant build contains the complete German UI bundle', async ({request}) => {
    const javascript = await applicationJavascript(request, 'migrants');
    expect(javascript).toContain('Sprache auswählen');
    expect(javascript).toContain('Dokument hinzufügen');
    expect(javascript).toContain('Ihre Privatsphäre ist uns wichtig');
  });

  test('PA build contains the German administration bundle', async ({request}) => {
    const javascript = await applicationJavascript(request, 'pa');
    expect(javascript).toContain('Meine Werkzeuge');
    expect(javascript).toContain('Dateneinstellungen');
    expect(javascript).toContain('Übersetzungen verwalten');
  });
});
