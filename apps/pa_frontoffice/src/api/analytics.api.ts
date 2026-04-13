import {logger} from 'src/services/Logger';
import {apiGet} from './client';

export type UsageRange = '24h' | '7d' | '30d' | '90d' | '12m';

export interface AnalyticsApp {
  key: string;
  label: string;
}

export interface UsageMetricPoint {
  x: string;
  y: number;
}

export interface UsageBreakdownRow {
  name: string;
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totalTime: number;
  bounceRate: number;
  avgVisitTime: number;
}

export interface UsageDashboard {
  app: AnalyticsApp;
  period: {
    range: UsageRange;
    unit: 'hour' | 'day' | 'month';
    timezone: string;
    startAt: number;
    endAt: number;
  };
  summary: {
    pageviews: number;
    visitors: number;
    visits: number;
    bounces: number;
    totalTime: number;
    bounceRate: number;
    avgVisitTime: number;
    comparison?: {
      pageviews?: number;
      visitors?: number;
      visits?: number;
      bounces?: number;
      totalTime?: number;
    };
  };
  active: {visitors: number};
  series: {
    pageviews: UsageMetricPoint[];
    sessions: UsageMetricPoint[];
  };
  breakdowns: {
    pages: UsageBreakdownRow[];
    referrers: UsageBreakdownRow[];
    countries: UsageBreakdownRow[];
    browsers: UsageBreakdownRow[];
    devices: UsageBreakdownRow[];
    languages: UsageBreakdownRow[];
    events: UsageBreakdownRow[];
  };
}

export const analyticsApi = {
  async listApps(): Promise<AnalyticsApp[]> {
    logger.info('[analytics.api] listApps');
    return apiGet<AnalyticsApp[]>('/analytics/usage/apps');
  },

  async getUsage(appKey: string, range: UsageRange, timezone?: string): Promise<UsageDashboard> {
    logger.info('[analytics.api] getUsage', {appKey, range, timezone});
    return apiGet<UsageDashboard>('/analytics/usage', {
      params: {
        appKey,
        range,
        timezone,
      },
    });
  },
};
