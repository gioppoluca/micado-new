<template>
    <!--
    InternalEntityMentionView.vue  (src/extensions/)
    ─────────────────────────────
    Componente Vue che renderizza uno span cliccabile per ogni mention @[type,id](text).
    Usato come VueMarkViewRenderer dell'estensione InternalEntityMention.

    Rimpiazza il Plugin ProseMirror click-handler del legacy InternalMention.js
    con un semplice componente Vue reattivo con accesso allo store Pinia.

    In EDITOR mode (editable=true): il click è ignorato (ProseMirror gestisce la selezione).
    In VIEWER mode (editable=false): il click invia un CustomEvent sul DOM,
      catturato da RichTextViewer.vue che apre EntityPreviewDialog.
  -->
    <span class="micado-mention" :class="[
        `micado-mention--${entityType}`,
        { 'micado-mention--unknown': !entity && !entitiesStore.loading }
    ]" :title="tooltipText" @click.prevent="handleClick" role="button" tabindex="0"
        :aria-label="`Apri dettaglio: ${displayText}`" @keydown.enter.prevent="handleClick"
        @keydown.space.prevent="handleClick">
        <mark-view-content />
    </span>
</template>

<script setup lang="ts">
/**
 * Props iniettati da VueMarkViewRenderer di TipTap v3.
 * I nomi sono l'API contrattuale di TipTap — non modificare.
 */
import { computed } from 'vue';
import { MarkViewContent } from '@tiptap/vue-3';
import { logger } from 'src/services/Logger';
import { useMicadoEntitiesStore, type EntityTypeCode } from 'src/stores/micado-entities-store';

// ─── Props (iniettati da VueMarkViewRenderer) ─────────────────────────────────
const props = defineProps<{
    mark: { attrs: Record<string, unknown> };
    editor: { isEditable: boolean; state: { doc: { nodeAt: (pos: number) => { textContent: string } | null } } };
    getPos: () => number | undefined;
}>();

// ─── Store ────────────────────────────────────────────────────────────────────
const entitiesStore = useMicadoEntitiesStore();

// ─── Computed ─────────────────────────────────────────────────────────────────

const entityType = computed(() => props.mark.attrs['entityType'] as EntityTypeCode);
const entityId = computed(() => props.mark.attrs['entityId'] as number | null);

const entity = computed(() => {
    if (!entityType.value || entityId.value === null) return undefined;
    return entitiesStore.findEntityById(entityType.value, entityId.value);
});

/** Testo visualizzato nello span (dal contenuto testuale del mark) */
const displayText = computed((): string => {
    const pos = props.getPos?.();
    if (pos === undefined) return '';
    try {
        return props.editor.state.doc.nodeAt(pos)?.textContent ?? '';
    } catch {
        return '';
    }
});

const tooltipText = computed((): string => {
    if (entitiesStore.loading && !entity.value) return 'Caricamento...';
    if (!entity.value) {
        logger.warn('[InternalEntityMentionView] entity non trovata in store', {
            type: entityType.value,
            id: entityId.value,
        });
        return `${entityType.value}:${entityId.value} (non trovata)`;
    }
    return entitiesStore.getEntityTitle(entity.value);
});

// ─── Click handler ────────────────────────────────────────────────────────────

/**
 * In editor mode: ignora (ProseMirror gestisce la selezione).
 * In viewer mode: dispatcha un CustomEvent sul documento, catturato da RichTextViewer.
 *
 * Usiamo un CustomEvent invece di emit perché il componente è dentro ProseMirror
 * e gli eventi Vue non si propagano normalmente all'esterno del NodeView.
 */
function handleClick(): void {
    if (props.editor.isEditable) {
        logger.debug('[InternalEntityMentionView] click in edit mode, skip');
        return;
    }

    if (!entity.value || entityId.value === null) {
        logger.warn('[InternalEntityMentionView] click su entity non trovata', {
            type: entityType.value,
            id: entityId.value,
        });
        return;
    }

    logger.info('[InternalEntityMentionView] apertura preview', {
        entityType: entityType.value,
        entityId: entityId.value,
        title: entitiesStore.getEntityTitle(entity.value),
    });

    document.dispatchEvent(new CustomEvent('micado:mention-click', {
        detail: {
            entityType: entityType.value,
            entityId: entityId.value,
        },
        bubbles: true,
    }));
}
</script>

<style lang="scss" scoped>
.micado-mention {
    color: var(--q-accent);
    text-decoration: underline;
    cursor: pointer;
    border-radius: 2px;
    transition: background-color 0.15s ease;

    &:focus-visible {
        outline: 2px solid var(--q-accent);
        outline-offset: 2px;
    }

    &:hover {
        background-color: rgba(255, 124, 68, 0.12);
    }

    // Entità non trovata nello store (link rotto)
    &--unknown {
        color: var(--q-negative);
        text-decoration-style: wavy;
    }

    // Sottile differenziazione visiva per tipo (aiuta la scansione in testi ricchi)
    &--g {
        border-bottom: 1px solid rgba(255, 124, 68, 0.4);
    }

    &--i {
        border-bottom: 1px dashed rgba(255, 124, 68, 0.4);
    }

    &--p {
        border-bottom: 2px solid rgba(255, 124, 68, 0.3);
    }

    &--e {
        border-bottom: 1px dotted rgba(255, 124, 68, 0.4);
    }
}
</style>