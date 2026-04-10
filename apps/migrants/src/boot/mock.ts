/**
 * src/boot/mock.ts
 *
 * Boot file that installs the mock adapter and registers all API module
 * handlers when VITE_API_MOCK=true.
 *
 * IMPORTANT: Add 'mock' as the FIRST entry in quasar.config.ts → boot[]
 * so the adapter is installed before any component or store imports an API module:
 *
 *   boot: ['mock', 'i18n', 'axios', 'keycloak', 'router-guard'],
 *
 * When VITE_API_MOCK is not 'true', this boot file is a no-op and adds
 * zero overhead to the production bundle (dynamic imports are tree-shaken).
 */

import { defineBoot } from '#q-app/wrappers';
import { logger } from 'src/services/Logger';
import { isMockEnabled, installMockAdapter } from 'src/api/mock';

export default defineBoot(async () => {
    if (!isMockEnabled) {
        logger.debug('[boot:mock] mock disabled — skipping');
        return;
    }

    // installMockAdapter is synchronous — no external package to load.
    const adapter = installMockAdapter();
    if (!adapter) return;

    // Register handlers from each API module.
    // Infrastructure APIs:
    const { registerLanguageMocks } = await import('src/api/language.api');
    const { registerSettingsMocks } = await import('src/api/settings.api');
    // Migrant content APIs (public endpoints):
    const { registerTopicMocks } = await import('src/api/topic.api');
    const { registerCategoryMocks } = await import('src/api/category.api');
    const { registerInformationMocks } = await import('src/api/information.api');
    const { registerEventMocks } = await import('src/api/event.api');
    const { registerGlossaryMocks } = await import('src/api/glossary.api');
    const { registerProcessMocks } = await import('src/api/process.api');

    registerLanguageMocks(adapter);
    registerSettingsMocks(adapter);
    registerTopicMocks(adapter);
    registerCategoryMocks(adapter);
    registerInformationMocks(adapter);
    registerEventMocks(adapter);
    registerGlossaryMocks(adapter);
    registerProcessMocks(adapter);

    logger.warn('[boot:mock] all mock handlers registered');
});