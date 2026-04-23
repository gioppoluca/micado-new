/**
 * src/services/mail.service.ts
 *
 * Thin nodemailer wrapper for sending transactional emails from the backend.
 *
 * ── Configuration (env vars) ──────────────────────────────────────────────────
 *
 *   MAIL_HOST      SMTP host, e.g. "smtp.gmail.com" or "mailhog"  (required)
 *   MAIL_PORT      SMTP port, default 587
 *   MAIL_SECURE    "true" for TLS (port 465), "false" for STARTTLS (default false)
 *   MAIL_USER      SMTP username / auth user  (optional — skip auth when absent)
 *   MAIL_PASSWORD  SMTP password              (optional)
 *   MAIL_FROM      Envelope From address, e.g. "Micado <noreply@micado.eu>"
 *                  Defaults to "Micado <noreply@micado.local>"
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   Inject via @inject('services.MailService') and call send().
 *   The service is auto-discovered because it lives in src/services/.
 *
 * ── Dev / test ────────────────────────────────────────────────────────────────
 *
 *   In local Docker Compose, point MAIL_HOST to Mailhog (port 1025, no auth).
 *   The MAIL_HOST env var is required; if absent the service is disabled and
 *   send() throws rather than silently swallowing errors.
 */

import { injectable, BindingScope, inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailOptions {
    to: string;
    subject: string;
    html: string;
    /** Optional plain-text fallback. */
    text?: string;
    /** Optional attachments. */
    attachments?: Array<{
        filename: string;
        content: Buffer | string;
        contentType?: string;
    }>;
}

@injectable({ scope: BindingScope.SINGLETON })
export class MailService {
    private readonly transporter: Transporter | null;
    private readonly fromAddress: string;
    private readonly host: string | undefined;

    constructor(
        @inject(LoggingBindings.WINSTON_LOGGER)
        private readonly logger: WinstonLogger,
    ) {
        this.host = process.env.MAIL_HOST;
        this.fromAddress = process.env.MAIL_FROM ?? 'Micado <noreply@micado.local>';

        if (!this.host) {
            this.logger.warn(
                '[MailService] MAIL_HOST is not set — email delivery is disabled. ' +
                'Set MAIL_HOST (and optionally MAIL_PORT, MAIL_USER, MAIL_PASSWORD) to enable.',
            );
            this.transporter = null;
            return;
        }

        const port = parseInt(process.env.MAIL_PORT ?? '587', 10);
        const secure = process.env.MAIL_SECURE === 'true';
        const user = process.env.MAIL_USER;
        const pass = process.env.MAIL_PASSWORD;

        this.transporter = nodemailer.createTransport({
            host: this.host,
            port,
            secure,
            ...(user && pass ? { auth: { user, pass } } : {}),
        });

        this.logger.info('[MailService] transporter configured', {
            host: this.host, port, secure, authUser: user ?? '(none)',
        });
    }

    /**
     * Send an email.
     *
     * @throws Error when MAIL_HOST is not configured.
     * @throws Error when the SMTP server rejects the message.
     */
    async send(opts: MailOptions): Promise<void> {
        if (!this.transporter) {
            throw new Error(
                'Email delivery is not configured. Set MAIL_HOST in the backend environment.',
            );
        }

        this.logger.info('[MailService.send]', {
            to: opts.to,
            subject: opts.subject,
            hasAttachments: (opts.attachments?.length ?? 0) > 0,
        });

        await this.transporter.sendMail({
            from: this.fromAddress,
            to: opts.to,
            subject: opts.subject,
            html: opts.html,
            ...(opts.text && { text: opts.text }),
            ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        });

        this.logger.info('[MailService.send] sent successfully', { to: opts.to });
    }

    /** Returns true if the mail server is reachable (SMTP NOOP). */
    async healthCheck(): Promise<boolean> {
        if (!this.transporter) return false;
        try {
            await this.transporter.verify();
            return true;
        } catch {
            return false;
        }
    }
}
