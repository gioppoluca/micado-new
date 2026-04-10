/**
 * src/shims-klaro.d.ts
 *
 * Ambient module declaration for the untyped Klaro consent-manager package.
 * Klaro does not ship @types — this file gives TypeScript just enough surface
 * to satisfy the imports in consent-service.ts without resorting to `any`.
 *
 * Only the three functions actually called by consent-service.ts are declared:
 *   • getManager(config) — returns the live consent manager instance
 *   • show(config, modal?) — opens the Klaro consent UI
 *
 * If future code uses additional Klaro APIs, extend this file rather than
 * widening types to `any`.
 */

declare module 'klaro/dist/klaro-no-css' {
    export interface KlaroConfig {
        [key: string]: unknown;
    }

    export interface KlaroManager {
        config?: Record<string, unknown>;
        consents?: Record<string, boolean>;
        watch?: (watcher: {
            update?: (
                obj: unknown,
                name: string,
                data: { consents?: Record<string, boolean> },
            ) => void;
        }) => void;
        unwatch?: (watcher: unknown) => void;
        saveAndApplyConsents?: () => void;
        resetConsents?: () => void;
        getConsent?: (name: string) => boolean;
    }

    /**
     * Returns (or creates) the Klaro consent manager for the given config.
     */
    export function getManager(config: KlaroConfig): KlaroManager;

    /**
     * Opens the Klaro consent dialog.
     * @param config  The Klaro configuration object.
     * @param modal   When true, opens the full consent modal instead of the notice.
     */
    export function show(config: KlaroConfig, modal?: boolean): void;
}