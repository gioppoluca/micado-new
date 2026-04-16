/**
 * src/api/index.ts
 *
 * Barrel export — import everything from 'src/api' in page/store files.
 */

export { apiClient, isApiError } from './client';
export type { ApiError } from './client';

export { languageApi } from './language.api';
export type {
    Language,
    CreateLanguagePayload,
    PatchLanguagePayload,
    LanguageListParams,
} from './language.api';

export { settingsApi } from './settings.api';
export type { PublicSetting } from './settings.api';

export { isMockEnabled } from './mock';
export { featuresApi } from './features.api';
export type { FeatureFlag, PatchFeatureFlagPayload } from './features.api';

// ── Micado entities (required by rich-text editor mention system) ──────────────
export { micadoEntitiesApi } from './micado-entities.api';
export type {
    MicadoEntity,
    EntityTranslation,
    EntityListParams,
} from './micado-entities.api';
