<template>
    <q-page padding>

        <!-- ── Header ─────────────────────────────────────────────────────────── -->
        <div class="row items-center q-col-gutter-md q-mb-md">
            <div class="col">
                <div class="text-h5 q-mb-xs">{{ t('menu.cso') }}</div>
                <div class="text-body2 text-grey-7">{{ t('menu.cso_description') }}</div>
            </div>
            <div class="col-auto row q-gutter-sm">
                <q-btn flat no-caps icon="refresh" :label="t('button.refresh')" :loading="loading"
                    @click="() => { void loadData(); }" />
                <q-btn color="info" unelevated rounded no-caps icon="domain_add" :label="t('ngo.addNgo')"
                    @click="openCreateOrgDialog" />
            </div>
        </div>

        <!-- ── Error banner ───────────────────────────────────────────────────── -->
        <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ error }}
            <template #action>
                <q-btn flat color="white" :label="t('button.cancel')" @click="error = null" />
            </template>
        </q-banner>

        <!-- ── Organizations table ───────────────────────────────────────────── -->
        <q-card flat bordered>
            <q-card-section class="row items-center">
                <div class="col text-subtitle2 text-grey-8">{{ t('ngo.ngoName') }}</div>
                <div class="col-auto text-body2 text-grey-6">
                    {{ t('pa_users.total_users', { count: organizations.length }) }}
                </div>
            </q-card-section>
            <q-separator />

            <q-table flat :rows="organizations" :columns="orgColumns" row-key="groupId" :loading="loading"
                :pagination="pagination" binary-state-sort>
                <template #loading>
                    <q-inner-loading showing>
                        <q-spinner-dots size="40px" color="primary" />
                    </q-inner-loading>
                </template>

                <template #body-cell-displayName="props">
                    <q-td :props="props">
                        <div class="text-weight-medium">{{ props.row.displayName }}</div>
                        <div class="text-caption text-grey-6">{{ props.row.slug }}</div>
                    </q-td>
                </template>

                <template #body-cell-adminEmail="props">
                    <q-td :props="props">
                        {{ props.row.adminEmail || '—' }}
                    </q-td>
                </template>

                <template #no-data>
                    <div class="full-width row flex-center q-gutter-sm q-pa-lg text-grey-7">
                        <q-icon name="domain_disabled" size="28px" />
                        <span>{{ t('ngo.no_orgs_found') }}</span>
                    </div>
                </template>
            </q-table>
        </q-card>

        <!-- ── Create organization dialog ───────────────────────────────────── -->
        <q-dialog v-model="createOrgDialog.open" persistent>
            <q-card class="dialog-card">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6">{{ t('ngo.addNgo') }}</div>
                    <q-space />
                    <q-btn flat round dense icon="close" @click="closeCreateOrgDialog" />
                </q-card-section>

                <q-card-section>
                    <div class="row q-col-gutter-md">
                        <!-- Organisation identity -->
                        <div class="col-12">
                            <q-input v-model.trim="createOrgDialog.form.displayName" outlined dense
                                :label="t('ngo.ngoName')" autocomplete="off" />
                        </div>
                        <div class="col-12">
                            <q-input v-model.trim="createOrgDialog.form.slug" outlined dense
                                label="Slug (URL-safe identifier)" autocomplete="off"
                                hint="Lowercase letters, digits and hyphens only. Used as a unique key." />
                        </div>
                        <q-separator class="col-12" />
                        <!-- First admin account -->
                        <div class="col-12 text-subtitle2 text-grey-7">
                            {{ t('ngo.firstAdminLabel') }}
                        </div>
                        <div class="col-12">
                            <q-input v-model.trim="createOrgDialog.form.adminEmail" outlined dense type="email"
                                :label="t('ngo.adminMail')" autocomplete="off" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model.trim="createOrgDialog.form.adminFirstName" outlined dense
                                :label="t('ngo.adminName')" autocomplete="off" />
                        </div>
                        <div class="col-12 col-md-6">
                            <q-input v-model.trim="createOrgDialog.form.adminLastName" outlined dense
                                :label="t('ngo.adminSurname')" autocomplete="off" />
                        </div>
                        <div class="col-12">
                            <q-input v-model="createOrgDialog.form.temporaryPassword" outlined dense
                                :type="createOrgDialog.showPassword ? 'text' : 'password'" :label="t('ngo.adminPwd')"
                                autocomplete="new-password">
                                <template #append>
                                    <q-icon :name="createOrgDialog.showPassword ? 'visibility_off' : 'visibility'"
                                        class="cursor-pointer"
                                        @click="createOrgDialog.showPassword = !createOrgDialog.showPassword" />
                                </template>
                            </q-input>
                            <div class="text-caption text-grey-7 q-mt-xs">
                                {{ t('pa_users.password_help') }}
                            </div>
                        </div>
                        <div class="col-12">
                            <q-toggle v-model="createOrgDialog.form.enabled" color="accent"
                                :label="t('pa_users.user_enabled')" />
                        </div>
                    </div>
                </q-card-section>

                <q-card-actions align="right">
                    <q-btn flat no-caps :label="t('button.cancel')" @click="closeCreateOrgDialog" />
                    <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')"
                        :loading="createOrgDialog.saving" @click="() => { void submitCreateOrgDialog(); }" />
                </q-card-actions>
            </q-card>
        </q-dialog>

    </q-page>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableProps } from 'quasar';
import { ngoOrganizationsApi, type NgoOrganization } from 'src/api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();

// ── State ─────────────────────────────────────────────────────────────────────

const loading = ref(false);
const error = ref<string | null>(null);
const organizations = ref<NgoOrganization[]>([]);

const pagination = ref({ rowsPerPage: 15 });

// ── Table columns ─────────────────────────────────────────────────────────────

const orgColumns: QTableProps['columns'] = [
    {
        name: 'displayName',
        label: t('ngo.ngoName'),
        field: 'displayName',
        align: 'left',
        sortable: true,
    },
    {
        name: 'adminEmail',
        label: t('ngo.adminMail'),
        field: 'adminEmail',
        align: 'left',
        sortable: true,
    },
];

// ── Create org dialog ─────────────────────────────────────────────────────────

function emptyOrgForm() {
    return {
        displayName: '',
        slug: '',
        adminEmail: '',
        adminFirstName: '',
        adminLastName: '',
        temporaryPassword: '',
        enabled: true,
    };
}

const createOrgDialog = reactive({
    open: false,
    saving: false,
    showPassword: false,
    form: emptyOrgForm(),
});

function openCreateOrgDialog(): void {
    createOrgDialog.form = emptyOrgForm();
    createOrgDialog.showPassword = false;
    createOrgDialog.open = true;
}

function closeCreateOrgDialog(): void {
    if (createOrgDialog.saving) return;
    createOrgDialog.open = false;
}

async function submitCreateOrgDialog(): Promise<void> {
    const f = createOrgDialog.form;
    if (
        !f.displayName ||
        !f.slug ||
        !f.adminEmail ||
        !f.adminFirstName ||
        !f.adminLastName ||
        !f.temporaryPassword
    ) {
        $q.notify({ color: 'negative', message: t('warning.req_fields') });
        return;
    }

    createOrgDialog.saving = true;
    try {
        const created = await ngoOrganizationsApi.createOrganization({
            displayName: f.displayName.trim(),
            slug: f.slug.trim(),
            adminEmail: f.adminEmail.trim().toLowerCase(),
            adminFirstName: f.adminFirstName.trim(),
            adminLastName: f.adminLastName.trim(),
            temporaryPassword: f.temporaryPassword,
            enabled: f.enabled,
        });

        organizations.value = [...organizations.value, created].sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
        );

        $q.notify({ type: 'positive', message: t('ngo.create_success') });
        createOrgDialog.open = false;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[CsoManagementPage] createOrganization failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        createOrgDialog.saving = false;
    }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const orgs = await ngoOrganizationsApi.listOrganizations();
        organizations.value = [...orgs].sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
        );
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[CsoManagementPage] loadData failed', e);
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
.dialog-card {
    width: 680px;
    max-width: 92vw;
}
</style>