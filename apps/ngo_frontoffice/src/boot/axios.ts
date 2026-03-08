/**
 * src/boot/axios.ts
 *
 * Registers the shared apiClient on the Vue app as $api and $axios so legacy
 * Options API components and the REST explorer still work.
 *
 * The token interceptor, error normalisation, and logging now live entirely in
 * src/api/client.ts — this file is kept as a thin boot shim only.
 */

import { defineBoot } from '#q-app/wrappers';
import axios, { type AxiosInstance } from 'axios';
import { apiClient } from 'src/api/client';

declare module 'vue' {
  interface ComponentCustomProperties {
    $axios: AxiosInstance;
    $api: AxiosInstance;
  }
}

export default defineBoot(({ app }) => {
  // $axios → plain axios (for one-off calls that don't need auth)
  app.config.globalProperties.$axios = axios;
  // $api   → the authenticated, intercepted instance from client.ts
  app.config.globalProperties.$api = apiClient;
});

// Re-export so any file that was doing `import { api } from 'src/boot/axios'`
// continues to work without changes.
export { apiClient as api };