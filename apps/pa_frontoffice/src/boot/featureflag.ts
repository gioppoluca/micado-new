// src/boot/featureflag.ts
//
// Quasar boot file — replaces the legacy featureflag.js boot.
// Runs in ALL THREE apps (migrants, PA, NGO).
//
// What it does:
//   1. Registers the v-feature-flipping directive globally
//   2. Adds the router guard globally
//   3. Calls GET /active-features (public, no auth required)
//   4. Pushes the enabled key list into the service singleton
//
import { boot } from 'quasar/wrappers';
import { api } from 'boot/axios'; // adjust to your axios boot alias
import { featureFlippingDirective, featureFlippingGuard, setEnabledFeatures } from 'src/features/feature-flipping';

export default boot(async ({ app, router }) => {
    // Register directive — used as v-feature-flipping in templates
    app.directive('feature-flipping', featureFlippingDirective);

    // Register global navigation guard
    router.beforeEach(featureFlippingGuard);

    try {
        const { data } = await api.get<{ features: string[] }[]>('/active-features');
        // Legacy shape: [{ features: ['KEY1', 'KEY2'] }]
        const keys = data[0]?.features ?? [];
        setEnabledFeatures(keys);
        console.debug('[featureflag] enabled:', keys);
    } catch (err) {
        console.error('[featureflag] Failed to load feature flags:', err);
        // Non-fatal: app continues with all features disabled
        setEnabledFeatures([]);
    }
});