<script setup lang="ts">
/**
 * src/pages/GlossaryPage.vue
 *
 * Public glossary — alphabetic list of terms with fuzzy search.
 *
 * ── Features ──────────────────────────────────────────────────────────────────
 *
 *   • Fuzzy search via Fuse.js (same library used in the legacy app).
 *   • Alphabetic sidebar: tap a letter to jump to the first term starting with it.
 *   • Expansion items: each term title collapses/expands its Markdown description.
 *   • Deep-link: ?id=<termId> in the URL opens that term automatically on mount.
 *   • Fully public — no Keycloak token required.
 *   • Reacts to language change via the glossary store's language watcher.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/Glossary.vue (Vue 2 / Vuex / Options API)
 *   New:    src/pages/GlossaryPage.vue (Vue 3 / Pinia / Composition API)
 */

import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import Fuse from 'fuse.js';
import { useGlossaryStore } from 'src/stores/glossary-store';
import { logger } from 'src/services/Logger';
import type { MigrantGlossaryTerm } from 'src/api/glossary.api';

// ─── Stores & router ─────────────────────────────────────────────────────────

const { t } = useI18n();
const glossaryStore = useGlossaryStore();
const route = useRoute();
const router = useRouter();

// ─── Local state ──────────────────────────────────────────────────────────────

/** Current search string (bound to the q-input via a computed setter). */
const searchText = ref('');

/** Filtered subset — overwritten by the Fuse search; starts as full list. */
const filteredTerms = ref<MigrantGlossaryTerm[]>([]);

/**
 * Refs to the q-expansion-item components keyed by term id.
 * Used to programmatically open a term when deep-linking.
 */
/** Structural type covering the one QExpansionItem method we call. */
interface ExpansionItemRef { show?: () => void }
const expansionRefs = ref<Record<number, ExpansionItemRef>>({});

/** Whether auto-scroll on first open is still pending. */
const autoScroll = ref(true);

// ─── Computed ─────────────────────────────────────────────────────────────────

/**
 * Build alphabet index: { letter → first term id starting with that letter }.
 * Only computed over the full sorted list (not the filtered one) so the
 * sidebar letters always reflect the full glossary.
 */
const alphabetIndex = computed<{ letter: string; termId: number }[]>(() => {
    const seen = new Set<string>();
    const result: { letter: string; termId: number }[] = [];
    for (const term of glossaryStore.sortedTerms) {
        const letter = (term.title.charAt(0) ?? '?').toUpperCase();
        if (!seen.has(letter)) {
            seen.add(letter);
            result.push({ letter, termId: term.id });
        }
    }
    return result;
});

/** Letters where the current *filtered* list contains at least one term. */
const activeLetters = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const term of filteredTerms.value) {
        set.add((term.title.charAt(0) ?? '').toUpperCase());
    }
    return set;
});

// ─── Search ───────────────────────────────────────────────────────────────────

const search = computed({
    get: () => searchText.value,
    set: (query: string) => {
        searchText.value = query;
        if (!query.trim()) {
            filteredTerms.value = glossaryStore.sortedTerms;
        } else {
            const fuse = new Fuse(glossaryStore.sortedTerms, {
                keys: ['title', 'description'],
                threshold: 0.4,
            });
            filteredTerms.value = fuse.search(query).map((r: { item: MigrantGlossaryTerm }) => r.item);
        }
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when this term is the first one starting with its letter
 * in the filtered list — used to show the alphabet section header.
 */
function isFirstOfLetter(term: MigrantGlossaryTerm, index: number): boolean {
    const letter = (term.title.charAt(0) ?? '').toUpperCase();
    if (index === 0) return true;
    const prev = filteredTerms.value[index - 1];
    return prev
        ? (prev.title.charAt(0) ?? '').toUpperCase() !== letter
        : true;
}

function getFirstLetter(term: MigrantGlossaryTerm): string {
    return (term.title.charAt(0) ?? '?').toUpperCase();
}

/** Programmatically open a term's expansion item (e.g. from deep-link). */
function openTerm(termId: number | string): void {
    const id = Number(termId);
    const item = expansionRefs.value[id];
    item?.show?.();
}

/** Called when an expansion item is shown — updates URL and scrolls. */
function onTermShown(termId: number): void {
    if (route.query['id'] !== String(termId)) {
        void router.replace({ query: { ...route.query, id: String(termId) } });
    }
    if (autoScroll.value) {
        const el = document.getElementById(`gTitle-${termId}`);
        if (el) {
            window.scrollTo({ top: el.offsetTop - 64, behavior: 'smooth' });
        }
        autoScroll.value = false;
    }
}

/** Jump to the first visible term that starts with `letter`. */
function scrollToLetter(letter: string): void {
    const entry = alphabetIndex.value.find(e => e.letter === letter);
    if (!entry) return;
    const el = document.getElementById(`gTitle-${entry.termId}`);
    if (el) {
        window.scrollTo({ top: el.offsetTop - 64, behavior: 'smooth' });
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// Sync filteredTerms whenever the store sorts differently (language change).
watch(
    () => glossaryStore.sortedTerms,
    (terms) => {
        filteredTerms.value = searchText.value
            ? filteredTerms.value   // keep current search results
            : terms;
    },
    { immediate: true },
);

// React to URL ?id= changes (e.g. browser back/forward).
watch(
    () => route.query['id'],
    async (id) => {
        if (id !== undefined) {
            await nextTick();
            void openTerm(id as string);
        }
    },
);

onMounted(async () => {
    logger.info('[GlossaryPage] mounted');
    if (glossaryStore.terms.length === 0) {
        await glossaryStore.fetchAll();
    }
    filteredTerms.value = glossaryStore.sortedTerms;

    // If the URL has ?id=xxx, open that term after data is ready.
    const queryId = route.query['id'];
    if (queryId) {
        autoScroll.value = true;
        await nextTick();
        void openTerm(queryId as string);
    }
});
</script>

<template>
    <q-page class="glossary-page">

        <!-- ── Loading state ──────────────────────────────────────────────────── -->
        <div v-if="glossaryStore.loading" class="row justify-center q-pa-xl">
            <q-spinner-dots color="primary" size="48px" />
        </div>

        <!-- ── Error banner ───────────────────────────────────────────────────── -->
        <q-banner v-else-if="glossaryStore.error" class="bg-negative text-white q-ma-md" rounded>
            <template #avatar><q-icon name="error_outline" /></template>
            {{ glossaryStore.error }}
            <template #action>
                <q-btn flat label="Retry" @click="glossaryStore.fetchAll()" />
            </template>
        </q-banner>

        <!-- ── Main content ───────────────────────────────────────────────────── -->
        <template v-else>
            <!-- Header icon (legacy had glossary_header.svg; we use a material icon) -->
            <div class="row justify-center q-pt-md q-pb-sm">
                <q-icon name="menu_book" size="80px" color="primary" />
            </div>

            <!-- Search bar -->
            <div class="row items-center q-px-md q-pb-md q-gutter-sm">
                <q-input v-model="search" class="col" outlined dense debounce="300" :label="t('desc_labels.search')"
                    color="primary" clearable>
                    <template #append>
                        <q-icon name="search" />
                    </template>
                </q-input>
            </div>

            <!-- Orange separator (matches legacy .list-separator) -->
            <div class="glossary-separator q-mb-sm" />

            <!-- Empty search result -->
            <div v-if="filteredTerms.length === 0" class="q-pa-md text-grey-6 text-center">
                {{ t('glossary.missing_content') }}
            </div>

            <!-- Term list + alphabet sidebar -->
            <div v-else class="row no-wrap">

                <!-- Term list -->
                <q-list class="col">
                    <template v-for="(term, index) in filteredTerms" :key="term.id">

                        <!-- Alphabet section header -->
                        <div v-if="isFirstOfLetter(term, index)" class="glossary-alpha-header">
                            <span class="glossary-alpha-letter">{{ getFirstLetter(term) }}</span>
                        </div>

                        <!-- Expansion item -->
                        <q-expansion-item :id="`gTitle-${term.id}`"
                            :ref="(el) => { if (el) expansionRefs[term.id] = el as ExpansionItemRef; }" group="glossary"
                            expand-icon-class="text-orange" @after-show="onTermShown(term.id)">
                            <template #header>
                                <div class="row items-center full-width">
                                    <span class="glossary-term-title col">{{ term.title }}</span>
                                </div>
                            </template>

                            <q-card flat>
                                <q-card-section class="text-body2 glossary-description">
                                    <!-- Markdown output: rendered as plain text for now.
                                         Replace with <RichTextViewer> once that component
                                         is ported to the migrants frontend. -->
                                    <div style="white-space: pre-wrap;">{{ term.description ?? '' }}</div>
                                </q-card-section>
                            </q-card>
                        </q-expansion-item>

                        <q-separator class="q-mb-sm" />

                    </template>
                </q-list>

                <!-- Alphabet sidebar -->
                <div class="glossary-alpha-sidebar column items-center q-px-xs q-pt-sm">
                    <span v-for="entry in alphabetIndex" :key="entry.letter" class="glossary-alpha-btn"
                        :class="{ 'glossary-alpha-btn--inactive': !activeLetters.has(entry.letter) }"
                        @click="scrollToLetter(entry.letter)">
                        {{ entry.letter }}
                    </span>
                </div>

            </div>
        </template>

    </q-page>
</template>

<style scoped lang="scss">
.glossary-page {
    max-width: 520px;
    margin: 0 auto;
}

// Orange full-width separator (legacy: .list-separator)
.glossary-separator {
    width: 100vw;
    height: 3px;
    background-color: $accent;
    margin-left: -16px; // bleed out of q-page padding
    margin-right: -16px;
}

// ── Alphabet section header ──────────────────────────────────────────────────

.glossary-alpha-header {
    background-color: #ededed;
    margin-left: -16px;
    width: 100vw;
    padding: 2px 16px;
}

.glossary-alpha-letter {
    font-weight: bold;
    font-size: 13px;
    line-height: 18px;
    color: #444;
}

// ── Term title inside expansion header ──────────────────────────────────────

.glossary-term-title {
    font-weight: bold;
    font-size: 13px;
}

// ── Term description body ────────────────────────────────────────────────────

.glossary-description {
    font-size: 12px;
    color: #555;
}

// ── Alphabet sidebar ─────────────────────────────────────────────────────────

.glossary-alpha-sidebar {
    min-width: 22px;
    flex-shrink: 0;
    position: sticky;
    top: 64px; // below the header bar
    max-height: calc(100vh - 128px);
    overflow-y: auto;
}

.glossary-alpha-btn {
    color: $primary;
    font-weight: bold;
    font-size: 12px;
    line-height: 1.6;
    cursor: pointer;
    user-select: none;

    &:hover {
        color: $accent;
    }

    &--inactive {
        color: #ccc;
        cursor: default;
        pointer-events: none;
    }
}
</style>