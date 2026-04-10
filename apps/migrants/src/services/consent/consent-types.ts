export type ConsentPurposeKey =
    | 'necessary'
    | 'analytics'
    | 'embeddedMedia'
    | 'externalMaps'
    | 'thirdPartySupport';

export type ConsentServiceKey =
    | 'usageTracker'
    | 'youtubeEmbed'
    | 'atlasEmbed'
    | 'supportWidget';

export interface ConsentSnapshot {
    schemaVersion: number;
    consentConfigVersion: string;
    lang: string;
    purposes: Partial<Record<ConsentPurposeKey, boolean>>;
    services: Partial<Record<ConsentServiceKey, boolean>>;
    savedAt: string;
}

export interface ConsentState {
    ready: boolean;
    lang: string;
    purposes: Partial<Record<ConsentPurposeKey, boolean>>;
    services: Partial<Record<ConsentServiceKey, boolean>>;
    raw: Record<string, boolean>;
}

export interface ConsentSyncPayload {
    userId: string;
    snapshot: ConsentSnapshot;
}

export interface OptionalServiceHandler {
    key: ConsentServiceKey;
    start: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
}