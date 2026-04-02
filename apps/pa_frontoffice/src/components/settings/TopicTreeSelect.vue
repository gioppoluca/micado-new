<template>
    <!--
    TopicTreeSelect.vue
    ════════════════════════════════════════════════════════════════════════
    Isolation wrapper for vue3-treeselect (megafetis/vue3-treeselect).

    ── Why appendToBody is NOT used ────────────────────────────────────────
    The library uses Options API provide/inject to share the root instance
    with child components (Menu, MenuPortal, etc.).
    When appendToBody=true, MenuPortal is teleported outside the component
    tree, breaking the provide/inject chain → "injection 'instance' not found"
    → crash on instance.wrapperClass access.
    Solution: omit appendToBody (defaults to false). The menu renders inline,
    which works correctly for this form context.

    ── Behaviour ───────────────────────────────────────────────────────────
    • Shows the full topic hierarchy (all depths) for navigation.
    • Nodes at depth >= maxSelectableDepth are VISIBLE but NOT SELECTABLE.
    • The topic being edited (excludeId) is hidden to prevent self-parenting.
    • Single selection only. Emits null when cleared.
    -->
    <div class="topic-tree-select">
        <Treeselect :model-value="modelValue" :options="treeOptions" :multiple="false" :clearable="true"
            :searchable="true" :disabled="disabled" :placeholder="placeholder" :default-expand-level="1"
            @update:model-value="onUpdate">
            <!-- Dim disabled nodes in the dropdown -->
            <template #option-label="{ node }">
                <span :class="{ 'topic-node--disabled': node.raw?.isDisabled }">
                    {{ node.label }}
                </span>
            </template>
        </Treeselect>

        <!-- Depth limit hint -->
        <div v-if="limitHint" class="text-caption text-grey-6 q-mt-xs">
            {{ limitHint }}
        </div>
    </div>
</template>

<script setup lang="ts">
import Treeselect from 'vue3-treeselect';
import 'vue3-treeselect/dist/vue3-treeselect.css';

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { toTreeNodes } from 'src/api/topic.api';
import type { Topic } from 'src/api/topic.api';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue: number | null;
    topics: Topic[];
    maxSelectableDepth?: number;
    excludeId?: number;
    placeholder?: string;
    disabled?: boolean;
}>(), {
    maxSelectableDepth: 99,
    placeholder: '',
    disabled: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: number | null): void;
}>();

const treeOptions = computed(() =>
    toTreeNodes(props.topics, props.maxSelectableDepth, props.excludeId),
);

const limitHint = computed(() => {
    if (props.maxSelectableDepth >= 99) return null;
    const hasDisabled = props.topics.some(
        t => t.depth >= props.maxSelectableDepth && t.id !== props.excludeId,
    );
    if (!hasDisabled) return null;
    return t('help.topic_max_depth_hint', { depth: props.maxSelectableDepth });
});

function onUpdate(value: number | string | null): void {
    if (value === null || value === undefined) {
        emit('update:modelValue', null);
    } else {
        emit('update:modelValue', Number(value));
    }
}
</script>

<style scoped>
.topic-tree-select {
    width: 100%;
}

.topic-node--disabled {
    opacity: 0.45;
    font-style: italic;
}
</style>

<style>
.vue-treeselect__control {
    border-color: rgba(0, 0, 0, 0.24);
    border-radius: 4px;
    min-height: 40px;
}

.vue-treeselect__control:hover {
    border-color: rgba(0, 0, 0, 0.54);
}

.vue-treeselect__placeholder {
    color: rgba(0, 0, 0, 0.54);
    font-size: 14px;
}

.vue-treeselect__menu {
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.vue-treeselect__option--selected {
    background-color: #e8f5e9;
    color: #1b5e20;
}

.vue-treeselect__option--highlight {
    background-color: #f5f5f5;
}

.vue-treeselect__option--disabled {
    cursor: not-allowed;
    color: rgba(0, 0, 0, 0.38);
}
</style>