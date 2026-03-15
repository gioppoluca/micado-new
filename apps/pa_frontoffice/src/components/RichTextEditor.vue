<template>
    <div class="rich-text-editor">
        <!-- ── Toolbar ────────────────────────────────────────────────────── -->
        <div v-if="!readonly" class="editor-toolbar row items-center q-gutter-xs q-pa-xs">
            <q-btn flat dense round icon="format_bold" :class="{ 'text-accent': editor?.isActive('bold') }"
                :disable="readonly" @click="editor?.chain().focus().toggleBold().run()" />
            <q-btn flat dense round icon="format_italic" :class="{ 'text-accent': editor?.isActive('italic') }"
                :disable="readonly" @click="editor?.chain().focus().toggleItalic().run()" />
            <q-btn flat dense round icon="link" :class="{ 'text-accent': editor?.isActive('link') }" :disable="readonly"
                @click="openLinkDialog" />
            <q-btn flat dense round icon="image" :disable="readonly" @click="showImageDialog = true" />
            <q-separator vertical inset class="q-mx-xs" />
            <q-btn flat dense round icon="undo" :disable="!editor?.can().undo()"
                @click="editor?.chain().focus().undo().run()" />
            <q-btn flat dense round icon="redo" :disable="!editor?.can().redo()"
                @click="editor?.chain().focus().redo().run()" />
            <q-space />
            <span class="text-caption text-grey-6">
                {{ t('text_editor.word_count') }}: {{ wordCount }}
            </span>
        </div>

        <!-- ── Editor surface ─────────────────────────────────────────────── -->
        <editor-content v-if="editor" :editor="editor" class="editor-content" :class="{ 'editor-content--readonly': readonly }" />

        <!-- ── Link dialog ────────────────────────────────────────────────── -->
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
                <q-card-section class="q-gutter-sm">
                    <q-tabs v-model="imageTab" dense active-color="accent" indicator-color="accent">
                        <q-tab name="upload" :label="t('upload_modal.upload_label')" />
                        <q-tab name="url" :label="t('upload_modal.url')" />
                    </q-tabs>
                    <q-tab-panels v-model="imageTab" animated>
                        <q-tab-panel name="upload">
                            <q-file v-model="imageFile" filled dense accept="image/*"
                                :label="t('upload_modal.uploader_label')" />
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
 * RichTextEditor — Vue 3 replacement for GlossaryEditor.vue.
 *
 * Uses tiptap v2 (@tiptap/vue-3) instead of the Vue 2-only tiptap v1.
 * The API is significantly different; key changes:
 *   - `new Editor({...})` → `useEditor({...})` composable
 *   - EditorContent / EditorMenuBar / EditorMenuBubble → EditorContent only
 *     (toolbar is built manually as regular HTML/Quasar components)
 *   - editor.chain().focus().toggleBold().run() replaces commands.bold
 *   - editor.isActive('bold') replaces isActive.bold()
 *   - vue-countable replaced with a computed word count
 *
 * Props match the old GlossaryEditor interface so existing call sites
 * can swap the component name with no other changes.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

const { t } = useI18n();

// ── Props & emits ──────────────────────────────────────────────────────────

const props = withDefaults(defineProps<{
    /** HTML string value (v-model) */
    modelValue: string
    readonly?: boolean
    maxCharLimit?: number | null
}>(), {
    modelValue: '',
    readonly: false,
    maxCharLimit: null,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void
}>();

// ── Editor ─────────────────────────────────────────────────────────────────

const editor = useEditor({
    extensions: [
        StarterKit,
        Link.configure({ openOnClick: false }),
        Image,
    ],
    content: props.modelValue,
    editable: !props.readonly,
    onUpdate: ({ editor: ed }: { editor: Editor }) => {
        emit('update:modelValue', ed.getHTML());
    },
});

// ── Word count ─────────────────────────────────────────────────────────────

const wordCount = computed<number>(() => {
    if (!editor.value) return 0;
    const text = editor.value.getText();
    return text.trim() ? text.trim().split(/\s+/).length : 0;
});

// ── Link dialog ────────────────────────────────────────────────────────────

const showLinkDialog = ref(false);
const linkUrl = ref('');

function openLinkDialog(): void {
    // Pre-fill with existing href if cursor is on a link
    const prev = editor.value?.getAttributes('link').href as string | undefined;
    linkUrl.value = prev ?? '';
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

// ── Image dialog ───────────────────────────────────────────────────────────

const showImageDialog = ref(false);
const imageTab = ref<'upload' | 'url'>('upload');
const imageFile = ref<File | null>(null);
const imageUrl = ref('');
const imageAlt = ref('');

async function applyImage(): Promise<void> {
    let src = imageUrl.value;

    if (imageTab.value === 'upload' && imageFile.value) {
        // Convert to data URL for embedding (backend upload endpoint not in OpenAPI yet)
        src = await fileToDataUrl(imageFile.value);
    }

    if (src) {
        editor.value?.chain().focus().setImage({ src, alt: imageAlt.value }).run();
    }

    showImageDialog.value = false;
    imageFile.value = null;
    imageUrl.value = '';
    imageAlt.value = '';
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ── Watchers ───────────────────────────────────────────────────────────────

watch(() => props.modelValue, (val) => {
    if (editor.value && editor.value.getHTML() !== val) {
        editor.value.commands.setContent(val, { emitUpdate: false });
    }
});

watch(() => props.readonly, (val) => {
    editor.value?.setEditable(!val);
});

// ── Cleanup ────────────────────────────────────────────────────────────────

onBeforeUnmount(() => {
    editor.value?.destroy();
});
</script>

<style scoped lang="scss">
.editor-toolbar {
    border: 1px solid $grey-4;
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    background: $grey-2;
}

.editor-content {
    border: 1px solid $grey-4;
    border-radius: 0 0 4px 4px;
    min-height: 120px;
    padding: 8px 12px;
    font-size: 16px;
    background: $grey-3;

    &--readonly {
        border-radius: 4px;
        background: $grey-2;
        cursor: default;
    }
}

:deep(.ProseMirror) {
    outline: none;
    min-height: 100px;

    p {
        margin: 0.5em 0;
    }

    img {
        max-width: 300px;
        width: 100%;
    }

    a {
        color: var(--q-accent);
        cursor: pointer;
    }
}
</style>