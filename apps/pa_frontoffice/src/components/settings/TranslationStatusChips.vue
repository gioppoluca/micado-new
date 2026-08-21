<template>
  <span class="row inline items-center q-gutter-x-xs">
    <q-chip v-for="([lang, state]) in entries" :key="lang" dense size="sm"
      :color="chipColor(state)" :text-color="state === 'SENT' ? 'brown-10' : 'grey-9'"
      class="q-ma-none translation-chip" :class="{missing: state === 'MISSING'}">
      {{ lang.toUpperCase() }}
      <q-tooltip>{{ t(`translation_chip.${state.toLowerCase()}`) }}</q-tooltip>
    </q-chip>
    <q-btn v-if="canDispatch" flat dense round size="sm" icon="translate" color="primary"
      :loading="loading" :aria-label="t('translation_chip.send_missing')" @click.stop="dispatch">
      <q-tooltip>{{ t('translation_chip.send_missing') }}</q-tooltip>
    </q-btn>
  </span>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useI18n} from 'vue-i18n';
import {useQuasar} from 'quasar';
import {dispatchMissingTranslations, type TranslationChipState} from 'src/api/translation-state.api';

const props = defineProps<{
  states?: Record<string, TranslationChipState> | undefined;
  revisionId?: string | undefined;
  revisionStatus: string;
}>();
const emit = defineEmits<{dispatched: []}>();
const {t} = useI18n();
const $q = useQuasar();
const loading = ref(false);
const entries = computed(() => Object.entries(props.states ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const canDispatch = computed(() => Boolean(props.revisionId)
  && ['APPROVED', 'PUBLISHED'].includes(props.revisionStatus)
  && entries.value.some(([, state]) => state === 'MISSING'));

function chipColor(state: TranslationChipState): string {
  if (state === 'TRANSLATED') return 'green-3';
  if (state === 'SENT') return 'amber-4';
  return 'white';
}

async function dispatch(): Promise<void> {
  if (!props.revisionId) return;
  loading.value = true;
  try {
    const result = await dispatchMissingTranslations(props.revisionId);
    $q.notify({type: 'positive', message: t(result.dispatched.length
      ? 'translation_chip.send_success' : 'translation_chip.send_none')});
    emit('dispatched');
  } catch {
    $q.notify({type: 'negative', message: t('translation_chip.send_failed')});
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.translation-chip.missing { border: 1px solid #bdbdbd; }
</style>
