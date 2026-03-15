import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // public home
      { path: '', name: 'home', component: () => import('pages/IndexPage.vue') },

      // post-login language selection (auth required)
      { path: 'languages', name: 'languages', component: () => import('pages/LandingPage.vue'), meta: { requiresAuth: true } },

      // protected profile
      { path: 'profile', name: 'profile', component: () => import('pages/ProfilePage.vue'), meta: { requiresAuth: true } },

      // ── Data settings — nested, matches legacy /data_settings/* structure ──
      {
        path: 'data_settings',
        meta: { requiresAuth: true },
        children: [
          // Default redirect: sidebar links to /data_settings/profile_settings
          { path: '', redirect: { name: 'data-settings-profile' } },

          // Profile settings (accessible to all authenticated roles)
          {
            path: 'profile_settings',
            name: 'data-settings-profile',
            component: () => import('pages/SettingsPage.vue'),
          },

          // Function configuration (superadmin only)
          {
            path: 'settings',
            name: 'data-settings-function',
            component: () => import('pages/SettingsPage.vue'),
            meta: { roles: ['micado_superadmin'] },
          },

          // Language / translation management
          {
            path: 'language',
            name: 'data-settings-language',
            component: () => import('pages/SettingsPage.vue'),
            meta: { roles: ['micado_admin', 'micado_superadmin'] },
          },
        ],
      },
    ],
  },

  // login route (optional; protected pages auto-redirect to Keycloak)
  { path: '/login', name: 'login', component: () => import('pages/LoginPage.vue') },

  { path: '/:catchAll(.*)*', name: 'not-found', component: () => import('pages/ErrorNotFound.vue') },
];

export default routes;