<template>
    <q-page padding>
        <!-- ── Page header ── -->
        <div class="row items-center q-col-gutter-md q-mb-md">
            <div class="col">
                <div class="text-h5 q-mb-xs">{{ t('migrant.title') }}</div>
                <div class="text-body2 text-grey-7">{{ t('migrant.subtitle') }}</div>
            </div>
            <div class="col-auto">
                <q-btn flat no-caps icon="refresh" :label="t('button.refresh')" :loading="loading"
                    @click="() => { void loadData(); }" />
            </div>
        </div>

        <!-- ── Error banner ── -->
        <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="error = null" />
            </template>
        </q-banner>

        <!-- ── Table ── -->
        <q-card flat bordered>
            <q-card-section class="row items-center q-col-gutter-md">
                <div class="col-12 col-md-6">
                    <q-input v-model="search" outlined dense clearable debounce="250" :label="t('input_labels.search')">
                        <template #prepend><q-icon name="search" /></template>
                    </q-input>
                </div>
                <div class="col-12 col-md-6 text-body2 text-grey-7 text-right">
                    {{ t('migrant.total_users', { count: filteredUsers.length }) }}
                </div>
            </q-card-section>

            <q-separator />

            <q-table flat :rows="filteredUsers" :columns="columns" row-key="id" :loading="loading"
                :pagination="pagination" binary-state-sort>
                <template #loading>
                    <q-inner-loading showing>
                        <q-spinner-dots size="40px" color="primary" />
                    </q-inner-loading>
                </template>

                <!-- Name + email cell -->
                <template #body-cell-user="props">
                    <q-td :props="props">
                        <div class="text-weight-medium">{{ fullName(props.row) }}</div>
                        <div class="text-caption text-grey-7">
                            {{ props.row.email || props.row.username || '—' }}
                        </div>
                    </q-td>
                </template>

                <!-- Status badge -->
                <template #body-cell-status="props">
                    <q-td :props="props" class="text-center">
                        <q-badge :color="props.row.enabled ? 'positive' : 'grey-6'" rounded>
                            {{ props.row.enabled ? t('migrant.enabled') : t('migrant.disabled') }}
                        </q-badge>
                    </q-td>
                </template>

                <!-- Registration date -->
                <template #body-cell-registered="props">
                    <q-td :props="props">
                        <span v-if="props.row.createdTimestamp" class="text-caption">
                            {{ formatDate(props.row.createdTimestamp) }}
                        </span>
                        <span v-else class="text-caption text-grey-6">—</span>
                    </q-td>
                </template>

                <!-- Action buttons — matching legacy screenshot: integration plan | data | delete -->
                <template #body-cell-actions="props">
                    <q-td :props="props" class="text-right">
                        <div class="row justify-end q-gutter-xs no-wrap">
                            <!-- Integration Plans -->
                            <q-btn flat round dense color="primary" icon="assignment"
                                :title="t('migrant.integration_plans')" @click="goToPlans(props.row)" />
                            <!-- Profile / Data -->
                            <q-btn flat round dense color="dark" icon="folder" :title="t('migrant.profile_data')"
                                @click="goToProfile(props.row)" />
                            <!-- Delete -->
                            <q-btn flat round dense color="negative" icon="close" :title="t('button.delete')"
                                @click="openDeleteDialog(props.row)" />
                        </div>
                    </q-td>
                </template>

                <template #no-data>
                    <div class="full-width row flex-center q-gutter-sm q-pa-lg text-grey-7">
                        <q-icon name="group_off" size="28px" />
                        <span>{{ t('migrant.no_users_found') }}</span>
                    </div>
                </template>
            </q-table>
        </q-card>

        <!-- ── Delete confirmation dialog ── -->
        <q-dialog v-model="deleteDialog.open" persistent>
            <q-card class="dialog-card-sm">
                <q-card-section class="row items-center q-gutter-sm">
                    <q-icon name="warning" color="negative" size="28px" />
                    <div class="text-h6">{{ t('migrant.delete_user') }}</div>
                </q-card-section>
                <q-card-section>
                    {{
                        t('migrant.delete_confirmation', {
                            user:
                                deleteDialog.user?.email ||
                                deleteDialog.user?.username ||
                                fullName(deleteDialog.user),
                    })
                    }}
                    <div class="text-caption text-negative q-mt-sm">
                        {{ t('migrant.delete_warning') }}
                    </div>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="closeDeleteDialog" />
                    <q-btn color="negative" unelevated rounded no-caps :label="t('button.delete')"
                        :loading="deleteDialog.deleting" @click="() => { void submitDeleteDialog(); }" />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </q-page>
</template>

<script setup lang="ts">
/**
 * MigrantManagementPage
 *
 * Lists migrant users from the Keycloak migrants realm.
 * Provides navigation to integration plans and profile data per user.
 * PA can delete a migrant account (pa_admin only — server-side enforced).
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableProps } from 'quasar';
import { useRouter } from 'vue-router';
import { migrantUsersApi, type MigrantUser } from 'src/api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const router = useRouter();

// ── State ──────────────────────────────────────────────────────────────────────

const loading = ref(false);
const error = ref<string | null>(null);
const search = ref('');
const users = ref<MigrantUser[]>([]);

const pagination = ref({
    rowsPerPage: 15,
    sortBy: 'user',
    descending: false,
});

// ── Table columns ──────────────────────────────────────────────────────────────

const columns: QTableProps['columns'] = [
    {
        name: 'user',
        label: t('migrant.user'),
        field: (row: MigrantUser) =>
            `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() ||
            row.email ||
            row.username ||
            '',
        align: 'left',
        sortable: true,
    },
    {
        name: 'status',
        label: t('migrant.status'),
        field: (row: MigrantUser) =>
            row.enabled ? t('migrant.enabled') : t('migrant.disabled'),
        align: 'center',
        sortable: true,
    },
    {
        name: 'registered',
        label: t('migrant.registered'),
        field: (row: MigrantUser) => row.createdTimestamp ?? 0,
        align: 'left',
        sortable: true,
    },
    {
        name: 'actions',
        // Column headers matching legacy screenshot labels
        label: `${t('migrant.integration_plans')}  /  ${t('migrant.profile_data')}  /  ${t('input_labels.delete')}`,
        field: 'id',
        align: 'right',
        sortable: false,
    },
];

// ── Computed ───────────────────────────────────────────────────────────────────

const filteredUsers = computed(() => {
    const term = search.value.trim().toLowerCase();
    if (!term) return users.value;

    return users.value.filter((u) => {
        const haystack = [u.email, u.username, u.firstName, u.lastName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return haystack.includes(term);
    });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function fullName(user: MigrantUser | null | undefined): string {
    if (!user) return '';
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.email || user.username || '—';
}

function formatDate(epochMs: number): string {
    return new Date(epochMs).toLocaleDateString();
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function goToPlans(user: MigrantUser): void {
    void router.push({
        name: 'migrant-plans',
        params: { migrantId: user.id },
        state: { migrantName: fullName(user) },
    });
}

function goToProfile(user: MigrantUser): void {
    void router.push({
        name: 'migrant-profile',
        params: { migrantId: user.id },
        state: { migrantName: fullName(user) },
    });
}

// ── Delete dialog ──────────────────────────────────────────────────────────────

const deleteDialog = reactive<{
    open: boolean;
    deleting: boolean;
    user: MigrantUser | null;
}>({
    open: false,
    deleting: false,
    user: null,
});

function openDeleteDialog(user: MigrantUser): void {
    deleteDialog.user = user;
    deleteDialog.open = true;
}

function closeDeleteDialog(): void {
    if (deleteDialog.deleting) return;
    deleteDialog.open = false;
    deleteDialog.user = null;
}

async function submitDeleteDialog(): Promise<void> {
    if (!deleteDialog.user?.id) return;

    deleteDialog.deleting = true;
    try {
        await migrantUsersApi.deleteMigrant(deleteDialog.user.id);
        $q.notify({ type: 'positive', message: t('migrant.delete_success') });
        closeDeleteDialog();
        await loadData();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantManagementPage] delete failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        deleteDialog.deleting = false;
    }
}

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadData(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
        users.value = await migrantUsersApi.listMigrants();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantManagementPage] loadData failed', e);
        error.value = message;
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void loadData();
});
</script>

<style scoped>
.dialog-card-sm {
    width: 480px;
    max-width: 92vw;
}
</style>