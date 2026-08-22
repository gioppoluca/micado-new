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

interface WorkflowDbRow {
  workflowId: string;
  dbosStatus: string;
  workflowName: string;
  className: string | null;
  businessStatus: string | null;
  rawEventValue: string | null;
  eventSerialization: string | null;
}

interface ActiveLanguageDbRow {
  lang: string;
  name: string;
  isDefault: boolean;
}

interface ImportedTranslationDbRow {
  revisionId: string;
  lang: string;
  title: string;
  description: string | null;
  translationStatus: string;
  sourceHash: string | null;
  lastImportAt: string | null;
}

interface StagedCommitDbRow {
  id: string;
  component: string;
  lang: string;
  status: string;
  action: string;
  receivedAt: string;
}

interface ApprovedInformationDbRow {
  itemId: string;
  revisionId: string;
  revisionStatus: string;
  approvedAt: string | null;
  approvedByUsername: string | null;
  sourceLang: string;
  translationStatus: string;
  sourceHash: string | null;
  lastExportAt: string | null;
}

interface ArbMetadata {
  description?: string;
  category?: string;
  isoCode?: string;
  itemId?: string;
  fieldKey?: string;
  revisionId?: string;
  sourceHash?: string;
}

type ArbCatalog = Record<string, string | ArbMetadata>;

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
 * Implemented business path:
 *   1. real PA login through Keycloak;
 *   2. real Information creation through the PA browser form;
 *   3. direct read-only verification in the application PostgreSQL database;
 *   4. approval through the existing Information edit form;
 *   5. approval verification in PostgreSQL;
 *   6. DBOS master/children verification;
 *   7. source ARB verification through the Gitea API;
 *   8. Italian translation through the Weblate UI;
 *   9. real Weblate commit and push through repository maintenance;
 *  10. imported translation verification in PostgreSQL;
 *  11. translated child advancement verification in DBOS;
 *  12. readonly translated content verification through the PA UI.
 *
 * The test writes real development data and does not clean it up. Every run
 * uses a unique marker so its UI/API/DB/Git/Weblate evidence can be correlated
 * through the later publication and Migrant verification increments.
 */
test.describe('Complete business logic — Information lifecycle', () => {
  test('creates, approves and translates a real Information', async ({page, playwright}, testInfo) => {
    flow('Test process entered', {
      enabled: process.env.RUN_COMPLETE_BUSINESS_LOGIC === 'true',
      paUrl: environment.paBaseUrl,
      paUsername: environment.paAdminUsername,
      backendAuthentication: environment.backendDummyAuth ? 'DUMMY' : 'KEYCLOAK',
      backendActor: environment.backendDummyAuth
        ? environment.backendDummyUsername
        : environment.paAdminUsername,
      database: `${environment.appDbHost}:${environment.appDbPort}/${environment.appDbName}`,
      dbosSchema: environment.dbosDbSchema,
      giteaUrl: environment.giteaBaseUrl,
      weblateUrl: environment.weblateBaseUrl,
      translationLanguage: environment.businessTranslationLanguage,
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
    test.skip(!environment.giteaPassword, 'GITEA_WEBLATE_PASSWORD is missing from the project .env.');
    test.skip(!environment.weblateAdminPassword, 'WEBLATE_ADMIN_PASSWORD is missing from the project .env.');

    test.setTimeout(10 * 60_000);

    const marker = `cbl-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    const sourceTitle = `CBL source ${marker}`;
    const sourceDescription = `Complete business logic test information ${marker}`;
    const translatedTitle = `CBL traduzione IT ${marker}`;
    const translatedDescription = `Informazione tradotta dal test completo ${marker}`;
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
    let approvalHttpStatus: number | undefined;
    let approvedDatabaseRow: ApprovedInformationDbRow | undefined;
    let workflowRows: WorkflowDbRow[] = [];
    let activeTargetLanguages: string[] = [];
    let sourceArb: ArbCatalog | undefined;
    let giteaSourceHash: string | undefined;
    let weblateTranslationsSaved = false;
    let weblateCommitPushed = false;
    let importedTranslation: ImportedTranslationDbRow | undefined;
    let translatedWorkflowRows: WorkflowDbRow[] = [];
    let paTranslationVisible = false;
    let currentBusinessStep = 0;

    try {
      await test.step('1 — log in to the PA as pa_admin', async () => {
        currentBusinessStep = 1;
        flow('STEP 1 START — open PA home and use its Login control');

        const homeResponse = await page.goto(`${environment.paBaseUrl}/`, {waitUntil: 'domcontentloaded'});
        expect(homeResponse, 'Opening the PA home returned no HTTP response').not.toBeNull();
        expect(homeResponse!.ok(), `PA home returned HTTP ${homeResponse!.status()}`).toBeTruthy();
        check('Public PA home opened', {url: page.url(), status: homeResponse!.status()});
        await testInfo.attach('01a-pa-public-home.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        // Quasar's Material Icon contributes its ligature name to textContent,
        // therefore this item reads roughly "exit_to_app Login" in the DOM.
        // An anchored /^Login$/ selector can never match the actual source.
        const drawerItems = page.locator('.q-drawer .q-item:visible');
        const visibleDrawerItems = await drawerItems.allTextContents();
        flow('Visible anonymous PA drawer items', visibleDrawerItems.map(text => text.trim().replace(/\s+/g, ' ')));

        const loginMenuItem = page.locator('.q-drawer .q-item')
          .filter({has: page.locator('.q-icon')})
          .filter({hasText: /Login/i})
          .first();
        await expect(loginMenuItem, 'The PA sidebar Login control is not visible').toBeVisible();
        check('PA Login control is visible', {domText: (await loginMenuItem.textContent())?.trim().replace(/\s+/g, ' ')});
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
        currentBusinessStep = 2;
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
        currentBusinessStep = 3;
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
        const expectedBackendActor = environment.backendDummyAuth
          ? environment.backendDummyUsername
          : environment.paAdminUsername;
        if (environment.backendDummyAuth) {
          console.warn(
            `[MICADO][CBL][AUTH][WARNING] Backend dummy authentication is active: `
            + `audit columns are expected to contain "${expectedBackendActor}" instead of the Keycloak user `
            + `"${environment.paAdminUsername}". Set AUTH_DISABLE_KEYCLOAK=false for a fully real audit chain.`,
          );
        }
        expect(databaseRow.createdByUsername).toBe(expectedBackendActor);
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
          authenticationMode: environment.backendDummyAuth ? 'DUMMY' : 'KEYCLOAK',
        });

        await testInfo.attach('03-created-information-database.json', {
          body: Buffer.from(JSON.stringify(databaseRow, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 3 DONE — PostgreSQL verification passed');
      });

      await test.step('4 — approve the Information through the PA edit form', async () => {
        currentBusinessStep = 4;
        flow('STEP 4 START — open the created Information and approve it');
        const informationId = Number(created!.id);
        const editButton = page.locator(`[data-cy="edit_information_${informationId}"]`);
        await expect(editButton, `Edit control for Information ${informationId} is not visible`).toBeVisible();
        check('Edit control for created Information is visible', {informationId});

        const fullItemResponsePromise = page.waitForResponse(response => {
          if (response.request().method() !== 'GET') return false;
          try {
            return new URL(response.url()).pathname === `/information/${informationId}`;
          } catch {
            return false;
          }
        });
        await editButton.click();
        const fullItemResponse = await fullItemResponsePromise;
        expect(fullItemResponse.ok(), `GET /information/${informationId} returned HTTP ${fullItemResponse.status()}`)
          .toBeTruthy();
        check('Full Information loaded by the edit action', {
          informationId,
          httpStatus: fullItemResponse.status(),
        });

        const editor = page.locator('[data-cy="information_multilang_tabs"]');
        await expect(editor).toBeVisible();
        await expect(editor.locator('input:visible').first()).toHaveValue(sourceTitle);
        check('Edit form contains the expected source title');

        const translatableRow = page.locator('.row.items-center.justify-between')
          .filter({hasText: /Translatable/i})
          .first();
        await expect(translatableRow, 'Translatable control row is not visible').toBeVisible();
        const translatableToggle = translatableRow.locator('.q-toggle');
        await expect(translatableToggle).toHaveAttribute('aria-checked', 'false');
        check('Translatable toggle starts disabled for the DRAFT revision');
        await translatableToggle.click();
        await expect(translatableToggle).toHaveAttribute('aria-checked', 'true');
        check('Translatable toggle changed the form state to APPROVED');

        const approvalResponsePromise = page.waitForResponse(response => {
          if (response.request().method() !== 'PUT') return false;
          try {
            return new URL(response.url()).pathname === `/information/${informationId}`;
          } catch {
            return false;
          }
        });
        await page.locator('button.save_button').click();
        const approvalResponse = await approvalResponsePromise;
        approvalHttpStatus = approvalResponse.status();
        expect(
          approvalResponse.ok(),
          `PUT /information/${informationId} failed with HTTP ${approvalResponse.status()}: ${await approvalResponse.text()}`,
        ).toBeTruthy();
        check('Backend accepted Information approval', {
          informationId,
          httpStatus: approvalResponse.status(),
        });

        await expect(page.locator('button.save_button')).toBeHidden();
        await expect(page.getByText(sourceTitle, {exact: true})).toBeVisible();
        check('Approval form closed and Information returned to the PA list', {informationId});

        await testInfo.attach('04-approved-information.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        flow('STEP 4 DONE — Information approval submitted through the PA UI', {
          informationId,
          httpStatus: approvalResponse.status(),
        });
      });

      await test.step('5 — verify APPROVED state directly in PostgreSQL', async () => {
        currentBusinessStep = 5;
        flow('STEP 5 START — verify approval in application database');
        const expectedActor = environment.backendDummyAuth
          ? environment.backendDummyUsername
          : environment.paAdminUsername;

        const loadApprovedRow = () => queryPostgres<ApprovedInformationDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            ci.id::text                    AS "itemId",
            cr.id::text                    AS "revisionId",
            cr.status::text                AS "revisionStatus",
            cr.approved_at::text           AS "approvedAt",
            cr.approved_by->>'username'    AS "approvedByUsername",
            cr.source_lang                 AS "sourceLang",
            crt.t_status::text             AS "translationStatus",
            crt.source_hash                AS "sourceHash",
            crt.last_export_at::text       AS "lastExportAt"
          FROM content_item ci
          JOIN content_revision cr ON cr.item_id = ci.id
          JOIN content_revision_translation crt
            ON crt.revision_id = cr.id AND crt.lang = cr.source_lang
          WHERE ci.type_code = 'INFORMATION' AND ci.external_key = $1
        `, [String(created!.id)]);

        await expect.poll(loadApprovedRow, {
          message: 'Information revision did not become APPROVED in PostgreSQL',
          timeout: 30_000,
          intervals: [250, 500, 1_000, 2_000],
        }).toEqual(expect.arrayContaining([
          expect.objectContaining({revisionStatus: 'APPROVED'}),
        ]));
        const rows = await loadApprovedRow();

        expect(rows).toHaveLength(1);
        approvedDatabaseRow = rows[0];
        flow('Approved database row read', approvedDatabaseRow);
        expect(approvedDatabaseRow.itemId).toBe(databaseRow!.itemId);
        expect(approvedDatabaseRow.revisionId).toBe(databaseRow!.revisionId);
        expect(approvedDatabaseRow.revisionStatus).toBe('APPROVED');
        expect(approvedDatabaseRow.approvedAt).not.toBeNull();
        expect(approvedDatabaseRow.approvedByUsername).toBe(expectedActor);
        expect(approvedDatabaseRow.translationStatus).toBe('APPROVED');
        check('Revision and source translation are APPROVED', approvedDatabaseRow);
        await testInfo.attach('05-approved-information-database.json', {
          body: Buffer.from(JSON.stringify(approvedDatabaseRow, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 5 DONE — approval persisted correctly');
      });

      await test.step('6 — verify DBOS master and all translation children', async () => {
        currentBusinessStep = 6;
        flow('STEP 6 START — verify durable translation workflows');
        expect(environment.dbosDbSchema).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
        const revisionId = databaseRow!.revisionId;
        const activeLanguages = await queryPostgres<ActiveLanguageDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT lang, name, is_default AS "isDefault"
          FROM languages
          WHERE active = true
          ORDER BY sort_order, lang
        `);
        expect(activeLanguages, 'The application database has no active languages').not.toHaveLength(0);
        expect(
          activeLanguages.some(language => language.lang === databaseRow!.sourceLang),
          `Revision source language ${databaseRow!.sourceLang} is not active`,
        ).toBe(true);
        activeTargetLanguages = activeLanguages
          .map(language => language.lang)
          .filter(lang => lang !== databaseRow!.sourceLang);
        expect(activeTargetLanguages, 'The instance has no active target languages').not.toHaveLength(0);
        flow('Active application languages used by the backend orchestrator', {
          sourceLang: databaseRow!.sourceLang,
          activeLanguages,
          activeTargetLanguages,
          weblateConfiguredTargets: environment.targetLanguages,
        });

        const masterId = `tr:${revisionId}`;
        const childIds = activeTargetLanguages.map(lang => `tr:${revisionId}:${lang}`);
        const expectedIds = [masterId, ...childIds];
        flow('Expected DBOS workflow IDs', expectedIds);

        const loadWorkflows = () => queryPostgres<WorkflowDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.dbosDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            ws.workflow_uuid AS "workflowId",
            ws.status        AS "dbosStatus",
            ws.name          AS "workflowName",
            ws.class_name    AS "className",
            CASE
              WHEN ev.value IS NULL THEN NULL
              WHEN ev.value LIKE '%"__dbos_serializer":"superjson"%'
                THEN ev.value::jsonb->>'json'
              ELSE TRIM(BOTH '"' FROM ev.value)
            END              AS "businessStatus",
            ev.value         AS "rawEventValue",
            ev.serialization AS "eventSerialization"
          FROM "${environment.dbosDbSchema}".workflow_status ws
          LEFT JOIN "${environment.dbosDbSchema}".workflow_events ev
            ON ev.workflow_uuid = ws.workflow_uuid
           AND ev.key = 'lang:' || split_part(ws.workflow_uuid, ':', 3) || ':status'
          WHERE ws.workflow_uuid = ANY($1::text[])
          ORDER BY ws.workflow_uuid
        `, [expectedIds]);

        await expect.poll(async () => {
          const rows = await loadWorkflows();
          const snapshot = {
            count: rows.length,
            waitingChildren: rows.filter(row => row.workflowId !== masterId
              && row.dbosStatus === 'PENDING'
              && row.businessStatus === 'WAITING_TRANSLATION').length,
          };
          flow('DBOS polling snapshot', {summary: snapshot, rows});
          return snapshot;
        }, {
          message: 'DBOS master/children were not all started and waiting for translation',
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 5_000],
        }).toEqual({count: expectedIds.length, waitingChildren: childIds.length});

        workflowRows = await loadWorkflows();
        flow('DBOS workflow rows read', workflowRows);
        const master = workflowRows.find(row => row.workflowId === masterId);
        expect(master, 'DBOS master workflow is missing').toBeTruthy();
        expect(master!.dbosStatus).toBe('PENDING');
        expect(master!.className).toContain('TranslationMasterWorkflow');
        for (const childId of childIds) {
          const child = workflowRows.find(row => row.workflowId === childId);
          expect(child, `DBOS child workflow ${childId} is missing`).toBeTruthy();
          expect(child!.dbosStatus, `${childId} is not durably waiting`).toBe('PENDING');
          expect(child!.className).toContain('TranslationChildWorkflow');
          expect(child!.businessStatus).toBe('WAITING_TRANSLATION');
          check('DBOS child is waiting for Weblate', child);
        }
        check('DBOS master exists and waits for all children', master);
        await testInfo.attach('06-dbos-workflows.json', {
          body: Buffer.from(JSON.stringify({masterId, childIds, rows: workflowRows}, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 6 DONE — DBOS master and all children verified');
      });

      await test.step('7 — verify the source ARB file through Gitea', async () => {
        currentBusinessStep = 7;
        flow('STEP 7 START — read information source catalog from Gitea');
        const gitea = await playwright.request.newContext({
          baseURL: environment.giteaBaseUrl,
          extraHTTPHeaders: {
            Authorization: `Basic ${Buffer.from(`${environment.giteaUsername}:${environment.giteaPassword}`).toString('base64')}`,
            Accept: 'application/json',
          },
        });
        try {
          const repoPath = `information/${databaseRow!.sourceLang}.arb`;
          const encodedPath = encodeURIComponent(repoPath);
          const apiPath = `/api/v1/repos/${environment.giteaUsername}/${environment.giteaTranslationsRepo}`
            + `/contents/${encodedPath}?ref=${encodeURIComponent(environment.giteaTranslationsBranch)}`;

          let fileResponseBody: {content?: string; encoding?: string; sha?: string; path?: string} | undefined;
          await expect.poll(async () => {
            const response = await gitea.get(apiPath);
            if (!response.ok()) return {status: response.status(), containsKeys: false};
            fileResponseBody = await response.json();
            const decoded = Buffer.from(fileResponseBody!.content ?? '', 'base64').toString('utf8');
            return {
              status: response.status(),
              containsKeys: decoded.includes(`"${created!.id}:title"`)
                && decoded.includes(`"${created!.id}:description"`),
            };
          }, {
            message: 'Gitea information source ARB was not updated with the approved revision',
            timeout: 60_000,
            intervals: [500, 1_000, 2_000, 5_000],
          }).toEqual({status: 200, containsKeys: true});

          const arbText = Buffer.from(fileResponseBody!.content!, 'base64').toString('utf8');
          sourceArb = JSON.parse(arbText) as ArbCatalog;
          const titleKey = `${created!.id}:title`;
          const descriptionKey = `${created!.id}:description`;
          const titleMeta = sourceArb[`@${titleKey}`] as ArbMetadata;
          const descriptionMeta = sourceArb[`@${descriptionKey}`] as ArbMetadata;
          expect(sourceArb[titleKey]).toBe(sourceTitle);
          expect(sourceArb[descriptionKey]).toBe(sourceDescription);
          expect(titleMeta.itemId).toBe(String(created!.id));
          expect(titleMeta.fieldKey).toBe('title');
          expect(titleMeta.revisionId).toBe(databaseRow!.revisionId);
          expect(titleMeta.sourceHash).toBeTruthy();
          expect(descriptionMeta.itemId).toBe(String(created!.id));
          expect(descriptionMeta.fieldKey).toBe('description');
          expect(descriptionMeta.revisionId).toBe(databaseRow!.revisionId);
          expect(descriptionMeta.sourceHash).toBe(titleMeta.sourceHash);
          giteaSourceHash = titleMeta.sourceHash;
          check('Gitea ARB contains source strings and correlation metadata', {
            repoPath,
            sha: fileResponseBody!.sha,
            revisionId: titleMeta.revisionId,
            sourceHash: giteaSourceHash,
          });
          await testInfo.attach('07-information-source.arb', {
            body: Buffer.from(arbText),
            contentType: 'application/json',
          });
        } finally {
          await gitea.dispose();
        }
        flow('STEP 7 DONE — Gitea source ARB verified');
      });

      await test.step('8 — translate title and description through the Weblate UI', async () => {
        currentBusinessStep = 8;
        flow('STEP 8 START — log in to Weblate and translate Information');
        const targetLang = environment.businessTranslationLanguage;
        expect(environment.targetLanguages, `${targetLang} is not configured in Weblate target languages`).toContain(targetLang);
        expect(activeTargetLanguages, `${targetLang} is not active in the Micado languages table`).toContain(targetLang);

        const webHome = await page.goto(`${environment.weblateBaseUrl}/`, {waitUntil: 'domcontentloaded'});
        expect(webHome?.ok(), `Weblate home returned HTTP ${webHome?.status()}`).toBeTruthy();
        check('Weblate public home opened', {url: page.url(), status: webHome!.status()});

        const signInLink = page.getByRole('link', {name: /sign in|log in/i}).first();
        await expect(signInLink, 'Weblate Sign in link is not visible').toBeVisible();
        await signInLink.click();
        await page.waitForLoadState('domcontentloaded');

        const describeLoginControls = async () => page.locator('input:visible, button:visible, a:visible').evaluateAll(elements =>
          elements.slice(0, 80).map(element => ({
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute('type'),
            name: element.getAttribute('name'),
            id: element.id || null,
            href: element.getAttribute('href'),
            text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
          })),
        );
        flow('Weblate authentication page opened', {
          url: page.url(),
          title: await page.title(),
          controls: await describeLoginControls(),
        });
        await page.screenshot({path: testInfo.outputPath('08a-weblate-authentication.png'), fullPage: true});

        const usernameSelectors = [
          'input[name="username"]:visible',
          '#id_username:visible',
          'input[autocomplete="username"]:visible',
          'input[name="login"]:visible',
          '#id_login:visible',
          'input[name="email"]:visible',
          '#id_email:visible',
        ].join(', ');
        let usernameField = page.locator(usernameSelectors).first();

        // Some Weblate installations first display the available authentication
        // methods. Keep the real UI flow and select the password/e-mail method
        // before looking for the Django login form.
        if (!await usernameField.isVisible()) {
          const passwordLoginAction = page.locator('a:visible, button:visible').filter({
            hasText: /sign in with (e-?mail|username|password)|password login|e-?mail login/i,
          }).first();
          if (await passwordLoginAction.isVisible()) {
            flow('Weblate requires authentication-method selection', {
              action: (await passwordLoginAction.innerText()).trim(),
            });
            await passwordLoginAction.click();
            await page.waitForLoadState('domcontentloaded');
            usernameField = page.locator(usernameSelectors).first();
          }
        }

        // Last-resort compatibility for customised Weblate login templates:
        // accept the single visible textual field in the password form.
        if (!await usernameField.isVisible()) {
          const textualFields = page.locator(
            'form input:visible:not([type="password"]):not([type="hidden"]):not([type="search"]):not([type="checkbox"]):not([type="submit"])',
          );
          if (await textualFields.count() === 1) usernameField = textualFields.first();
        }

        const passwordField = page.locator(
          'input[name="password"]:visible, #id_password:visible, input[type="password"]:visible',
        ).first();
        await expect(usernameField, 'Weblate username field is not visible').toBeVisible();
        await expect(passwordField, 'Weblate password field is not visible').toBeVisible();
        check('Weblate login form opened through Sign in', {
          url: page.url(),
          usernameField: await usernameField.getAttribute('name'),
          usernameFieldId: await usernameField.getAttribute('id'),
        });

        await usernameField.fill(environment.weblateAdminUsername);
        await passwordField.fill(environment.weblateAdminPassword);
        const loginForm = passwordField.locator('xpath=ancestor::form[1]');
        const loginSubmit = loginForm.locator('button[type="submit"], input[type="submit"]').first();
        await expect(loginSubmit, 'Weblate login submit control is not visible').toBeVisible();
        await loginSubmit.click();
        await page.waitForLoadState('networkidle');
        await expect(passwordField, 'Weblate login form remained visible after submit').toBeHidden();
        expect(page.url(), 'Weblate remained on the login page after submit').not.toMatch(/\/accounts\/login\/?(?:\?|$)/);
        await page.screenshot({path: testInfo.outputPath('08b-weblate-authenticated.png'), fullPage: true});
        check('Weblate admin login completed', {username: environment.weblateAdminUsername, url: page.url()});

        const describeVisibleLinks = async () => page.locator('a:visible').evaluateAll(links =>
          links.slice(0, 120).map(link => ({
            text: (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            href: link.getAttribute('href'),
          })),
        );

        let projectLink = page.locator('a[href$="/projects/micado/"]:visible').first();
        if (!await projectLink.isVisible()) {
          // Weblate 5.16 exposes Projects as a dropdown trigger (`href="#"`),
          // not as a direct /projects/ link.
          const projectsMenu = page.locator('a:visible').filter({hasText: /^\s*Projects\s*$/}).first();
          flow('Micado is not listed on the Weblate home; opening the Projects menu', {
            url: page.url(),
            visibleLinks: await describeVisibleLinks(),
          });
          await expect(projectsMenu, 'Weblate Projects menu is not visible').toBeVisible();
          await projectsMenu.click();
          check('Weblate Projects dropdown opened');

          projectLink = page.locator('a[href$="/projects/micado/"]:visible').first();
          if (!await projectLink.isVisible()) {
            const allProjectsLink = page.getByRole('link', {name: /^Browse all projects$/i}).first();
            flow('Micado is not present in the Projects dropdown', {
              visibleLinks: await describeVisibleLinks(),
            });
            await expect(allProjectsLink, 'Browse all projects link is not visible in the Projects dropdown').toBeVisible();
            await allProjectsLink.click();
            await page.waitForLoadState('networkidle');
            check('Weblate Projects page opened through the dropdown', {url: page.url()});
            projectLink = page.locator('a[href$="/projects/micado/"]:visible').first();
            if (!await projectLink.isVisible()) {
              projectLink = page.locator('a:visible').filter({hasText: /^\s*micado\s*$/i}).first();
            }
          }
          await page.screenshot({path: testInfo.outputPath('08c-weblate-projects.png'), fullPage: true});
        }
        await expect(projectLink, 'Micado project link is not visible in Weblate').toBeVisible();
        await projectLink.click();
        await page.waitForLoadState('networkidle');
        check('Micado project opened from Weblate UI');

        const componentsNavigation = page.locator('a:visible, button:visible')
          .filter({hasText: /^\s*Components\b/i}).first();
        await expect(componentsNavigation, 'Components navigation is not visible in the Micado project').toBeVisible();
        await componentsNavigation.click();
        await page.waitForLoadState('networkidle');
        check('Micado Components list opened through the Weblate UI', {
          url: page.url(),
          visibleLinks: await describeVisibleLinks(),
        });
        await page.screenshot({path: testInfo.outputPath('08d-weblate-components.png'), fullPage: true});

        let componentLink = page.locator('a[href$="/projects/micado/content-information/"]:visible').first();
        if (!await componentLink.isVisible()) {
          componentLink = page.getByRole('link', {name: /^Information$/i}).first();
        }
        await expect(componentLink, 'content-information component is not visible').toBeVisible();
        await componentLink.click();
        await page.waitForLoadState('networkidle');
        check('content-information component opened from Weblate UI');

        let languageLink = page.getByRole('link', {name: /^Italian\b/i}).first();
        if (!await languageLink.isVisible()) {
          languageLink = page.locator(
            `a[href$="/projects/micado/content-information/${targetLang}/"]:visible`,
          ).first();
        }
        await expect(languageLink, 'Italian language row is not visible in content-information').toBeVisible({timeout: 30_000});
        await languageLink.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(new RegExp(`/projects/micado/content-information/${targetLang}/`));
        check('Italian language opened from component UI', {
          targetLang,
          url: page.url(),
          visibleLinks: await describeVisibleLinks(),
        });
        await page.screenshot({path: testInfo.outputPath('08e-weblate-italian.png'), fullPage: true});

        let translateLink = page.getByRole('link', {name: /^Translate$/i}).first();
        if (!await translateLink.isVisible()) {
          translateLink = page.getByRole('button', {name: /^Translate$/i}).first();
        }
        if (!await translateLink.isVisible()) {
          translateLink = page.locator(
            `a[href^="/translate/micado/content-information/${targetLang}/"]:visible`,
          ).first();
        }
        await expect(translateLink, 'Translate action is not visible on the Italian language page').toBeVisible();
        await translateLink.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(new RegExp(`/translate/micado/content-information/${targetLang}/`));
        check('Italian translation editor opened through Translate', {url: page.url()});
        await page.screenshot({path: testInfo.outputPath('08f-weblate-italian-translate.png'), fullPage: true});

        const locateUnitSearchInput = async () => {
          const selectors = [
            `form[action*="/translate/micado/content-information/${targetLang}/"] textarea#id_q:visible`,
            `form[action*="/translate/micado/content-information/${targetLang}/"] textarea[name="q"]:visible`,
            `form[action*="/translate/micado/content-information/${targetLang}/"] input[name="q"]:visible`,
            `form[action*="/search/micado/content-information"] textarea#id_q:visible`,
            `form[action*="/search/micado/content-information"] textarea[name="q"]:visible`,
            `form[action*="/search/micado/content-information"] input[name="q"]:visible`,
            'textarea#id_q:visible',
            'textarea[name="q"]:visible',
            'input#id_q:visible',
            'input[name="q"]:visible',
            'input[name="query"]:visible',
            'input[type="search"]:visible',
          ].join(', ');
          let input = page.locator(selectors).first();
          if (await input.isVisible()) return input;

          const searchMenu = page.locator('a:visible, button:visible')
            .filter({hasText: /^\s*Search\s*$/i}).first();
          if (await searchMenu.isVisible()) {
            await searchMenu.click();
            flow('Weblate Search menu opened from translation editor', {
              url: page.url(),
              visibleLinks: await describeVisibleLinks(),
            });
          }

          input = page.locator(selectors).first();
          if (await input.isVisible()) return input;

          const componentSearchLink = page.locator(
            `a[href*="/search/micado/content-information/"]:visible, a[href*="/search/micado/content-information/?"]:visible`,
          ).first();
          if (await componentSearchLink.isVisible()) {
            await componentSearchLink.click();
            await page.waitForLoadState('networkidle');
            flow('Weblate component search page opened through Search menu', {url: page.url()});
          }
          return page.locator(selectors).first();
        };

        const translateUnit = async (fieldKey: 'title' | 'description', translatedValue: string) => {
          const context = `${created!.id}:${fieldKey}`;
          const itemFilter = String(created!.id);
          await expect.poll(async () => {
            const searchInput = await locateUnitSearchInput();
            if (!await searchInput.isVisible()) {
              const visibleFields = await page.locator('input:visible, textarea:visible').evaluateAll(fields => fields.map(field => ({
                tag: field.tagName.toLowerCase(),
                id: field.id || null,
                name: field.getAttribute('name'),
                type: field.getAttribute('type'),
                placeholder: field.getAttribute('placeholder'),
              })));
              flow('Weblate unit search input is not visible', {
                context,
                url: page.url(),
                visibleFields,
                visibleLinks: await describeVisibleLinks(),
              });
              return false;
            }
            // Filter by the numeric Information ID. Both ARB keys
            // `<id>:title` and `<id>:description` are returned regardless of
            // how many historical strings or result pages the component has.
            await searchInput.fill(itemFilter);
            await searchInput.press('Enter');
            await page.waitForLoadState('networkidle');

            const contextLink = page.getByRole('link', {name: context, exact: true}).first();
            const contextAlreadyOpen = await page.locator('input:visible').evaluateAll(
              (inputs, expected) => inputs.some(input => (input as HTMLInputElement).value === expected),
              context,
            );
            if (!contextAlreadyOpen && await contextLink.isVisible()) {
              await contextLink.click();
              await page.waitForLoadState('networkidle');
            }

            const keyAsText = await page.getByText(context, {exact: true}).count() > 0;
            const keyAsInputValue = await page.locator('input:visible').evaluateAll(
              (inputs, expected) => inputs.some(input => (input as HTMLInputElement).value === expected),
              context,
            );
            const targetEditorVisible = await page.locator(
              'textarea[name^="target"]:visible, textarea[id^="id_target"]:visible',
            ).first().isVisible();
            flow('Weblate unit search snapshot', {
              context,
              itemFilter,
              url: page.url(),
              keyAsText,
              keyAsInputValue,
              targetEditorVisible,
            });
            return (keyAsText || keyAsInputValue) && targetEditorVisible;
          }, {
            message: `Weblate filter ${itemFilter} did not expose unit ${context}`,
            timeout: 90_000,
            intervals: [1_000, 2_000, 5_000],
          }).toBe(true);

          const targetEditor = page.locator('textarea[name^="target"]:visible, textarea[id^="id_target"]:visible').first();
          await expect(targetEditor, `Target editor for ${context} is not visible`).toBeVisible();
          await targetEditor.fill(translatedValue);
          const saveButton = page.getByRole('button', {name: /save and stay/i});
          await expect(saveButton).toBeVisible();
          await saveButton.click();
          await expect(targetEditor).toHaveValue(translatedValue);
          check('Weblate translation saved from UI', {context, translatedValue});
        };

        await translateUnit('title', translatedTitle);
        await translateUnit('description', translatedDescription);
        weblateTranslationsSaved = true;
        await testInfo.attach('08-weblate-translations-saved.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        flow('STEP 8 DONE — title and description saved in Weblate UI', {
          targetLang,
          translatedTitle,
          translatedDescription,
        });
      });

      await test.step('9 — commit and push the translation through the Weblate UI', async () => {
        currentBusinessStep = 9;
        flow('STEP 9 START — commit and push from Weblate repository maintenance');
        const targetLang = environment.businessTranslationLanguage;
        const commitStartedAt = new Date(Date.now() - 5_000).toISOString();

        let componentBreadcrumb = page.locator('a[href$="/projects/micado/content-information/"]:visible').first();
        if (!await componentBreadcrumb.isVisible()) {
          componentBreadcrumb = page.getByRole('link', {name: /^Information$/i}).first();
        }
        await expect(componentBreadcrumb, 'Information component breadcrumb is not visible after translation').toBeVisible();
        await componentBreadcrumb.click();
        await page.waitForLoadState('networkidle');

        const operationsMenu = page.locator('a:visible, button:visible').filter({hasText: /^\s*Operations\s*$/i}).first();
        await expect(operationsMenu, 'Weblate Operations menu is not visible on the component page').toBeVisible();
        await operationsMenu.click();

        // "Repository maintenance" is a Bootstrap tab toggle
        // (<a role="tab" data-bs-toggle="tab" data-bs-target="#repository" href="#">),
        // not a plain navigation link, so it must be located by its "tab" role.
        const repositoryLink = page.getByRole('tab', {name: /repository maintenance/i}).first();
        await expect(repositoryLink, 'Repository maintenance is not visible in the Operations menu').toBeVisible();
        await repositoryLink.click();
        await page.waitForLoadState('networkidle');
        check('Weblate repository maintenance opened through Operations', {url: page.url()});
        await page.screenshot({path: testInfo.outputPath('09a-weblate-repository-maintenance.png'), fullPage: true});

        const clickRepositoryAction = async (action: 'Commit' | 'Push') => {
          const pattern = action === 'Commit' ? /^Commit(?: pending changes)?$/i : /^Push(?: changes)?$/i;
          let control = page.getByRole('button', {name: pattern}).first();
          if (!await control.isVisible()) control = page.getByRole('link', {name: pattern}).first();
          await expect(control, `Weblate ${action} action is not visible`).toBeVisible();
          // These Weblate ".link-post" actions can carry aria-disabled="true"
          // even though the click still works (Weblate's own JS handles it),
          // so force the click past Playwright's enabled-state check.
          await control.click({force: true});

          const confirmationDialog = page.getByRole('dialog').filter({hasText: new RegExp(action, 'i')}).first();
          if (await confirmationDialog.isVisible()) {
            const confirmation = confirmationDialog.getByRole('button', {
              name: new RegExp(`^(Confirm|${action}|Confirm ${action})$`, 'i'),
            }).first();
            await expect(confirmation, `Weblate ${action} confirmation is not visible`).toBeVisible();
            await confirmation.click();
          }
          await page.waitForLoadState('networkidle');
          check(`Weblate ${action} submitted through repository maintenance`, {url: page.url()});
        };

        await clickRepositoryAction('Commit');

        const loadStagedCommits = () => queryPostgres<StagedCommitDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            id::text             AS "id",
            component,
            lang,
            status,
            action,
            received_at::text    AS "receivedAt"
          FROM micado.weblate_commit_event
          WHERE component = 'content-information'
            AND lang = $1
            AND received_at >= $2::timestamptz
          ORDER BY received_at DESC
        `, [targetLang, commitStartedAt]);

        await expect.poll(async () => (await loadStagedCommits()).filter(row => row.status === 'NEW').length, {
          message: 'The real Weblate COMMIT webhook did not stage a content-information event',
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 5_000],
        }).toBeGreaterThan(0);
        const stagedRows = await loadStagedCommits();
        check('Weblate COMMIT webhook staged for backend processing', stagedRows);
        await testInfo.attach('09-weblate-staged-commit.json', {
          body: Buffer.from(JSON.stringify(stagedRows, null, 2)),
          contentType: 'application/json',
        });

        await clickRepositoryAction('Push');
        await expect.poll(async () => (await loadStagedCommits()).length, {
          message: 'The real Weblate PUSH webhook did not consume the staged commit',
          timeout: 90_000,
          intervals: [500, 1_000, 2_000, 5_000],
        }).toBe(0);
        weblateCommitPushed = true;
        await page.screenshot({path: testInfo.outputPath('09b-weblate-after-push.png'), fullPage: true});
        flow('STEP 9 DONE — real Weblate commit and push completed', {targetLang});
      });

      await test.step('10 — verify the imported translation in PostgreSQL', async () => {
        currentBusinessStep = 10;
        flow('STEP 10 START — verify translated revision state in application database');
        const targetLang = environment.businessTranslationLanguage;
        const loadImportedTranslation = () => queryPostgres<ImportedTranslationDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            revision_id::text     AS "revisionId",
            lang,
            title,
            description,
            t_status::text        AS "translationStatus",
            source_hash           AS "sourceHash",
            last_import_at::text  AS "lastImportAt"
          FROM content_revision_translation
          WHERE revision_id = $1::uuid AND lang = $2
        `, [databaseRow!.revisionId, targetLang]);

        await expect.poll(loadImportedTranslation, {
          message: 'The Weblate translation was not imported into content_revision_translation',
          timeout: 90_000,
          intervals: [500, 1_000, 2_000, 5_000],
        }).toEqual([expect.objectContaining({
          translationStatus: 'APPROVED',
          title: translatedTitle,
          description: translatedDescription,
          sourceHash: giteaSourceHash,
        })]);
        [importedTranslation] = await loadImportedTranslation();
        expect(importedTranslation.lastImportAt).not.toBeNull();
        check('Target translation is APPROVED and correlated to the source revision', importedTranslation);
        await testInfo.attach('10-imported-translation.json', {
          body: Buffer.from(JSON.stringify(importedTranslation, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 10 DONE — imported database state verified');
      });

      await test.step('11 — verify the translated DBOS child advanced to DONE', async () => {
        currentBusinessStep = 11;
        flow('STEP 11 START — verify DBOS advancement after Weblate push');
        const targetLang = environment.businessTranslationLanguage;
        const masterId = `tr:${databaseRow!.revisionId}`;
        const childId = `tr:${databaseRow!.revisionId}:${targetLang}`;
        const loadTranslatedWorkflows = () => queryPostgres<WorkflowDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.dbosDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, `
          SELECT
            ws.workflow_uuid AS "workflowId",
            ws.status        AS "dbosStatus",
            ws.name          AS "workflowName",
            ws.class_name    AS "className",
            CASE
              WHEN ev.value IS NULL THEN NULL
              WHEN ev.value LIKE '%"__dbos_serializer":"superjson"%'
                THEN ev.value::jsonb->>'json'
              ELSE TRIM(BOTH '"' FROM ev.value)
            END              AS "businessStatus",
            ev.value         AS "rawEventValue",
            ev.serialization AS "eventSerialization"
          FROM "${environment.dbosDbSchema}".workflow_status ws
          LEFT JOIN "${environment.dbosDbSchema}".workflow_events ev
            ON ev.workflow_uuid = ws.workflow_uuid
           AND ev.key = 'lang:' || split_part(ws.workflow_uuid, ':', 3) || ':status'
          WHERE ws.workflow_uuid = ANY($1::text[])
          ORDER BY ws.workflow_uuid
        `, [[masterId, childId]]);

        await expect.poll(async () => {
          const rows = await loadTranslatedWorkflows();
          const child = rows.find(row => row.workflowId === childId);
          flow('Translated DBOS child polling snapshot', {child, rows});
          return child ? {dbosStatus: child.dbosStatus, businessStatus: child.businessStatus} : null;
        }, {
          message: 'The translated DBOS child did not complete after the push',
          timeout: 90_000,
          intervals: [500, 1_000, 2_000, 5_000],
        }).toEqual({dbosStatus: 'SUCCESS', businessStatus: 'DONE'});

        translatedWorkflowRows = await loadTranslatedWorkflows();
        const master = translatedWorkflowRows.find(row => row.workflowId === masterId);
        const child = translatedWorkflowRows.find(row => row.workflowId === childId);
        expect(child?.className).toContain('TranslationChildWorkflow');
        expect(master, 'Translation master disappeared from DBOS').toBeTruthy();
        check('Translated DBOS child is DONE while master remains durable for other languages', {master, child});
        await testInfo.attach('11-dbos-after-translation.json', {
          body: Buffer.from(JSON.stringify({master, child}, null, 2)),
          contentType: 'application/json',
        });
        flow('STEP 11 DONE — DBOS translated child advancement verified');
      });

      await test.step('12 — verify the translated Information readonly in the PA UI', async () => {
        currentBusinessStep = 12;
        flow('STEP 12 START — return to PA and inspect the full translated Information');
        const paHome = await page.goto(`${environment.paBaseUrl}/`, {waitUntil: 'networkidle'});
        expect(paHome?.ok(), `PA home returned HTTP ${paHome?.status()}`).toBeTruthy();
        const informationMenuItem = page.locator('a[href="/information"]:visible').first();
        await expect(informationMenuItem, 'Information navigation is not visible after returning to the PA').toBeVisible();
        await informationMenuItem.click();
        await expect(page).toHaveURL(/\/information(?:[?#].*)?$/);

        const searchInput = page.locator('.q-page input:visible').first();
        await expect(searchInput, 'PA Information search input is not visible').toBeVisible();
        await searchInput.fill(marker);
        const sourceRowTitle = page.getByText(sourceTitle, {exact: true}).first();
        await expect(sourceRowTitle, 'Created Information is not present in the PA list').toBeVisible();

        const informationId = Number(created!.id);
        const viewControl = page.locator([
          `button[data-cy="view_information_${informationId}"]`,
          `button[data-cy="edit_information_${informationId}"]`,
        ].join(', ')).first();
        await expect(viewControl, 'Readonly/view control for the approved Information is not visible').toBeVisible();
        await viewControl.click();

        const editor = page.locator('[data-cy="information_multilang_tabs"]');
        await expect(editor).toBeVisible();
        const targetLanguage = activeTargetLanguages.includes(environment.businessTranslationLanguage)
          ? environment.businessTranslationLanguage
          : null;
        expect(targetLanguage).not.toBeNull();
        const targetLanguageName = (await queryPostgres<ActiveLanguageDbRow>({
          host: environment.appDbHost,
          port: environment.appDbPort,
          database: environment.appDbName,
          user: environment.appDbUsername,
          password: environment.appDbPassword,
          connectionTimeoutMillis: 10_000,
        }, 'SELECT lang, name, is_default AS "isDefault" FROM languages WHERE lang = $1', [targetLanguage]))[0]?.name;
        expect(targetLanguageName, 'Target language has no display name in the database').toBeTruthy();

        const languageTab = editor.getByRole('tab', {name: new RegExp(`^${targetLanguageName}$`, 'i')}).first();
        await expect(languageTab, `PA language tab ${targetLanguageName} is not visible`).toBeVisible();
        await languageTab.click();
        const visibleTitle = editor.locator('input:visible').first();
        await expect(visibleTitle).toHaveValue(translatedTitle);
        const visibleDescription = editor.locator('.ProseMirror:visible').first();
        await expect(visibleDescription).toContainText(translatedDescription);
        paTranslationVisible = true;
        await testInfo.attach('12-pa-readonly-translation.png', {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        check('Imported translation is visible in the PA full readonly view', {
          informationId,
          targetLang: targetLanguage,
          translatedTitle,
          translatedDescription,
        });
        flow('STEP 12 DONE — PA readonly translation verified');
      });

      flow('TEST DONE — steps 1 through 12 passed', {
        informationId: created.id,
        itemUuid: databaseRow?.itemId,
        revisionId: databaseRow?.revisionId,
        approvalHttpStatus,
        giteaSourceHash,
        weblateTranslationsSaved,
        weblateCommitPushed,
        importedTranslation,
        paTranslationVisible,
      });
    } catch (error) {
      flow(`TEST STOPPED — step ${currentBusinessStep} failed; steps ${currentBusinessStep + 1}–12 were not executed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      let completedSteps: number[] = [];
      if (created) completedSteps = [1, 2];
      if (databaseRow) completedSteps = [1, 2, 3];
      if (approvalHttpStatus) completedSteps = [1, 2, 3, 4];
      if (approvedDatabaseRow) completedSteps = [1, 2, 3, 4, 5];
      if (workflowRows.length) completedSteps = [1, 2, 3, 4, 5, 6];
      if (giteaSourceHash) completedSteps = [1, 2, 3, 4, 5, 6, 7];
      if (weblateTranslationsSaved) completedSteps = [1, 2, 3, 4, 5, 6, 7, 8];
      if (weblateCommitPushed) completedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      if (importedTranslation) completedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      if (translatedWorkflowRows.length) completedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      if (paTranslationVisible) completedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

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
          backendAuthentication: environment.backendDummyAuth ? 'DUMMY' : 'KEYCLOAK',
          expectedBackendActor: environment.backendDummyAuth
            ? environment.backendDummyUsername
            : environment.paAdminUsername,
          approvalHttpStatus: approvalHttpStatus ?? null,
          approvedDatabase: approvedDatabaseRow ?? null,
          workflows: workflowRows,
          activeTargetLanguages,
          giteaSourceHash: giteaSourceHash ?? null,
          translatedTitle,
          translatedDescription,
          weblateTranslationsSaved,
          weblateCommitPushed,
          importedTranslation: importedTranslation ?? null,
          translatedWorkflows: translatedWorkflowRows,
          paTranslationVisible,
          completedSteps,
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