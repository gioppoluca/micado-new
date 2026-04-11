/**
 * src/boot/router-guard.ts
 *
 * Global navigation guard — handles:
 *
 *   1. Welcome-skip: if localStorage('showWelcome') === 'false' and the user
 *      navigates to '/' (welcome), redirect straight to '/home'.
 *
 *   2. requiresAuth: true — redirect to Keycloak login when unauthenticated.
 *
 *   3. roles: string[] — post-auth role check; redirect to '/' on mismatch.
 */

import { defineBoot } from '#q-app/wrappers';
import { keycloak } from 'src/auth/keycloak';
import { getRoles } from 'src/auth/keycloak';
import { logger } from 'src/services/Logger';

export default defineBoot(({ router }) => {
  router.beforeEach((to) => {

    // ── 1. Welcome-skip ────────────────────────────────────────────────────
    // If the user has previously opted out of the welcome page, send them
    // straight to /home.  Only applies to the root / route.
    if (to.name === 'welcome' && localStorage.getItem('showWelcome') === 'false') {
      logger.info('[router-guard] welcome skip — redirecting to /home');
      return { name: 'home' };
    }

    // ── 2. Auth check ──────────────────────────────────────────────────────
    if (to.matched.some(r => r.meta?.requiresAuth) && !keycloak.authenticated) {
      logger.info('[router-guard] unauthenticated — redirecting to login', { path: to.fullPath });
      void keycloak.login({ redirectUri: window.location.origin + to.fullPath });
      return false;
    }

    // ── 3. Role check ──────────────────────────────────────────────────────
    const requiredRoles = to.matched
      .flatMap(r => (r.meta?.roles as string[] | undefined) ?? []);

    if (requiredRoles.length > 0) {
      const userRoles = getRoles();
      const hasRole = requiredRoles.some(role => userRoles.includes(role));
      if (!hasRole) {
        logger.warn('[router-guard] insufficient roles', {
          path: to.fullPath,
          required: requiredRoles,
          user: userRoles,
        });
        return { path: '/' };
      }
    }

    return true;
  });
});