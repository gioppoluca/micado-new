<script setup lang="ts">
/**
 * src/pages/TasksPage.vue
 *
 * Integration Plans & Tasks — personalised step-by-step integration journey.
 *
 * ── Current status ────────────────────────────────────────────────────────────
 *   The integration plan API (/intervention-plan, /tasks) is not yet ported
 *   to the new LoopBack 4 backend.  This page renders a placeholder.
 *   When the API is ready:
 *
 *   1. Add intervention-plan.api.ts
 *   2. Add plan-store.ts (Pinia)
 *   3. Replace the placeholder with the q-stepper-based plan view.
 *
 * ── Feature flag ─────────────────────────────────────────────────────────────
 *   Requires FEAT_MIGRANT_LOGIN + FEAT_TASKS.
 *   Route is auth-gated (requiresAuth: true).
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/PlanList.vue + Tasks.vue + SinglePlan.vue
 */

import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const router = useRouter();
</script>

<template>
    <q-page class="feature-page q-pa-lg">

        <div class="column items-center q-pt-xl">
            <q-icon name="assignment" size="72px" color="primary" class="q-mb-md" />

            <div class="text-h6 text-primary text-weight-bold q-mb-sm">
                {{ t('menu.integration_plan') }}
            </div>

            <div class="text-body2 text-grey-7 text-center q-mb-xl" style="max-width: 320px;">
                {{ t('features.tasks_coming_soon') }}
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