import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // ── Public home ──────────────────────────────────────────────────────
      { path: '', name: 'home', component: () => import('pages/IndexPage.vue') },

      // ── Post-login language selection ────────────────────────────────────
      {
        path: 'languages',
        name: 'languages',
        component: () => import('pages/LandingPage.vue'),
        meta: { requiresAuth: true },
      },

      // ── Profile ──────────────────────────────────────────────────────────
      {
        path: 'profile',
        name: 'profile',
        component: () => import('pages/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },

      // ── Useful Information ────────────────────────────────────────────────
      {
        path: 'information',
        name: 'information',
        component: () => import('pages/InformationPage.vue'),
        meta: { requiresAuth: true, roles: ['ngo_admin', 'ngo_operator', 'ngo-admin'] },
      },

      // ── Step-by-step guides (NGO read-only + comments) ──────────────────────
      {
        path: 'ngo-processes',
        name: 'ngo-processes',
        component: () => import('pages/NgoProcessesPage.vue'),
        meta: { requiresAuth: true, roles: ['ngo_admin', 'ngo_operator', 'ngo-admin'] },
      },

      // ── Manage validation (NGO feature — stub for future implementation) ────────
      {
        path: 'manage-validation',
        name: 'manage-validation',
        component: () => import('pages/ManageValidationPage.vue'),
        meta: { requiresAuth: true, roles: ['ngo_admin', 'ngo_operator', 'ngo-admin'] },
      },

      // ── Events & Courses ──────────────────────────────────────────────────
      {
        path: 'events',
        name: 'events',
        component: () => import('pages/EventsPage.vue'),
        meta: { requiresAuth: true, roles: ['ngo_admin', 'ngo_operator', 'ngo-admin'] },
      },

      // ── Settings section ──────────────────────────────────────────────────
      {
        path: 'data_settings',
        meta: { requiresAuth: true },
        children: [
          {
            path: '',
            redirect: { name: 'settings-profile' },
          },
          {
            path: 'profile_settings',
            name: 'settings-profile',
            component: () => import('pages/SettingsPage.vue'),
          },
          // ── NGO user management (ngo_admin only) ─────────────────────────
          {
            path: 'usermgmt',
            name: 'settings-usermgmt',
            component: () => import('pages/NgoUserManagementPage.vue'),
            meta: { roles: ['ngo_admin', 'ngo-admin'] },
          },
        ],
      },
    ],
  },

  // ── Login ─────────────────────────────────────────────────────────────────
  { path: '/login', name: 'login', component: () => import('pages/LoginPage.vue') },

  // ── 404 ──────────────────────────────────────────────────────────────────
  { path: '/:catchAll(.*)*', name: 'not-found', component: () => import('pages/ErrorNotFound.vue') },
];

export default routes;
