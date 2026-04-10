/**
 * src/router/routes.ts
 *
 * Route table for the Micado migrants frontend.
 *
 * ── Public routes (no auth required) ─────────────────────────────────────────
 *
 *   /            WelcomePage     — one-shot intro; router-guard redirects to
 *                                  /home when localStorage('showWelcome')='false'
 *   /home        HomePage        — topic navigation + unified content list
 *   /glossary    GlossaryPage    — alphabetic glossary, deep-linkable via ?id=
 *   /about       AboutPage       — project credits
 *   /privacy     PrivacyPage     — GDPR / privacy policy
 *
 * ── Auth-gated routes ─────────────────────────────────────────────────────────
 *
 *   /profile     ProfilePage     — user profile (requires Keycloak session)
 *   /settings    SettingsPage    — app settings (requires Keycloak session)
 *
 * ── Placeholder routes (to be ported) ────────────────────────────────────────
 *
 *   /info/:id    InformationDetailPage
 *   /process/:id ProcessDetailPage
 *   /event/:id   EventDetailPage
 *
 *   These are listed here so the router does not 404 when HomePage navigates
 *   to them.  Replace the component imports once those pages are implemented.
 *
 * ── Welcome-skip logic ────────────────────────────────────────────────────────
 *
 *   The router-guard (boot/router-guard.ts) reads localStorage('showWelcome').
 *   If it is 'false', navigation to '/' is redirected to '/home'.
 *   The WelcomePage itself writes this value via the "Don't show again" checkbox.
 */

import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  // ── Main layout shell ─────────────────────────────────────────────────────
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [

      // ── Public ───────────────────────────────────────────────────────

      {
        path: '',
        name: 'welcome',
        component: () => import('pages/WelcomePage.vue'),
        // router-guard handles the skip-to-home redirect
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

      // ── Detail pages (placeholders — port progressively) ──────────────

      {
        path: 'info/:id',
        name: 'info-detail',
        // Lazy-import; replace with real page once ported
        component: () => import('pages/HomePage.vue'),   // TODO: InformationDetailPage
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

      // ── Legacy redirect: /login no longer needed (Keycloak handles it) ─
      {
        path: 'login',
        name: 'login',
        component: () => import('pages/LoginPage.vue'),
      },
    ],
  },

  // ── Fallback 404 ──────────────────────────────────────────────────────────
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;