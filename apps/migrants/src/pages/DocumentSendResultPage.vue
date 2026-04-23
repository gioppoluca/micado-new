<template>
  <q-page class="result-page q-pa-md">

    <!-- ── Close ─────────────────────────────────────────────────────────── -->
    <div class="row justify-end q-mb-lg">
      <q-btn flat round dense icon="close" @click="goBack" />
    </div>

    <!-- ── Success state ─────────────────────────────────────────────────── -->
    <template v-if="isSuccess">
      <div class="column items-center q-pt-lg">
        <!-- Orange circle checkmark (matches mockup image 2) -->
        <div class="check-circle q-mb-xl">
          <q-icon name="check" size="56px" color="white" />
        </div>

        <div class="text-body1 text-center result-text">
          {{ t('documents.send_success_prefix') }}
          <br />
          <strong>{{ sentTo }}</strong>
        </div>
      </div>
    </template>

    <!-- ── Error state ────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="column items-center q-pt-lg">
        <!-- Pink/magenta warning triangle (matches mockup image 3) -->
        <div class="warning-triangle q-mb-xl">
          <q-icon name="warning" size="52px" :style="{ color: '#c71585' }" />
        </div>

        <div class="text-body1 text-center result-text">
          {{ errorMessage || t('documents.send_error_generic') }}
        </div>
      </div>
    </template>

    <!-- ── Go Back button (both states) ──────────────────────────────────── -->
    <div class="row justify-center q-mt-xl">
      <q-btn
        outline rounded no-caps icon="arrow_back"
        :label="t('button.go_back')"
        class="go-back-btn"
        @click="goBack"
      />
    </div>

  </q-page>
</template>

<script setup lang="ts">
/**
 * DocumentSendResultPage — /document-wallet/:id/send/result
 *
 * Single page covering both the success (image 2) and error (image 3) states.
 * State is passed via query params:
 *   ?success=1&sentTo=email@example.com    → success screen
 *   ?success=0&error=<message>             → error screen
 *
 * The "Go Back" button navigates to the document detail page.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const isSuccess = computed(() => route.query.success === '1');
const sentTo = computed(() => (route.query.sentTo as string | undefined) ?? '');
const errorMessage = computed(() => {
  const raw = route.query.error as string | undefined;
  // Show a user-friendly message for the most common SMTP rejection reason
  if (!raw) return '';
  if (raw.toLowerCase().includes('does not exist') ||
      raw.toLowerCase().includes('invalid recipient') ||
      raw.toLowerCase().includes('user unknown') ||
      raw.toLowerCase().includes('no such user')) {
    return t('documents.send_error_no_user');
  }
  return t('documents.send_error_generic');
});

function goBack(): void {
  const docId = route.params.id as string;
  void router.push({ name: 'document-detail', params: { id: docId } });
}
</script>

<style scoped lang="scss">
.result-page {
  max-width: 480px;
  margin: 0 auto;
}

/* Orange filled circle with white checkmark — matches mockup image 2 */
.check-circle {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: transparent;
  border: 4px solid #ff7c44;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;

  :deep(.q-icon) {
    color: #ff7c44 !important;
  }
}

/* Pink/magenta warning triangle — matches mockup image 3 */
.warning-triangle {
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-text {
  max-width: 280px;
  line-height: 1.6;
}

.go-back-btn {
  border-color: var(--micado-header);
  color: var(--micado-header);
  min-width: 160px;
}
</style>
