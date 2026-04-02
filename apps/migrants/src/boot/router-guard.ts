/**
 * src/boot/router-guard.ts
 *
 * Global navigation guard — handles two route meta properties:
 *
 *   requiresAuth: true
 *     Redirect to Keycloak login if the user is not authenticated.
 *
 *   roles: string[]
 *     After authentication, check that the user has at least one of the
 *     listed Keycloak roles.  Redirect to '/' if none match.
 *     Role names are raw Keycloak values (no 'Application/' prefix).
 */

import { defineBoot } from '#q-app/wrappers';
import { keycloak } from 'src/auth/keycloak';
import { getRoles } from 'src/auth/keycloak';
import { logger } from 'src/services/Logger';

export default defineBoot(({ router }) => {
  router.beforeEach((to) => {
    // ── Auth check ──────────────────────────────────────────────────────────
    if (to.matched.some(r => r.meta?.requiresAuth) && !keycloak.authenticated) {
      logger.info('[router-guard] unauthenticated — redirecting to login', { path: to.fullPath });
      void keycloak.login({ redirectUri: window.location.origin + to.fullPath });
      return false;
    }

    // ── Role check ──────────────────────────────────────────────────────────
    // Collect all roles required by matched route segments (parent + child)
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