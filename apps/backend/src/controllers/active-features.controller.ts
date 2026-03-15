// src/controllers/active-features.controller.ts
//
// PUBLIC endpoint — no auth required.
// Called at boot time by all three frontend apps (migrants, PA, NGO).
// Returns the same shape as the legacy /active-features view:
//   [{ features: ['KEY1', 'KEY2'] }]
//
import { get, response } from '@loopback/rest';
import { repository } from '@loopback/repository';
import { authenticate } from '@loopback/authentication';
import { FeatureFlagRepository } from '../repositories';

export class ActiveFeaturesController {
    constructor(
        @repository(FeatureFlagRepository)
        private flagRepo: FeatureFlagRepository,
    ) { }

    @get('/active-features')
    @authenticate.skip()
    @response(200, {
        description: 'Array of enabled feature flag keys — used by frontend boot',
        content: {
            'application/json': {
                schema: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { features: { type: 'array', items: { type: 'string' } } },
                    },
                },
            },
        },
    })
    async activeFeatures(): Promise<{ features: string[] }[]> {
        const enabled = await this.flagRepo.find({ where: { enabled: true } });
        const keys = enabled.map(f => f.flagKey);
        // Wrap in array to preserve legacy response shape: [{ features: [...] }]
        return [{ features: keys }];
    }
}