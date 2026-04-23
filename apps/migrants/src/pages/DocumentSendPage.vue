<template>
  <q-page class="send-page q-pa-md">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="row items-center justify-between q-mb-md">
      <div>
        <div class="text-h6 text-weight-bold">{{ t('documents.send_title') }}</div>
        <div class="text-body2 text-grey-7">{{ t('documents.send_subtitle') }}</div>
      </div>
      <q-btn flat round dense icon="close" @click="router.back()" />
    </div>

    <!-- ── Authority dropdown ─────────────────────────────────────────────── -->
    <div class="q-mb-md">
      <q-select
        v-model="selectedContact"
        :options="contactOptions"
        option-value="email"
        option-label="displayName"
        emit-value
        map-options
        clearable
        outlined
        dense
        :label="t('documents.select_authority')"
        :loading="loadingContacts"
        @update:model-value="onContactSelected"
      />
    </div>

    <!-- ── Free-form email input ──────────────────────────────────────────── -->
    <div class="q-mb-lg">
      <q-input
        v-model.trim="freeEmail"
        outlined dense
        type="email"
        :label="t('documents.different_email')"
        :disable="!!selectedContact"
        @update:model-value="selectedContact = null"
      />
    </div>

    <!-- ── Send button ────────────────────────────────────────────────────── -->
    <div class="row justify-center q-mt-xl">
      <q-btn
        unelevated rounded no-caps
        icon-right="send"
        :label="t('documents.send_document')"
        class="send-btn"
        :loading="sending"
        :disable="!targetEmail"
        @click="() => { void submit(); }"
      />
    </div>

  </q-page>
</template>

<script setup lang="ts">
/**
 * DocumentSendPage — /document-wallet/:id/send
 *
 * Lets the authenticated migrant send a document as an email attachment.
 *
 * Flow:
 *   1. On mount: load available contact emails from GET /ngo/contact-emails.
 *   2. User picks one from the dropdown OR types a free-form email.
 *      The two inputs are mutually exclusive: selecting from the dropdown
 *      clears the free-text field and vice versa.
 *   3. On submit: POST /documents-migrant/:id/send-email { email }.
 *   4. Navigate to /document-wallet/:id/send/result?sentTo=...&success=true|false
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { documentApi, type ContactEmailOption } from 'src/api/document.api';
import { isApiError } from 'src/api/client';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const id = computed(() => route.params.id as string);

// ── State ─────────────────────────────────────────────────────────────────────

const contactOptions = ref<ContactEmailOption[]>([]);
const selectedContact = ref<string | null>(null);   // holds the email value
const freeEmail = ref('');
const loadingContacts = ref(false);
const sending = ref(false);

/** The resolved email to send to — whichever input is active. */
const targetEmail = computed(() =>
  selectedContact.value?.trim() || freeEmail.value.trim() || '',
);

// ── Handlers ──────────────────────────────────────────────────────────────────

function onContactSelected(email: string | null): void {
  if (email) freeEmail.value = '';
}

async function submit(): Promise<void> {
  const email = targetEmail.value;
  if (!email) return;

  sending.value = true;
  try {
    const result = await documentApi.sendByEmail(id.value, { email });
    void router.replace({
      name: 'document-send-result',
      params: { id: id.value },
      query: { sentTo: result.sentTo, success: '1' },
    });
  } catch (e) {
    const msg = isApiError(e) ? e.message : String(e);
    logger.error('[DocumentSendPage] send failed', e);
    void router.replace({
      name: 'document-send-result',
      params: { id: id.value },
      query: { success: '0', error: msg },
    });
  } finally {
    sending.value = false;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  loadingContacts.value = true;
  try {
    contactOptions.value = await documentApi.listContactEmails();
    logger.info('[DocumentSendPage] contacts loaded', { count: contactOptions.value.length });
  } catch (e) {
    logger.error('[DocumentSendPage] failed to load contacts', e);
    // Non-fatal: the free-form input is still usable
  } finally {
    loadingContacts.value = false;
  }
});
</script>

<style scoped lang="scss">
.send-page {
  max-width: 480px;
  margin: 0 auto;
}

.send-btn {
  min-width: 200px;
  background: var(--micado-header) !important;
  color: #fff;
  font-size: 1rem;
}
</style>
