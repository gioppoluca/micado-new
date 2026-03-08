/**
 * src/api/client.ts
 *
 * Central axios instance for the micado_ngo application.
 *
 * Responsibilities:
 *  - Attach the Keycloak Bearer token to every request via a request interceptor.
 *    The token is retrieved lazily from keycloak.ts so this module has no
 *    circular-dependency issues with the boot files.
 *  - Attempt a silent token refresh (updateToken) before each request so the
 *    token is never stale by the time it reaches the backend.
 *  - Normalise error responses into a typed ApiError so callers never have to
 *    inspect raw AxiosError internals.
 *  - Log every request / response / error through the shared consola logger so
 *    all HTTP traffic is visible in one place.
 *
 * Mocking:
 *  If VITE_API_MOCK=true the axios-mock-adapter is installed on this instance
 *  so every API module's mock handlers kick in automatically without any
 *  changes to callers.
 */

import axios, {
    type AxiosInstance,
    type AxiosRequestConfig,
    type InternalAxiosRequestConfig,
    AxiosError,
} from 'axios';
import { keycloak } from 'src/auth/keycloak';
import { logger } from 'src/services/Logger';

// ─── Typed error ─────────────────────────────────────────────────────────────
// Extends Error so Promise.reject(new ApiError(...)) satisfies
// @typescript-eslint/prefer-promise-reject-errors, which requires rejection
// reasons to be Error instances.

export class ApiError extends Error {
    /** HTTP status code, or 0 for network / setup errors */
    readonly status: number;

    constructor(message: string, status: number, cause?: unknown) {
        // Passing { cause } to super() sets the inherited Error.cause property
        // (ES2022+) without needing to redeclare it on this class.
        super(message, { cause });
        // override is required: Error already declares 'name' on its prototype.
        this.name = 'ApiError';
        this.status = status;
    }
}

export function isApiError(e: unknown): e is ApiError {
    return e instanceof ApiError;
}

function normaliseError(error: unknown): ApiError {
    if (error instanceof AxiosError) {
        const status = error.response?.status ?? 0;
        const serverMsg =
            (error.response?.data as { error?: string; message?: string } | undefined)
                ?.error ??
            (error.response?.data as { error?: string; message?: string } | undefined)
                ?.message;
        const message = serverMsg ?? error.message ?? 'Unknown network error';
        return new ApiError(message, status, error);
    }
    if (error instanceof Error) {
        return new ApiError(error.message, 0, error);
    }
    return new ApiError(String(error), 0, error);
}

// ─── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL as string,
    timeout: 15_000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// ─── Request interceptor: token refresh + Bearer attachment ──────────────────

apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
        // Only attempt token operations if Keycloak is authenticated
        if (keycloak.authenticated) {
            try {
                // Refresh if the token expires within 30 seconds
                await keycloak.updateToken(30);
            } catch (e) {
                // Token refresh failed — log and continue; the backend will 401 and
                // the response interceptor below will handle it.
                logger.warn('[api] token refresh failed before request', {
                    url: config.url,
                    error: e,
                });
            }

            const token = keycloak.token;
            if (token) {
                config.headers = config.headers ?? {};
                config.headers.Authorization = `Bearer ${token}`;
                logger.debug('[api] →', {
                    method: config.method?.toUpperCase(),
                    url: config.url,
                    // Never log the token value itself, only confirm it was attached
                    tokenAttached: true,
                });
            }
        } else {
            logger.debug('[api] → (unauthenticated)', {
                method: config.method?.toUpperCase(),
                url: config.url,
            });
        }

        return config;
    },
    (error: unknown) => {
        logger.error('[api] request setup error', error);
        return Promise.reject(normaliseError(error));
    },
);

// ─── Response interceptor: logging + error normalisation ─────────────────────

apiClient.interceptors.response.use(
    (response) => {
        logger.debug('[api] ←', {
            status: response.status,
            url: response.config.url,
        });
        return response;
    },
    (error: unknown) => {
        const normalised = normaliseError(error);

        logger.error('[api] ← error', {
            status: normalised.status,
            message: normalised.message,
            url: error instanceof AxiosError ? error.config?.url : undefined,
        });

        return Promise.reject(normalised);
    },
);

// ─── Convenience wrappers ─────────────────────────────────────────────────────
// Thin wrappers that return T directly (not AxiosResponse<T>), so call-sites
// only deal with the data they care about.

export async function apiGet<T>(
    url: string,
    config?: AxiosRequestConfig,
): Promise<T> {
    const res = await apiClient.get<T>(url, config);
    return res.data;
}

export async function apiPost<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
): Promise<T> {
    const res = await apiClient.post<T>(url, data, config);
    return res.data;
}

export async function apiPatch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
): Promise<T> {
    const res = await apiClient.patch<T>(url, data, config);
    return res.data;
}

export async function apiPut<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
): Promise<T> {
    const res = await apiClient.put<T>(url, data, config);
    return res.data;
}

export async function apiDelete(
    url: string,
    config?: AxiosRequestConfig,
): Promise<void> {
    await apiClient.delete(url, config);
}