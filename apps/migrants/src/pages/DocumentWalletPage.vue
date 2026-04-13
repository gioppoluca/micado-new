<script setup lang="ts">
/**
 * src/pages/DocumentWalletPage.vue
 *
 * Document Wallet — personal document storage for authenticated migrants.
 *
 * ── Current status ────────────────────────────────────────────────────────────
 *   The documents API (/documents, /document-types) is not yet ported to
 *   the new LoopBack 4 backend.  This page renders a placeholder with a
 *   clear message.  When the API is ready:
 *
 *   1. Add document.api.ts  (GET /documents-migrant, POST, DELETE)
 *   2. Add document-store.ts (Pinia, mirrors information-store pattern)
 *   3. Replace the placeholder below with the document list + upload form.
 *
 * ── Feature flag ─────────────────────────────────────────────────────────────
 *   Requires FEAT_MIGRANT_LOGIN + FEAT_DOCUMENTS to be active.
 *   The route is also auth-gated (requiresAuth: true).
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/DocumentWallet.vue + components/DocumentWalletItem.vue
 */

import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const router = useRouter();
</script>

<template>
    <q-page class="feature-page q-pa-lg">

        <div class="column items-center q-pt-xl">
            <q-icon name="folder_open" size="72px" color="primary" class="q-mb-md" />

            <div class="text-h6 text-primary text-weight-bold q-mb-sm">
                {{ t('menu.documents') }}
            </div>

            <div class="text-body2 text-grey-7 text-center q-mb-xl" style="max-width: 320px;">
                {{ t('features.documents_coming_soon') }}
            </div>

            <q-btn outline rounded no-caps icon="arrow_back" :label="t('button.go_back')" class="go-back-btn"
                @click="router.back()" />
        </div>

    </q-page>
</template>

<style scoped lang="scss">
.feature-page {
    max-width: 480px;
    margin: 0 auto;
}

.go-back-btn {
    border-color: $primary;
    color: $primary;
    min-width: 180px;
}
</style>