import 'klaro/dist/klaro.css';
import 'src/css/klaro-overrides.scss';
import type { BootFileParams } from '@quasar/app-vite';
import { boot } from 'quasar/wrappers';
import { consola } from 'consola';
import { consentService } from 'src/services/consent/consent-service';
import { i18n } from 'boot/i18n';

const logger = consola.withTag('boot-consent');

declare module '@vue/runtime-core' {
    interface ComponentCustomProperties {
        $consent: typeof consentService;
    }
}

function resolveLocale(): string {
    const locale = i18n.global.locale;
    return typeof locale === 'string' ? locale : (locale.value ?? 'en-US');
}

function translate(...args: unknown[]): string {
    return i18n.global.t(...(args as Parameters<typeof i18n.global.t>));
}

export default boot(async ({ app, router }: BootFileParams) => {
    logger.info('Initializing consent boot');

    await consentService.init({
        lang: resolveLocale(),
        t: translate,
        getCurrentUserId: () => {
            const user = app.config.globalProperties.$auth?.user;
            return user?.id ?? null;
        },
    });

    await consentService.hydrateFromBackendIfMissing();

    app.config.globalProperties.$consent = consentService;

    router.afterEach((to) => {
        logger.debug('Route changed', to.fullPath);
    });
});