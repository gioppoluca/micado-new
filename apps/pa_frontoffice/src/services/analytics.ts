import { logger } from 'src/services/Logger';

export interface AnalyticsEventData {
    [key: string]: string | number | boolean | null | undefined;
}

function isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.umami?.track === 'function';
}

export function trackEvent(name: string, data?: AnalyticsEventData): void {
    if (!isAvailable()) {
        logger.debug('[analytics] umami not available, skipped event', { name, data });
        return;
    }

    try {
        if (data) {
            window.umami!.track(name, data);
        } else {
            window.umami!.track(name);
        }
        logger.debug('[analytics] tracked event', { name, data });
    } catch (error) {
        logger.error('[analytics] failed to track event', error);
    }
}

export function identifySession(data: AnalyticsEventData): void {
    if (typeof window === 'undefined' || typeof window.umami?.identify !== 'function') {
        return;
    }

    try {
        window.umami.identify(data);
        logger.debug('[analytics] identified session', data);
    } catch (error) {
        logger.error('[analytics] failed to identify session', error);
    }
}