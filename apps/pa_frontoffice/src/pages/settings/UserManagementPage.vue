<template>
  <q-page padding>
    <div class="row items-center q-col-gutter-md q-mb-md">
      <div class="col">
        <div class="text-h5 q-mb-xs">{{ t('data_settings.usermgmt') }}</div>
        <div class="text-body2 text-grey-7">
          {{ t('pa_users.subtitle') }}
        </div>
      </div>
      <div class="col-auto row q-gutter-sm">
        <q-btn flat no-caps icon="refresh" :label="t('button.refresh')" :loading="loading"
          @click="() => { void loadData(); }" />
        <q-btn color="info" unelevated rounded no-caps icon="person_add" :label="t('pa_users.add_person')"
          @click="openCreateDialog" />
      </div>
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ error }}
      <template #action>
        <q-btn flat color="white" :label="t('button.cancel')" @click="error = null" />
      </template>
    </q-banner>

    <q-card flat bordered>
      <q-card-section class="row items-center q-col-gutter-md">
        <div class="col-12 col-md-6">
          <q-input v-model="search" outlined dense clearable debounce="250" :label="t('input_labels.search')">
            <template #prepend>
              <q-icon name="search" />
            </template>
          </q-input>
        </div>
        <div class="col-12 col-md-6 text-body2 text-grey-7 text-right">
          {{ t('pa_users.total_users', { count: filteredUsers.length }) }}
        </div>
      </q-card-section>

      <q-separator />

      <q-table flat :rows="filteredUsers" :columns="columns" row-key="id" :loading="loading" :pagination="pagination"
        binary-state-sort>
        <template #loading>
          <q-inner-loading showing>
            <q-spinner-dots size="40px" color="primary" />
          </q-inner-loading>
        </template>

        <template #body-cell-user="props">
          <q-td :props="props">
            <div class="text-weight-medium">{{ fullName(props.row) }}</div>
            <div class="text-caption text-grey-7">{{ props.row.email || props.row.username || '—' }}</div>
          </q-td>
        </template>

        <template #body-cell-status="props">
          <q-td :props="props" class="text-center">
            <q-badge :color="props.row.enabled ? 'positive' : 'grey-6'" rounded>
              {{ props.row.enabled ? t('pa_users.enabled') : t('pa_users.disabled') }}
            </q-badge>
          </q-td>
        </template>

        <template #body-cell-roles="props">
          <q-td :props="props">
            <div class="row q-gutter-xs">
              <q-chip v-for="role in roleNamesForUser(props.row.id)" :key="`${props.row.id}-${role}`" dense size="sm"
                color="blue-1" text-color="blue-9">
                {{ role }}
              </q-chip>
              <span v-if="roleNamesForUser(props.row.id).length === 0" class="text-caption text-grey-6">—</span>
            </div>
          </q-td>
        </template>

        <template #body-cell-actions="props">
          <q-td :props="props" class="text-right">
            <div class="row justify-end q-gutter-xs no-wrap">
              <q-btn flat round dense icon="manage_accounts" :title="t('pa_users.manage_roles')"
                @click="openRolesDialog(props.row)" />
              <q-btn flat round dense color="negative" icon="delete" :title="t('button.delete')"
                @click="openDeleteDialog(props.row)" />
            </div>
          </q-td>
        </template>

        <template #no-data>
          <div class="full-width row flex-center q-gutter-sm q-pa-lg text-grey-7">
            <q-icon name="group_off" size="28px" />
            <span>{{ t('pa_users.no_users_found') }}</span>
          </div>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="createDialog.open" persistent>
      <q-card class="dialog-card">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ t('pa_users.add_person') }}</div>
          <q-space />
          <q-btn flat round dense icon="close" @click="closeCreateDialog" />
        </q-card-section>

        <q-card-section>
          <div class="row q-col-gutter-md">
            <div class="col-12">
              <q-input v-model.trim="createDialog.form.email" outlined dense type="email"
                :label="t('input_labels.email')" autocomplete="off" />
            </div>
            <div class="col-12 col-md-6">
              <q-input v-model.trim="createDialog.form.firstName" outlined dense :label="t('input_labels.name')"
                autocomplete="off" />
            </div>
            <div class="col-12 col-md-6">
              <q-input v-model.trim="createDialog.form.lastName" outlined dense :label="t('pa_users.last_name')"
                autocomplete="off" />
            </div>
            <div class="col-12">
              <q-input v-model="createDialog.form.password" outlined dense
                :type="createDialog.showPassword ? 'text' : 'password'" :label="t('pa_users.temporary_password')"
                autocomplete="new-password">
                <template #append>
                  <q-icon :name="createDialog.showPassword ? 'visibility_off' : 'visibility'" class="cursor-pointer"
                    @click="createDialog.showPassword = !createDialog.showPassword" />
                </template>
              </q-input>
              <div class="text-caption text-grey-7 q-mt-xs">
                {{ t('pa_users.password_help') }}
              </div>
            </div>
            <div class="col-12">
              <q-select v-model="createDialog.form.roles" outlined dense use-chips multiple emit-value map-options
                :options="roleOptions" :label="t('pa_users.roles')" />
            </div>
            <div class="col-12">
              <q-toggle v-model="createDialog.form.enabled" color="accent" :label="t('pa_users.user_enabled')" />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('button.cancel')" @click="closeCreateDialog" />
          <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')" :loading="createDialog.saving"
            @click="() => { void submitCreateDialog(); }" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="rolesDialog.open" persistent>
      <q-card class="dialog-card">
        <q-card-section class="row items-center q-pb-none">
          <div>
            <div class="text-h6">{{ t('pa_users.manage_roles') }}</div>
            <div class="text-caption text-grey-7">{{ rolesDialog.user?.email || rolesDialog.user?.username }}</div>
          </div>
          <q-space />
          <q-btn flat round dense icon="close" @click="closeRolesDialog" />
        </q-card-section>

        <q-card-section>
          <q-select v-model="rolesDialog.selectedRoles" outlined dense use-chips multiple emit-value map-options
            :options="roleOptions" :label="t('pa_users.roles')" />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('button.cancel')" @click="closeRolesDialog" />
          <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')" :loading="rolesDialog.saving"
            @click="() => { void submitRolesDialog(); }" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="deleteDialog.open" persistent>
      <q-card class="dialog-card-sm">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon name="warning" color="negative" size="28px" />
          <div class="text-h6">{{ t('pa_users.delete_person') }}</div>
        </q-card-section>
        <q-card-section>
          {{ t('pa_users.delete_confirmation', {
            user: deleteDialog.user?.email || deleteDialog.user?.username || fullName(deleteDialog.user),
          }) }}
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar, type QTableProps } from 'quasar';
import { paUsersApi, type CreatePaUserPayload, type KeycloakRealmRole, type PaUser } from 'src/api';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();

const loading = ref(false);
const error = ref<string | null>(null);
const search = ref('');
const users = ref<PaUser[]>([]);
const roles = ref<KeycloakRealmRole[]>([]);
const userRolesMap = ref<Record<string, string[]>>({});

const pagination = ref({
  rowsPerPage: 15,
  sortBy: 'email',
  descending: false,
});

const columns: QTableProps['columns'] = [
  {
    name: 'user',
    label: t('pa_users.user'),
    field: (row: PaUser) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || row.email || row.username || '',
    align: 'left',
    sortable: true,
  },
  {
    name: 'status',
    label: t('pa_users.status'),
    field: (row: PaUser) => row.enabled ? t('pa_users.enabled') : t('pa_users.disabled'),
    align: 'center',
    sortable: true,
  },
  {
    name: 'roles',
    label: t('pa_users.roles'),
    field: (row: PaUser) => roleNamesForUser(row.id).join(', '),
    align: 'left',
    sortable: true,
  },
  {
    name: 'actions',
    label: t('pa_users.actions'),
    field: 'id',
    align: 'right',
    sortable: false,
  },
];

const roleOptions = computed(() =>
  roles.value
    .filter((role) => !!role.name)
    .map((role) => ({
      label: role.name as string,
      value: role.name as string,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const filteredUsers = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return users.value;

  return users.value.filter((user) => {
    const haystack = [
      user.email,
      user.username,
      user.firstName,
      user.lastName,
      ...roleNamesForUser(user.id),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(term);
  });
});

const createDialog = reactive({
  open: false,
  saving: false,
  showPassword: false,
  form: createEmptyCreateForm(),
});

const rolesDialog = reactive<{
  open: boolean;
  saving: boolean;
  user: PaUser | null;
  selectedRoles: string[];
}>({
  open: false,
  saving: false,
  user: null,
  selectedRoles: [],
});

const deleteDialog = reactive<{
  open: boolean;
  deleting: boolean;
  user: PaUser | null;
}>({
  open: false,
  deleting: false,
  user: null,
});

function createEmptyCreateForm(): CreatePaUserPayload {
  return {
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    roles: [],
    enabled: true,
  };
}

function fullName(user: PaUser | null | undefined): string {
  if (!user) return '';
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email || user.username || '—';
}

function roleNamesForUser(userId?: string): string[] {
  if (!userId) return [];
  return userRolesMap.value[userId] ?? [];
}

async function loadData(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const [userRows, realmRoles] = await Promise.all([
      paUsersApi.listUsers(),
      paUsersApi.listRoles(),
    ]);

    users.value = [...userRows].sort((a, b) =>
      (a.email || a.username || '').localeCompare(b.email || b.username || ''),
    );
    roles.value = realmRoles;

    const roleEntries = await Promise.all(
      users.value.map(async (user) => {
        const currentRoles = await paUsersApi.getUserRoles(user.id);
        return [
          user.id,
          currentRoles
            .map((role) => role.name)
            .filter((role): role is string => !!role)
            .sort((a, b) => a.localeCompare(b)),
        ] as const;
      }),
    );

    userRolesMap.value = Object.fromEntries(roleEntries);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[UserManagementPage] loadData failed', e);
    error.value = message;
  } finally {
    loading.value = false;
  }
}

function openCreateDialog(): void {
  createDialog.form = createEmptyCreateForm();
  createDialog.showPassword = false;
  createDialog.open = true;
}

function closeCreateDialog(): void {
  if (createDialog.saving) return;
  createDialog.open = false;
}

async function submitCreateDialog(): Promise<void> {
  const payload = {
    ...createDialog.form,
    email: createDialog.form.email.trim().toLowerCase(),
    firstName: createDialog.form.firstName.trim(),
    lastName: createDialog.form.lastName.trim(),
  };

  if (!payload.email || !payload.firstName || !payload.lastName || !payload.password) {
    $q.notify({ color: 'negative', message: t('warning.req_fields') });
    return;
  }

  createDialog.saving = true;

  try {
    await paUsersApi.createUser(payload);
    createDialog.open = false;
    $q.notify({ type: 'positive', message: t('pa_users.create_success') });
    await loadData();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[UserManagementPage] create user failed', e);
    $q.notify({ color: 'negative', message });
  } finally {
    createDialog.saving = false;
  }
}

function openRolesDialog(user: PaUser): void  {
  rolesDialog.user = user;
  rolesDialog.selectedRoles = [...roleNamesForUser(user.id)];
  rolesDialog.open = true;
}

function closeRolesDialog(): void {
  if (rolesDialog.saving) return;
  rolesDialog.open = false;
  rolesDialog.user = null;
  rolesDialog.selectedRoles = [];
}

async function submitRolesDialog(): Promise<void> {
  if (!rolesDialog.user?.id) return;

  rolesDialog.saving = true;
  try {
    await paUsersApi.updateUserRoles(rolesDialog.user.id, {
      roles: [...rolesDialog.selectedRoles].sort((a, b) => a.localeCompare(b)),
    });
    userRolesMap.value = {
      ...userRolesMap.value,
      [rolesDialog.user.id]: [...rolesDialog.selectedRoles].sort((a, b) => a.localeCompare(b)),
    };
    $q.notify({ type: 'positive', message: t('pa_users.roles_update_success') });
    closeRolesDialog();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[UserManagementPage] update roles failed', e);
    $q.notify({ color: 'negative', message });
  } finally {
    rolesDialog.saving = false;
  }
}

function openDeleteDialog(user: PaUser): void {
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
    await paUsersApi.removeUser(deleteDialog.user.id);
    $q.notify({ type: 'positive', message: t('pa_users.delete_success') });
    closeDeleteDialog();
    await loadData();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[UserManagementPage] delete user failed', e);
    $q.notify({ color: 'negative', message });
  } finally {
    deleteDialog.deleting = false;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<style scoped>
.dialog-card {
  width: 720px;
  max-width: 92vw;
}

.dialog-card-sm {
  width: 480px;
  max-width: 92vw;
}
</style>
