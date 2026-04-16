<template>
    <!--
    MultiLangEditorTabs.vue  →  src/components/rich-text-editor/MultiLangEditorTabs.vue
    ──────────────────────────────────────────────────────────────────────────────────
    Wrapper tab multilingua per RichTextEditor. Rimpiazza AddDocument.vue del legacy.
    Una tab per ogni lingua attiva; v-model: { [langCode]: { title?, description } }
  -->
    <div class="mlet-wrapper">
        <q-tab-panels v-model="activeTab" animated class="mlet-panels">
            <q-tab-panel v-for="lang in languages" :key="lang.lang" :name="lang.lang">

                <div class="mlet-lang-label text-caption text-grey-7 q-mb-sm">
                    {{ lang.name }}
                    <q-badge v-if="lang.isDefault" color="accent" label="default" class="q-ml-xs" />
                </div>

                <template v-if="showTitle">
                    <q-input :model-value="modelValue[lang.lang]?.title ?? ''"
                        @update:model-value="update(lang.lang, 'title', $event as string)" outlined bg-color="grey-3"
                        :label="t('input_labels.title')" :maxlength="titleMaxLength > 0 ? titleMaxLength : undefined"
                        :counter="titleMaxLength > 0" :readonly="readonly" class="q-mb-md" />
                </template>

                <RichTextEditor :ref="(el) => setRef(lang.lang, el)"
                    :model-value="modelValue[lang.lang]?.description ?? ''"
                    @update:model-value="update(lang.lang, 'description', $event)" :readonly="readonly"
                    :max-char-limit="descriptionMaxLength" />
            </q-tab-panel>
        </q-tab-panels>

        <q-separator />

        <q-tabs v-model="activeTab" dense align="left" class="text-grey-7" active-color="accent"
            indicator-color="accent">
            <q-tab v-for="lang in languages" :key="lang.lang" :name="lang.lang" :label="lang.name">
                <q-badge v-if="hasContent(lang.lang)" color="positive" floating rounded />
            </q-tab>
        </q-tabs>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Language } from 'src/api/language.api';
import RichTextEditor from 'src/components/RichTextEditor.vue';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue: Record<string, { title?: string; description: string }>;
    languages: Language[];
    readonly?: boolean;
    showTitle?: boolean;
    titleMaxLength?: number;
    descriptionMaxLength?: number | null;
}>(), {
    readonly: false,
    showTitle: false,
    titleMaxLength: 200,
    descriptionMaxLength: null,
});

const emit = defineEmits<{
    (e: 'update:modelValue', v: Record<string, { title?: string; description: string }>): void;
}>();

/** Tab attiva: codice lingua. Default alla prima lingua della lista */
const activeTab = ref(props.languages[0]?.lang ?? 'en');

/** Ref agli editor per lingua — usati da getAllTranslations() */
const editorRefs = ref<Record<string, InstanceType<typeof RichTextEditor> | null>>({});

function setRef(lang: string, el: unknown): void {
    editorRefs.value[lang] = el as InstanceType<typeof RichTextEditor> | null;
}

function update(lang: string, field: 'title' | 'description', value: string): void {
    emit('update:modelValue', {
        ...props.modelValue,
        [lang]: { ...(props.modelValue[lang] ?? { description: '' }), [field]: value },
    });
}

function hasContent(lang: string): boolean {
    const e = props.modelValue[lang];
    return !!(e?.title?.trim() || e?.description?.trim());
}

/** Restituisce le traduzioni correnti con il Markdown aggiornato da tutti gli editor */
function getAllTranslations(): Record<string, { title?: string; description: string }> {
    const out = { ...props.modelValue };
    for (const [lang, editorRef] of Object.entries(editorRefs.value)) {
        if (editorRef) out[lang] = { ...(out[lang] ?? { description: '' }), description: editorRef.getMarkdown() };
    }
    return out;
}

function hasAnyError(): boolean {
    return Object.values(editorRefs.value).some(r => r?.hasError());
}

function setActiveLanguage(lang: string): void {
    activeTab.value = lang;
}

defineExpose({ getAllTranslations, hasAnyError, setActiveLanguage });
</script>

<style scoped lang="scss">
.mlet-wrapper {
    border: 1px solid $grey-4;
    border-radius: 4px;
}

.mlet-panels :deep(.q-tab-panel) {
    padding: 16px;
}

.mlet-lang-label {
    display: flex;
    align-items: center;
}
</style>