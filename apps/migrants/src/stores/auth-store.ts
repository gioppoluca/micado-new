import { defineStore } from 'pinia';
import type Keycloak from 'keycloak-js';
import type { KeycloakLoginOptions, KeycloakLogoutOptions } from 'keycloak-js';
import { getRoles } from 'src/auth/keycloak';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    keycloak: null as Keycloak | null,
    authenticated: false,
    roles: [] as string[],
  }),
  getters: {
    hasRole: (state) => (role: string) => state.roles.includes(role),
  },
  actions: {
    setKeycloak(kc: Keycloak, authenticated: boolean) {
      this.keycloak = kc;
      this.authenticated = authenticated;
      this.roles = getRoles();
    },

    async login(redirectUri?: string) {
      if (!this.keycloak) throw new Error('Keycloak not initialized');

      const opts: KeycloakLoginOptions = {};
      if (redirectUri) opts.redirectUri = redirectUri;

      await this.keycloak.login(opts);
    },

    async logout(redirectUri?: string) {
      if (!this.keycloak) throw new Error('Keycloak not initialized');

      const opts: KeycloakLogoutOptions = {};
      if (redirectUri) opts.redirectUri = redirectUri;

      await this.keycloak.logout(opts);
    },
  },
});