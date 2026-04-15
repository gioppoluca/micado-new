import { BindingScope, inject, injectable } from '@loopback/core';
import { HttpErrors } from '@loopback/rest';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { fetch } from 'undici';

export interface AnalyticsAppDescriptor {
  key: string;
  label: string;
  websiteId: string;
}

export interface UsageQuery {
  appKey: string;
  range?: '24h' | '7d' | '30d' | '90d' | '12m';
  startAt?: number;
  endAt?: number;
  timezone?: string;
}

export interface UsageDashboardDto {
  app: { key: string; label: string };
  period: {
    range: string;
    unit: 'hour' | 'day' | 'month' | 'year';
    timezone: string;
    startAt: number;
    endAt: number;
  };
  summary: Record<string, unknown>;
  active: { visitors: number };
  series: {
    pageviews: Array<{ x: string; y: number }>;
    sessions: Array<{ x: string; y: number }>;
  };
  breakdowns: {
    pages: Array<Record<string, unknown>>;
    referrers: Array<Record<string, unknown>>;
    countries: Array<Record<string, unknown>>;
    browsers: Array<Record<string, unknown>>;
    devices: Array<Record<string, unknown>>;
    languages: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
  };
  realtime: Record<string, unknown>;
}

interface UmamiAuthState {
  token: string;
  expiresAt: number;
}

@injectable({ scope: BindingScope.SINGLETON })
export class UmamiAnalyticsService {
  private authState?: UmamiAuthState;

  constructor(
    @inject(LoggingBindings.WINSTON_LOGGER)
    protected logger: WinstonLogger,
  ) { }

  listApps(): AnalyticsAppDescriptor[] {
    return this.readConfiguredApps().map(app => ({ ...app }));
  }

  async getDashboard(query: UsageQuery): Promise<UsageDashboardDto> {
    const app = this.findAppOrFail(query.appKey);
    const period = this.resolvePeriod(query);

    this.logger.info('[UmamiAnalyticsService.getDashboard] loading usage dashboard', {
      appKey: app.key,
      websiteId: app.websiteId,
      startAt: period.startAt,
      endAt: period.endAt,
      unit: period.unit,
      timezone: period.timezone,
    });

    const [summary, active, series, pages, referrers, countries, browsers, devices, languages, events, realtime] = await Promise.all([
      this.getJson(`/api/websites/${app.websiteId}/stats`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
      }),
      this.getJson(`/api/websites/${app.websiteId}/active`),
      this.getJson(`/api/websites/${app.websiteId}/pageviews`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        unit: period.unit,
        timezone: period.timezone,
        compare: 'prev',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'path',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'referrer',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'country',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'browser',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'device',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'language',
        limit: '10',
      }),
      this.getJson(`/api/websites/${app.websiteId}/metrics/expanded`, {
        startAt: String(period.startAt),
        endAt: String(period.endAt),
        type: 'event',
        limit: '10',
      }),
      this.getJson(`/api/realtime/${app.websiteId}`),
    ]);

    return {
      app: { key: app.key, label: app.label },
      period,
      summary: summary as Record<string, unknown>,
      active: {
        visitors: Number((active as { visitors?: number })?.visitors ?? 0),
      },
      series: {
        pageviews: Array.isArray((series as { pageviews?: unknown[] })?.pageviews)
          ? (series as { pageviews: Array<{ x: string; y: number }> }).pageviews
          : [],
        sessions: Array.isArray((series as { sessions?: unknown[] })?.sessions)
          ? (series as { sessions: Array<{ x: string; y: number }> }).sessions
          : [],
      },
      breakdowns: {
        pages: this.ensureArray(pages),
        referrers: this.ensureArray(referrers),
        countries: this.ensureArray(countries),
        browsers: this.ensureArray(browsers),
        devices: this.ensureArray(devices),
        languages: this.ensureArray(languages),
        events: this.ensureArray(events),
      },
      realtime: typeof realtime === 'object' && realtime !== null ? realtime as Record<string, unknown> : {},
    };
  }

  protected readConfiguredApps(): AnalyticsAppDescriptor[] {
    const fromJson = process.env.UMAMI_APPS_JSON?.trim();
    if (fromJson) {
      try {
        const parsed = JSON.parse(fromJson) as AnalyticsAppDescriptor[];
        return parsed.filter(item => item?.key && item?.label && item?.websiteId);
      } catch (error: unknown) {
        this.logger.error('[UmamiAnalyticsService] invalid UMAMI_APPS_JSON', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw new HttpErrors.InternalServerError('Invalid UMAMI_APPS_JSON configuration');
      }
    }

    // Env var names must match docker-compose: UMAMI_{APP}_WEBSITE_ID / UMAMI_{APP}_NAME
    const apps: AnalyticsAppDescriptor[] = [
      {
        key: 'migrants',
        label: process.env.UMAMI_MIGRANTS_NAME ?? 'Migrants',
        websiteId: process.env.UMAMI_MIGRANTS_WEBSITE_ID ?? '',
      },
      {
        key: 'pa',
        label: process.env.UMAMI_PA_NAME ?? 'PA Frontoffice',
        websiteId: process.env.UMAMI_PA_WEBSITE_ID ?? '',
      },
      {
        key: 'ngo',
        label: process.env.UMAMI_NGO_NAME ?? 'NGO Frontoffice',
        websiteId: process.env.UMAMI_NGO_WEBSITE_ID ?? '',
      },
    ].filter(item => item.websiteId);

    if (!apps.length) {
      throw new HttpErrors.InternalServerError('No Umami websites configured');
    }

    return apps;
  }

  protected findAppOrFail(appKey: string): AnalyticsAppDescriptor {
    const app = this.readConfiguredApps().find(item => item.key === appKey);
    if (!app) {
      throw new HttpErrors.NotFound(`Umami app '${appKey}' is not configured`);
    }
    return app;
  }

  protected resolvePeriod(query: UsageQuery): UsageDashboardDto['period'] {
    const timezone = query.timezone ?? process.env.UMAMI_TIMEZONE ?? 'Europe/Rome';

    if (query.startAt && query.endAt) {
      const diff = Math.max(query.endAt - query.startAt, 1);
      return {
        range: 'custom',
        timezone,
        startAt: query.startAt,
        endAt: query.endAt,
        unit: this.unitFromDiff(diff),
      };
    }

    const range = query.range ?? '30d';
    const endAt = Date.now();
    const startAt = endAt - this.rangeToMs(range);

    return {
      range,
      timezone,
      startAt,
      endAt,
      unit: this.unitFromRange(range),
    };
  }

  protected rangeToMs(range: NonNullable<UsageQuery['range']>): number {
    switch (range) {
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case '30d': return 30 * 24 * 60 * 60 * 1000;
      case '90d': return 90 * 24 * 60 * 60 * 1000;
      case '12m': return 365 * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }

  protected unitFromRange(range: NonNullable<UsageQuery['range']>): UsageDashboardDto['period']['unit'] {
    switch (range) {
      case '24h': return 'hour';
      case '12m': return 'month';
      default: return 'day';
    }
  }

  protected unitFromDiff(diffMs: number): UsageDashboardDto['period']['unit'] {
    const oneDay = 24 * 60 * 60 * 1000;
    if (diffMs <= oneDay * 2) return 'hour';
    if (diffMs >= oneDay * 180) return 'month';
    return 'day';
  }

  protected ensureArray(input: unknown): Array<Record<string, unknown>> {
    return Array.isArray(input) ? input as Array<Record<string, unknown>> : [];
  }

  protected async getJson(path: string, query?: Record<string, string>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('[UmamiAnalyticsService.getJson] upstream Umami error', {
        path,
        status: response.status,
        body,
      });
      throw new HttpErrors.BadGateway(`Umami request failed for ${path}`);
    }

    return response.json();
  }

  protected async getAccessToken(): Promise<string> {
    if (this.authState && this.authState.expiresAt > Date.now()) {
      return this.authState.token;
    }

    const baseUrl = this.getBaseUrl();
    // Credentials env var names match docker-compose: UMAMI_URL / UMAMI_ADMIN_USERNAME / UMAMI_ADMIN_PASSWORD
    const username = process.env.UMAMI_ADMIN_USERNAME;
    const password = process.env.UMAMI_ADMIN_PASSWORD;

    if (!username || !password) {
      throw new HttpErrors.InternalServerError('Umami credentials are not configured');
    }

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('[UmamiAnalyticsService.getAccessToken] authentication failed', {
        status: response.status,
        body,
      });
      throw new HttpErrors.BadGateway('Unable to authenticate against Umami');
    }

    const payload = await response.json() as { token?: string };
    if (!payload.token) {
      throw new HttpErrors.BadGateway('Umami authentication response did not include a token');
    }

    this.authState = {
      token: payload.token,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    return payload.token;
  }

  protected getBaseUrl(): string {
    // docker-compose exposes the Umami internal URL as UMAMI_URL
    const baseUrl = process.env.UMAMI_URL?.replace(/\/$/, '');
    if (!baseUrl) {
      throw new HttpErrors.InternalServerError('UMAMI_URL is not configured');
    }
    return baseUrl;
  }

  protected buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.getBaseUrl()}${path}`);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }
}