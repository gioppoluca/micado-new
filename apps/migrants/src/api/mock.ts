/**
 * src/api/mock.ts
 *
 * Self-contained mock adapter — no external package required.
 *
 * Works by installing an axios request interceptor that matches registered
 * routes before the request goes over the network, and resolves with a
 * synthetic AxiosResponse instead.
 *
 * Usage:
 *   1. Set VITE_API_MOCK=true in .env.development.local
 *   2. 'mock' must be the first entry in quasar.config.ts → boot[]
 *
 * Each API module registers its own handlers via registerXxxMocks(adapter).
 * The handlers live next to the real calls so they stay in sync.
 */

import { logger } from 'src/services/Logger';

// ─── Public types (used by API module handler functions) ─────────────────────

/** Fields from the axios config that handler callbacks may inspect. */
export interface MockRequestConfig {
    url?: string | undefined;
    params?: Record<string, string | boolean | number | undefined> | undefined;
}

/** What a handler callback must return: [httpStatus, responseData?] */
export type MockReplyTuple = [number, unknown?];

/** Fluent builder returned by registry.onGet() / .onPost() etc. */
export interface MockReplyBuilder {
    /** Static reply — same data every time: .reply(200, payload) */
    reply(status: number, data?: unknown): void;
    /** Dynamic reply — callback inspects the request: .reply(cfg => [200, payload]) */
    reply(fn: (config: MockRequestConfig) => MockReplyTuple): void;
}

/** The registry passed to each API module's registerXxxMocks() function. */
export interface MockRegistry {
    onGet(url: string | RegExp): MockReplyBuilder;
    onPost(url: string | RegExp): MockReplyBuilder;
    onPatch(url: string | RegExp): MockReplyBuilder;
    onPut(url: string | RegExp): MockReplyBuilder;
    onDelete(url: string | RegExp): MockReplyBuilder;
}

// ─── Internal implementation ─────────────────────────────────────────────────

type HandlerFn = (config: MockRequestConfig) => MockReplyTuple;

interface RouteEntry {
    method: string;
    matcher: string | RegExp;
    handler: HandlerFn;
}

function matches(entry: RouteEntry, method: string, url: string): boolean {
    if (entry.method !== method.toLowerCase()) return false;
    if (entry.matcher instanceof RegExp) return entry.matcher.test(url);
    return entry.matcher === url;
}

function makeBuilder(
    routes: RouteEntry[],
    method: string,
    matcher: string | RegExp,
): MockReplyBuilder {
    return {
        reply(
            statusOrFn: number | ((config: MockRequestConfig) => MockReplyTuple),
            data?: unknown,
        ): void {
            const handler: HandlerFn =
                typeof statusOrFn === 'function'
                    ? statusOrFn
                    : () => [statusOrFn, data];
            routes.push({ method, matcher, handler });
        },
    };
}

function createMockRegistry(): MockRegistry {
    const routes: RouteEntry[] = [];

    // Deferred import avoids circular-dependency at module evaluation time.
    // This executes synchronously from the boot file before any page renders.
    void import('src/api/client').then(({ apiClient }) => {
        apiClient.interceptors.request.use(async (config) => {
            const url = config.url ?? '';
            const method = config.method ?? 'get';
            const entry = routes.find(r => matches(r, method, url));

            if (!entry) {
                logger.warn('[mock] no handler registered for', {
                    method: method.toUpperCase(),
                    url,
                });
                return config;
            }

            const mockConfig: MockRequestConfig = {
                url: config.url,
                params: config.params as MockRequestConfig['params'],
            };

            // Simulate realistic network latency
            await new Promise<void>(resolve => setTimeout(resolve, 300));

            const [status, responseData] = entry.handler(mockConfig);

            logger.debug('[mock] ←', { method: method.toUpperCase(), url, status });

            if (status >= 400) {
                // Reject so axios error interceptors fire exactly as they would for
                // a real network error.
                return Promise.reject(
                    Object.assign(new Error(`Request failed with status code ${status}`), {
                        response: { status, data: responseData, headers: {}, config },
                        isAxiosError: true,
                        config,
                    }),
                );
            }

            // Override the adapter for this specific request so axios resolves
            // immediately with our synthetic response without hitting the network.
            config.adapter = () =>
                Promise.resolve({
                    data: responseData,
                    status,
                    statusText: String(status),
                    headers: {},
                    config,
                });

            return config;
        });

        logger.debug('[mock] request interceptor installed');
    });

    return {
        onGet: (url) => makeBuilder(routes, 'get', url),
        onPost: (url) => makeBuilder(routes, 'post', url),
        onPatch: (url) => makeBuilder(routes, 'patch', url),
        onPut: (url) => makeBuilder(routes, 'put', url),
        onDelete: (url) => makeBuilder(routes, 'delete', url),
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const isMockEnabled =
    (import.meta.env.VITE_API_MOCK as string | undefined) === 'true';

let mockRegistry: MockRegistry | null = null;

export function getMockAdapter(): MockRegistry | null {
    return mockRegistry;
}

/**
 * Called once from src/boot/mock.ts.
 * Returns the registry so API modules can register their handlers.
 * Now synchronous — no dynamic import of an external package needed.
 */
export function installMockAdapter(): MockRegistry | null {
    if (!isMockEnabled) return null;

    logger.warn(
        '[api:mock] ⚠️  Mock adapter ENABLED — all API calls are intercepted. ' +
        'Set VITE_API_MOCK=false to use the real backend.',
    );

    mockRegistry = createMockRegistry();
    return mockRegistry;
}