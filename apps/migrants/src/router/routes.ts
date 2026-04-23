/**
 * src/router/routes.ts
 *
 * ── Public ────────────────────────────────────────────────────────────────────
 *   /              WelcomePage
 *   /home          HomePage
 *   /glossary      GlossaryPage
 *   /about         AboutPage
 *   /privacy       PrivacyPage
 *   /powered-by    PoweredByPage
 *   /info/:id      InformationDetailPage
 *   /event/:id     EventDetailPage
 *   /process/:id   ProcessDetailPage
 *
 * ── Auth-gated ────────────────────────────────────────────────────────────────
 *   /profile        ProfilePage
 *   /settings       SettingsPage
 *   /document-wallet DocumentWalletPage  (FEAT_DOCUMENTS)
 *   /tasks           TasksPage           (FEAT_TASKS)
 */

import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [

      // ── Public ───────────────────────────────────────────────────────

      { path: '', name: 'welcome', component: () => import('pages/WelcomePage.vue') },
      { path: 'home', name: 'home', component: () => import('pages/HomePage.vue') },
      { path: 'glossary', name: 'glossary', component: () => import('pages/GlossaryPage.vue') },
      { path: 'about', name: 'about', component: () => import('pages/AboutPage.vue') },
      { path: 'privacy', name: 'privacy', component: () => import('pages/PrivacyPage.vue') },
      { path: 'powered-by', name: 'powered-by', component: () => import('pages/PoweredByPage.vue') },

      // ── Content detail pages ──────────────────────────────────────────

      { path: 'info/:id', name: 'info-detail', component: () => import('pages/InformationDetailPage.vue') },
      { path: 'event/:id', name: 'event-detail', component: () => import('pages/EventDetailPage.vue') },
      { path: 'process/:id', name: 'process-detail', component: () => import('pages/ProcessDetailPage.vue') },

      // ── Auth-gated ────────────────────────────────────────────────────

      {
        path: 'profile',
        name: 'profile',
        component: () => import('pages/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('pages/SettingsPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'document-wallet',
        name: 'document-wallet',
        component: () => import('pages/DocumentWalletPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'document-wallet/:id',
        name: 'document-detail',
        component: () => import('pages/DocumentDetailPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'document-wallet/:id/edit',
        name: 'document-edit',
        component: () => import('pages/DocumentEditPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'document-wallet/:id/send',
        name: 'document-send',
        component: () => import('pages/DocumentSendPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'document-wallet/:id/send/result',
        name: 'document-send-result',
        component: () => import('pages/DocumentSendResultPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('pages/TasksPage.vue'),
        meta: { requiresAuth: true },
      },

      { path: 'login', name: 'login', component: () => import('pages/LoginPage.vue') },
    ],
  },

  {
    path: '/:catchAll(.*)*',
    name: 'not-found',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;