import {defineBoot} from '#q-app/wrappers';
import {keycloak} from 'src/auth/keycloak';

export default defineBoot(({router}) => {
  router.beforeEach(async (to) => {
    if (to.meta?.requiresAuth) {
      if (!keycloak.authenticated) {
        await keycloak.login({redirectUri: window.location.origin + to.fullPath});
        // navigation will continue after redirect
        return false;
      }
    }
    return true;
  });
});
