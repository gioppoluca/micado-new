import {BindingScope, inject, injectable} from '@loopback/core';
import {HttpErrors, Request} from '@loopback/rest';
import {LoggingBindings} from '@loopback/logging';
import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import type {Logger} from 'winston';

/**
 * Verifies Weblate's Standard Webhooks signature.
 *
 * Weblate signs: "{webhook-id}.{whole-second-timestamp}.{raw-request-body}"
 * using HMAC-SHA256 and the base64-decoded WEBLATE_WEBHOOK_SECRET.
 *
 * ── Root cause of the 2026-08-21 signature-mismatch incident ────────────────
 *
 * Two independent bugs were stacked, and both had to be fixed:
 *
 * 1. BODY: the signed content must use the EXACT RAW BYTES of the HTTP
 *    request body, never `JSON.stringify(parsedBody)`. Weblate's Python
 *    `json.dumps` output (spaces after `:` and `,`) does not necessarily
 *    round-trip byte-for-byte through JSON.parse → JSON.stringify (key
 *    order, whitespace, number formatting can all drift). Re-serializing
 *    is not just "the wrong choice" here, it is unreliable by construction.
 *
 * 2. TIMESTAMP: the `webhook-timestamp` header Weblate 5.16 sends carries
 *    sub-second precision (e.g. "1787347965.731791"), but Weblate signs
 *    using the TRUNCATED WHOLE-SECOND value ("1787347965") — i.e.
 *    `str(int(time.time()))` at signing time vs. a higher-precision value
 *    in the header. Signing with the verbatim header string (fractional
 *    part included) never matches. This was confirmed empirically by
 *    recomputing HMAC-SHA256 offline against a captured real delivery.
 *
 * Fix: sign `{id}.{floor(timestamp)}.{rawBody}` — never the parsed/
 * re-serialized body, never the verbatim (fractional) timestamp string.
 *
 * ── Security note ────────────────────────────────────────────────────────────
 * Never log the secret itself (raw, base64, hex, or with the prefix
 * stripped) — only ever log a one-way fingerprint. A secret that leaks
 * into application logs (which usually end up in a log aggregator with a
 * much wider read audience than the backend's own env) defeats the
 * entire point of signing: anyone who can read the logs can forge valid
 * deliveries. This was a real issue in the previous version of this file.
 */
@injectable({scope: BindingScope.SINGLETON})
export class WeblateWebhookSignatureService {
  private static readonly MAX_AGE_SECONDS = 5 * 60;

  constructor(
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: Logger,
  ) {}

  verify(request: Request, _body: unknown): void {
    // _body (the already-parsed request body) is intentionally unused now —
    // signing MUST use the raw bytes (see class docstring, bug #1). Kept in
    // the signature so callers don't need to change: TranslationCommittedController
    // and TranslationPushedController both call `webhookSignature.verify(req, body)`.
    const tag = '[WeblateSignature]';
    const configuredSecret = process.env.WEBLATE_WEBHOOK_SECRET?.trim();

    const messageId = this.header(request, 'webhook-id');
    const timestampHeader = this.header(request, 'webhook-timestamp');
    const signatureHeader = this.header(request, 'webhook-signature');
    const rawBody = this.readRawBody(request);

    this.logger.info(`${tag} verify start method=${request.method} url=${request.originalUrl ?? request.url} ip=${request.ip}`);
    this.logger.info(`${tag} headers webhook-id=${messageId ?? '<missing>'} webhook-timestamp=${timestampHeader ?? '<missing>'} webhook-signature-present=${Boolean(signatureHeader)}`);
    this.logger.info(`${tag} configuredSecret present=${Boolean(configuredSecret)} chars=${configuredSecret?.length ?? 0} fingerprint=${configuredSecret ? this.sha256(configuredSecret) : '<missing>'}`);
    this.logger.info(`${tag} rawBody available=${rawBody !== undefined} bytes=${rawBody ? Buffer.byteLength(rawBody, 'utf8') : 0} sha256=${rawBody !== undefined ? this.sha256(rawBody) : '<unavailable>'}`);

    if (!configuredSecret) {
      this.logger.error(`${tag} REJECT reason=WEBLATE_WEBHOOK_SECRET is missing`);
      throw new HttpErrors.ServiceUnavailable('Weblate webhook secret is not configured');
    }

    if (!messageId || !timestampHeader || !signatureHeader) {
      this.logger.error(`${tag} REJECT reason=missing signature headers messageId=${Boolean(messageId)} timestamp=${Boolean(timestampHeader)} signature=${Boolean(signatureHeader)}`);
      throw new HttpErrors.Forbidden('Missing Weblate webhook signature headers');
    }

    // RAW BODY IS MANDATORY. Falling back to JSON.stringify(body) here would
    // silently accept a body that was never actually validated against the
    // real bytes Weblate signed — see bug #1 above. Fail closed instead.
    if (rawBody === undefined) {
      this.logger.error(`${tag} REJECT reason=raw request body unavailable — cannot verify signature safely (check that the raw-body capture middleware runs before body-parser for this route)`);
      throw new HttpErrors.ServiceUnavailable('Raw request body unavailable for signature verification');
    }

    this.verifyTimestamp(timestampHeader);

    // Weblate signs with the WHOLE-SECOND timestamp, even though the header
    // itself may carry sub-second precision — see bug #2 above.
    const timestampSeconds = String(Math.trunc(Number(timestampHeader)));
    if (timestampSeconds !== timestampHeader) {
      this.logger.info(`${tag} timestamp truncated for signing header=${timestampHeader} signedAs=${timestampSeconds}`);
    }

    const secret = configuredSecret.replace(/^whsec_/, '');
    const key = Buffer.from(secret, 'base64');
    this.logger.info(`${tag} decodedSecret bytes=${key.length} prefixRemoved=${configuredSecret.startsWith('whsec_')} fingerprint=${this.sha256(key.toString('base64'))}`);
    if (key.length < 24 || key.length > 64) {
      this.logger.error(`${tag} REJECT reason=decoded secret length outside 24..64 bytes actual=${key.length}`);
      throw new HttpErrors.ServiceUnavailable('Weblate webhook secret has an invalid length');
    }

    const signedContent = `${messageId}.${timestampSeconds}.${rawBody}`;
    const expected = createHmac('sha256', key).update(signedContent).digest();
    this.logger.info(`${tag} signedContentBytes=${Buffer.byteLength(signedContent, 'utf8')} expectedSignature=v1,${expected.toString('base64')}`);

    const candidates = signatureHeader.split(' ').filter(Boolean);
    this.logger.info(`${tag} received candidateCount=${candidates.length}`);

    const valid = candidates.some((candidate, index) => {
      const [version, encoded] = candidate.split(',', 2);
      if (version !== 'v1' || !encoded) {
        this.logger.warn(`${tag} candidate[${index}] ignored reason=unsupported-version-or-empty-signature`);
        return false;
      }

      try {
        const received = Buffer.from(encoded, 'base64');
        const matches = received.length === expected.length && timingSafeEqual(received, expected);
        this.logger.info(`${tag} candidate[${index}] version=${version} decodedBytes=${received.length} matches=${matches}`);
        return matches;
      } catch (error) {
        this.logger.error(`${tag} candidate[${index}] decode/compare failed error=${String(error)}`);
        return false;
      }
    });

    if (!valid) {
      this.logger.error(`${tag} REJECT reason=no received signature matched the expected HMAC`);
      throw new HttpErrors.Forbidden('Invalid Weblate webhook signature');
    }

    this.logger.info(`${tag} ACCEPT`);
  }

  private verifyTimestamp(value: string): void {
    const timestamp = Number(value);
    const now = Date.now() / 1000;
    const deltaSeconds = Number.isFinite(timestamp) ? now - timestamp : Number.NaN;
    this.logger.info(`[WeblateSignature] timestamp parsed=${timestamp} now=${now} deltaSeconds=${deltaSeconds} maxAgeSeconds=${WeblateWebhookSignatureService.MAX_AGE_SECONDS}`);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > WeblateWebhookSignatureService.MAX_AGE_SECONDS) {
      this.logger.error(`[WeblateSignature] REJECT reason=timestamp invalid or expired value=${value} deltaSeconds=${deltaSeconds}`);
      throw new HttpErrors.Forbidden('Weblate webhook timestamp is invalid or expired');
    }
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value?.toString();
  }

  private readRawBody(request: Request): string | undefined {
    const candidate = (request as Request & {rawBody?: Buffer | string}).rawBody;
    if (Buffer.isBuffer(candidate)) return candidate.toString('utf8');
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}