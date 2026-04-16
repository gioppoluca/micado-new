<template>
    <!--
    EntityPreviewDialog.vue  →  src/components/rich-text-editor/EntityPreviewDialog.vue
    ──────────────────────────────────────────────────────────────────────────────────
    Dialog preview entità MICADO. Rimpiazza InternalReferenceDialog.vue del legacy.
  -->
    <q-dialog v-model="isOpen">
        <q-card class="entity-preview-dialog">
            <q-toolbar class="bg-white">
                <q-badge :color="typeColor" :label="typeLabel" class="q-mr-sm" />
                <q-toolbar-title class="text-subtitle1 text-weight-medium">{{ title }}</q-toolbar-title>
                <q-btn flat round dense icon="close" @click="isOpen = false" />
            </q-toolbar>

            <q-card-section class="entity-preview-dialog__body">
                <template v-if="entitiesStore.loading && !entity">
                    <q-skeleton v-for="i in 3" :key="i" type="text" />
                </template>

                <template v-else-if="entity">
                    <!-- La descrizione è Markdown → la renderizziamo con RichTextViewer -->
                    <RichTextViewer :content="entityDescription" :all-entities-fetched="true" />
                </template>

                <p v-else class="text-grey-6">{{ t('entity_preview.no_description') }}</p>
            </q-card-section>

            <q-card-actions align="right">
                <span class="text-caption text-grey-6 q-mr-auto entity-preview-dialog__url">{{ entityRoute }}</span>
                <q-btn flat no-caps color="accent" icon="open_in_new" :label="t('button.go_to_reference')"
                    @click="navigate" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { logger } from 'src/services/Logger';
import { useMicadoEntitiesStore, ENTITY_TYPE, type EntityTypeCode } from 'src/stores/micado-entities-store';
import RichTextViewer from './RichTextViewer.vue';

const { t } = useI18n();
const router = useRouter();
const entitiesStore = useMicadoEntitiesStore();

const props = withDefaults(defineProps<{
    modelValue: boolean;
    entityType: EntityTypeCode | null;
    entityId: number | null;
}>(), { modelValue: false, entityType: null, entityId: null });

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const isOpen = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) });

const entity = computed(() => {
    if (!props.entityType || props.entityId === null) return undefined;
    return entitiesStore.findEntityById(props.entityType, props.entityId);
});

const title = computed(() => entity.value ? entitiesStore.getEntityTitle(entity.value) : '');

const entityDescription = computed(() => entity.value?.description ?? '');

const entityRoute = computed(() => {
    if (!props.entityType || props.entityId === null) return '';
    return entitiesStore.getEntityRoute(props.entityType, props.entityId);
});

const typeColor = computed(() => ({
    [ENTITY_TYPE.GLOSSARY]: 'deep-orange',
    [ENTITY_TYPE.INFORMATION]: 'blue',
    [ENTITY_TYPE.PROCESS]: 'green',
    [ENTITY_TYPE.EVENT]: 'purple',
}[(props.entityType ?? '') as EntityTypeCode] ?? 'grey'));

const typeLabel = computed(() => ({
    [ENTITY_TYPE.GLOSSARY]: 'Glossario',
    [ENTITY_TYPE.INFORMATION]: 'Info',
    [ENTITY_TYPE.PROCESS]: 'Processo',
    [ENTITY_TYPE.EVENT]: 'Evento',
}[(props.entityType ?? '') as EntityTypeCode] ?? props.entityType ?? ''));

function navigate(): void {
    if (!entityRoute.value) return;
    logger.info('[EntityPreviewDialog] navigate', { route: entityRoute.value });
    void router.push(entityRoute.value);
    isOpen.value = false;
}
</script>

<style scoped lang="scss">
.entity-preview-dialog {
    width: 540px;
    max-width: 95vw;

    &__body {
        max-height: 400px;
        overflow-y: auto;
        min-height: 60px;
    }

    &__url {
        font-size: 11px;
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 200px;
    }
}
</style>