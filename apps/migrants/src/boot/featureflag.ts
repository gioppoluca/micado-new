/**
 * src/boot/featureflag.ts
 *
 * Registers the v-feature-flipping directive and router guard globally,
 * then fetches the active feature keys at boot time.
 *
 * Boot order position: after loadData, before keycloak.
 * GET /active-features is public — no auth token required.
 *
 * Migration notes from legacy featureflag.js:
 *  - `boot` from 'quasar/wrappers' → `defineBoot` from '#q-app/wrappers'
 *  - Raw axios instance → apiClient from src/api/client
 *  - console.debug/error → logger from src/services/Logger
 */

import { defineBoot } from '#q-app/wrappers';
import { apiClient } from 'src/api/client';
import { logger } from 'src/services/Logger';
import {
    featureFlippingDirective,
    featureFlippingGuard,
    setEnabledFeatures,
} from 'src/features/feature-flipping';

export default defineBoot(async ({ app, router }) => {
    // Register v-feature-flipping directive globally
    app.directive('feature-flipping', featureFlippingDirective);

    // Register feature-flag navigation guard
    router.beforeEach(featureFlippingGuard);

    try {
        const response = await apiClient.get<{ features: string[] }[]>('/active-features');
        // Backend shape: [{ features: ['KEY1', 'KEY2', ...] }]
        const keys = response.data[0]?.features ?? [];
        setEnabledFeatures(keys);
        logger.info('[featureflag] active features loaded', { count: keys.length, keys });
    } catch (err) {
        // Non-fatal: app continues with all features disabled
        logger.error('[featureflag] failed to load active features — all features disabled', err);
        setEnabledFeatures([]);
    }
});