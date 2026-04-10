import { consola } from 'consola';
import type { ConsentServiceKey, OptionalServiceHandler } from './consent-types';

const logger = consola.withTag('consent-registry');

let analyticsStarted = false;

function startAnalytics() {
    if (analyticsStarted) return;
    analyticsStarted = true;
    logger.info('Starting analytics service');
    // TODO: initialize Umami / Matomo / custom analytics here
    // Example:
    // import('/src/services/analytics').then(({ analytics }) => analytics.start());
}

function stopAnalytics() {
    if (!analyticsStarted) return;
    analyticsStarted = false;
    logger.info('Stopping analytics service');
    // TODO: stop analytics or disable future tracking here
}

function startSupportWidget() {
    logger.info('Starting support widget');
    // TODO: lazy load widget script here
}

function stopSupportWidget() {
    logger.info('Stopping support widget');
    // TODO: optionally remove widget iframe/script here
}

const handlers: Record<ConsentServiceKey, OptionalServiceHandler> = {
    usageTracker: {
        key: 'usageTracker',
        start: startAnalytics,
        stop: stopAnalytics,
    },
    youtubeEmbed: {
        key: 'youtubeEmbed',
        start: () => logger.info('YouTube embeds allowed'),
        stop: () => logger.info('YouTube embeds blocked'),
    },
    atlasEmbed: {
        key: 'atlasEmbed',
        start: () => logger.info('Atlas embeds allowed'),
        stop: () => logger.info('Atlas embeds blocked'),
    },
    supportWidget: {
        key: 'supportWidget',
        start: startSupportWidget,
        stop: stopSupportWidget,
    },
};

export function getOptionalServiceHandler(key: ConsentServiceKey): OptionalServiceHandler | undefined {
    return handlers[key];
}

export function getAllOptionalServiceKeys(): ConsentServiceKey[] {
    return Object.keys(handlers) as ConsentServiceKey[];
}