export interface KlaroConfigLike {
    version: number;
    elementID: string;
    storageMethod: 'localStorage' | 'cookie';
    storageName: string;
    htmlTexts: boolean;
    mustConsent: boolean;
    acceptAll: boolean;
    hideDeclineAll: boolean;
    hideLearnMore: boolean;
    noticeAsModal: boolean;
    groupByPurpose: boolean;
    default: boolean;
    lang: string;
    translations: Record<string, unknown>;
    services: Array<Record<string, unknown>>;
}


type TranslateFn = (...args: unknown[]) => string;

function normalizeKlaroLang(lang: string): string {
    const lower = lang.toLowerCase();

    if (lower.startsWith('it')) return 'it';
    if (lower.startsWith('en')) return 'en';

    return 'en';
}

function buildTranslations(t: TranslateFn) {
    return {
        it: {
            consentNotice: {
                title: t('consent.notice.title', {}, { locale: 'it-IT' }),
                description: t('consent.notice.description', {}, { locale: 'it-IT' }),
                learnMore: t('consent.notice.learnMore', {}, { locale: 'it-IT' }),
            },
            consentModal: {
                title: t('consent.modal.title', {}, { locale: 'it-IT' }),
                description: t('consent.modal.description', {}, { locale: 'it-IT' }),
                privacyPolicy: {
                    name: t('consent.modal.privacyPolicyName', {}, { locale: 'it-IT' }),
                    text: t('consent.modal.privacyPolicyText', {}, { locale: 'it-IT' }),
                },
            },
            ok: t('consent.actions.ok', {}, { locale: 'it-IT' }),
            acceptAll: t('consent.actions.acceptAll', {}, { locale: 'it-IT' }),
            decline: t('consent.actions.decline', {}, { locale: 'it-IT' }),
            declineAll: t('consent.actions.declineAll', {}, { locale: 'it-IT' }),
            save: t('consent.actions.save', {}, { locale: 'it-IT' }),
            close: t('consent.actions.close', {}, { locale: 'it-IT' }),
            purposeItem: {
                service: t('consent.labels.service', {}, { locale: 'it-IT' }),
                services: t('consent.labels.services', {}, { locale: 'it-IT' }),
            },
            purposes: {
                necessary: {
                    title: t('consent.purposes.necessary.title', {}, { locale: 'it-IT' }),
                    description: t('consent.purposes.necessary.description', {}, { locale: 'it-IT' }),
                },
                analytics: {
                    title: t('consent.purposes.analytics.title', {}, { locale: 'it-IT' }),
                    description: t('consent.purposes.analytics.description', {}, { locale: 'it-IT' }),
                },
                embeddedMedia: {
                    title: t('consent.purposes.embeddedMedia.title', {}, { locale: 'it-IT' }),
                    description: t('consent.purposes.embeddedMedia.description', {}, { locale: 'it-IT' }),
                },
                externalMaps: {
                    title: t('consent.purposes.externalMaps.title', {}, { locale: 'it-IT' }),
                    description: t('consent.purposes.externalMaps.description', {}, { locale: 'it-IT' }),
                },
                thirdPartySupport: {
                    title: t('consent.purposes.thirdPartySupport.title', {}, { locale: 'it-IT' }),
                    description: t('consent.purposes.thirdPartySupport.description', {}, { locale: 'it-IT' }),
                },
            },
            services: {
                usageTracker: {
                    title: t('consent.services.usageTracker.title', {}, { locale: 'it-IT' }),
                    description: t('consent.services.usageTracker.description', {}, { locale: 'it-IT' }),
                },
                youtubeEmbed: {
                    title: t('consent.services.youtubeEmbed.title', {}, { locale: 'it-IT' }),
                    description: t('consent.services.youtubeEmbed.description', {}, { locale: 'it-IT' }),
                },
                atlasEmbed: {
                    title: t('consent.services.atlasEmbed.title', {}, { locale: 'it-IT' }),
                    description: t('consent.services.atlasEmbed.description', {}, { locale: 'it-IT' }),
                },
                supportWidget: {
                    title: t('consent.services.supportWidget.title', {}, { locale: 'it-IT' }),
                    description: t('consent.services.supportWidget.description', {}, { locale: 'it-IT' }),
                },
            },
        },
        en: {
            consentNotice: {
                title: t('consent.notice.title', {}, { locale: 'en-US' }),
                description: t('consent.notice.description', {}, { locale: 'en-US' }),
                learnMore: t('consent.notice.learnMore', {}, { locale: 'en-US' }),
            },
            consentModal: {
                title: t('consent.modal.title', {}, { locale: 'en-US' }),
                description: t('consent.modal.description', {}, { locale: 'en-US' }),
                privacyPolicy: {
                    name: t('consent.modal.privacyPolicyName', {}, { locale: 'en-US' }),
                    text: t('consent.modal.privacyPolicyText', {}, { locale: 'en-US' }),
                },
            },
            ok: t('consent.actions.ok', {}, { locale: 'en-US' }),
            acceptAll: t('consent.actions.acceptAll', {}, { locale: 'en-US' }),
            decline: t('consent.actions.decline', {}, { locale: 'en-US' }),
            declineAll: t('consent.actions.declineAll', {}, { locale: 'en-US' }),
            save: t('consent.actions.save', {}, { locale: 'en-US' }),
            close: t('consent.actions.close', {}, { locale: 'en-US' }),
            purposeItem: {
                service: t('consent.labels.service', {}, { locale: 'en-US' }),
                services: t('consent.labels.services', {}, { locale: 'en-US' }),
            },
            purposes: {
                necessary: {
                    title: t('consent.purposes.necessary.title', {}, { locale: 'en-US' }),
                    description: t('consent.purposes.necessary.description', {}, { locale: 'en-US' }),
                },
                analytics: {
                    title: t('consent.purposes.analytics.title', {}, { locale: 'en-US' }),
                    description: t('consent.purposes.analytics.description', {}, { locale: 'en-US' }),
                },
                embeddedMedia: {
                    title: t('consent.purposes.embeddedMedia.title', {}, { locale: 'en-US' }),
                    description: t('consent.purposes.embeddedMedia.description', {}, { locale: 'en-US' }),
                },
                externalMaps: {
                    title: t('consent.purposes.externalMaps.title', {}, { locale: 'en-US' }),
                    description: t('consent.purposes.externalMaps.description', {}, { locale: 'en-US' }),
                },
                thirdPartySupport: {
                    title: t('consent.purposes.thirdPartySupport.title', {}, { locale: 'en-US' }),
                    description: t('consent.purposes.thirdPartySupport.description', {}, { locale: 'en-US' }),
                },
            },
            services: {
                usageTracker: {
                    title: t('consent.services.usageTracker.title', {}, { locale: 'en-US' }),
                    description: t('consent.services.usageTracker.description', {}, { locale: 'en-US' }),
                },
                youtubeEmbed: {
                    title: t('consent.services.youtubeEmbed.title', {}, { locale: 'en-US' }),
                    description: t('consent.services.youtubeEmbed.description', {}, { locale: 'en-US' }),
                },
                atlasEmbed: {
                    title: t('consent.services.atlasEmbed.title', {}, { locale: 'en-US' }),
                    description: t('consent.services.atlasEmbed.description', {}, { locale: 'en-US' }),
                },
                supportWidget: {
                    title: t('consent.services.supportWidget.title', {}, { locale: 'en-US' }),
                    description: t('consent.services.supportWidget.description', {}, { locale: 'en-US' }),
                },
            },
        },
    };
}

export function createKlaroConfig(
    lang: string,
    t: TranslateFn,
): KlaroConfigLike {
    const klaroLang = normalizeKlaroLang(lang);

    return {
        version: 1,
        elementID: 'micado-klaro',
        storageMethod: 'localStorage',
        storageName: 'micado-klaro-consent',
        htmlTexts: false,
        mustConsent: false,
        acceptAll: true,
        hideDeclineAll: false,
        hideLearnMore: false,
        noticeAsModal: true,
        groupByPurpose: true,
        default: false,
        lang: klaroLang,
        translations: buildTranslations(t),
        services: [
            {
                name: 'usageTracker',
                purposes: ['analytics'],
                required: false,
                default: false,
                optOut: false,
                onlyOnce: true,
            },
            {
                name: 'youtubeEmbed',
                purposes: ['embeddedMedia'],
                required: false,
                default: false,
                optOut: false,
                contextualConsentOnly: true,
            },
            {
                name: 'atlasEmbed',
                purposes: ['externalMaps'],
                required: false,
                default: false,
                optOut: false,
                contextualConsentOnly: true,
            },
            {
                name: 'supportWidget',
                purposes: ['thirdPartySupport'],
                required: false,
                default: false,
                optOut: false,
            },
        ],
    };
}