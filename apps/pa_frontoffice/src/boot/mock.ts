/**
 * src/boot/mock.ts
 *
 * Boot file that installs the mock adapter and registers all API module
 * handlers when VITE_API_MOCK=true.
 *
 * IMPORTANT: 'mock' must be the FIRST entry in quasar.config.ts → boot[]
 * so the adapter is installed before any component or store imports an API module.
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

    const adapter = installMockAdapter();
    if (!adapter) return;

    // Register handlers from each API module.
    // Add new modules here as they are created.
    const { registerLanguageMocks } = await import('src/api/language.api');
    const { registerSettingsMocks } = await import('src/api/settings.api');
    const { registerFeaturesMocks } = await import('src/api/features.api');
    const { registerUserTypeMocks } = await import('src/api/user-type.api');
    const { registerDocumentTypeMocks } = await import('src/api/document-type.api');
    const { registerTopicMocks } = await import('src/api/topic.api');
    const { registerGlossaryMocks } = await import('src/api/glossary.api');
    const { registerCategoryMocks } = await import('src/api/category.api');
    const { registerEventMocks } = await import('src/api/event.api');
    const { registerInformationMocks } = await import('src/api/information.api');

    registerLanguageMocks(adapter);
    registerSettingsMocks(adapter);
    registerFeaturesMocks(adapter);
    registerUserTypeMocks(adapter);
    registerDocumentTypeMocks(adapter);
    registerTopicMocks(adapter);
    registerGlossaryMocks(adapter);
    registerCategoryMocks(adapter);
    registerEventMocks(adapter);
    registerInformationMocks(adapter);

    logger.warn('[boot:mock] all mock handlers registered');
});