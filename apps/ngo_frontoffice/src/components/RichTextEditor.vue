<template>
    <!--
    RichTextEditor.vue  →  src/components/RichTextEditor.vue
    ─────────────────────────────────────────────────────────
    Sostituzione completa del componente esistente (che era uno stub HTML→TipTap).
    Aggiunge rispetto allo stub:
      - Markdown bidirezionale (tiptap-markdown)
      - Mention MICADO (@[type,id](text)) tramite InternalEntityMention
      - CharacterCount nativo (rimpiazza il computed manuale)
      - FileHandler per drag & drop / paste immagini
      - BubbleMenu inline per i link (invece del dialog separato del legacy)

    v-model: stringa Markdown (non più HTML come nello stub)

    Retrocompatibilità: le prop (modelValue, readonly, maxCharLimit)
    restano identiche allo stub esistente — i call site non cambiano.
  -->
    <div class="rich-text-editor">

        <!-- ── Single border frame — toolbar + content share one border so left
             edges are physically identical. No double-border misalignment. -->
        <div :class="readonly ? 'editor-frame editor-frame--readonly' : 'editor-frame'">

            <!-- ── Toolbar ────────────────────────────────────────────────────── -->
            <div v-if="!readonly" class="editor-toolbar row items-center q-gutter-xs">
                <q-btn flat dense round icon="format_bold" :class="{ 'text-accent': editor?.isActive('bold') }"
                    @click="editor?.chain().focus().toggleBold().run()" />

                <q-btn flat dense round icon="format_italic" :class="{ 'text-accent': editor?.isActive('italic') }"
                    @click="editor?.chain().focus().toggleItalic().run()" />

                <q-separator vertical inset class="q-mx-xs" />

                <q-btn flat dense round icon="link" :class="{ 'text-accent': editor?.isActive('link') }"
                    :disable="isSelectionEmpty" @click="openLinkDialog">
                    <q-tooltip v-if="isSelectionEmpty">{{ t('link_modal.selected') }}</q-tooltip>
                </q-btn>

                <q-btn flat dense round icon="image" @click="showImageDialog = true" />

                <q-separator vertical inset class="q-mx-xs" />

                <q-btn flat dense round icon="undo" :disable="!editor?.can().undo()"
                    @click="editor?.chain().focus().undo().run()" />

                <q-btn flat dense round icon="redo" :disable="!editor?.can().redo()"
                    @click="editor?.chain().focus().redo().run()" />

                <q-space />

                <!-- Conteggio parole — CharacterCount extension (rimpiazza computed manuale) -->
                <span class="text-caption text-grey-6">
                    {{ t('text_editor.word_count') }}: {{ wordCount }}
                </span>
                <span v-if="hasCharError" class="text-caption text-negative q-ml-xs">
                    (max {{ maxCharLimit }})
                </span>

                <!-- Slot per pulsanti extra (approvazione, versioning, ecc.) -->
                <slot name="toolbar-extra" />
            </div>

            <!-- ── BubbleMenu link ───────────────────────────────────────────────── -->
            <BubbleMenu v-if="editor && !readonly" :editor="editor" :should-show="shouldShowBubbleMenu"
                class="editor-bubble-menu">
                <template v-if="bubbleMode === 'form'">
                    <q-input v-model="bubbleLinkUrl" dense borderless dark placeholder="https://"
                        class="editor-bubble-menu__input" @keydown.enter.prevent="applyBubbleLink"
                        @keydown.esc="closeBubble" ref="bubbleInputRef" autofocus />
                    <q-btn flat dense dark icon="check" color="positive" @click="applyBubbleLink" />
                    <q-btn v-if="editor?.isActive('link')" flat dense dark icon="link_off" color="negative"
                        @click="removeLink" />
                    <q-btn flat dense dark icon="close" @click="closeBubble" />
                </template>
                <template v-else>
                    <q-btn flat dense dark size="sm" :icon="editor?.isActive('link') ? 'edit' : 'add_link'"
                        :label="editor?.isActive('link') ? t('button.update_link') : t('button.add_link')"
                        @click="openBubble" />
                </template>
            </BubbleMenu>

            <!-- ── Area editor ProseMirror ─────────────────────────────────────── -->
            <editor-content v-if="editor" :editor="editor" class="editor-content"
                :class="{ 'editor-content--readonly': readonly }" />

        </div><!-- /editor-frame -->

        <!-- ── Link dialog (fallback per click toolbar) ──────────────────── -->
        <q-dialog v-model="showLinkDialog" persistent>
            <q-card style="min-width: 400px">
                <q-card-section>
                    <q-input v-model="linkUrl" :label="t('link_modal.link')" color="accent" autofocus
                        @keyup.enter="applyLink" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat :label="t('button.cancel')" @click="showLinkDialog = false" />
                    <q-btn unelevated color="accent" no-caps :label="t('link_modal.apply')" @click="applyLink" />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- ── Image dialog ───────────────────────────────────────────────── -->
        <q-dialog v-model="showImageDialog" persistent>
            <q-card style="min-width: 400px">
                <q-toolbar class="bg-white">
                    <q-toolbar-title>{{ t('upload_modal.title') }}</q-toolbar-title>
                    <q-btn flat round dense icon="close" v-close-popup />
                </q-toolbar>
                <q-card-section class="q-gutter-sm">
                    <q-tabs v-model="imageTab" dense active-color="accent" indicator-color="accent">
                        <q-tab name="upload" :label="t('upload_modal.upload_label')" />
                        <q-tab name="url" :label="t('upload_modal.url')" />
                    </q-tabs>
                    <q-tab-panels v-model="imageTab" animated>
                        <q-tab-panel name="upload">
                            <!--
                TODO: rimpiazzare q-file con il componente ImageUploader del progetto
                che usa api-images-client interno. Il componente deve emettere
                'uploaded' con l'URL risultante.
              -->
                            <q-file v-model="imageFile" filled dense accept="image/*"
                                :label="t('upload_modal.uploader_label')" @update:model-value="handleFileSelected" />
                        </q-tab-panel>
                        <q-tab-panel name="url">
                            <q-input v-model="imageUrl" filled dense :label="t('upload_modal.url_label')" />
                        </q-tab-panel>
                    </q-tab-panels>
                    <q-input v-model="imageAlt" filled dense :label="t('upload_modal.text_alternative')" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat :label="t('button.cancel')" @click="showImageDialog = false" />
                    <q-btn unelevated color="accent" no-caps :label="t('upload_modal.upload_button')"
                        @click="applyImage" />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </div>
</template>

<script setup lang="ts">
/**
 * RichTextEditor — versione completa con Markdown, mention MICADO, BubbleMenu.
 * Sostituisce il precedente stub src/components/RichTextEditor.vue.
 */
import { ref, computed, watch, onBeforeMount, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CharacterCount from '@tiptap/extension-character-count';
import { FileHandler } from '@tiptap/extension-file-handler';
import { Markdown } from 'tiptap-markdown';
import { logger } from 'src/services/Logger';
import InternalEntityMention from 'src/extensions/InternalEntityMention';
import InternalEntityMentionSuggestion from 'src/extensions/InternalEntityMentionSuggestion';
import { useMicadoEntitiesStore } from 'src/stores/micado-entities-store';
import { useAppStore } from 'src/stores/app-store';

const { t } = useI18n();

// ── Props & emits ──────────────────────────────────────────────────────────

const props = withDefaults(defineProps<{
    /** Contenuto Markdown (v-model). Retrocompatibile con il vecchio stub (era HTML). */
    modelValue: string;
    readonly?: boolean;
    maxCharLimit?: number | null;
}>(), {
    modelValue: '',
    readonly: false,
    maxCharLimit: null,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();

// ── Editor setup ───────────────────────────────────────────────────────────

/** Previene il loop watch→setContent→onUpdate→emit */
const isInternalUpdate = ref(false);

const editor = useEditor({
    content: props.modelValue,
    editable: !props.readonly,

    extensions: [
        /**
         * StarterKit v3: Bold, Italic, Heading, Lists, Code, History, ecc.
         * Link e Image sono aggiunti separatamente per configurazione custom.
         */
        StarterKit,

        Link.configure({
            openOnClick: false,     // Non navigare in edit mode
            autolink: false,
            HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        }),

        Image.configure({
            inline: true,
            HTMLAttributes: { class: 'editor-image' },
        }),

        /**
         * CharacterCount: rimpiazza il computed manuale wordCount dello stub.
         * editor.storage.characterCount.words() e .characters()
         */
        CharacterCount.configure({
            limit: props.maxCharLimit ?? undefined,
        }),

        /**
         * FileHandler: rimpiazza il boilerplate Image.js del legacy.
         * Gestisce drag & drop e paste di immagini.
         */
        FileHandler.configure({
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
            onDrop: (ed: Editor, files: File[], pos: number): void => {
                void (async () => {
                    for (const file of files) {
                        const url = await uploadImage(file);
                        if (url) ed.chain().insertContentAt(pos, { type: 'image', attrs: { src: url } }).focus().run();
                    }
                })();
            },
            onPaste: (ed: Editor, files: File[]): void => {
                void (async () => {
                    for (const file of files) {
                        const url = await uploadImage(file);
                        if (url) ed.chain().insertContent({ type: 'image', attrs: { src: url } }).focus().run();
                    }
                })();
            },
        }),

        /**
         * Markdown: input/output Markdown bidirezionale.
         * Rimpiazza showdown + referenceExtension + moveSpaces del legacy.
         *
         * TODO: sostituire con @tiptap/markdown quando stabile.
         */
        Markdown.configure({ html: false, transformPastedText: true }),

        /** Mark — renders existing @[type,id](text) syntax from DB */
        InternalEntityMention,

        /**
         * Extension — handles @ typing, shows popup, inserts the mark.
         * Must be a separate Extension (not inside the Mark) so that
         * this.editor is fully mounted when addProseMirrorPlugins() runs.
         */
        InternalEntityMentionSuggestion,
    ],

    onUpdate({ editor: ed }: { editor: Editor }) {
        if (isInternalUpdate.value) return;
        const markdown = (ed.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
        logger.debug('[RichTextEditor] onUpdate', { len: markdown.length });
        emit('update:modelValue', markdown);
    },

    onFocus() { logger.debug('[RichTextEditor] focus'); },
    onBlur() { logger.debug('[RichTextEditor] blur'); },
});

// ── Word/char count ────────────────────────────────────────────────────────

const wordCount = computed<number>(() =>
    (editor.value?.storage as { characterCount?: { words: () => number } } | undefined)
        ?.characterCount?.words() ?? 0
);

const charCount = computed<number>(() =>
    (editor.value?.storage as { characterCount?: { characters: () => number } } | undefined)
        ?.characterCount?.characters() ?? 0
);

const hasCharError = computed<boolean>(() =>
    props.maxCharLimit !== null && charCount.value > (props.maxCharLimit ?? 0)
);

const isSelectionEmpty = computed<boolean>(() =>
    editor.value?.state.selection.empty ?? true
);

// ── BubbleMenu link ────────────────────────────────────────────────────────

type BubbleMode = 'default' | 'form';
const bubbleMode = ref<BubbleMode>('default');
const bubbleLinkUrl = ref('');
const bubbleInputRef = ref<{ focus: () => void } | null>(null);

function shouldShowBubbleMenu({ from, to }: { from: number; to: number }): boolean {
    return (editor.value?.isActive('link') ?? false) || from !== to;
}

function openBubble(): void {
    bubbleLinkUrl.value = editor.value?.getAttributes('link').href as string ?? '';
    bubbleMode.value = 'form';
    void nextTick(() => bubbleInputRef.value?.focus());
}

function applyBubbleLink(): void {
    if (!bubbleLinkUrl.value) {
        editor.value?.chain().focus().unsetLink().run();
    } else {
        editor.value?.chain().focus().extendMarkRange('link').setLink({ href: bubbleLinkUrl.value }).run();
    }
    closeBubble();
}

function removeLink(): void {
    editor.value?.chain().focus().unsetLink().run();
    closeBubble();
}

function closeBubble(): void {
    bubbleMode.value = 'default';
    bubbleLinkUrl.value = '';
}

// ── Link dialog ────────────────────────────────────────────────────────────

const showLinkDialog = ref(false);
const linkUrl = ref('');

function openLinkDialog(): void {
    linkUrl.value = editor.value?.getAttributes('link').href as string ?? '';
    showLinkDialog.value = true;
}

function applyLink(): void {
    if (!linkUrl.value) {
        editor.value?.chain().focus().unsetLink().run();
    } else {
        editor.value?.chain().focus().setLink({ href: linkUrl.value }).run();
    }
    showLinkDialog.value = false;
    linkUrl.value = '';
}

// ── Image upload ───────────────────────────────────────────────────────────

const showImageDialog = ref(false);
const imageTab = ref<'upload' | 'url'>('upload');
const imageFile = ref<File | null>(null);
const imageUrl = ref('');
const imageAlt = ref('');

/**
 * Carica un'immagine e restituisce l'URL.
 *
 * TODO: sostituire con api-images-client del progetto PA_frontoffice:
 *   import client from 'api-images-client'
 *   const [promise] = client.uploadImage(file)
 *   const result = await promise
 *   const host = window.location.hostname === 'localhost'
 *     ? appStore.paUrl
 *     : window.location.hostname
 *   return `${window.location.protocol}//${host}/micado_img/${result.files[0].new_filename}`
 */
async function uploadImage(file: File): Promise<string> {
    logger.info('[RichTextEditor] uploadImage', { name: file.name, size: file.size });
    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  TODO: implementare upload reale con api-images-client             ║
    // ║  Fallback temporaneo: base64 per sviluppo locale                   ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleFileSelected(file: File | null): Promise<void> {
    if (!file) return;
    const url = await uploadImage(file);
    editor.value?.chain().focus().setImage({ src: url, alt: imageAlt.value }).run();
    showImageDialog.value = false;
    imageFile.value = null;
    imageAlt.value = '';
}

async function applyImage(): Promise<void> {
    const src = imageTab.value === 'url'
        ? imageUrl.value
        : (imageFile.value ? await uploadImage(imageFile.value) : '');

    if (src) editor.value?.chain().focus().setImage({ src, alt: imageAlt.value }).run();

    showImageDialog.value = false;
    imageFile.value = null;
    imageUrl.value = '';
    imageAlt.value = '';
}

// ── Watchers ───────────────────────────────────────────────────────────────

watch(() => props.modelValue, (val) => {
    if (!editor.value) return;
    const current = (editor.value.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
    if (val === current) return;

    logger.debug('[RichTextEditor] watch modelValue: aggiornamento esterno');
    isInternalUpdate.value = true;
    editor.value.commands.setContent(val);
    void nextTick(() => { isInternalUpdate.value = false; });
});

watch(() => props.readonly, (val) => {
    editor.value?.setEditable(!val);
});

// ── API pubblica (per ref da componenti padre, es. MultiLangEditorTabs) ────

/** Restituisce il Markdown corrente */
function getMarkdown(): string {
    return (editor.value?.storage as unknown as { markdown: { getMarkdown: () => string } } | undefined)
        ?.markdown.getMarkdown() ?? '';
}

/** Imposta il contenuto da una stringa Markdown */
function setMarkdown(md: string): void {
    isInternalUpdate.value = true;
    editor.value?.commands.setContent(md);
    void nextTick(() => { isInternalUpdate.value = false; });
}

/** Verifica se c'è un errore di validazione */
function hasError(): boolean {
    return hasCharError.value;
}

defineExpose({ getMarkdown, setMarkdown, hasError, editor });

const entitiesStore = useMicadoEntitiesStore();
const appStore = useAppStore();

// ── Lifecycle ───────────────────────────────────────────────────────────────

onBeforeMount(() => {
    /**
     * Pre-warm entity cache as early as possible so that mention suggestions
     * are ready by the time the user types '@'.
     * Fire-and-forget — the suggestion popup watches store.loading reactively.
     */
    if (!entitiesStore.allEntitiesFetched) {
        void entitiesStore.fetchAllEntities({
            defaultLang: appStore.defaultLang,
            userLang: appStore.userLang,
        });
    }
});

// ── Cleanup ────────────────────────────────────────────────────────────────

onBeforeUnmount(() => {
    logger.debug('[RichTextEditor] destroy');
    editor.value?.destroy();
});
</script>

<style scoped lang="scss">
.editor-frame {
    border: 1px solid $grey-4;
    border-radius: 4px;
    overflow: hidden; // clips children so border-radius shows correctly

    &--readonly {
        background: $grey-2;
    }
}

.editor-toolbar {
    // No border here — the frame provides the outer border.
    border-bottom: 1px solid $grey-4;
    border-radius: 0;
    background: $grey-2;
    // Left padding = 8px so toolbar buttons left-align with editor text.
    // We use padding-left directly (not q-pa-xs on the element) so we control
    // the exact value that ProseMirror padding-left matches.
    padding: 2px 4px 2px 4px;
}

.editor-content {
    // No border — frame provides it.
    min-height: 120px;
    font-size: 16px;
    background: $grey-3;
}


.editor-bubble-menu {
    display: flex;
    align-items: center;
    gap: 4px;
    background: $dark;
    border-radius: 6px;
    padding: 4px 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);

    &__input {
        min-width: 180px;
    }
}

:deep(.ProseMirror) {
    outline: none;
    min-height: 100px;
    // Padding here (not on .editor-content) keeps left edge of text flush with toolbar.
    // q-pa-xs on the toolbar = 4px; we match with 4px left so text starts at same x.
    // padding-left matches .editor-toolbar padding-left exactly (8px)
    // so the first character of text and the first toolbar button icon are at the same x.
    // Left padding 8px = toolbar padding-left (4px) + q-btn dense internal padding (4px)
    // so text left edge aligns with icon glyph left edge.
    padding: 8px 12px 8px 8px;

    p {
        margin: 0.5em 0;
    }

    a {
        color: var(--q-accent);
        cursor: pointer;
    }

    .editor-image {
        max-width: 300px;
        width: 100%;
    }
}
</style>