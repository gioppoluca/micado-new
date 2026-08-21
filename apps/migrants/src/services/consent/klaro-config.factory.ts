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

function normalizeKlaroLang(locale: string): string {
    const lang = locale.trim().split(/[-_]/)[0]?.toLowerCase();
    if (!lang) {
        throw new Error('MICADO consent configuration requires an initialized locale');
    }
    return lang;
}

function buildTranslation(t: TranslateFn, locale: string) {
    const translate = (key: string): string => t(key, {}, {locale});

    return {
        consentNotice: {
            title: translate('consent.notice.title'),
            description: translate('consent.notice.description'),
            learnMore: translate('consent.notice.learnMore'),
        },
        consentModal: {
            title: translate('consent.modal.title'),
            description: translate('consent.modal.description'),
            privacyPolicy: {
                name: translate('consent.modal.privacyPolicyName'),
                text: translate('consent.modal.privacyPolicyText'),
            },
        },
        ok: translate('consent.actions.ok'),
        acceptAll: translate('consent.actions.acceptAll'),
        decline: translate('consent.actions.decline'),
        declineAll: translate('consent.actions.declineAll'),
        save: translate('consent.actions.save'),
        close: translate('consent.actions.close'),
        purposeItem: {
            service: translate('consent.labels.service'),
            services: translate('consent.labels.services'),
        },
        purposes: {
            necessary: {
                title: translate('consent.purposes.necessary.title'),
                description: translate('consent.purposes.necessary.description'),
            },
            analytics: {
                title: translate('consent.purposes.analytics.title'),
                description: translate('consent.purposes.analytics.description'),
            },
            embeddedMedia: {
                title: translate('consent.purposes.embeddedMedia.title'),
                description: translate('consent.purposes.embeddedMedia.description'),
            },
            externalMaps: {
                title: translate('consent.purposes.externalMaps.title'),
                description: translate('consent.purposes.externalMaps.description'),
            },
            thirdPartySupport: {
                title: translate('consent.purposes.thirdPartySupport.title'),
                description: translate('consent.purposes.thirdPartySupport.description'),
            },
        },
        services: {
            usageTracker: {
                title: translate('consent.services.usageTracker.title'),
                description: translate('consent.services.usageTracker.description'),
            },
            youtubeEmbed: {
                title: translate('consent.services.youtubeEmbed.title'),
                description: translate('consent.services.youtubeEmbed.description'),
            },
            atlasEmbed: {
                title: translate('consent.services.atlasEmbed.title'),
                description: translate('consent.services.atlasEmbed.description'),
            },
            supportWidget: {
                title: translate('consent.services.supportWidget.title'),
                description: translate('consent.services.supportWidget.description'),
            },
        },
    };
}

export function createKlaroConfig(locale: string, t: TranslateFn): KlaroConfigLike {
    const klaroLang = normalizeKlaroLang(locale);

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
        translations: {[klaroLang]: buildTranslation(t, locale)},
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
