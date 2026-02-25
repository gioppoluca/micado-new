import { defineBoot } from '#q-app/wrappers';
import { keycloak, initKeycloak } from 'src/auth/keycloak';
import { useAuthStore } from 'src/stores/auth-store';
import { logger } from '../services/Logger';

declare module 'vue' {
  interface ComponentCustomProperties {
    $keycloak: typeof keycloak;
  }
}

export default defineBoot(async ({ app }) => {
  logger.info('[boot:keycloak] starting');
  try {
    const authenticated = await initKeycloak();
    const authStore = useAuthStore();
    authStore.setKeycloak(keycloak, authenticated);
    app.config.globalProperties.$keycloak = keycloak;
    logger.info('[boot:keycloak] done', { authenticated });
  } catch (e) {
    logger.error('[boot:keycloak] failed — app will load but auth is unavailable', e);
    // do not rethrow: let the app render even if Keycloak is unreachable
  }
});