import {BindingScope, injectable} from '@loopback/core';
import {HttpErrors, Request} from '@loopback/rest';
import {createHmac, timingSafeEqual} from 'node:crypto';

/**
 * Verifies Weblate's Standard Webhooks signature.
 *
 * Weblate signs: "{webhook-id}.{webhook-timestamp}.{json-body}" using
 * HMAC-SHA256 and the base64-decoded WEBLATE_WEBHOOK_SECRET.
 */
@injectable({scope: BindingScope.SINGLETON})
export class WeblateWebhookSignatureService {
  private static readonly MAX_AGE_SECONDS = 5 * 60;

  verify(request: Request, body: unknown): void {
    const configuredSecret = process.env.WEBLATE_WEBHOOK_SECRET?.trim();
    if (!configuredSecret) {
      throw new HttpErrors.ServiceUnavailable('Weblate webhook secret is not configured');
    }

    const messageId = this.header(request, 'webhook-id');
    const timestamp = this.header(request, 'webhook-timestamp');
    const signatureHeader = this.header(request, 'webhook-signature');

    if (!messageId || !timestamp || !signatureHeader) {
      throw new HttpErrors.Forbidden('Missing Weblate webhook signature headers');
    }

    this.verifyTimestamp(timestamp);

    const secret = configuredSecret.replace(/^whsec_/, '');
    const key = Buffer.from(secret, 'base64');
    if (key.length < 24 || key.length > 64) {
      throw new HttpErrors.ServiceUnavailable('Weblate webhook secret has an invalid length');
    }

    const serializedBody = JSON.stringify(body ?? {});
    const signedContent = `${messageId}.${timestamp}.${serializedBody}`;
    const expected = createHmac('sha256', key).update(signedContent).digest();

    const valid = signatureHeader.split(' ').some(candidate => {
      const [version, encoded] = candidate.split(',', 2);
      if (version !== 'v1' || !encoded) return false;

      try {
        const received = Buffer.from(encoded, 'base64');
        return received.length === expected.length && timingSafeEqual(received, expected);
      } catch {
        return false;
      }
    });

    if (!valid) {
      throw new HttpErrors.Forbidden('Invalid Weblate webhook signature');
    }
  }

  private verifyTimestamp(value: string): void {
    const timestamp = Number(value);
    const now = Date.now() / 1000;
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > WeblateWebhookSignatureService.MAX_AGE_SECONDS) {
      throw new HttpErrors.Forbidden('Weblate webhook timestamp is invalid or expired');
    }
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value?.toString();
  }
}
