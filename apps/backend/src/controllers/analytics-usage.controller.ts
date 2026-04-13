import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { get, param } from '@loopback/rest';
import { inject, service } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import {
  AnalyticsAppDescriptor,
  UmamiAnalyticsService,
  UsageDashboardDto,
  UsageQuery,
} from '../services/umami-analytics.service';

const RANGE_SCHEMA = {
  type: 'string' as const,
  enum: ['24h', '7d', '30d', '90d', '12m'],
};

@authenticate('keycloak')
export class AnalyticsUsageController {
  constructor(
    @service(UmamiAnalyticsService)
    protected umamiAnalyticsService: UmamiAnalyticsService,

    @inject(LoggingBindings.WINSTON_LOGGER)
    protected logger: WinstonLogger,
  ) {}

  @get('/analytics/usage/apps', {
    responses: {
      '200': {
        description: 'Configured analytics applications mapped to Umami website ids',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                required: ['key', 'label'],
                properties: {
                  key: {type: 'string'},
                  label: {type: 'string'},
                  websiteId: {type: 'string'},
                },
              },
            },
          },
        },
      },
    },
  })
  @authorize({allowedRoles: ['micado_superadmin', 'pa_admin', 'ngo_admin']})
  async listApps(): Promise<AnalyticsAppDescriptor[]> {
    return this.umamiAnalyticsService.listApps().map(({key, label}) => ({key, label, websiteId: ''}));
  }

  @get('/analytics/usage', {
    responses: {
      '200': {
        description: 'Aggregated usage dashboard for one application backed by Umami',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              required: ['app', 'period', 'summary', 'active', 'series', 'breakdowns', 'realtime'],
            },
          },
        },
      },
    },
  })
  @authorize({allowedRoles: ['micado_superadmin', 'pa_admin', 'ngo_admin']})
  async getUsage(
    @param.query.string('appKey') appKey: string,
    @param.query.string('range', RANGE_SCHEMA) range?: UsageQuery['range'],
    @param.query.number('startAt') startAt?: number,
    @param.query.number('endAt') endAt?: number,
    @param.query.string('timezone') timezone?: string,
  ): Promise<UsageDashboardDto> {
    this.logger.info('[AnalyticsUsageController.getUsage]', {appKey, range, startAt, endAt, timezone});

    return this.umamiAnalyticsService.getDashboard({
      appKey,
      range,
      startAt,
      endAt,
      timezone,
    });
  }
}
