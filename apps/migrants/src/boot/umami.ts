/**
 * src/boot/umami.ts
 *
 * Injects the Umami analytics script at runtime, using URLs from the
 * RuntimeConfig singleton (populated by boot/envvar.ts).
 *
 * Boot order: envvar → umami → mock → i18n → axios → loadData → keycloak → router-guard
 *
 * WHY it runs second (right after envvar)
 * ──────────────────────────────────────
 * Umami tracks page views from the very first navigation.  By injecting the
 * script early — before keycloak redirects or any SPA routing — we capture
 * the initial landing page accurately, including for anonymous/public routes.
 *
 * WHY it is safe to run before keycloak
 * ──────────────────────────────────────
 * Umami only sends a lightweight beacon to its own server.  It does not call
 * the Micado API and does not require authentication.
 *
 * Graceful degradation
 * ────────────────────
 * If umamiUrl or umamiWebsiteId are absent from config.json the boot returns
 * silently without injecting anything.  Analytics is optional infrastructure.
 *
 * Idempotency
 * ───────────
 * scriptAlreadyPresent() guards against double-injection during HMR in dev.
 */

import { defineBoot } from '#q-app/wrappers';
import { getRuntimeConfig } from 'src/config/env';
import { logger } from 'src/services/Logger';

function scriptAlreadyPresent(src: string): boolean {
    return Array.from(document.scripts).some((script) => script.src === src);
}

export default defineBoot(() => {
    if (typeof window === 'undefined') {
        // SSR guard — not currently used but safe to keep
        return;
    }

    const { umamiUrl, umamiWebsiteId, umamiDomains } = getRuntimeConfig();

    if (!umamiUrl || !umamiWebsiteId) {
        logger.info('[boot:umami] disabled: missing umamiUrl or umamiWebsiteId');
        return;
    }

    const scriptSrc = `${umamiUrl.replace(/\/$/, '')}/script.js`;

    if (scriptAlreadyPresent(scriptSrc)) {
        logger.debug('[boot:umami] tracker already loaded');
        return;
    }

    const script = document.createElement('script');
    script.defer = true;
    script.src = scriptSrc;
    script.setAttribute('data-website-id', umamiWebsiteId);

    // Include search params in page-view payloads (relevant for public content pages)
    // — opposite of the PA backoffice where search params are excluded
    // script.setAttribute('data-exclude-search', 'true'); // intentionally omitted

    // Track only on the intended hostname(s), prevents dev noise in production
    if (umamiDomains) {
        script.setAttribute('data-domains', umamiDomains);
    }

    // Ensures the beacon goes to the right Umami instance even if script.js
    // is proxied or served from a CDN path different from the API root.
    script.setAttribute('data-host-url', umamiUrl.replace(/\/$/, ''));

    script.onload = () => {
        logger.info('[boot:umami] tracker loaded', {
            umamiUrl,
            umamiWebsiteId,
            umamiDomains,
        });
    };

    script.onerror = (error) => {
        logger.error('[boot:umami] failed to load tracker', error);
    };

    document.head.appendChild(script);
});