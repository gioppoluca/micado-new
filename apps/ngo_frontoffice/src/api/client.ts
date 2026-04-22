/**
 * src/api/client.ts
 *
 * Central axios instance for the micado_pa application.
 *
 * ── Fix: [object Object] in error banner ────────────────────────────────────
 *
 * LoopBack 4 wraps HTTP errors in a nested shape:
 *
 *   { "error": { "statusCode": 413, "name": "PayloadTooLargeError", "message": "..." } }
 *
 * The previous normaliseError() only looked one level deep:
 *   data?.error   →  evaluates to the inner *object*, not a string
 *   data?.message →  undefined (the message is nested inside data.error)
 *
 * When `serverMsg` ended up being an object, `error.value = serverMsg` caused
 * the banner template to render "[object Object]".
 *
 * Fix: drill into `data.error.message` first, then fall back to the flat
 * shapes used by other services, then to the Axios message.
 *
 * ── Body size ────────────────────────────────────────────────────────────────
 * The axios instance timeout is raised to 30 s to tolerate large icon uploads.
 * The real guard against oversized payloads is the frontend's file-size check
 * in onIconSelected (UserTypesPage.vue) + the backend's requestBodyParser limit.
 */

import axios, {
    type AxiosInstance,
    type AxiosRequestConfig,
    type InternalAxiosRequestConfig,
    AxiosError,
} from 'axios';
import { keycloak } from 'src/auth/keycloak';
import { logger } from 'src/services/Logger';
import { getRuntimeConfigOrDefaults } from 'src/config/env';

// ─── Typed error ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
    /** HTTP status code, or 0 for network / setup errors */
    readonly status: number;

    constructor(message: string, status: number, cause?: unknown) {
        super(message, { cause });
        this.name   = 'ApiError';
        this.status = status;
    }
}

export function isApiError(e: unknown): e is ApiError {
    return e instanceof ApiError;
}

// ─── LB4 error response shape ─────────────────────────────────────────────────

/**
 * LoopBack 4 serialises HttpErrors as:
 *   { error: { statusCode: number; name: string; message: string; details?: unknown[] } }
 *
 * Some 3rd-party middleware (e.g. body-parser before LB4 catches it) produces a
 * flat shape instead:
 *   { message: string }
 *
 * We handle both.
 */
/**
 * One entry in the LoopBack 4 `details` array emitted for 422 validation errors.
 *
 * Shape (from @loopback/rest AjvError):
 *   { path: '/fieldName', code: 'minLength', message: '...', info: { limit: 8 } }
 */
export interface Lb4ValidationDetail {
    path: string;
    code: string;
    message: string;
    info?: Record<string, unknown>;
}

interface Lb4ErrorBody {
    /** Nested LB4 error object */
    error?: {
        statusCode?: number;
        name?: string;
        message?: string;
        /** Field-level validation details — present on 422 UnprocessableEntity */
        details?: Lb4ValidationDetail[];
    } | string;
    /** Flat message from non-LB4 middleware */
    message?: string;
}

/**
 * Extract a human-readable message from an HTTP error response body.
 *
 * Priority:
 *  1. data.error.details[]  — 422 validation errors: join all field messages
 *  2. data.error.message    — standard LB4 HttpError (nested object)
 *  3. data.error            — if error is already a plain string
 *  4. data.message          — flat shape from body-parser / other middleware
 *  5. undefined             — caller falls back to AxiosError.message
 *
 * For validation errors (422), the generic `message` says "The request body is
 * invalid" — not actionable. The real cause is in `details[].message` which
 * names the failing field and constraint (e.g. "must NOT have fewer than 8
 * characters"). We join all detail messages so the UI can surface them all.
 */
function extractServerMessage(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;

    const body = data as Lb4ErrorBody;

    if (body.error !== undefined) {
        if (typeof body.error === 'string') {
            return body.error;
        }

        if (typeof body.error === 'object') {
            // Case 1: 422 with details[] — build a joined message from all entries
            const details = body.error.details;
            if (Array.isArray(details) && details.length > 0) {
                return details
                    .map(d => {
                        // Strip leading slash from path for readability:
                        //   "/temporaryPassword" -> "temporaryPassword"
                        const field = (d.path ?? '').replace(/^\//, '');
                        return field ? `${field}: ${d.message}` : d.message;
                    })
                    .join(' | ');
            }

            // Case 2: plain LB4 message
            if (typeof body.error.message === 'string') {
                return body.error.message;
            }
        }
    }

    // Case 4: flat { message }
    if (typeof body.message === 'string') {
        return body.message;
    }

    return undefined;
}

function normaliseError(error: unknown): ApiError {
    if (error instanceof AxiosError) {
        const status    = error.response?.status ?? 0;
        const serverMsg = extractServerMessage(error.response?.data);
        const message   = serverMsg ?? error.message ?? 'Unknown network error';

        logger.debug('[api] normaliseError', {
            status,
            serverMsg,
            rawData: error.response?.data,
        });

        return new ApiError(message, status, error);
    }

    if (error instanceof Error) {
        return new ApiError(error.message, 0, error);
    }

    return new ApiError(String(error), 0, error);
}

// ─── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
    baseURL: getRuntimeConfigOrDefaults().apiUrl,
    // Raised to 30 s to accommodate large base64 icon uploads over slow links.
    // The actual hard cap is enforced by the backend's requestBodyParser limit.
    timeout: 30_000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// ─── Request interceptor: token refresh + Bearer attachment ──────────────────

apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
        if (keycloak.authenticated) {
            try {
                await keycloak.updateToken(30);
            } catch (e) {
                logger.warn('[api] token refresh failed before request', {
                    url: config.url,
                    error: e,
                });
            }

            const token = keycloak.token;
            if (token) {
                config.headers                  = config.headers ?? {};
                config.headers.Authorization    = `Bearer ${token}`;
                logger.debug('[api] →', {
                    method:       config.method?.toUpperCase(),
                    url:          config.url,
                    tokenAttached: true,
                });
            }
        } else {
            logger.debug('[api] → (unauthenticated)', {
                method: config.method?.toUpperCase(),
                url:    config.url,
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
            url:    response.config.url,
        });
        return response;
    },
    (error: unknown) => {
        const normalised = normaliseError(error);

        logger.error('[api] ← error', {
            status:  normalised.status,
            message: normalised.message,
            url:     error instanceof AxiosError ? error.config?.url : undefined,
        });

        return Promise.reject(normalised);
    },
);

// ─── Convenience wrappers ─────────────────────────────────────────────────────

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