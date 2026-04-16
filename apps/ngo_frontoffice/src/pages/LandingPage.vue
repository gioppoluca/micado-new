<template>
    <q-page padding>

        <!-- ── Not authenticated ─────────────────────────────────────────────── -->
        <div v-if="!auth.authenticated" class="column items-center justify-center" style="min-height: 60vh;">
            <q-icon name="translate" size="4rem" color="primary" class="q-mb-md" />
            <div class="text-h5 q-mb-sm">Welcome to Micado PA</div>
            <div class="text-body2 text-grey-7 q-mb-lg">Please log in to continue</div>
            <q-btn color="primary" icon="login" label="Login with Keycloak" unelevated rounded size="lg"
                :loading="loginLoading" @click="doLogin" />
        </div>

        <!-- ── Authenticated ─────────────────────────────────────────────────── -->
        <template v-else>

            <!-- Header -->
            <div class="row items-center q-mb-lg">
                <q-icon name="translate" size="2rem" color="primary" class="q-mr-sm" />
                <div class="text-h5">Select your language</div>
                <q-space />
                <q-btn flat round icon="refresh" :loading="langStore.loading" title="Reload languages" @click="load" />
            </div>

            <!-- Error banner -->
            <q-banner v-if="langStore.error" class="bg-negative text-white q-mb-md" rounded dense>
                <template #avatar>
                    <q-icon name="error_outline" />
                </template>
                {{ langStore.error }}
                <template #action>
                    <q-btn flat label="Retry" @click="load" />
                </template>
            </q-banner>

            <!-- Loading skeletons -->
            <div v-if="langStore.loading" class="row q-gutter-md">
                <q-card v-for="n in 6" :key="n" flat bordered class="language-card">
                    <q-card-section class="column items-center q-gutter-sm">
                        <q-skeleton type="circle" size="48px" />
                        <q-skeleton type="text" width="80px" />
                        <q-skeleton type="text" width="60px" />
                    </q-card-section>
                </q-card>
            </div>

            <!-- Language grid -->
            <div v-else-if="langStore.activeLanguages.length" class="row q-gutter-md">
                <q-card v-for="lang in langStore.activeLanguages" :key="lang.lang" flat bordered clickable
                    class="language-card" :class="{ 'language-card--selected': langStore.selected?.lang === lang.lang }"
                    @click="selectLanguage(lang)">
                    <q-card-section class="column items-center q-gutter-xs">
                        <!-- Language code as avatar -->
                        <q-avatar color="primary" text-color="white" size="48px">
                            {{ lang.lang.toUpperCase() }}
                        </q-avatar>
                        <div class="text-subtitle1 text-weight-medium text-center">
                            {{ lang.name }}
                        </div>
                        <div v-if="lang.isoCode" class="text-caption text-grey-6">
                            {{ lang.isoCode }}
                        </div>
                        <q-badge v-if="lang.isDefault" color="positive" label="default" />
                    </q-card-section>
                </q-card>
            </div>

            <!-- Empty state -->
            <div v-else class="column items-center q-mt-xl text-grey-6">
                <q-icon name="language" size="3rem" class="q-mb-sm" />
                <div>No active languages configured.</div>
            </div>

        </template>
    </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth-store';
import { useLanguageStore } from '../stores/language-store';
import type { Language } from '../api/language.api';
import { logger } from '../services/Logger';

const auth = useAuthStore();
const langStore = useLanguageStore();
const router = useRouter();
const loginLoading = ref(false);

// ── Load languages once the user is authenticated ────────────────────────────
async function load(): Promise<void> {
    if (!auth.authenticated) return;
    logger.info('[LandingPage] loading languages');
    await langStore.fetchAll({ active: true });
}

// ── Keycloak login ────────────────────────────────────────────────────────────
async function doLogin(): Promise<void> {
    loginLoading.value = true;
    try {
        // Redirect back to this page after login
        await auth.login(window.location.href);
    } finally {
        // Keycloak will navigate away; this just guards against UI flicker
        loginLoading.value = false;
    }
}

// ── Language selection ────────────────────────────────────────────────────────
function selectLanguage(lang: Language): void {
    langStore.select(lang);
    logger.info('[LandingPage] language selected', { lang: lang.lang });
    // Navigate to the main app with the selected language
    void router.push({ path: '/', query: { lang: lang.lang } });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
    void load();
});
</script>

<style scoped lang="scss">
.language-card {
    width: 140px;
    cursor: pointer;
    transition: box-shadow 0.2s, transform 0.15s;

    &:hover {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        transform: translateY(-2px);
    }

    &--selected {
        outline: 2px solid var(--q-primary);
        outline-offset: 2px;
    }
}
</style>