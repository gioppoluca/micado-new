import { defineBoot } from '#q-app/wrappers';
import { getRuntimeConfig } from 'src/config/env';
import { logger } from 'src/services/Logger';

function scriptAlreadyPresent(src: string): boolean {
    return Array.from(document.scripts).some((script) => script.src === src);
}

export default defineBoot(() => {
    if (typeof window === 'undefined') {
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

    // Keep payload clean for backoffice routes
    script.setAttribute('data-exclude-search', 'true');

    // Track only on the intended hostname(s)
    if (umamiDomains) {
        script.setAttribute('data-domains', umamiDomains);
    }

    // Optional: if the script is served from one place and posts to another.
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