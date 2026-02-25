import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // public home
      { path: '', component: () => import('pages/IndexPage.vue') },

      // protected example
      { path: 'profile', component: () => import('pages/ProfilePage.vue'), meta: { requiresAuth: true } },

      // public settings bootstrap example
      { path: 'settings', component: () => import('pages/SettingsPage.vue') },
    ],
  },

  // login route (optional; protected pages auto-redirect to Keycloak)
  {
    path: '/login',
    component: () => import('pages/LoginPage.vue'),
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
