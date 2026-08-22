function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

export function optionalEnvironment(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

const baseDomain = optionalEnvironment('BASE_DOMAIN', 'localhost');
const protocol = baseDomain === 'localhost' ? 'http' : 'https';

function publicUrl(subdomain, path = '') {
  return `${protocol}://${subdomain}.${baseDomain}${path}`;
}

function service(id, label, subdomain, path = '', expectedTitle = '', allowEmptyBody = false) {
  return Object.freeze({
    id,
    label,
    url: publicUrl(subdomain, path),
    expectedTitle,
    allowEmptyBody,
  });
}

export const environment = Object.freeze({
  baseDomain,
  protocol,
  keycloakBaseUrl: publicUrl('auth'),
  backendBaseUrl: publicUrl('api'),
  backendPublicPath: '/ping',
  keycloakAdminUsername: optionalEnvironment('KC_BOOTSTRAP_ADMIN_USERNAME'),
  keycloakAdminPassword: optionalEnvironment('KC_BOOTSTRAP_ADMIN_PASSWORD'),
  // Realm-seeded users — same variables (and .env) used to resolve the
  // ${VAR} placeholders in infrastructure/keycloak/realms/*.json.
  paBaseUrl: publicUrl('pa'),
  paAdminUsername: optionalEnvironment('PA_ADMIN_USERNAME', 'pa-admin'),
  paAdminPassword: optionalEnvironment('PA_ADMIN_PASSWORD'),
  appDbHost: optionalEnvironment('PLAYWRIGHT_DB_HOST', 'host.docker.internal'),
  appDbPort: Number(optionalEnvironment('PLAYWRIGHT_DB_PORT', '5432')),
  appDbName: optionalEnvironment('APP_DB', optionalEnvironment('POSTGRES_DB', 'micado')),
  appDbUsername: optionalEnvironment('APP_DB_USER', 'micado'),
  appDbPassword: optionalEnvironment('MICADO_APP_PASSWORD'),
  backendDummyAuth: optionalEnvironment('AUTH_DISABLE_KEYCLOAK', 'false').toLowerCase() === 'true',
  backendDummyUsername: optionalEnvironment('AUTH_DUMMY_USERNAME', 'playwright.admin'),
  dbosDbSchema: optionalEnvironment('DBOS_DB_SCHEMA', 'dbos'),
  dbosDbUsername: optionalEnvironment('DBOS_DB_USER', 'dbos'),
  giteaBaseUrl: publicUrl('git'),
  giteaUsername: optionalEnvironment('GITEA_WEBLATE_USER', 'weblate-bot'),
  giteaPassword: optionalEnvironment('GITEA_WEBLATE_PASSWORD'),
  // The Compose backend is deliberately pinned to the `translations` repo.
  // Use test-specific overrides so a stale generic .env value cannot point
  // Playwright at a different repository than the running backend.
  giteaTranslationsRepo: optionalEnvironment('PLAYWRIGHT_GITEA_TRANSLATIONS_REPO', 'translations'),
  giteaTranslationsBranch: optionalEnvironment('PLAYWRIGHT_GITEA_TRANSLATIONS_BRANCH', 'main'),
  weblateBaseUrl: publicUrl('weblate'),
  weblateAdminUsername: optionalEnvironment('WEBLATE_ADMIN_USERNAME', 'admin'),
  weblateAdminPassword: optionalEnvironment('WEBLATE_ADMIN_PASSWORD'),
  sourceLanguage: optionalEnvironment('MICADO_SOURCE_LANG', 'en'),
  targetLanguages: optionalEnvironment('MICADO_TARGET_LANGS', 'it,fr,ar,de,sq,mk')
    .split(',').map(value => value.trim()).filter(Boolean),
  businessTranslationLanguage: optionalEnvironment('CBL_TRANSLATION_LANG', 'it'),
  ngoBaseUrl: publicUrl('ngo'),
  ngoAdminUsername: optionalEnvironment('NGO_ADMIN_USERNAME', 'ngo-admin'),
  ngoAdminPassword: optionalEnvironment('NGO_ADMIN_PASSWORD'),
});

export const webServices = Object.freeze([
  service('keycloak', 'KEYCLOAK-WEB', 'auth', '/admin/master/console/', 'Keycloak', true),
  service('migrants', 'MIGRANTS', 'migrants'),
  service('pa', 'PA', 'pa'),
  service('ngo', 'NGO', 'ngo'),
  service('gitea', 'GITEA', 'git', '', 'Gitea'),
  service('weblate', 'WEBLATE', 'weblate', '', 'Weblate'),
  service('umami', 'UMAMI', 'analytics', '/login', 'Umami'),
  service('traefik', 'TRAEFIK', 'traefik', '/dashboard/', 'Traefik'),
]);
