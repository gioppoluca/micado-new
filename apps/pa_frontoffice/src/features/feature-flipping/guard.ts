// src/features/feature-flipping/guard.ts
//
// Vue Router 4 navigation guard (same logic as legacy, updated typing).
//
import type { RouteLocationNormalized, NavigationGuardNext } from 'vue-router';
import { isEnabled } from './service';

/**
 * @example
 * { path: '/chat', component: Chat,
 *   meta: { featureFlipping: { key: 'CHATBOT', redirect: '/' } } }
 */
export function featureFlippingGuard(
    to: RouteLocationNormalized,
    _from: RouteLocationNormalized,
    next: NavigationGuardNext,
) {
    const ff = to.meta?.featureFlipping as
        | { key: string; redirect?: string; default?: boolean; not?: boolean }
        | undefined;

    if (ff) {
        const { key, redirect = '/', default: fallback, not = false } = ff;
        if (not ? isEnabled(key, fallback) : !isEnabled(key, fallback)) {
            return next(redirect);
        }
    }
    return next();
}