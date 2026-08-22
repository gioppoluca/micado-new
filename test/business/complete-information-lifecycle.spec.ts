import {expect, test, type APIResponse} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {environment} from '../helpers/environment.mjs';
import {attachPageDiagnostics} from '../helpers/diagnostics.mjs';
import {queryPostgres} from '../helpers/postgres';

// Worker-scoped recording options must be declared at file level. Placing
// these inside test.describe() makes Playwright reject the suite at discovery.
test.use({
  trace: 'on',
  video: 'on',
  screenshot: 'on',
});

interface CreatedInformationDbRow {
  itemId: string;
  externalKey: string;
  typeCode: string;
  publishedRevisionId: string | null;
  revisionId: string;
  revisionNo: number;
  revisionStatus: string;
  sourceLang: string;
  translationLang: string;
  title: string;
  description: string | null;
  translationStatus: string;
  sourceHash: string | null;
  createdByUsername: string | null;
}

function flow(message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
  console.log(`[MICADO][CBL][FLOW] ${message}${suffix}`);
}

function check(message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
  console.log(`[MICADO][CBL][CHECK][PASS] ${message}${suffix}`);
}

/**
 * Complete business logic — Information lifecycle.
 *
 * This first increment deliberately implements only:
 *   1. real PA login through Keycloak;
 *   2. real Information creation through the PA browser form;
 *   3. direct read-only verification in the application PostgreSQL database.
 *
 * The test writes real development data and does not clean it up. Every run
 * uses a unique marker so its UI/API/DB/Git/Weblate evidence can be correlated
 * when the remaining lifecycle steps are added.
 */
test.describe('Complete business logic — Information lifecycle', () => {
  test('creates a real draft Information from the PA UI', async ({page}, testInfo) => {
    flow('Test process entered', {
      enabled: process.env.RUN_COMPLETE_BUSINESS_LOGIC === 'true',
      paUrl: environment.paBaseUrl,
      paUsername: environment.paAdminUsername,
      database: `${environment.appDbHost}:${environment.appDbPort}/${environment.appDbName}`,
      artifactsDirectory: testInfo.outputDir,
    });

    if (process.env.RUN_COMPLETE_BUSINESS_LOGIC !== 'true') {
      console.warn('[MICADO][CBL][SKIP] RUN_COMPLETE_BUSINESS_LOGIC is not exactly "true". No Information was created.');
    }
    test.skip(
      process.env.RUN_COMPLETE_BUSINESS_LOGIC !== 'true',
      'Set RUN_COMPLETE_BUSINESS_LOGIC=true: this test creates persistent development data.',
    );
    if (!environment.paAdminPassword) {
      console.warn('[MICADO][CBL][SKIP] PA_ADMIN_PASSWORD is empty. No Information was created.');
    }
    test.skip(!environment.paAdminPassword, 'PA_ADMIN_PASSWORD is missing from the project .env.');

    test.setTimeout(120_000);

    const marker = `cbl-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    const sourceTitle = `CBL source ${marker}`;
    const sourceDescription = `Complete business logic test information ${marker}`;
    const diagnostics = attachPageDiagnostics(page, 'CBL-PA');
    const recordedVideo = page.video();

    flow('Run identity generated', {marker, sourceTitle, sourceDescription});

    page.on('request', request => {
      try {
        if (new URL(request.url()).pathname === '/information') {
          flow(`HTTP request ${request.method()} /information`, request.postDataJSON() ?? undefined);
        }
      } catch {
        // Ignore non-standard browser URLs.
      }
    });
    page.on('response', response => {
      try {
        if (new URL(response.url()).pathname === '/information') {
          flow(`HTTP response ${response.status()} ${response.request().method()} /information`);
        }
      } catch {
        // Ignore non-standard browser URLs.
      }
    });

    let createResponse: APIResponse | undefined;
    let created: Record<string, unknown> | undefined;
    let databaseRow: CreatedInformationDbRow | undefined;

    try {
      await test.step('1 — log in to the PA as pa_admin', async () => {
        flow('STEP 1 START — open PA home and use its Login control');

        const homeResponse = await page.goto(`${environment.paBaseUrl}/`, {waitUntil: 'domcontentloaded'});
        expect(homeResponse, 'Opening the PA home returned no HTTP response').not.toBeNull();
        expect(homeResponse!.ok(), `PA home returned HTTP ${homeResponse!.status()}`).toBeTruthy();
        check('Public PA home opened', {url: page.url(), status: homeResponse!.status()});
        await testInfo.attach('01a-pa-public-home.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        const loginMenuItem = page.locator('.q-item').filter({hasText: /^\s*Login\s*$/}).first();
        await expect(loginMenuItem, 'The PA sidebar Login control is not visible').toBeVisible();
        check('PA Login control is visible');
        await loginMenuItem.click();
        flow('PA Login control clicked; waiting for Keycloak');

        await expect(page.locator('#username')).toBeVisible();
        expect(page.url(), 'The PA Login control did not navigate to Keycloak').toContain('/realms/pa_frontoffice/');
        check('Keycloak login form reached through the PA Login control', {url: page.url()});
        await testInfo.attach('01b-keycloak-login-form.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        await page.locator('#username').fill(environment.paAdminUsername);
        await page.locator('#password').fill(environment.paAdminPassword);
        check('Keycloak credentials entered', {username: environment.paAdminUsername});

        const tokenResponsePromise = page.waitForResponse(
          response => response.url().includes('/protocol/openid-connect/token')
            && response.request().method() === 'POST',
          {timeout: 20_000},
        );
        await page.locator('#kc-login').click();
        flow('Keycloak login form submitted');

        const tokenResponse = await tokenResponsePromise;
        expect(tokenResponse.ok(), `Keycloak token endpoint returned HTTP ${tokenResponse.status()}`).toBeTruthy();
        const tokenBody = await tokenResponse.json() as {access_token?: string};
        expect(tokenBody.access_token, 'Keycloak response contains no access_token').toBeTruthy();
        const [, encodedClaims] = tokenBody.access_token!.split('.');
        expect(encodedClaims, 'Keycloak access_token is not a JWT').toBeTruthy();
        const claims = JSON.parse(Buffer.from(encodedClaims!, 'base64url').toString('utf8')) as {
          iss?: string;
          realm_access?: {roles?: string[]};
        };

        await page.waitForLoadState('networkidle');
        expect(new URL(page.url()).origin, 'Keycloak did not return the browser to the PA origin')
          .toBe(new URL(environment.paBaseUrl).origin);
        check('Keycloak returned browser to PA', {url: page.url(), tokenHttpStatus: tokenResponse.status()});
        await testInfo.attach('01c-pa-after-login.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        expect(claims.iss, 'Token was not issued by the pa_frontoffice realm').toContain('/realms/pa_frontoffice');
        check('Token issuer is pa_frontoffice', {issuer: claims.iss});
        expect(claims.realm_access?.roles ?? [], 'PA token is missing the pa_admin role').toContain('pa_admin');
        check('Token contains pa_admin role', {roles: claims.realm_access?.roles ?? []});
        const informationMenuItem = page.locator('a[href="/information"]').first();
        await expect(informationMenuItem, 'Useful Information is not available in the authenticated PA menu').toBeVisible();
        check('Useful Information navigation entry is visible');
        await informationMenuItem.click();
        await expect(page).toHaveURL(/\/information(?:[?#].*)?$/);
        check('Information page reached by clicking the PA navigation entry', {url: page.url()});
        await expect(page.getByRole('button', {name: /add information/i})).toBeVisible();
        check('Add Information button is visible');
        await testInfo.attach('01-pa-information-page.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        flow('STEP 1 DONE — complete UI login and PA navigation confirmed');
      });

      await test.step('2 — create a draft Information through the PA form', async () => {
        flow('STEP 2 START — create Information from PA form');
        await page.getByRole('button', {name: /add information/i}).click();
        flow('Add Information button clicked');

        const editor = page.locator('[data-cy="information_multilang_tabs"]');
        await expect(editor).toBeVisible();

        // MultiLangEditorTabs opens on the installation default language.
        // Only the visible tab panel is filled, so this remains valid if the
        // default language changes while preserving the same form component.
        const titleInput = editor.locator('input:visible').first();
        const descriptionEditor = editor.locator('.ProseMirror[contenteditable="true"]:visible');

        await titleInput.fill(sourceTitle);
        await descriptionEditor.fill(sourceDescription);
        check('Source fields filled in active default-language tab', {sourceTitle, sourceDescription});

        const responsePromise = page.waitForResponse(response => {
          if (response.request().method() !== 'POST') return false;
          try {
            return new URL(response.url()).pathname === '/information';
          } catch {
            return false;
          }
        });

        await page.locator('button.save_button').click();
        createResponse = await responsePromise;

        expect(
          createResponse.ok(),
          `POST /information failed with HTTP ${createResponse.status()}: ${await createResponse.text()}`,
        ).toBeTruthy();

        created = await createResponse.json() as Record<string, unknown>;
        flow('POST /information response body', created);
        expect(created.id, 'POST /information returned no numeric id').toEqual(expect.any(Number));
        check('API returned numeric Information id', {id: created.id});
        expect(created.title, 'The API returned a different source title').toBe(sourceTitle);
        check('API returned expected source title', {title: created.title});
        expect(created.status, 'A newly created Information must remain DRAFT').toBe('DRAFT');
        check('New Information is DRAFT', {status: created.status});

        // The form closes only after the store has accepted the API response.
        await expect(page.locator('button.save_button')).toBeHidden();
        check('Creation form closed after successful API response');
        await expect(page.getByText(sourceTitle, {exact: true})).toBeVisible();
        check('Created Information is visible in the PA list', {id: created.id, title: sourceTitle});

        await testInfo.attach('02-created-information.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        flow('STEP 2 DONE — Information created and visible', {id: created.id});
      });

      await test.step('3 — verify the created Information directly in PostgreSQL', async () => {
        flow('STEP 3 START — read-only PostgreSQL verification');
        expect(created?.id, 'Cannot query PostgreSQL without the created numeric Information id')
          .toEqual(expect.any(Number));

        const rows = await queryPostgres<CreatedInformationDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            ci.id::text                         AS "itemId",
            ci.external_key                     AS "externalKey",
            ci.type_code                        AS "typeCode",
            ci.published_revision_id::text      AS "publishedRevisionId",
            cr.id::text                         AS "revisionId",
            cr.revision_no                      AS "revisionNo",
            cr.status::text                     AS "revisionStatus",
            cr.source_lang                      AS "sourceLang",
            crt.lang                            AS "translationLang",
            crt.title                           AS "title",
            crt.description                     AS "description",
            crt.t_status::text                  AS "translationStatus",
            crt.source_hash                     AS "sourceHash",
            ci.created_by->>'username'          AS "createdByUsername"
          FROM content_item ci
          JOIN content_revision cr
            ON cr.item_id = ci.id
          JOIN content_revision_translation crt
            ON crt.revision_id = cr.id
           AND crt.lang = cr.source_lang
          WHERE ci.type_code = 'INFORMATION'
            AND ci.external_key = $1
        `, [String(created!.id)]);

        expect(rows, 'Expected exactly one source-language row for the new Information').toHaveLength(1);
        check('Database query returned exactly one source-language row', {rowCount: rows.length});
        databaseRow = rows[0];
        flow('Database row read', databaseRow);

        expect(databaseRow.externalKey).toBe(String(created!.id));
        expect(databaseRow.typeCode).toBe('INFORMATION');
        expect(databaseRow.publishedRevisionId).toBeNull();
        expect(databaseRow.revisionNo).toBe(1);
        expect(databaseRow.revisionStatus).toBe('DRAFT');
        expect(databaseRow.translationLang).toBe(databaseRow.sourceLang);
        expect(databaseRow.title).toBe(sourceTitle);
        expect(databaseRow.description).toBe(sourceDescription);
        expect(databaseRow.translationStatus).toBe('DRAFT');
        expect(databaseRow.sourceHash).toBeNull();
        expect(databaseRow.createdByUsername).toBe(environment.paAdminUsername);
        check('Database content_item is correct', {
          itemId: databaseRow.itemId,
          externalKey: databaseRow.externalKey,
          typeCode: databaseRow.typeCode,
          publishedRevisionId: databaseRow.publishedRevisionId,
        });
        check('Database revision is the first DRAFT revision', {
          revisionId: databaseRow.revisionId,
          revisionNo: databaseRow.revisionNo,
          status: databaseRow.revisionStatus,
        });
        check('Database source translation and audit actor are correct', {
          lang: databaseRow.translationLang,
          translationStatus: databaseRow.translationStatus,
          createdByUsername: databaseRow.createdByUsername,
        });

        await testInfo.attach('03-created-information-database.json', {
          body: Buffer.from(JSON.stringify(databaseRow, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 3 DONE — PostgreSQL verification passed');
      });
      flow('TEST DONE — steps 1, 2 and 3 passed', {
        informationId: created.id,
        itemUuid: databaseRow?.itemId,
        revisionId: databaseRow?.revisionId,
      });
    } finally {
      await testInfo.attach('business-context.json', {
        body: Buffer.from(JSON.stringify({
          marker,
          sourceTitle,
          sourceDescription,
          informationId: created?.id ?? null,
          createHttpStatus: createResponse?.status() ?? null,
          created: created ?? null,
          itemUuid: databaseRow?.itemId ?? null,
          revisionId: databaseRow?.revisionId ?? null,
          database: databaseRow ?? null,
          completedSteps: databaseRow ? [1, 2, 3] : created ? [1, 2] : [],
        }, null, 2)),
        contentType: 'application/json',
      });
      await diagnostics.attach(testInfo);
      flow('Evidence attachments written', {artifactsDirectory: testInfo.outputDir});

      // Playwright normally finalises video during fixture teardown. Closing
      // this dedicated page here lets us expose and attach the successful-run
      // video path explicitly in both the console and the HTML report.
      await page.close();
      if (recordedVideo) {
        const videoPath = await recordedVideo.path();
        await testInfo.attach('complete-business-flow.webm', {
          path: videoPath,
          contentType: 'video/webm',
        });
        flow('Video saved and attached', {videoPath});
      } else {
        console.warn('[MICADO][CBL][VIDEO] No video object exists. Verify that this file still declares test.use({video: "on"}) at top level.');
      }
    }
  });
});
