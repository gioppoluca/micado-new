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

      // ── Settings section ─────────────────────────────────────────────────
      // SettingsLayout renders the secondary settings drawer + <router-view>.
      // Every child route is rendered inside that layout's page container.
      {
        path: 'data_settings',
        component: () => import('layouts/SettingsLayout.vue'),
        meta: { requiresAuth: true },
        children: [
          // Default: redirect to profile_settings (matches sidebar default link)
          {
            path: '',
            redirect: { name: 'settings-profile' },
          },

          // ── Profile settings (all authenticated) ─────────────────────────
          {
            path: 'profile_settings',
            name: 'settings-profile',
            component: () => import('pages/settings/ProfileSettingsPage.vue'),
          },

          // ── Function configuration (superadmin) ──────────────────────────
          {
            path: 'settings',
            name: 'settings-function',
            component: () => import('pages/SettingsPage.vue'),
            meta: { roles: ['micado_superadmin'] },
          },

          // ── Survey management (superadmin) ───────────────────────────────
          {
            path: 'survey',
            name: 'settings-survey',
            component: () => import('pages/settings/SurveyManagementPage.vue'),
            meta: { roles: ['micado_superadmin'] },
          },

          // ── Language / translation management (admin+) ───────────────────
          {
            path: 'language',
            name: 'settings-language',
            component: () => import('pages/settings/TranslationManagementPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },

          // ── PA user management (superadmin) ─────────────────────────────
          {
            path: 'usermgmt',
            name: 'settings-usermgmt',
            component: () => import('pages/settings/UserManagementPage.vue'),
            meta: { roles: ['micado_superadmin'] },
          },

          // ── Privacy policy (all authenticated) ──────────────────────────
          {
            path: 'privacy',
            name: 'settings-privacy',
            component: () => import('pages/settings/PrivacyPolicyPage.vue'),
          },

          // ── Data management sub-pages (admin+) ───────────────────────────
          {
            path: 'document_types',
            name: 'settings-document-types',
            component: () => import('pages/settings/DocumentTypesPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },
          {
            path: 'intervention_categories',
            name: 'settings-intervention-categories',
            component: () => import('pages/settings/InterventionCategoriesPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },
          {
            path: 'intervention_types',
            name: 'settings-intervention-types',
            component: () => import('pages/settings/InterventionTypesPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },
          {
            path: 'topics',
            name: 'settings-topics',
            component: () => import('pages/settings/TopicsPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },
          {
            path: 'user_types',
            name: 'settings-user-types',
            component: () => import('pages/settings/UserTypesPage.vue'),
            meta: { roles: ['micado_superadmin', 'micado_admin'] },
          },
        ],
      },
    ],
  },

  // ── Login (optional — protected pages auto-redirect to Keycloak) ─────────
  { path: '/login', name: 'login', component: () => import('pages/LoginPage.vue') },

  // ── 404 ──────────────────────────────────────────────────────────────────
  { path: '/:catchAll(.*)*', name: 'not-found', component: () => import('pages/ErrorNotFound.vue') },
];

export default routes;