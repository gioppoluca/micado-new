/**
 * src/stores/micado-entities-store.ts
 *
 * Store Pinia per le entità MICADO linkabili nel rich-text editor.
 * Rimpiazza i quattro moduli Vuex separati del legacy (glossary, information,
 * flows, event) con un unico store setup-style, coerente con language-store.ts.
 *
 * Segue le convenzioni del progetto:
 *  - Setup store (non options store)
 *  - Typed return interface esplicita (evita falsi errori vue-tsc strict)
 *  - logger da src/services/Logger.ts
 *  - isApiError da src/api/client.ts
 *  - Accesso a defaultLang/userLang tramite useAppStore()
 *
 * Tipi di entità supportati (codice a singola lettera = sintassi mention):
 *   g → Glossary
 *   i → Information Centre
 *   p → Guided Process (il titolo è nel campo `process`, non `title`)
 *   e → Event
 */

import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { micadoEntitiesApi, type MicadoEntity, type EntityListParams } from 'src/api/micado-entities.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

// ─── Costanti ─────────────────────────────────────────────────────────────────

/**
 * Tipi di entità MICADO. Il codice a singola lettera è usato nella sintassi
 * @[type,id](title) memorizzata nel Markdown.
 */
export const ENTITY_TYPE = {
    GLOSSARY: 'g',
    INFORMATION: 'i',
    PROCESS: 'p',
    EVENT: 'e',
} as const;

export type EntityTypeCode = typeof ENTITY_TYPE[keyof typeof ENTITY_TYPE];

/**
 * Priorità per la deduplicazione nell'auto-linking.
 * Se più entità hanno lo stesso titolo, vince quella con priorità più alta (primo elemento).
 */
export const ENTITY_LINK_PRIORITY: EntityTypeCode[] = ['g', 'p', 'i', 'e'];

/**
 * Route di navigazione per tipo entità nel back-office PA.
 * TODO: verificare i percorsi con il router Vue 3 di PA_frontoffice.
 */
export const ENTITY_ROUTES: Record<EntityTypeCode, (id: number) => string> = {
    g: (id) => `/glossary/${id}/edit`,
    i: (id) => `/information/${id}/edit`,
    p: (id) => `/guided_process_editor/edit/${id}`,
    e: (id) => `/events/${id}/edit`,
};

// ─── Setup return type ────────────────────────────────────────────────────────

interface MicadoEntitiesStoreSetup {
    glossaryEntities: Ref<MicadoEntity[]>;
    informationEntities: Ref<MicadoEntity[]>;
    processEntities: Ref<MicadoEntity[]>;
    eventEntities: Ref<MicadoEntity[]>;
    allEntitiesFetched: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    allEntitiesByType: ComputedRef<Record<EntityTypeCode, MicadoEntity[]>>;
    fetchAllEntities(params?: { defaultLang?: string; userLang?: string; force?: boolean }): Promise<void>;
    invalidateCache(): void;
    getEntityTitle(entity: MicadoEntity): string;
    findEntityById(type: EntityTypeCode, id: number): ReturnType<MicadoEntity[]['find']>;
    getEntityRoute(type: EntityTypeCode, id: number): string;
    clearError(): void;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useMicadoEntitiesStore = defineStore('micadoEntities', (): MicadoEntitiesStoreSetup => {

    // ── State ──────────────────────────────────────────────────────────────────

    /**
     * Entità "temp" (bozze + pubblicate) usate dall'editor per l'auto-linking.
     * Include le bozze perché gli autori devono poter linkare contenuti
     * non ancora pubblici (stesso comportamento del legacy `glossaryTemp`).
     */
    const glossaryEntities = ref<MicadoEntity[]>([]);
    const informationEntities = ref<MicadoEntity[]>([]);
    const processEntities = ref<MicadoEntity[]>([]);
    const eventEntities = ref<MicadoEntity[]>([]);

    /**
     * Flag per evitare fetch ridondanti nella stessa sessione di editing.
     * Corrisponde all'`isAllFetched` del legacy markdownConverterMixin.
     */
    const allEntitiesFetched = ref(false);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // ── Getters ────────────────────────────────────────────────────────────────

    /** Tutte le entità indicizzate per tipo — usato da autoLinkEntities.ts */
    const allEntitiesByType = computed<Record<EntityTypeCode, MicadoEntity[]>>(() => ({
        g: glossaryEntities.value,
        i: informationEntities.value,
        p: processEntities.value,
        e: eventEntities.value,
    }));

    // ── Helpers ────────────────────────────────────────────────────────────────

    function setError(e: unknown): void {
        if (isApiError(e)) {
            error.value = e.message;
            logger.error('[micado-entities-store] API error', { status: e.status, message: e.message });
        } else {
            error.value = 'Unexpected error';
            logger.error('[micado-entities-store] unexpected error', e);
        }
    }

    function clearError(): void {
        error.value = null;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    /**
     * Carica tutte le entità linkabili in parallelo.
     * Skip se allEntitiesFetched è già true (a meno che force=true).
     *
     * @param params.defaultLang - Lingua default del sistema (da useAppStore)
     * @param params.userLang    - Lingua corrente dell'utente (da useAppStore)
     * @param params.force       - Forza il ricaricamento anche se già in cache
     */
    async function fetchAllEntities(params: {
        defaultLang?: string;
        userLang?: string;
        force?: boolean;
    } = {}): Promise<void> {
        if (allEntitiesFetched.value && !params.force) {
            logger.debug('[micado-entities-store] fetchAllEntities: skip (già in cache)');
            return;
        }

        logger.info('[micado-entities-store] fetchAllEntities: avvio', {
            defaultLang: params.defaultLang,
            userLang: params.userLang,
        });

        loading.value = true;
        clearError();

        try {
            const apiParams: EntityListParams = {
                ...(params.defaultLang !== undefined && { defaultLang: params.defaultLang }),
                ...(params.userLang !== undefined && { userLang: params.userLang }),
                includeDraft: true,
            };

            /**
             * Fetch indipendenti — ogni endpoint può fallire senza bloccare gli altri.
             * Questo è necessario durante la migrazione progressiva: gli endpoint
             * information/processes/events non esistono ancora nel backend LB4
             * e restituiscono 404. Con Promise.allSettled + fallback a [] ogni
             * endpoint migrato contribuisce comunque al mention picker.
             *
             * Quando tutti gli endpoint saranno implementati il comportamento
             * è identico al Promise.all originale.
             */
            const settle = async (p: Promise<MicadoEntity[]>, name: string): Promise<MicadoEntity[]> => {
                try {
                    return await p;
                } catch (e) {
                    // 404 = endpoint non ancora migrato — atteso durante la migrazione progressiva
                    const status = (e as { status?: number }).status;
                    if (status === 404) {
                        logger.debug(`[micado-entities-store] ${name}: endpoint non ancora implementato (404) — skip`);
                    } else {
                        logger.warn(`[micado-entities-store] ${name}: errore inatteso`, e);
                    }
                    return [];
                }
            };

            const [glossary, information, processes, events] = await Promise.all([
                settle(micadoEntitiesApi.listGlossary(apiParams), 'listGlossary'),
                settle(micadoEntitiesApi.listInformation(apiParams), 'listInformation'),
                settle(micadoEntitiesApi.listProcesses(apiParams), 'listProcesses'),
                settle(micadoEntitiesApi.listEvents(apiParams), 'listEvents'),
            ]);

            glossaryEntities.value = glossary;
            informationEntities.value = information;
            processEntities.value = processes;
            eventEntities.value = events;
            allEntitiesFetched.value = true;

            logger.info('[micado-entities-store] fetchAllEntities: completato', {
                glossary: glossary.length,
                information: information.length,
                processes: processes.length,
                events: events.length,
            });

        } catch (e) {
            setError(e);
        } finally {
            loading.value = false;
        }
    }

    /**
     * Invalida la cache, forza il prossimo fetchAllEntities a ricaricare.
     * Da chiamare dopo che l'utente salva una nuova entità.
     */
    function invalidateCache(): void {
        allEntitiesFetched.value = false;
        logger.debug('[micado-entities-store] cache invalidata');
    }

    /**
     * Restituisce il titolo normalizzato di un'entità, indipendentemente dal tipo.
     * Il Guided Process usa `process` invece di `title`.
     */
    function getEntityTitle(entity: MicadoEntity): string {
        return entity.process ?? entity.title ?? '';
    }

    /**
     * Cerca un'entità per tipo e ID. Usato dal viewer per il dialog di preview.
     */
    function findEntityById(type: EntityTypeCode, id: number) {
        const map: Record<EntityTypeCode, MicadoEntity[]> = {
            g: glossaryEntities.value,
            i: informationEntities.value,
            p: processEntities.value,
            e: eventEntities.value,
        };
        const collection = map[type];
        if (!collection) {
            logger.warn('[micado-entities-store] findEntityById: tipo sconosciuto', { type });
            return undefined;
        }
        return collection.find(entity => entity.id === id);
    }

    /**
     * Restituisce la route di navigazione per un'entità.
     */
    function getEntityRoute(type: EntityTypeCode, id: number): string {
        const routeFn = ENTITY_ROUTES[type];
        if (!routeFn) {
            logger.warn('[micado-entities-store] getEntityRoute: tipo sconosciuto', { type });
            return '/';
        }
        return routeFn(id);
    }

    return {
        // state
        glossaryEntities,
        informationEntities,
        processEntities,
        eventEntities,
        allEntitiesFetched,
        loading,
        error,
        // getters
        allEntitiesByType,
        // actions
        fetchAllEntities,
        invalidateCache,
        getEntityTitle,
        findEntityById,
        getEntityRoute,
        clearError,
    };
});