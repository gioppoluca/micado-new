import { defineBoot } from '#q-app/wrappers';
import { keycloak } from 'src/auth/keycloak';

export default defineBoot(({ router }) => {
  router.beforeEach((to) => {
    if (to.meta?.requiresAuth && !keycloak.authenticated) {
      void keycloak.login({ redirectUri: window.location.origin + to.fullPath });
      return false;
    }
    return true;
  });
});
