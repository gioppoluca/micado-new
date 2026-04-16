<template>
    <!--
    RichTextViewer.vue  →  src/components/rich-text-editor/RichTextViewer.vue
    ──────────────────────────────────────────────────────────────────────────
    Viewer read-only. Rimpiazza GlossaryEditorViewer.vue del legacy.
    Stessa lista di estensioni di RichTextEditor ma con editable=false.
    Il click sugli span mention viene catturato tramite CustomEvent (vedi
    InternalEntityMentionView.vue) e apre EntityPreviewDialog.
  -->
    <div class="rtv-wrapper">
        <q-spinner v-if="isLoading" size="sm" color="grey-5" />

        <template v-else>
            <div ref="contentRef" class="rtv-content" :class="{ 'rtv-content--collapsed': isCollapsed }">
                <EditorContent v-if="editor" :editor="editor" />
            </div>

            <template v-if="readMore">
                <q-btn v-if="isCollapsed" unelevated rounded no-caps size="sm" color="grey-5" padding="1px 15px"
                    class="q-mb-md" :label="t('button.read_more')" @click="expand" />
                <q-btn v-else-if="wasCollapsed" unelevated rounded no-caps outline size="sm" color="grey-8"
                    padding="1px 15px" class="q-my-md" :label="t('button.read_less')" @click="collapse" />
            </template>

            <slot name="append" />
        </template>

        <EntityPreviewDialog v-model="previewOpen" :entity-type="previewType" :entity-id="previewId" />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { logger } from 'src/services/Logger';
import { useAppStore } from 'src/stores/app-store';
import { useMicadoEntitiesStore, type EntityTypeCode } from 'src/stores/micado-entities-store';
import InternalEntityMention from 'src/extensions/InternalEntityMention';
import EntityPreviewDialog from './EntityPreviewDialog.vue';

const { t } = useI18n();
const appStore = useAppStore();
const entitiesStore = useMicadoEntitiesStore();

const props = withDefaults(defineProps<{
    content: string;
    /** Evita un secondo fetch se le entità sono già in store */
    allEntitiesFetched?: boolean;
    readMore?: boolean;
}>(), { content: '', allEntitiesFetched: false, readMore: false });

const emit = defineEmits<{
    (e: 'readMorePressed'): void;
    (e: 'readLessPressed'): void;
}>();

const isLoading = ref(true);
const contentRef = ref<HTMLElement | null>(null);
const isCollapsed = ref(false);
const wasCollapsed = ref(false);

const previewOpen = ref(false);
const previewType = ref<EntityTypeCode | null>(null);
const previewId = ref<number | null>(null);

const editor = useEditor({
    editable: false,
    content: '',
    extensions: [
        StarterKit,
        Link.configure({ openOnClick: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
        Image.configure({ inline: true }),
        Markdown.configure({ html: true }),
        InternalEntityMention,
    ],
});

async function initialize(): Promise<void> {
    isLoading.value = true;
    try {
        if (!props.allEntitiesFetched) {
            await entitiesStore.fetchAllEntities({
                defaultLang: appStore.defaultLang,
                userLang: appStore.userLang,
            });
        }
        editor.value?.commands.setContent(props.content);

        if (props.readMore) {
            await new Promise(r => setTimeout(r, 50)); // wait for render
            const h = contentRef.value?.getBoundingClientRect().height ?? 0;
            if (h > 41) { isCollapsed.value = true; wasCollapsed.value = true; }
        }
        logger.info('[RichTextViewer] inizializzato');
    } catch (e) {
        logger.error('[RichTextViewer] errore init', e);
    } finally {
        isLoading.value = false;
    }
}

watch(() => props.content, (v) => {
    if (!isLoading.value) editor.value?.commands.setContent(v);
});

function handleMentionClick(ev: Event): void {
    const { entityType, entityId } = (ev as CustomEvent<{ entityType: EntityTypeCode; entityId: number }>).detail;
    logger.info('[RichTextViewer] mention click', { entityType, entityId });
    previewType.value = entityType;
    previewId.value = entityId;
    previewOpen.value = true;
}

function expand(): void { isCollapsed.value = false; emit('readMorePressed'); }
function collapse(): void { isCollapsed.value = true; emit('readLessPressed'); }

onMounted(async () => {
    await initialize();
    document.addEventListener('micado:mention-click', handleMentionClick);
});

onBeforeUnmount(() => {
    document.removeEventListener('micado:mention-click', handleMentionClick);
    editor.value?.destroy();
});
</script>

<style scoped lang="scss">
.rtv-content {
    font-family: "Nunito Sans";
    font-size: 16px;

    &--collapsed {
        overflow: hidden;
        max-height: 41px;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
}

:deep(.ProseMirror) {
    outline: none;

    a {
        color: var(--q-accent);
    }
}
</style>