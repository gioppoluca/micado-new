/**
 * src/api/index.ts
 *
 * Barrel export — import everything from 'src/api' in page/store files.
 *
 * Examples:
 *   import { languageApi }            from 'src/api';
 *   import { settingsApi }            from 'src/api';
 *   import type { Language }          from 'src/api';
 *   import { isApiError, type ApiError } from 'src/api';
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