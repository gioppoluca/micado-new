<template>
  <q-page padding>
    <div class="row items-center q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-auto">
        <div class="text-h5">{{ t('analytics.title') }}</div>
        <div class="text-caption text-grey-7">{{ t('analytics.subtitle') }}</div>
      </div>
      <q-space />
      <div class="col-12 col-md-auto">
        <q-btn flat round icon="refresh" :loading="loading" @click="refreshCurrent">
          <q-tooltip>{{ t('analytics.refresh') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <q-banner v-if="error" rounded class="bg-negative text-white q-mb-md">
      <template #avatar><q-icon name="error" /></template>
      {{ error }}
    </q-banner>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="q-pb-none">
        <q-tabs v-model="selectedAppKey" dense no-caps active-color="accent" indicator-color="accent" inline-label
          @update:model-value="onAppChanged">
          <q-tab v-for="app in apps" :key="app.key" :name="app.key" :label="app.label" icon="analytics" />
        </q-tabs>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="row q-col-gutter-sm items-center">
          <div class="col-12 col-md-auto text-subtitle2">{{ t('analytics.period') }}</div>
          <div class="col-12 col-md">
            <q-btn-toggle v-model="selectedRange" spread no-caps unelevated toggle-color="accent"
              :options="rangeOptions" @update:model-value="onRangeChanged" />
          </div>
          <div class="col-12 col-md-auto text-caption text-grey-7">
            {{ formattedPeriod }}
          </div>
        </div>
      </q-card-section>
    </q-card>

    <div v-if="loading && !dashboard" class="row justify-center q-py-xl">
      <q-spinner size="48px" color="accent" />
    </div>

    <template v-else-if="dashboard">
      <div class="row q-col-gutter-md q-mb-md">
        <div v-for="card in summaryCards" :key="card.key" class="col-12 col-sm-6 col-lg-3">
          <q-card flat bordered class="dashboard-card full-height">
            <q-card-section>
              <div class="text-caption text-grey-7">{{ card.label }}</div>
              <div class="text-h5 q-mt-xs">{{ card.value }}</div>
              <div class="text-caption text-grey-7 q-mt-sm">{{ card.helper }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-12 col-lg-8">
          <q-card flat bordered class="full-height">
            <q-card-section>
              <div class="text-subtitle1">{{ t('analytics.series_title') }}</div>
              <div class="text-caption text-grey-7 q-mb-md">{{ t('analytics.series_description') }}</div>

              <div class="series-chart">
                <div v-for="point in pageviewBars" :key="point.x" class="series-bar-wrap">
                  <div class="series-bar-label">{{ point.label }}</div>
                  <div class="series-bar-track">
                    <div class="series-bar-fill" :style="{ width: `${point.width}%` }" />
                  </div>
                  <div class="series-bar-value">{{ formatNumber(point.y) }}</div>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <div class="col-12 col-lg-4">
          <q-card flat bordered class="full-height">
            <q-card-section>
              <div class="text-subtitle1">{{ t('analytics.realtime_title') }}</div>
              <div class="text-caption text-grey-7 q-mb-md">{{ t('analytics.realtime_description') }}</div>
              <div class="text-h3">{{ formatNumber(dashboard.active.visitors) }}</div>
              <div class="text-body2 text-grey-8">{{ t('analytics.active_users_now') }}</div>
              <q-separator class="q-my-md" />
              <div class="text-caption text-grey-7">{{ t('analytics.current_app') }}</div>
              <div class="text-subtitle1">{{ dashboard.app.label }}</div>
              <div class="text-caption text-grey-7 q-mt-sm">{{ dashboard.period.timezone }}</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <div class="row q-col-gutter-md">
        <div v-for="section in breakdownSections" :key="section.key" class="col-12 col-xl-6">
          <q-card flat bordered>
            <q-card-section>
              <div class="text-subtitle1">{{ section.title }}</div>
              <div class="text-caption text-grey-7 q-mb-md">{{ section.description }}</div>

              <q-markup-table flat separator="horizontal" dense wrap-cells>
                <thead>
                  <tr>
                    <th class="text-left">{{ t('analytics.table_dimension') }}</th>
                    <th class="text-right">{{ t('analytics.table_pageviews') }}</th>
                    <th class="text-right">{{ t('analytics.table_visitors') }}</th>
                    <th class="text-right">{{ t('analytics.table_visits') }}</th>
                    <th class="text-right">{{ t('analytics.table_bounce_rate') }}</th>
                    <th class="text-right">{{ t('analytics.table_avg_time') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in section.rows" :key="`${section.key}-${row.name}`">
                    <td class="text-left">{{ row.name || '—' }}</td>
                    <td class="text-right">{{ formatNumber(row.pageviews) }}</td>
                    <td class="text-right">{{ formatNumber(row.visitors) }}</td>
                    <td class="text-right">{{ formatNumber(row.visits) }}</td>
                    <td class="text-right">{{ formatPercent(row.bounceRate) }}</td>
                    <td class="text-right">{{ formatDuration(row.avgVisitTime) }}</td>
                  </tr>
                  <tr v-if="section.rows.length === 0">
                    <td colspan="6" class="text-center text-grey-6">{{ t('analytics.no_data') }}</td>
                  </tr>
                </tbody>
              </q-markup-table>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { analyticsApi, type AnalyticsApp, type UsageBreakdownRow, type UsageDashboard, type UsageRange } from 'src/api';
import { logger } from 'src/services/Logger';
import { trackEvent } from 'src/services/analytics';

const { t, locale } = useI18n();

const apps = ref<AnalyticsApp[]>([]);
const selectedAppKey = ref<string>('');
const selectedRange = ref<UsageRange>('30d');
const dashboard = ref<UsageDashboard | null>(null);
const loading = ref(false);
const error = ref('');

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';

const rangeOptions = computed(() => [
  { label: t('analytics.range_24h'), value: '24h' },
  { label: t('analytics.range_7d'), value: '7d' },
  { label: t('analytics.range_30d'), value: '30d' },
  { label: t('analytics.range_90d'), value: '90d' },
  { label: t('analytics.range_12m'), value: '12m' },
]);

const formattedPeriod = computed(() => {
  if (!dashboard.value) return '';
  const fmt = new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' });
  return `${fmt.format(new Date(dashboard.value.period.startAt))} → ${fmt.format(new Date(dashboard.value.period.endAt))}`;
});

const summaryCards = computed(() => {
  const data = dashboard.value;
  if (!data) return [];

  return [
    {
      key: 'pageviews',
      label: t('analytics.card_pageviews'),
      value: formatNumber(data.summary.pageviews),
      helper: t('analytics.card_pageviews_helper'),
    },
    {
      key: 'visitors',
      label: t('analytics.card_visitors'),
      value: formatNumber(data.summary.visitors),
      helper: t('analytics.card_visitors_helper'),
    },
    {
      key: 'visits',
      label: t('analytics.card_visits'),
      value: formatNumber(data.summary.visits),
      helper: t('analytics.card_visits_helper'),
    },
    {
      key: 'bounces',
      label: t('analytics.card_bounces'),
      value: formatNumber(data.summary.bounces),
      helper: formatPercent(data.summary.bounceRate),
    },
    {
      key: 'avg',
      label: t('analytics.card_avg_time'),
      value: formatDuration(data.summary.avgVisitTime),
      helper: t('analytics.card_avg_time_helper'),
    },
    {
      key: 'active',
      label: t('analytics.card_active_now'),
      value: formatNumber(data.active.visitors),
      helper: t('analytics.card_active_now_helper'),
    },
  ];
});

type UsageSeriesPoint = UsageDashboard['series']['pageviews'][number];

const pageviewBars = computed(() => {
  const points: UsageSeriesPoint[] = dashboard.value?.series.pageviews ?? [];
  const max = Math.max(...points.map((point: UsageSeriesPoint) => point.y), 0);

  return points.slice(-12).map((point: UsageSeriesPoint) => ({
    ...point,
    label: compactPointLabel(point.x),
    width: max > 0 ? Math.max(4, Math.round((point.y / max) * 100)) : 0,
  }));
});

const breakdownSections = computed(() => {
  const data = dashboard.value;
  if (!data) return [];

  return [
    {
      key: 'pages',
      title: t('analytics.section_pages'),
      description: t('analytics.section_pages_description'),
      rows: data.breakdowns.pages,
    },
    {
      key: 'referrers',
      title: t('analytics.section_referrers'),
      description: t('analytics.section_referrers_description'),
      rows: data.breakdowns.referrers,
    },
    {
      key: 'countries',
      title: t('analytics.section_countries'),
      description: t('analytics.section_countries_description'),
      rows: data.breakdowns.countries,
    },
    {
      key: 'browsers',
      title: t('analytics.section_browsers'),
      description: t('analytics.section_browsers_description'),
      rows: data.breakdowns.browsers,
    },
    {
      key: 'devices',
      title: t('analytics.section_devices'),
      description: t('analytics.section_devices_description'),
      rows: data.breakdowns.devices,
    },
    {
      key: 'languages',
      title: t('analytics.section_languages'),
      description: t('analytics.section_languages_description'),
      rows: data.breakdowns.languages,
    },
    {
      key: 'events',
      title: t('analytics.section_events'),
      description: t('analytics.section_events_description'),
      rows: data.breakdowns.events,
    },
  ] as Array<{ key: string; title: string; description: string; rows: UsageBreakdownRow[] }>;
});

onMounted(async () => {
  await loadApps();
});

async function loadApps() {
  loading.value = true;
  error.value = '';

  try {
    apps.value = await analyticsApi.listApps();
    if (apps.value.length > 0) {
      selectedAppKey.value = apps.value[0]?.key ?? '';
      await fetchDashboard();
    }
  } catch (err) {
    logger.error('[UsageDashboardPage] loadApps failed', err);
    error.value = extractMessage(err);
  } finally {
    loading.value = false;
  }
}

async function fetchDashboard() {
  if (!selectedAppKey.value) return;

  loading.value = true;
  error.value = '';

  try {
    dashboard.value = await analyticsApi.getUsage(selectedAppKey.value, selectedRange.value, timezone);
    trackEvent('analytics-dashboard-view', {
      appKey: selectedAppKey.value,
      range: selectedRange.value,
    });
  } catch (err) {
    logger.error('[UsageDashboardPage] fetchDashboard failed', err);
    error.value = extractMessage(err);
  } finally {
    loading.value = false;
  }
}

function onAppChanged() {
  void fetchDashboard();
}

function onRangeChanged() {
  void fetchDashboard();
}

function refreshCurrent() {
  void fetchDashboard();
}

function formatNumber(value: number | undefined): string {
  return new Intl.NumberFormat(locale.value).format(value ?? 0);
}

function formatPercent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatDuration(seconds: number | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;

  if (minutes === 0) return `${remainder}s`;
  if (minutes < 60) return `${minutes}m ${remainder}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function compactPointLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    ...(dashboard.value?.period.unit === 'hour' ? { hour: '2-digit' } : {}),
  }).format(d);
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return t('analytics.generic_error');
}
</script>

<style scoped>
.dashboard-card {
  min-height: 132px;
}

.series-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.series-bar-wrap {
  display: grid;
  grid-template-columns: 92px 1fr 72px;
  gap: 12px;
  align-items: center;
}

.series-bar-label,
.series-bar-value {
  font-size: 0.85rem;
}

.series-bar-track {
  position: relative;
  height: 12px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.series-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--q-accent);
}
</style>
