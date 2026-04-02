import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // Public site root — remains accessible without authentication
      { path: '', name: 'home', component: () => import('pages/IndexPage.vue') },

      // Post-login home page
      {
        path: 'home',
        name: 'authenticated-home',
        component: () => import('pages/HomePage.vue'),
        meta: { requiresAuth: true },
      },

      // Protected language selection / bootstrap area
      {
        path: 'languages',
        name: 'languages',
        component: () => import('pages/LandingPage.vue'),
        meta: { requiresAuth: true },
      },

      // Protected profile area
      {
        path: 'profile',
        name: 'profile',
        component: () => import('pages/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },

      // Protected bootstrap/debug page for settings visibility
      {
        path: 'settings',
        name: 'settings',
        component: () => import('pages/SettingsPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: '/login',
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

