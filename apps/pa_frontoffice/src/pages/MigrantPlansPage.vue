<template>
    <q-page padding>
        <!-- ── Breadcrumb / back ── -->
        <div class="row items-center q-mb-md q-gutter-sm">
            <q-btn flat dense no-caps icon="arrow_back" :label="t('migrant.back_to_list')"
                @click="() => router.push({ name: 'migrant-management' })" />
            <q-breadcrumbs class="text-grey-7">
                <q-breadcrumbs-el :label="t('migrant.title')" />
                <q-breadcrumbs-el :label="migrantLabel" />
                <q-breadcrumbs-el :label="t('migrant.plan_list_title')" />
            </q-breadcrumbs>
        </div>

        <!-- ── Page header ── -->
        <div class="row items-center q-col-gutter-md q-mb-md">
            <div class="col">
                <div class="text-h5 q-mb-xs">{{ t('migrant.plan_list_title') }}</div>
                <div class="text-body2 text-grey-7">
                    {{ t('migrant.plan_list_subtitle', { name: migrantLabel }) }}
                </div>
            </div>
            <div class="col-auto row q-gutter-sm">
                <q-btn flat no-caps icon="refresh" :label="t('button.refresh')" :loading="loading"
                    @click="() => { void loadData(); }" />
                <q-btn v-if="canEdit" color="info" unelevated rounded no-caps icon="add" :label="t('migrant.plan_new')"
                    @click="openCreatePlanDialog" />
            </div>
        </div>

        <!-- ── Error ── -->
        <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="error = null" />
            </template>
        </q-banner>

        <!-- ── Plans list ── -->
        <div v-if="loading && !plans.length" class="row flex-center q-pa-xl">
            <q-spinner-dots size="40px" color="primary" />
        </div>

        <div v-else-if="!plans.length" class="row flex-center q-pa-xl text-grey-7">
            <q-icon name="assignment" size="32px" class="q-mr-sm" />
            {{ t('migrant.plan_no_plans') }}
        </div>

        <div v-else class="q-col-gutter-md">
            <q-card v-for="plan in plans" :key="plan.id" flat bordered class="plan-card">
                <!-- Plan header -->
                <q-card-section>
                    <div class="row items-center no-wrap q-gutter-sm">
                        <q-badge :color="plan.completed ? 'positive' : 'blue-6'" rounded class="q-mr-sm">
                            {{ plan.completed ? t('migrant.plan_status_done') : t('migrant.plan_status_open') }}
                        </q-badge>
                        <div class="col text-subtitle1 text-weight-medium">
                            {{ plan.title || '—' }}
                        </div>
                        <div class="col-auto row q-gutter-xs no-wrap">
                            <q-btn v-if="canEdit" flat round dense icon="edit" :title="t('button.edit')"
                                @click="openEditPlanDialog(plan)" />
                            <q-btn v-if="canDelete" flat round dense color="negative" icon="delete"
                                :title="t('button.delete')" @click="openDeletePlanDialog(plan)" />
                        </div>
                    </div>

                    <!-- Plan meta -->
                    <div class="row q-col-gutter-sm q-mt-sm text-caption text-grey-7">
                        <div v-if="plan.caseManager" class="col-auto">
                            <q-icon name="person" size="xs" class="q-mr-xs" />{{ plan.caseManager }}
                        </div>
                        <div v-if="plan.startDate" class="col-auto">
                            <q-icon name="event" size="xs" class="q-mr-xs" />
                            {{ plan.startDate }}
                            <template v-if="plan.endDate"> → {{ plan.endDate }}</template>
                        </div>
                        <div v-if="plan.notes" class="col-12 text-italic">{{ plan.notes }}</div>
                    </div>
                </q-card-section>

                <q-separator />

                <!-- Items list -->
                <q-card-section class="q-pt-sm">
                    <div class="row items-center q-mb-sm">
                        <div class="col text-caption text-grey-6 text-uppercase text-weight-medium">
                            {{ t('migrant.plan_list_title') }}
                        </div>
                        <q-btn v-if="canEdit" flat dense no-caps size="sm" icon="add" :label="t('migrant.item_new')"
                            @click="openCreateItemDialog(plan)" />
                    </div>

                    <div v-if="!plan.items?.length" class="text-caption text-grey-6 q-pl-sm">
                        {{ t('migrant.item_no_items') }}
                    </div>

                    <q-list v-else separator>
                        <q-item v-for="item in plan.items" :key="item.id" class="q-px-none">
                            <q-item-section avatar top>
                                <q-checkbox :model-value="item.completed" :disable="!canEdit" dense
                                    @update:model-value="(val) => toggleItemCompleted(plan, item, val)" />
                            </q-item-section>

                            <q-item-section>
                                <q-item-label :class="item.completed ? 'text-strike text-grey-6' : ''">
                                    {{ item.title || '—' }}
                                </q-item-label>
                                <q-item-label caption>
                                    <span v-if="item.description">{{ item.description }}</span>
                                    <span v-if="item.dueDate" class="q-ml-sm">
                                        <q-icon name="schedule" size="xs" />
                                        {{ item.dueDate }}
                                    </span>
                                </q-item-label>
                            </q-item-section>

                            <!-- Validation status chip -->
                            <q-item-section side>
                                <div class="row items-center q-gutter-xs no-wrap">
                                    <q-chip v-if="item.validatedAt" dense color="positive" text-color="white"
                                        icon="verified" :label="t('migrant.item_validated')" />
                                    <q-chip v-else-if="item.validationRequestedAt" dense color="warning"
                                        text-color="dark" icon="hourglass_empty"
                                        :label="t('migrant.item_validation_pending')" />
                                    <q-btn v-else-if="canEdit && !item.completed" flat dense no-caps size="sm"
                                        icon="send" :label="t('migrant.item_validation_request')"
                                        @click="requestValidation(plan, item)" />
                                    <q-btn v-if="canEdit" flat round dense size="sm" icon="edit"
                                        @click="openEditItemDialog(plan, item)" />
                                    <q-btn v-if="canDelete" flat round dense size="sm" color="negative" icon="close"
                                        @click="deleteItem(plan, item)" />
                                </div>
                            </q-item-section>
                        </q-item>
                    </q-list>
                </q-card-section>
            </q-card>
        </div>

        <!-- ═══ Plan create/edit dialog ══════════════════════════════════════════ -->
        <q-dialog v-model="planDialog.open" persistent>
            <q-card class="dialog-card">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6">
                        {{ planDialog.isEdit ? t('button.edit') : t('migrant.plan_new') }}
                    </div>
                    <q-space />
                    <q-btn flat round dense icon="close" @click="closePlanDialog" />
                </q-card-section>

                <q-card-section>
                    <div class="row q-col-gutter-md">
                        <div class="col-12">
                            <q-input v-model.trim="planDialog.form.title" outlined dense
                                :label="t('migrant.plan_title')" />
                        </div>
                        <div class="col-12">
                            <q-input v-model.trim="planDialog.form.caseManager" outlined dense
                                :label="t('migrant.plan_case_manager')" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model="planDialog.form.startDate" outlined dense type="date"
                                :label="t('migrant.plan_start_date')" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model="planDialog.form.endDate" outlined dense type="date"
                                :label="t('migrant.plan_end_date')" />
                        </div>
                        <div class="col-12">
                            <q-input v-model.trim="planDialog.form.notes" outlined dense type="textarea" autogrow
                                :label="t('migrant.plan_notes')" />
                        </div>
                        <div v-if="planDialog.isEdit" class="col-12">
                            <q-toggle v-model="planDialog.form.completed" color="positive"
                                :label="t('migrant.plan_completed')" />
                        </div>
                    </div>
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="closePlanDialog" />
                    <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')"
                        :loading="planDialog.saving" @click="() => { void submitPlanDialog(); }" />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- ═══ Plan delete dialog ════════════════════════════════════════════════ -->
        <q-dialog v-model="deletePlanDialog.open" persistent>
            <q-card class="dialog-card-sm">
                <q-card-section class="row items-center q-gutter-sm">
                    <q-icon name="warning" color="negative" size="28px" />
                    <div class="text-h6">{{ t('button.delete') }}</div>
                </q-card-section>
                <q-card-section>
                    {{
                        t('migrant.plan_delete_confirm', {
                            title: deletePlanDialog.plan?.title || '—',
                    })
                    }}
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="deletePlanDialog.open = false" />
                    <q-btn color="negative" unelevated rounded no-caps :label="t('button.delete')"
                        :loading="deletePlanDialog.deleting" @click="() => { void submitDeletePlan(); }" />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- ═══ Item create/edit dialog ═══════════════════════════════════════════ -->
        <q-dialog v-model="itemDialog.open" persistent>
            <q-card class="dialog-card">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6">
                        {{ itemDialog.isEdit ? t('button.edit') : t('migrant.item_new') }}
                    </div>
                    <q-space />
                    <q-btn flat round dense icon="close" @click="closeItemDialog" />
                </q-card-section>

                <q-card-section>
                    <div class="row q-col-gutter-md">
                        <div class="col-12">
                            <q-input v-model.trim="itemDialog.form.title" outlined dense
                                :label="t('migrant.item_title')" />
                        </div>
                        <div class="col-12">
                            <q-input v-model.trim="itemDialog.form.description" outlined dense type="textarea" autogrow
                                :label="t('migrant.item_description')" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model="itemDialog.form.assignedDate" outlined dense type="date"
                                :label="t('migrant.item_assigned_date')" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model="itemDialog.form.dueDate" outlined dense type="date"
                                :label="t('migrant.item_due_date')" />
                        </div>
                        <div v-if="itemDialog.isEdit" class="col-12">
                            <q-toggle v-model="itemDialog.form.completed" color="positive"
                                :label="t('migrant.item_completed')" />
                        </div>
                    </div>
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="closeItemDialog" />
                    <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')"
                        :loading="itemDialog.saving" @click="() => { void submitItemDialog(); }" />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </q-page>
</template>

<script setup lang="ts">
/**
 * MigrantPlansPage
 *
 * Route: /migrant/:migrantId/plans
 *
 * Displays all integration plans for a single migrant with their items.
 * Plans and items are loaded eagerly (getPlan returns items).
 * PA operators can create/edit plans and items; deletion is pa_admin only
 * (server-side enforced — buttons shown optimistically, 403 handled gracefully).
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import {
    migrantUsersApi,
    type InterventionPlan,
    type InterventionPlanItem,
    type CreatePlanPayload,
    type UpdatePlanPayload,
    type CreatePlanItemPayload,
    type UpdatePlanItemPayload,
} from 'src/api';
import { useAuthStore } from 'src/stores/auth-store';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// ── Params ─────────────────────────────────────────────────────────────────────
const migrantId = route.params.migrantId as string;
// Name passed via router state from the list page; falls back to id.
const migrantLabel = ref<string>(
    (history.state?.migrantName as string | undefined) ?? migrantId,
);

// ── Role guards ────────────────────────────────────────────────────────────────
const canEdit = computed(() => auth.hasRole('pa_admin') || auth.hasRole('pa_operator'));
const canDelete = computed(() => auth.hasRole('pa_admin'));

// ── State ──────────────────────────────────────────────────────────────────────
const loading = ref(false);
const error = ref<string | null>(null);
const plans = ref<InterventionPlan[]>([]);

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadData(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
        // listPlans gives headers; then load each with items
        const headers = await migrantUsersApi.listPlans(migrantId);
        plans.value = await Promise.all(
            headers.map((p) => migrantUsersApi.getPlan(migrantId, p.id)),
        );
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] loadData failed', e);
        error.value = message;
    } finally {
        loading.value = false;
    }
}

onMounted(() => { void loadData(); });

// ═══ Plan dialogs ══════════════════════════════════════════════════════════════

function emptyPlanForm(): CreatePlanPayload & { completed: boolean } {
    return { title: '', caseManager: '', startDate: '', endDate: '', notes: '', completed: false };
}

const planDialog = reactive<{
    open: boolean;
    isEdit: boolean;
    saving: boolean;
    editId: string | null;
    form: ReturnType<typeof emptyPlanForm>;
}>({
    open: false,
    isEdit: false,
    saving: false,
    editId: null,
    form: emptyPlanForm(),
});

function openCreatePlanDialog(): void {
    planDialog.isEdit = false;
    planDialog.editId = null;
    planDialog.form = emptyPlanForm();
    planDialog.open = true;
}

function openEditPlanDialog(plan: InterventionPlan): void {
    planDialog.isEdit = true;
    planDialog.editId = plan.id;
    planDialog.form = {
        title: plan.title ?? '',
        caseManager: plan.caseManager ?? '',
        startDate: plan.startDate ?? '',
        endDate: plan.endDate ?? '',
        notes: plan.notes ?? '',
        completed: plan.completed,
    };
    planDialog.open = true;
}

function closePlanDialog(): void {
    if (planDialog.saving) return;
    planDialog.open = false;
}

async function submitPlanDialog(): Promise<void> {
    planDialog.saving = true;
    try {
        // Conditional spreads required by exactOptionalPropertyTypes —
        // optional fields must be absent (not `undefined`) when empty.
        const payload: UpdatePlanPayload = {
            ...(planDialog.form.title && { title: planDialog.form.title }),
            ...(planDialog.form.caseManager && { caseManager: planDialog.form.caseManager }),
            ...(planDialog.form.startDate && { startDate: planDialog.form.startDate }),
            ...(planDialog.form.endDate && { endDate: planDialog.form.endDate }),
            ...(planDialog.form.notes && { notes: planDialog.form.notes }),
            ...(planDialog.isEdit && { completed: planDialog.form.completed }),
        };

        if (planDialog.isEdit && planDialog.editId) {
            await migrantUsersApi.updatePlan(migrantId, planDialog.editId, payload);
            $q.notify({ type: 'positive', message: t('migrant.plan_update_success') });
        } else {
            await migrantUsersApi.createPlan(migrantId, payload as CreatePlanPayload);
            $q.notify({ type: 'positive', message: t('migrant.plan_create_success') });
        }

        planDialog.open = false;
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] submitPlanDialog failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        planDialog.saving = false;
    }
}

// ── Delete plan ────────────────────────────────────────────────────────────────

const deletePlanDialog = reactive<{
    open: boolean;
    deleting: boolean;
    plan: InterventionPlan | null;
}>({ open: false, deleting: false, plan: null });

function openDeletePlanDialog(plan: InterventionPlan): void {
    deletePlanDialog.plan = plan;
    deletePlanDialog.open = true;
}

async function submitDeletePlan(): Promise<void> {
    if (!deletePlanDialog.plan) return;
    deletePlanDialog.deleting = true;
    try {
        await migrantUsersApi.deletePlan(migrantId, deletePlanDialog.plan.id);
        $q.notify({ type: 'positive', message: t('migrant.plan_delete_success') });
        deletePlanDialog.open = false;
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] deletePlan failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        deletePlanDialog.deleting = false;
    }
}

// ═══ Item dialogs ══════════════════════════════════════════════════════════════

function emptyItemForm(): CreatePlanItemPayload & { completed: boolean } {
    return { title: '', description: '', assignedDate: '', dueDate: '', sortOrder: 0, completed: false };
}

const itemDialog = reactive<{
    open: boolean;
    isEdit: boolean;
    saving: boolean;
    planId: string | null;
    itemId: string | null;
    form: ReturnType<typeof emptyItemForm>;
}>({
    open: false,
    isEdit: false,
    saving: false,
    planId: null,
    itemId: null,
    form: emptyItemForm(),
});

function openCreateItemDialog(plan: InterventionPlan): void {
    itemDialog.isEdit = false;
    itemDialog.planId = plan.id;
    itemDialog.itemId = null;
    itemDialog.form = emptyItemForm();
    itemDialog.open = true;
}

function openEditItemDialog(plan: InterventionPlan, item: InterventionPlanItem): void {
    itemDialog.isEdit = true;
    itemDialog.planId = plan.id;
    itemDialog.itemId = item.id;
    itemDialog.form = {
        title: item.title ?? '',
        description: item.description ?? '',
        assignedDate: item.assignedDate ?? '',
        dueDate: item.dueDate ?? '',
        sortOrder: item.sortOrder,
        completed: item.completed,
    };
    itemDialog.open = true;
}

function closeItemDialog(): void {
    if (itemDialog.saving) return;
    itemDialog.open = false;
}

async function submitItemDialog(): Promise<void> {
    if (!itemDialog.planId) return;
    itemDialog.saving = true;
    try {
        if (itemDialog.isEdit && itemDialog.itemId) {
            // Conditional spreads — exactOptionalPropertyTypes discipline.
            const payload: UpdatePlanItemPayload = {
                ...(itemDialog.form.title && { title: itemDialog.form.title }),
                ...(itemDialog.form.description && { description: itemDialog.form.description }),
                ...(itemDialog.form.assignedDate && { assignedDate: itemDialog.form.assignedDate }),
                ...(itemDialog.form.dueDate && { dueDate: itemDialog.form.dueDate }),
                completed: itemDialog.form.completed,
                ...(itemDialog.form.sortOrder !== undefined && { sortOrder: itemDialog.form.sortOrder }),
            };
            await migrantUsersApi.updateItem(migrantId, itemDialog.planId, itemDialog.itemId, payload);
            $q.notify({ type: 'positive', message: t('migrant.item_update_success') });
        } else {
            // Conditional spreads — exactOptionalPropertyTypes discipline.
            const payload: CreatePlanItemPayload = {
                ...(itemDialog.form.title && { title: itemDialog.form.title }),
                ...(itemDialog.form.description && { description: itemDialog.form.description }),
                ...(itemDialog.form.assignedDate && { assignedDate: itemDialog.form.assignedDate }),
                ...(itemDialog.form.dueDate && { dueDate: itemDialog.form.dueDate }),
                ...(itemDialog.form.sortOrder !== undefined && { sortOrder: itemDialog.form.sortOrder }),
            };
            await migrantUsersApi.createItem(migrantId, itemDialog.planId, payload);
            $q.notify({ type: 'positive', message: t('migrant.item_create_success') });
        }

        itemDialog.open = false;
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] submitItemDialog failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        itemDialog.saving = false;
    }
}

// ── Item actions ───────────────────────────────────────────────────────────────

async function toggleItemCompleted(
    plan: InterventionPlan,
    item: InterventionPlanItem,
    completed: boolean,
): Promise<void> {
    try {
        await migrantUsersApi.updateItem(migrantId, plan.id, item.id, { completed });
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] toggleItemCompleted failed', e);
        $q.notify({ color: 'negative', message });
    }
}

async function requestValidation(
    plan: InterventionPlan,
    item: InterventionPlanItem,
): Promise<void> {
    try {
        await migrantUsersApi.requestValidation(migrantId, plan.id, item.id);
        $q.notify({ type: 'positive', message: t('migrant.item_validation_success') });
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantPlansPage] requestValidation failed', e);
        $q.notify({ color: 'negative', message });
    }
}

// Not async — $q.dialog().onOk() does not await the callback.
// The inner async work is wrapped in void to satisfy no-misused-promises.
function deleteItem(plan: InterventionPlan, item: InterventionPlanItem): void {
    $q.dialog({
        title: t('button.delete'),
        message: t('migrant.item_delete_confirm'),
        cancel: true,
        persistent: true,
    }).onOk(() => {
        void (async () => {
            try {
                await migrantUsersApi.deleteItem(migrantId, plan.id, item.id);
                $q.notify({ type: 'positive', message: t('migrant.item_delete_success') });
                await loadData();
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                logger.error('[MigrantPlansPage] deleteItem failed', e);
                $q.notify({ color: 'negative', message });
            }
        })();
    });
}
</script>

<style scoped>
.plan-card {
    margin-bottom: 16px;
}

.dialog-card {
    width: 640px;
    max-width: 94vw;
}

.dialog-card-sm {
    width: 480px;
    max-width: 92vw;
}

.text-strike {
    text-decoration: line-through;
}
</style>