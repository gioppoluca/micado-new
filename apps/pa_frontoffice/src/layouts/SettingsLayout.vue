<template>
    <!--
    SettingsLayout — secondary navigation layout for the /data_settings section.

    Migrated from: DataSettings.vue (legacy name was misleading — it was a layout,
    not a data component).

    Architecture:
      This component is mounted as the parent of all /data_settings/* routes.
      It renders a secondary left drawer containing the settings sub-navigation,
      plus a <router-view> that renders whichever child page is currently active.

      The main application sidebar (MainLayout) stays visible — this adds a
      second, narrower drawer that sits inside the page-container area, giving
      the settings section its own navigation panel without replacing the global
      app chrome.

    Navigation structure (mirrors legacy DataSettings.vue):
      Expandable group — "Data management" (role-gated per item):
        • Document types
        • Intervention categories
        • Intervention types
        • Topics
        • User types
      Flat items (individually role-gated):
        • Settings (function configuration)   — superadmin only
        • Survey management                   — superadmin only
        • Translations / language             — admin+
        • PA user management                  — superadmin only
        • Profile settings                    — all authenticated
        • Privacy policy                      — all authenticated

    Role migration note:
      Legacy used "Application/micado_superadmin" style strings from the old
      auth plugin.  New app uses raw Keycloak role names via auth-store.hasRole().
  -->
    <q-layout view="lHh lpr lFf" container style="height: 100vh">

        <!-- ── Secondary settings drawer ─────────────────────────────────────── -->
        <q-drawer v-model="drawerOpen" show-if-above bordered :width="220" :breakpoint="700"
            :content-style="{ backgroundColor: '#DCE4E8', border: 'none' }">
            <q-scroll-area class="fit">
                <q-list>

                    <!-- Expandable: Data management sub-items ───────────────────────── -->
                    <q-separator />
                    <q-expansion-item :label="t('data_settings.data_management')" default-opened expand-separator
                        header-class="settings-group-header">
                        <q-item v-for="item in dataManagementItems" :key="item.labelKey"
                            :data-cy="item.labelKey.replace('.', '_')" :disable="!canAccess(item.path)" clickable
                            :to="'/data_settings' + item.path" active-class="settings-link-active"
                            class="settings-sub-item">
                            <q-item-section>{{ t(item.labelKey) }}</q-item-section>
                        </q-item>
                    </q-expansion-item>
                    <q-separator />

                    <!-- Flat items ───────────────────────────────────────────────────── -->
                    <q-item v-for="item in flatItems" :key="item.labelKey" :data-cy="item.labelKey.replace('.', '_')"
                        :disable="!canAccess(item.path)" clickable
                        :to="'/data_settings' + item.path" active-class="settings-link-active"
                        class="settings-flat-item">
                        <q-item-section>{{ t(item.labelKey) }}</q-item-section>
                    </q-item>

                </q-list>
            </q-scroll-area>
        </q-drawer>

        <!-- ── Child page ─────────────────────────────────────────────────────── -->
        <q-page-container>
            <router-view />
        </q-page-container>

    </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from 'src/stores/auth-store';

const { t } = useI18n();
const auth   = useAuthStore();
const router = useRouter();

const drawerOpen = ref(true);

// ── Nav item types ─────────────────────────────────────────────────────────
// Roles are intentionally NOT stored here — they are read from route meta
// so that routes.ts is the single source of truth.

interface SettingsNavItem {
    labelKey: string;
    /** Path segment appended to /data_settings, e.g. '/user_types' */
    path: string;
}

// ── Expandable "Data management" group ────────────────────────────────────

const dataManagementItems: SettingsNavItem[] = [
    { labelKey: 'data_settings.document_types',          path: '/document_types' },
    { labelKey: 'data_settings.event_categories',        path: '/event_categories' },
    { labelKey: 'data_settings.intervention_categories', path: '/intervention_categories' },
    { labelKey: 'data_settings.intervention_types',      path: '/intervention_types' },
    { labelKey: 'data_settings.topics',                  path: '/topics' },
    { labelKey: 'data_settings.user_types',              path: '/user_types' },
];

// ── Flat items ────────────────────────────────────────────────────────────

const flatItems: SettingsNavItem[] = [
    { labelKey: 'data_settings.settings',         path: '/settings' },
    { labelKey: 'data_settings.surveymanagement', path: '/survey' },
    { labelKey: 'data_settings.translations',     path: '/language' },
    { labelKey: 'data_settings.usermgmt',         path: '/usermgmt' },
    { labelKey: 'data_settings.profile_settings', path: '/profile_settings' },
    { labelKey: 'data_settings.privacy_policy',   path: '/privacy' },
];

// ── Role check ────────────────────────────────────────────────────────────
// Reads required roles from route meta — no duplication with routes.ts.

function canAccess(path: string): boolean {
    const resolved = router.resolve('/data_settings' + path);
    const roles = resolved.meta?.['roles'] as string[] | undefined;
    if (!roles?.length) return true;
    return roles.some(role => auth.hasRole(role));
}
</script>

<style scoped>
.settings-group-header {
    font-weight: bold;
    font-size: 14px;
    background-color: #dce4e8;
}

.settings-sub-item {
    font-weight: normal;
    font-size: 14px;
    padding-left: 24px;
}

.settings-flat-item {
    font-weight: bold;
    font-size: 14px;
    background-color: #dce4e8;
}

.settings-link-active {
    color: white;
    background: #0b91ce;
}
</style>