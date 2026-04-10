import * as klaro from 'klaro/dist/klaro-no-css';
import { reactive, readonly } from 'vue';
import { consola } from 'consola';
import { createKlaroConfig } from './klaro-config.factory';
import { getAllOptionalServiceKeys, getOptionalServiceHandler } from './optional-services.registry';
import { ConsentSyncService } from './consent-sync-service';
import type {
    ConsentServiceKey,
    ConsentSnapshot,
    ConsentState,
} from './consent-types';

interface KlaroManagerLike {
    config?: Record<string, unknown>;
    consents?: Record<string, boolean>;
    watch?: (watcher: {
        update?: (obj: unknown, name: string, data: { consents?: Record<string, boolean> }) => void;
    }) => void;
    unwatch?: (watcher: unknown) => void;
    saveAndApplyConsents?: () => void;
    resetConsents?: () => void;
    getConsent?: (name: string) => boolean;
}

export interface ConsentInitOptions {
    lang: string;
    t: (...args: unknown[]) => string;
    getCurrentUserId?: (() => string | null) | undefined;
}

const logger = consola.withTag('consent-service');

const state = reactive<ConsentState>({
    ready: false,
    lang: 'en-US',
    purposes: {},
    services: {},
    raw: {},
});

export class ConsentService {
    private manager: KlaroManagerLike | null = null;
    private watcher: {
        update?: (obj: unknown, name: string, data: { consents?: Record<string, boolean> }) => void;
    } | null = null;

    private syncService = new ConsentSyncService();
    private getCurrentUserId?: (() => string | null) | undefined;
    private consentConfigVersion = '2026-04-10';
    private storageName = 'micado-klaro-consent';
    private config: Record<string, unknown> | null = null;

    async init(options: ConsentInitOptions): Promise<void> {
        this.getCurrentUserId = options.getCurrentUserId;
        state.lang = options.lang;

        this.config = createKlaroConfig(options.lang, options.t) as unknown as Record<string, unknown>;
        this.manager = klaro.getManager(this.config) as KlaroManagerLike;

        this.watcher = {
            update: (_obj, _name, data) => {
                logger.info('Consent updated', data.consents ?? {});
                this.applyConsentState(data.consents ?? {});
                void this.syncCurrentUserConsent();
            },
        };

        this.manager.watch?.(this.watcher);

        const initialConsents = this.manager.consents ?? this.readStoredConsents();
        this.applyConsentState(initialConsents);

        state.ready = true;
        logger.info('Consent service initialized');

        await this.applyOptionalServices();
        const hasStoredConsent = !!localStorage.getItem(this.storageName);
        if (!hasStoredConsent && this.config) {
            klaro.show(this.config);
        }
    }

    getState(): Readonly<ConsentState> {
        return readonly(state) as Readonly<ConsentState>;
    }

    showPreferences(): void {
        if (!this.config) {
            logger.warn('Klaro config not initialized, cannot show preferences');
            return;
        }

        klaro.show(this.config, true);
    }

    showNotice(): void {
        if (!this.config) {
            logger.warn('Klaro config not initialized, cannot show notice');
            return;
        }

        klaro.show(this.config);
    }

    hasServiceConsent(service: ConsentServiceKey): boolean {
        if (this.manager?.getConsent) {
            return !!this.manager.getConsent(service);
        }
        return !!state.services[service];
    }

    async syncCurrentUserConsent(): Promise<void> {
        const userId = this.getCurrentUserId?.();
        if (!userId) return;

        const snapshot = this.toSnapshot();
        await this.syncService.saveUserConsent({
            userId,
            snapshot,
        });
    }

    async hydrateFromBackendIfMissing(): Promise<void> {
        const userId = this.getCurrentUserId?.();
        if (!userId) return;

        const hasLocalConsent = !!localStorage.getItem(this.storageName);
        if (hasLocalConsent) return;

        const backendSnapshot = await this.syncService.loadUserConsent(userId);
        if (!backendSnapshot) return;

        logger.info('Hydrating local consent from backend snapshot');

        const raw = { ...backendSnapshot.services };

        localStorage.setItem(
            this.storageName,
            JSON.stringify({
                consents: raw,
            }),
        );

        this.applyConsentState(raw as Record<string, boolean>);
        await this.applyOptionalServices();
    }

    private applyConsentState(rawConsents: Record<string, boolean>): void {
        state.raw = { ...rawConsents };
        state.services = {
            usageTracker: !!rawConsents.usageTracker,
            youtubeEmbed: !!rawConsents.youtubeEmbed,
            atlasEmbed: !!rawConsents.atlasEmbed,
            supportWidget: !!rawConsents.supportWidget,
        };
        state.purposes = {
            necessary: true,
            analytics: !!rawConsents.usageTracker,
            embeddedMedia: !!rawConsents.youtubeEmbed,
            externalMaps: !!rawConsents.atlasEmbed,
            thirdPartySupport: !!rawConsents.supportWidget,
        };

        void this.applyOptionalServices();
    }

    private async applyOptionalServices(): Promise<void> {
        for (const key of getAllOptionalServiceKeys()) {
            const handler = getOptionalServiceHandler(key);
            if (!handler) continue;

            if (this.hasServiceConsent(key)) {
                await handler.start();
            } else if (handler.stop) {
                await handler.stop();
            }
        }
    }

    private readStoredConsents(): Record<string, boolean> {
        try {
            const raw = localStorage.getItem(this.storageName);
            if (!raw) return {};

            const parsed = JSON.parse(raw) as { consents?: Record<string, boolean> };
            return parsed.consents ?? {};
        } catch (error) {
            logger.warn('Failed reading stored consent payload', error);
            return {};
        }
    }

    private toSnapshot(): ConsentSnapshot {
        return {
            schemaVersion: 1,
            consentConfigVersion: this.consentConfigVersion,
            lang: state.lang,
            purposes: { ...state.purposes },
            services: { ...state.services },
            savedAt: new Date().toISOString(),
        };
    }
}

export const consentService = new ConsentService();