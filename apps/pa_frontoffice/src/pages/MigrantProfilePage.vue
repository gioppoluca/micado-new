<template>
    <q-page padding>
        <!-- ── Breadcrumb / back ── -->
        <div class="row items-center q-mb-md q-gutter-sm">
            <q-btn flat dense no-caps icon="arrow_back" :label="t('migrant.back_to_list')"
                @click="() => router.push({ name: 'migrant-management' })" />
            <q-breadcrumbs class="text-grey-7">
                <q-breadcrumbs-el :label="t('migrant.title')" />
                <q-breadcrumbs-el :label="migrantLabel" />
                <q-breadcrumbs-el :label="t('migrant.profile_data')" />
            </q-breadcrumbs>
        </div>

        <!-- ── Loading skeleton ── -->
        <div v-if="loading" class="row flex-center q-pa-xl">
            <q-spinner-dots size="40px" color="primary" />
        </div>

        <template v-else-if="migrant">
            <!-- ── Identity card (read-only — from Keycloak) ── -->
            <q-card flat bordered class="q-mb-md">
                <q-card-section class="row items-center q-col-gutter-md">
                    <div class="col-auto">
                        <q-avatar size="72px" color="blue-2" text-color="blue-9" icon="person" />
                    </div>
                    <div class="col">
                        <div class="text-h6">{{ fullName(migrant) }}</div>
                        <div class="text-body2 text-grey-7">{{ migrant.email }}</div>
                        <div class="row q-mt-sm q-gutter-sm">
                            <q-badge :color="migrant.enabled ? 'positive' : 'grey-6'" rounded>
                                {{ migrant.enabled ? t('migrant.enabled') : t('migrant.disabled') }}
                            </q-badge>
                            <q-badge v-if="migrant.emailVerified" color="blue-6" rounded>
                                email verified
                            </q-badge>
                        </div>
                    </div>
                    <!-- Quick action: go to plans -->
                    <div class="col-auto">
                        <q-btn unelevated rounded no-caps color="info" icon="assignment"
                            :label="t('migrant.integration_plans')"
                            @click="() => router.push({ name: 'migrant-plans', params: { migrantId }, state: { migrantName: migrantLabel } })" />
                    </div>
                </q-card-section>

                <q-separator />

                <q-card-section>
                    <div class="row q-col-gutter-md text-body2">
                        <div class="col-12 col-md-4">
                            <div class="text-grey-7 text-caption">{{ t('input_labels.name') }}</div>
                            <div>{{ migrant.firstName || '—' }}</div>
                        </div>
                        <div class="col-12 col-md-4">
                            <div class="text-grey-7 text-caption">{{ t('pa_users.last_name') }}</div>
                            <div>{{ migrant.lastName || '—' }}</div>
                        </div>
                        <div class="col-12 col-md-4">
                            <div class="text-grey-7 text-caption">{{ t('migrant.registered') }}</div>
                            <div>{{ migrant.createdTimestamp ? formatDate(migrant.createdTimestamp) : '—' }}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="text-grey-7 text-caption">{{ t('input_labels.email') }}</div>
                            <div>{{ migrant.email || '—' }}</div>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="text-grey-7 text-caption">username</div>
                            <div class="text-caption text-grey-8">{{ migrant.username || '—' }}</div>
                        </div>
                        <div class="col-12">
                            <div class="text-grey-7 text-caption">Keycloak ID</div>
                            <div class="text-caption text-mono text-grey-8">{{ migrant.id }}</div>
                        </div>
                    </div>
                </q-card-section>
            </q-card>

            <!-- ── PA Internal notes ── -->
            <q-card flat bordered>
                <q-card-section>
                    <div class="text-subtitle2 q-mb-sm">{{ t('migrant.notes') }}</div>
                    <div class="text-caption text-grey-7 q-mb-md">{{ t('migrant.notes_help') }}</div>
                    <q-input v-model="notes" outlined type="textarea" autogrow :label="t('migrant.notes')"
                        :disable="!canEdit" />
                </q-card-section>
                <q-card-actions v-if="canEdit" align="right">
                    <q-btn color="accent" unelevated rounded no-caps :label="t('button.save')" :loading="savingNotes"
                        @click="() => { void saveNotes(); }" />
                </q-card-actions>
            </q-card>
        </template>

        <!-- ── Error ── -->
        <q-banner v-if="error" class="bg-negative text-white q-mt-md" rounded>
            <template #avatar><q-icon name="error" /></template>
            {{ error }}
        </q-banner>
    </q-page>
</template>

<script setup lang="ts">
/**
 * MigrantProfilePage
 *
 * Route: /migrant/:migrantId/profile
 *
 * Displays migrant identity data fetched from Keycloak (read-only)
 * plus a PA-internal notes field backed by migrant_profile.notes in the DB.
 *
 * Note: documents management will be added as a separate sub-section
 * once the document model is migrated.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { migrantUsersApi, type MigrantUser } from 'src/api';
import { useAuthStore } from 'src/stores/auth-store';
import { logger } from 'src/services/Logger';

const { t } = useI18n();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const migrantId = route.params.migrantId as string;
const migrantLabel = ref<string>(
    (history.state?.migrantName as string | undefined) ?? migrantId,
);

const canEdit = computed(() =>
    auth.hasRole('pa_admin') || auth.hasRole('pa_operator'),
);

// ── State ──────────────────────────────────────────────────────────────────────
const loading = ref(false);
const error = ref<string | null>(null);
const migrant = ref<MigrantUser | null>(null);
const notes = ref('');
const savingNotes = ref(false);

// ── Helpers ────────────────────────────────────────────────────────────────────

function fullName(user: MigrantUser): string {
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.email || user.username || '—';
}

function formatDate(epochMs: number): string {
    return new Date(epochMs).toLocaleDateString();
}

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadData(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
        migrant.value = await migrantUsersApi.getMigrant(migrantId);
        migrantLabel.value = fullName(migrant.value);

        // Load PA internal notes from migrant_profile
        const savedNotes = await migrantUsersApi.getNotes(migrantId);
        notes.value = savedNotes ?? '';
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantProfilePage] loadData failed', e);
        error.value = message;
    } finally {
        loading.value = false;
    }
}

/**
 * Saves PA internal notes via PATCH /admin/migrants/users/:id/notes.
 * The migrant_profile anchor row is created lazily if not yet present.
 */
async function saveNotes(): Promise<void> {
    savingNotes.value = true;
    try {
        await migrantUsersApi.updateNotes(migrantId, notes.value);
        $q.notify({ type: 'positive', message: t('migrant.notes_saved') });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('[MigrantProfilePage] saveNotes failed', e);
        $q.notify({ color: 'negative', message });
    } finally {
        savingNotes.value = false;
    }
}

onMounted(() => { void loadData(); });
</script>