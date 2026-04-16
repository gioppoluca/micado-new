/**
 * src/boot/mock.ts
 *
 * Boot file that installs the mock adapter and registers all API module
 * handlers when VITE_API_MOCK=true.
 *
 * IMPORTANT: 'mock' must be listed before all other boots in quasar.config.ts
 * so the adapter is installed before any component or store imports an API module.
 *
 * When VITE_API_MOCK is not 'true', this boot file is a no-op.
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

    // Register handlers for modules present in ngo_frontoffice.
    // Add new modules here as they are created.
    const { registerLanguageMocks } = await import('src/api/language.api');
    const { registerSettingsMocks } = await import('src/api/settings.api');
    const { registerFeaturesMocks } = await import('src/api/features.api');

    registerLanguageMocks(adapter);
    registerSettingsMocks(adapter);
    registerFeaturesMocks(adapter);

    logger.warn('[boot:mock] all mock handlers registered');
});
