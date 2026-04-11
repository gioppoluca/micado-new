/**
 * src/router/routes.ts
 *
 * ── Public ────────────────────────────────────────────────────────────────────
 *   /            WelcomePage           one-shot intro
 *   /home        HomePage              topic tree + unified content list
 *   /glossary    GlossaryPage          alphabetic glossary
 *   /about       AboutPage             navigation menu
 *   /privacy     PrivacyPage           policy text + consent state
 *   /powered-by  PoweredByPage         EU funding + partner list
 *   /info/:id    InformationDetailPage single information item
 *
 * ── Auth-gated ────────────────────────────────────────────────────────────────
 *   /profile     ProfilePage           user hub (docs / tasks / settings / logout)
 *   /settings    SettingsPage
 *
 * ── Placeholders (port progressively) ─────────────────────────────────────────
 *   /process/:id → TODO ProcessDetailPage
 *   /event/:id   → TODO EventDetailPage
 */

import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [

      // ── Public ───────────────────────────────────────────────────────

      {
        path: '',
        name: 'welcome',
        component: () => import('pages/WelcomePage.vue'),
      },
      {
        path: 'home',
        name: 'home',
        component: () => import('pages/HomePage.vue'),
      },
      {
        path: 'glossary',
        name: 'glossary',
        component: () => import('pages/GlossaryPage.vue'),
      },
      {
        path: 'about',
        name: 'about',
        component: () => import('pages/AboutPage.vue'),
      },
      {
        path: 'privacy',
        name: 'privacy',
        component: () => import('pages/PrivacyPage.vue'),
      },
      {
        path: 'powered-by',
        name: 'powered-by',
        component: () => import('pages/PoweredByPage.vue'),
      },

      // ── Content detail pages ───────────────────────────────────────

      {
        path: 'info/:id',
        name: 'info-detail',
        component: () => import('pages/InformationDetailPage.vue'),
      },
      {
        path: 'process/:id',
        name: 'process-detail',
        component: () => import('pages/HomePage.vue'),   // TODO: ProcessDetailPage
      },
      {
        path: 'event/:id',
        name: 'event-detail',
        component: () => import('pages/HomePage.vue'),   // TODO: EventDetailPage
      },

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
        path: 'login',
        name: 'login',
        component: () => import('pages/LoginPage.vue'),
      },
    ],
  },

  {
    path: '/:catchAll(.*)*',
    name: 'not-found',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;