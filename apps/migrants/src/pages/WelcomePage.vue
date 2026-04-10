<script setup lang="ts">
/**
 * src/pages/WelcomePage.vue
 *
 * One-shot welcome/landing page shown to first-time visitors.
 *
 * ── Behaviour ─────────────────────────────────────────────────────────────────
 *
 *   • Shown at the app root `/` unless localStorage('showWelcome') === 'false',
 *     in which case the router guard redirects straight to `/home`.
 *   • "Don't show this page again" checkbox writes to localStorage so repeat
 *     visits skip directly to the home page.
 *   • Content texts (info / guides / event / plan / doc) come from public
 *     settings (keys: welcome.info, welcome.guides, etc.) via useSettingsStore.
 *   • Root topics are displayed in a horizontal scroll strip (same as legacy).
 *   • "My Documents" and "Integration Plans" sections are visible only when
 *     feature flags FEAT_DOCUMENTS and FEAT_TASKS are active.
 *   • The page is fully public — no Keycloak authentication required.
 *
 * ── Legacy mapping ────────────────────────────────────────────────────────────
 *   Legacy: src/pages/LandingPage.vue (Vue 2 / Vuex / Options API)
 *   New   : src/pages/WelcomePage.vue  (Vue 3 / Pinia / Composition API)
 */

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useTopicStore } from 'src/stores/topic-store';
import { useSettingsStore } from 'src/stores/settings-store';
import { isEnabled } from 'src/features/feature-flipping';
import { logger } from 'src/services/Logger';

// ─── Stores ───────────────────────────────────────────────────────────────────

const { t } = useI18n();
const router = useRouter();
const topicStore = useTopicStore();
const settingsStore = useSettingsStore();


// ─── Local state ──────────────────────────────────────────────────────────────

/** Tracks whether the help dialog for a content-type section is open. */
const openDialog = ref<'info' | 'guides' | 'event' | 'doc' | 'plan' | null>(null);

/** The topic whose quick-info dialog is open. */
const openTopicId = ref<number | null>(null);

/** "Don't show again" checkbox value — initialised from localStorage. */
const skipWelcome = ref(localStorage.getItem('showWelcome') === 'false');

// ─── Computed ─────────────────────────────────────────────────────────────────

/** Only root-level topics (father = null) are shown on the welcome strip. */
const rootTopics = computed(() =>
    topicStore.topics.filter(t => t.father === null),
);

/** Texts sourced from public settings; empty string → hide block. */
const infoText = computed(() => settingsStore.get('welcome.info'));
const guidesText = computed(() => settingsStore.get('welcome.guides'));
const eventText = computed(() => settingsStore.get('welcome.event'));
const docText = computed(() => settingsStore.get('welcome.doc'));
const planText = computed(() => settingsStore.get('welcome.plan'));

/** Show authenticated-user sections only when feature flags permit. */
const hasLogin = computed(() => isEnabled('FEAT_MIGRANT_LOGIN'));
const hasDocs = computed(() => hasLogin.value && isEnabled('FEAT_DOCUMENTS'));
const hasTasks = computed(() => hasLogin.value && isEnabled('FEAT_TASKS'));
const showPrivate = computed(() => hasDocs.value || hasTasks.value);

// ─── Actions ──────────────────────────────────────────────────────────────────

function goHome(): void {
    void router.push('/home');
}

function navigateToTopic(topicId: number): void {
    logger.info('[WelcomePage] navigating to topic', { topicId });
    openTopicId.value = null;
    void router.push({ path: '/home', query: { topicId: String(topicId) } });
}

/** Persist the user's "skip welcome" preference. */
function onSkipChange(val: boolean): void {
    localStorage.setItem('showWelcome', val ? 'false' : 'true');
    logger.info('[WelcomePage] showWelcome preference saved', { skip: val });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
    logger.info('[WelcomePage] mounted');
    // Topics and settings may already be loaded by loadData boot; fetch only if missing.
    if (topicStore.topics.length === 0) {
        await topicStore.fetchAll();
    }
    if (settingsStore.settings.length === 0) {
        await settingsStore.fetchAll();
    }
});
</script>

<template>
    <q-page class="welcome-page">

        <!-- ── Hero illustration ─────────────────────────────────────────────── -->
        <div class="welcome-hero row justify-center q-pt-md q-pb-sm">
            <img src="~assets/micado-logo.png" alt="Micado" class="welcome-logo" />
        </div>

        <!-- ── CTA button ─────────────────────────────────────────────────────── -->
        <div class="row justify-center items-center q-mb-lg q-gutter-sm">
            <q-btn unelevated rounded color="primary" icon="play_arrow" :label="t('welcome.start')" class="welcome-cta"
                no-caps @click="goHome" />
        </div>

        <!-- ── How does this app work? ───────────────────────────────────────── -->
        <div class="welcome-section-header row items-center q-px-md q-py-sm">
            <span class="col text-weight-bold">{{ t('welcome.howItWorks') }}</span>
        </div>

        <!-- ── Topics text ────────────────────────────────────────────────────── -->
        <div class="q-px-md q-pt-md q-pb-sm text-body2">
            {{ t('welcome.topicContent') }}
        </div>

        <!-- ── Root topics horizontal scroll ─────────────────────────────────── -->
        <q-scroll-area v-if="rootTopics.length" style="height: 120px;" class="q-px-sm q-mb-md">
            <div class="row no-wrap q-gutter-sm q-px-sm">
                <div v-for="topic in rootTopics" :key="topic.id" class="topic-chip column items-center justify-center"
                    @click="openTopicId = topic.id">
                    <q-icon :name="topic.icon ?? 'label'" size="28px" color="secondary" class="q-mb-xs" />
                    <div class="topic-chip-label ellipsis text-center">{{ topic.topic }}</div>

                    <!-- Quick-info dialog for the topic -->
                    <q-dialog :model-value="openTopicId === topic.id" @hide="openTopicId = null">
                        <q-card style="min-width: 280px; max-width: 90vw;">
                            <q-card-section class="row items-center q-pb-none">
                                <q-icon :name="topic.icon ?? 'label'" color="primary" size="2rem" class="q-mr-sm" />
                                <div class="text-h6">{{ topic.topic }}</div>
                                <q-space />
                                <q-btn icon="close" flat round dense v-close-popup />
                            </q-card-section>
                            <q-card-section class="text-body2 text-grey-8">
                                {{ topic.description ?? '' }}
                            </q-card-section>
                            <q-card-actions align="right">
                                <q-btn flat color="primary" :label="t('welcome.explore')" no-caps
                                    @click="navigateToTopic(topic.id)" />
                            </q-card-actions>
                        </q-card>
                    </q-dialog>
                </div>
            </div>
        </q-scroll-area>

        <q-separator class="q-mx-md q-mb-md" color="orange-4" />

        <!-- ── Content category section ──────────────────────────────────────── -->
        <div class="q-px-md q-pb-sm text-body2">
            {{ t('welcome.categoryContent') }}
        </div>

        <div class="row justify-center q-gutter-md q-px-md q-mb-md">

            <!-- Basic Information -->
            <div class="content-box column items-center justify-center" @click="openDialog = 'info'">
                <q-icon name="info" size="32px" color="primary" class="q-mb-xs" />
                <div class="content-box-label text-center">{{ t('menu.info') }}</div>
            </div>

            <!-- Step-by-Step Instructions (Processes) -->
            <div class="content-box column items-center justify-center" @click="openDialog = 'guides'">
                <q-icon name="linear_scale" size="32px" color="primary" class="q-mb-xs" />
                <div class="content-box-label text-center">{{ t('menu.guides') }}</div>
            </div>

            <!-- Events & Courses -->
            <div class="content-box column items-center justify-center" @click="openDialog = 'event'">
                <q-icon name="event" size="32px" color="primary" class="q-mb-xs" />
                <div class="content-box-label text-center">{{ t('menu.events') }}</div>
            </div>
        </div>

        <!-- ── Help dialogs for content types ────────────────────────────────── -->
        <q-dialog :model-value="openDialog === 'info'" @hide="openDialog = null">
            <q-card style="min-width: 280px; max-width: 90vw;">
                <q-card-section class="row items-center q-pb-none">
                    <q-icon name="info" color="primary" size="2rem" class="q-mr-sm" />
                    <div class="text-h6">{{ t('menu.info') }}</div>
                    <q-space /><q-btn icon="close" flat round dense v-close-popup />
                </q-card-section>
                <q-card-section class="text-body2">
                    {{ infoText || t('welcome.defaultInfoText') }}
                </q-card-section>
            </q-card>
        </q-dialog>

        <q-dialog :model-value="openDialog === 'guides'" @hide="openDialog = null">
            <q-card style="min-width: 280px; max-width: 90vw;">
                <q-card-section class="row items-center q-pb-none">
                    <q-icon name="linear_scale" color="primary" size="2rem" class="q-mr-sm" />
                    <div class="text-h6">{{ t('menu.guides') }}</div>
                    <q-space /><q-btn icon="close" flat round dense v-close-popup />
                </q-card-section>
                <q-card-section class="text-body2">
                    {{ guidesText || t('welcome.defaultGuidesText') }}
                </q-card-section>
            </q-card>
        </q-dialog>

        <q-dialog :model-value="openDialog === 'event'" @hide="openDialog = null">
            <q-card style="min-width: 280px; max-width: 90vw;">
                <q-card-section class="row items-center q-pb-none">
                    <q-icon name="event" color="primary" size="2rem" class="q-mr-sm" />
                    <div class="text-h6">{{ t('menu.events') }}</div>
                    <q-space /><q-btn icon="close" flat round dense v-close-popup />
                </q-card-section>
                <q-card-section class="text-body2">
                    {{ eventText || t('welcome.defaultEventText') }}
                </q-card-section>
            </q-card>
        </q-dialog>

        <q-separator class="q-mx-md q-mb-md" color="orange-4" />

        <!-- ── Authenticated features (Documents + Plans) ─────────────────────── -->
        <template v-if="showPrivate">
            <div class="q-px-md q-pb-sm text-body2">
                {{ t('welcome.loginContent') }}
            </div>

            <div class="row justify-center q-gutter-md q-px-md q-mb-md">
                <div v-if="hasDocs" class="content-box content-box--wide column items-center justify-center"
                    @click="openDialog = 'doc'">
                    <q-icon name="folder" size="32px" color="accent" class="q-mb-xs" />
                    <div class="content-box-label text-center">{{ t('menu.documents') }}</div>
                </div>
                <div v-if="hasTasks" class="content-box content-box--wide column items-center justify-center"
                    @click="openDialog = 'plan'">
                    <q-icon name="assignment" size="32px" color="accent" class="q-mb-xs" />
                    <div class="content-box-label text-center">{{ t('menu.integration_plan') }}</div>
                </div>
            </div>

            <q-dialog :model-value="openDialog === 'doc'" @hide="openDialog = null">
                <q-card style="min-width: 280px; max-width: 90vw;">
                    <q-card-section class="row items-center q-pb-none">
                        <q-icon name="folder" color="accent" size="2rem" class="q-mr-sm" />
                        <div class="text-h6">{{ t('menu.documents') }}</div>
                        <q-space /><q-btn icon="close" flat round dense v-close-popup />
                    </q-card-section>
                    <q-card-section class="text-body2">
                        {{ docText || t('welcome.defaultDocText') }}
                    </q-card-section>
                </q-card>
            </q-dialog>

            <q-dialog :model-value="openDialog === 'plan'" @hide="openDialog = null">
                <q-card style="min-width: 280px; max-width: 90vw;">
                    <q-card-section class="row items-center q-pb-none">
                        <q-icon name="assignment" color="accent" size="2rem" class="q-mr-sm" />
                        <div class="text-h6">{{ t('menu.integration_plan') }}</div>
                        <q-space /><q-btn icon="close" flat round dense v-close-popup />
                    </q-card-section>
                    <q-card-section class="text-body2">
                        {{ planText || t('welcome.defaultPlanText') }}
                    </q-card-section>
                </q-card>
            </q-dialog>

            <q-separator class="q-mx-md q-mb-md" color="orange-4" />
        </template>

        <!-- ── "Don't show this page again" ──────────────────────────────────── -->
        <div class="row items-center q-px-md q-pb-xl">
            <q-checkbox v-model="skipWelcome" color="accent" @update:model-value="onSkipChange" />
            <span class="q-ml-sm text-body2 text-grey-7">
                {{ t('welcome.noLandingPage') }}
            </span>
        </div>

    </q-page>
</template>

<style scoped lang="scss">
.welcome-page {
    max-width: 480px;
    margin: 0 auto;
}

.welcome-hero {
    padding-top: 16px;
}

.welcome-logo {
    max-width: 220px;
    width: 100%;
}

.welcome-cta {
    min-width: 250px;
    font-size: 16px;
    font-weight: bold;
}

// Blue banner — "How does this app work?"
.welcome-section-header {
    background-color: $primary;
    color: white;
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 4px;
}

// ── Topic chip (horizontal scroll strip) ────────────────────────────────────

.topic-chip {
    min-width: 90px;
    max-width: 90px;
    height: 90px;
    border: 0.5px solid $secondary;
    border-radius: 5px;
    background-color: #fafafa;
    padding: 8px 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: box-shadow 0.15s;

    &:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }
}

.topic-chip-label {
    color: $secondary;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    max-width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

// ── Content type boxes ───────────────────────────────────────────────────────

.content-box {
    min-width: 95px;
    max-width: 95px;
    height: 95px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: white;
    cursor: pointer;
    transition: box-shadow 0.15s, transform 0.1s;
    padding: 8px;

    &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        transform: translateY(-1px);
    }

    &--wide {
        min-width: 150px;
        max-width: 150px;
    }
}

.content-box-label {
    font-size: 12px;
    font-weight: 600;
    color: #555;
    line-height: 1.2;
}
</style>