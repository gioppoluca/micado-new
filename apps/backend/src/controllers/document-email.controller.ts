/**
 * src/controllers/document-email.controller.ts
 *
 * ── Endpoint map ─────────────────────────────────────────────────────────────
 *
 *   GET  /ngo/contact-emails
 *     Public (@authenticate.skip) — returns { displayName, contactEmail }[]
 *     for every NGO group that has a contactEmail attribute set, plus the
 *     PA's own feedback_email setting (labelled as "Public Administration").
 *     Used by the migrant send-document page to populate the dropdown.
 *
 *   POST /documents-migrant/:id/send-email
 *     Authenticated migrant only.
 *     Verifies the document belongs to the caller, fetches the binary,
 *     sends it as an email attachment to the target address.
 *     Body: { email: string }
 *     Returns: { sentTo: string }
 *
 * ── Design decisions ──────────────────────────────────────────────────────────
 *
 *   • The target email is supplied by the caller — either chosen from the
 *     dropdown (pre-validated authority contacts) or entered free-form.
 *     The backend does NOT validate whether a free-form address "exists" —
 *     that is fundamentally unknowable without sending. We deliver the message
 *     and let SMTP bounce handling deal with invalid addresses.
 *     The frontend mockup's "email does not exist" screen is shown when the
 *     SMTP send itself throws (e.g. the server rejects the recipient).
 *
 *   • The document is attached using its stored mimeType and fileName.
 *     The email body is a simple HTML template; no translation needed for the
 *     initial implementation.
 *
 *   • MAIL_HOST must be configured; if it is absent MailService throws and
 *     the endpoint returns 503 (caught here and re-thrown as HttpErrors).
 */

import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { repository } from '@loopback/repository';
import { get, post, param, requestBody, HttpErrors } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { MailService } from '../services/mail.service';
import { MigrantDocumentRepository } from '../repositories/migrant-document.repository';
import { SettingRepository } from '../repositories/setting.repository';
import { NgoOrganizationBootstrapService } from '../services/ngo-organization-bootstrap.service';

/** Shape returned by GET /ngo/contact-emails */
export interface ContactEmailOption {
    /** Human-readable label for the dropdown. */
    displayName: string;
    /** The email address to send to. */
    email: string;
}

@authenticate('keycloak')
export class DocumentEmailController {
    constructor(
        @inject('services.MailService')
        private readonly mailService: MailService,

        @repository(MigrantDocumentRepository)
        private readonly documentRepo: MigrantDocumentRepository,

        @repository(SettingRepository)
        private readonly settingRepo: SettingRepository,

        @inject('services.NgoOrganizationBootstrapService')
        private readonly ngoBootstrap: NgoOrganizationBootstrapService,

        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) { }

    // ── GET /ngo/contact-emails ───────────────────────────────────────────────

    /**
     * Returns the list of pre-configured email destinations for the send-document
     * feature. Public endpoint — no auth token needed by the migrant app.
     *
     * Sources (merged, deduplicated):
     *   1. Every NGO group that has a contactEmail Keycloak attribute.
     *   2. The PA's feedback_email setting (key "feedback_email"), labelled
     *      "Public Administration".
     */
    @authenticate.skip()
    @get('/ngo/contact-emails', {
        responses: {
            '200': {
                description: 'List of available send-to email destinations.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    displayName: { type: 'string' },
                                    email: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    async listContactEmails(): Promise<ContactEmailOption[]> {
        const results: ContactEmailOption[] = [];

        // 1. PA feedback_email setting
        try {
            const setting = await this.settingRepo.findOne({ where: { key: 'feedback_email' } });
            if (setting?.value?.trim()) {
                results.push({
                    displayName: 'Public Administration',
                    email: setting.value.trim(),
                });
            }
        } catch (e) {
            this.logger.warn('[DocumentEmailController] could not load feedback_email setting', e);
        }

        // 2. NGO groups with a contactEmail attribute
        try {
            const orgs = await this.ngoBootstrap.listOrganizations();
            for (const org of orgs) {
                if (org.contactEmail) {
                    results.push({
                        displayName: org.displayName,
                        email: org.contactEmail,
                    });
                }
            }
        } catch (e) {
            this.logger.warn('[DocumentEmailController] could not load NGO contact emails', e);
        }

        this.logger.info('[DocumentEmailController.listContactEmails]', {
            count: results.length,
        });
        return results;
    }

    // ── POST /documents-migrant/:id/send-email ────────────────────────────────

    /**
     * Send a document as an email attachment to the given address.
     *
     * Enforces ownership: the document must belong to the authenticated caller.
     * Throws 422 when `email` is missing.
     * Throws 503 when the mail server is not configured.
     * Throws 502 when the SMTP server rejects the message (with the SMTP
     * error surfaced as the message so the frontend can show the error screen).
     */
    @post('/documents-migrant/{id}/send-email', {
        responses: {
            '200': {
                description: 'Document sent.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: { sentTo: { type: 'string' } },
                        },
                    },
                },
            },
            '404': { description: 'Document not found.' },
            '422': { description: 'Email address is missing.' },
            '502': { description: 'SMTP server rejected the message.' },
            '503': { description: 'Mail server not configured.' },
        },
    })
    async sendDocumentByEmail(
        @inject(SecurityBindings.USER) caller: UserProfile,
        @param.path.string('id') id: string,
        @requestBody({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['email'],
                        properties: {
                            email: { type: 'string', format: 'email' },
                        },
                    },
                },
            },
        })
        body: { email: string },
    ): Promise<{ sentTo: string }> {
        const callerSub = caller.id ?? (caller as Record<string, unknown>)['sub'] as string;
        const targetEmail = body.email?.trim();

        if (!targetEmail) {
            throw new HttpErrors.UnprocessableEntity('email is required.');
        }

        this.logger.info('[DocumentEmailController.sendDocumentByEmail]', {
            callerSub, documentId: id, targetEmail,
        });

        // ── Ownership check ────────────────────────────────────────────────────
        const doc = await this.documentRepo.findOne({ where: { id } });
        if (!doc || doc.migrantId !== callerSub) {
            throw new HttpErrors.NotFound(`Document ${id} not found.`);
        }

        // ── Build attachment buffer ────────────────────────────────────────────
        // fileData is stored as BYTEA → node Buffer by the LB4 connector.
        const fileBuffer: Buffer = Buffer.isBuffer(doc.fileData)
            ? doc.fileData
            : Buffer.from(String(doc.fileData ?? ''), 'base64');

        // ── Send ──────────────────────────────────────────────────────────────
        try {
            await this.mailService.send({
                to: targetEmail,
                subject: `Micado: document shared by a migrant`,
                html: this.buildEmailHtml(doc.fileName),
                text: `A migrant has shared a document with you via the Micado platform.\n\nDocument: ${doc.fileName}`,
                attachments: [
                    {
                        filename: doc.fileName || 'document',
                        content: fileBuffer,
                        contentType: doc.mimeType || 'application/octet-stream',
                    },
                ],
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error('[DocumentEmailController.sendDocumentByEmail] send failed', {
                targetEmail, error: msg,
            });

            if (msg.includes('not configured') || msg.includes('MAIL_HOST')) {
                throw new HttpErrors.ServiceUnavailable(
                    'Email delivery is not configured on this server. Contact the administrator.',
                );
            }
            // SMTP rejection → surface as 502 so the frontend shows the error screen
            throw new HttpErrors.BadGateway(msg);
        }

        return { sentTo: targetEmail };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private buildEmailHtml(fileName: string): string {
        return `
<!DOCTYPE html>
<html lang="en">
<body style="font-family:sans-serif;color:#1f2937;max-width:600px;margin:auto;padding:24px;">
  <h2 style="color:#0f3a5d;">Document shared via Micado</h2>
  <p>A migrant has shared a personal document with you through the Micado platform.</p>
  <p style="margin:16px 0;">
    <strong>File:</strong> ${this.escapeHtml(fileName)}
  </p>
  <p>Please find the document attached to this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:12px;color:#6b7280;">
    This message was sent automatically by the Micado platform.
    Do not reply to this email.
  </p>
</body>
</html>`.trim();
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
