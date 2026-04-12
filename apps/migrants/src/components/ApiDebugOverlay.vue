<template>
    <!--
    ApiDebugOverlay.vue
    ────────────────────────────────────────────────────────────────────────────
    Development-only floating panel that intercepts every axios request/response
    and displays them as a live log.

    ACTIVATION:  append  ?debug=1  to any URL  (or click the bug FAB).
    The panel persists the preference in sessionStorage so it survives
    navigation within the same tab, but resets on new sessions.

    HOW TO USE FOR BACKEND DEBUGGING
    ─────────────────────────────────
    1. Open the app with ?debug=1
    2. Navigate to the page with empty content
    3. Read the REQUEST rows — they show the exact URL + query params
    4. Copy the cURL snippet and run it against the backend directly

    Disabled automatically in production builds (VITE_API_MOCK=false AND
    import.meta.env.PROD).  You can force-enable with VITE_DEBUG_OVERLAY=true.
  -->
    <template v-if="enabled">
        <!-- Floating toggle FAB -->
        <q-btn fab-mini :icon="open ? 'bug_report' : 'bug_report'" :color="open ? 'negative' : 'grey-7'"
            class="debug-fab" @click="open = !open" aria-label="Toggle API debug panel" />

        <!-- Sliding panel -->
        <transition name="debug-slide">
            <div v-if="open" class="debug-panel">
                <!-- Header -->
                <div class="debug-header row items-center q-px-sm q-py-xs">
                    <span class="text-caption text-weight-bold q-mr-auto">
                        🐛 API Debug — {{ baseUrl }}
                    </span>
                    <q-btn flat dense round icon="delete_sweep" size="xs" color="white" title="Clear log"
                        @click="entries = []" />
                    <q-btn flat dense round icon="close" size="xs" color="white" @click="open = false" />
                </div>

                <!-- Log entries -->
                <div class="debug-body" ref="bodyEl">
                    <div v-if="entries.length === 0" class="text-caption text-grey-5 q-pa-sm">
                        No requests yet — navigate to trigger API calls.
                    </div>
                    <div v-for="(e, i) in entries" :key="i" class="debug-entry q-px-sm q-py-xs" :class="entryClass(e)">
                        <!-- Method + status + URL -->
                        <div class="row items-center no-wrap debug-entry-header">
                            <span class="debug-badge" :class="e.method">{{ e.method }}</span>
                            <span v-if="e.status" class="debug-status q-ml-xs"
                                :class="e.status >= 400 ? 'text-negative' : 'text-positive'">
                                {{ e.status }}
                            </span>
                            <span v-else class="debug-status q-ml-xs text-grey-5">…</span>
                            <span class="debug-url q-ml-xs ellipsis">{{ e.url }}</span>
                            <q-btn flat dense round icon="content_copy" size="xs" color="grey-5" class="q-ml-auto"
                                title="Copy cURL" @click="copyCurl(e)" />
                        </div>

                        <!-- Query params (collapsible) -->
                        <div v-if="e.params && Object.keys(e.params).length" class="debug-params">
                            <span v-for="(v, k) in e.params" :key="k" class="debug-param-chip">{{ k }}={{ v }}</span>
                        </div>

                        <!-- Error message -->
                        <div v-if="e.error" class="debug-error text-negative text-caption q-mt-xs">
                            {{ e.error }}
                        </div>

                        <!-- Timing -->
                        <div class="debug-timing text-grey-5">
                            {{ e.ts }} {{ e.duration != null ? `· ${e.duration}ms` : '' }}
                        </div>
                    </div>
                </div>
            </div>
        </transition>
    </template>
</template>

<script setup lang="ts">
/**
 * Intercepts axios via the global apiClient interceptors and mirrors every
 * request/response into a reactive log displayed by this overlay.
 *
 * The interceptors are installed once on mount and ejected on unmount so they
 * don't accumulate across hot-reloads.
 */
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { apiClient } from 'src/api/client';
import type { InternalAxiosRequestConfig } from 'axios';
import { getRuntimeConfigOrDefaults } from 'src/config/env';

// ─── Axios config augmentation ───────────────────────────────────────────────
// Extend InternalAxiosRequestConfig to carry our debug correlation id.
// Using module augmentation avoids unsafe casts to Record<string, unknown>.

declare module 'axios' {
    interface InternalAxiosRequestConfig {
        _debugId?: number;
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
    id: number;
    method: string;
    url: string;
    params: Record<string, unknown> | null;
    status: number | null;
    error: string | null;
    duration: number | null;
    ts: string;
    startedAt: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'micado:debug-overlay';

const open = ref(false);
const entries = ref<LogEntry[]>([]);
const bodyEl = ref<HTMLElement | null>(null);
let counter = 0;

const pendingMap = new Map<number, LogEntry>();
let reqInterceptorId: number | null = null;
let resInterceptorId: number | null = null;

// ─── Enabled flag ─────────────────────────────────────────────────────────────

/**
 * Overlay is enabled when:
 *   • URL has ?debug=1  (sets sessionStorage)
 *   • sessionStorage already has the flag
 *   • VITE_DEBUG_OVERLAY=true build-time var
 *   • Not a production build (safety net)
 */
const enabled = computed<boolean>(() => {
    if (import.meta.env.PROD && import.meta.env.VITE_DEBUG_OVERLAY !== 'true') return false;
    const urlFlag = new URLSearchParams(window.location.search).get('debug') === '1';
    if (urlFlag) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        return true;
    }
    try {
        return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
        return false;
    }
});

const baseUrl = computed(() => getRuntimeConfigOrDefaults().apiUrl ?? '(no baseURL)');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
    return new Date().toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function entryClass(e: LogEntry): string {
    if (e.error) return 'entry-error';
    if (e.status && e.status >= 400) return 'entry-error';
    if (e.status) return 'entry-ok';
    return 'entry-pending';
}

function extractParams(config: InternalAxiosRequestConfig): Record<string, unknown> | null {
    const p = config.params as unknown;
    if (!p || typeof p !== 'object') return null;
    return p as Record<string, unknown>;
}

async function scrollToBottom() {
    await nextTick();
    if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
}

function buildCurl(e: LogEntry): string {
    const base = baseUrl.value.replace(/\/$/, '');
    const qs = e.params
        ? '?' + Object.entries(e.params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
        : '';
    return `curl -X ${e.method} "${base}${e.url}${qs}"`;
}

async function copyCurl(e: LogEntry) {
    try {
        await navigator.clipboard.writeText(buildCurl(e));
    } catch {
        prompt('Copy this cURL:', buildCurl(e));
    }
}

// ─── Interceptors ─────────────────────────────────────────────────────────────

function installInterceptors() {
    reqInterceptorId = apiClient.interceptors.request.use((config) => {
        if (!enabled.value) return config;
        const id = ++counter;
        const entry: LogEntry = {
            id,
            method: (config.method ?? 'GET').toUpperCase(),
            url: config.url ?? '?',
            params: extractParams(config),
            status: null,
            error: null,
            duration: null,
            ts: now(),
            startedAt: performance.now(),
        };
        pendingMap.set(id, entry);
        // Store the id on the config so the response interceptor can correlate.
        config._debugId = id;
        entries.value.push(entry);
        void scrollToBottom();
        return config;
    });

    resInterceptorId = apiClient.interceptors.response.use(
        (response) => {
            if (!enabled.value) return response;
            const id = response.config._debugId;
            if (id !== undefined) {
                const entry = pendingMap.get(id);
                if (entry) {
                    entry.status = response.status;
                    entry.duration = Math.round(performance.now() - entry.startedAt);
                    pendingMap.delete(id);
                }
            }
            return response;
        },
        (error: unknown) => {
            if (enabled.value) {
                const axiosError = error as { config?: InternalAxiosRequestConfig; response?: { status: number }; message?: string };
                const id = axiosError.config?._debugId;
                if (id !== undefined) {
                    const entry = pendingMap.get(id);
                    if (entry) {
                        entry.status = axiosError.response?.status ?? 0;
                        entry.error = axiosError.message ?? 'Unknown error';
                        entry.duration = Math.round(performance.now() - entry.startedAt);
                        pendingMap.delete(id);
                    }
                }
            }
            // ESLint @typescript-eslint/prefer-promise-reject-errors: rejection reason must be an Error.
            // The interceptor receives `unknown`; we pass it through as-is if it already
            // is an Error (the common case — axios always rejects with AxiosError), otherwise
            // wrap it so downstream catch blocks always receive an Error instance.
            const rejection = error instanceof Error ? error : new Error(String(error));
            return Promise.reject(rejection);
        },
    );
}

function ejectInterceptors() {
    if (reqInterceptorId !== null) apiClient.interceptors.request.eject(reqInterceptorId);
    if (resInterceptorId !== null) apiClient.interceptors.response.eject(resInterceptorId);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
    if (enabled.value) {
        open.value = true; // auto-open when activated via URL flag
        installInterceptors();
    }
});

onUnmounted(ejectInterceptors);
</script>

<style scoped lang="scss">
.debug-fab {
    position: fixed;
    bottom: 72px;
    right: 12px;
    z-index: 9000;
    opacity: 0.7;

    &:hover {
        opacity: 1;
    }
}

.debug-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 42vh;
    z-index: 8999;
    display: flex;
    flex-direction: column;
    background: #1e1e2e;
    border-top: 2px solid #f38ba8;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
}

.debug-header {
    background: #181825;
    color: #cdd6f4;
    flex-shrink: 0;
}

.debug-body {
    overflow-y: auto;
    flex: 1;
    color: #cdd6f4;
}

.debug-entry {
    border-bottom: 1px solid #313244;

    &.entry-ok {
        border-left: 3px solid #a6e3a1;
    }

    &.entry-error {
        border-left: 3px solid #f38ba8;
    }

    &.entry-pending {
        border-left: 3px solid #fab387;
    }
}

.debug-entry-header {
    gap: 0;
}

.debug-badge {
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 700;
    font-size: 10px;
    flex-shrink: 0;

    &.GET {
        background: #89dceb;
        color: #1e1e2e;
    }

    &.POST {
        background: #a6e3a1;
        color: #1e1e2e;
    }

    &.PUT,
    &.PATCH {
        background: #fab387;
        color: #1e1e2e;
    }

    &.DELETE {
        background: #f38ba8;
        color: #1e1e2e;
    }
}

.debug-status {
    font-weight: 600;
    flex-shrink: 0;
}

.debug-url {
    color: #89b4fa;
    flex: 1;
    min-width: 0;
}

.debug-params {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
}

.debug-param-chip {
    background: #313244;
    color: #cba6f7;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
}

.debug-error {
    font-size: 10px;
}

.debug-timing {
    font-size: 9px;
    color: #585b70;
    margin-top: 1px;
}

.debug-slide-enter-active,
.debug-slide-leave-active {
    transition: transform 0.2s ease, opacity 0.2s ease;
}

.debug-slide-enter-from,
.debug-slide-leave-to {
    transform: translateY(100%);
    opacity: 0;
}
</style>