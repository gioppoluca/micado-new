import {authenticate} from '@loopback/authentication';
import {authorize} from '@loopback/authorization';
import {inject} from '@loopback/core';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';
import {get, post, requestBody} from '@loopback/rest';
import {
  CreateNgoOrganizationRequest,
  NgoOrganizationBootstrapService,
  NgoOrganizationSummary,
} from '../services/ngo-organization-bootstrap.service';

/**
 * PA-only bootstrap endpoints for NGO organizations.
 *
 * The backend talks to Keycloak as the technical super-admin and enforces the
 * segregation rules itself. This controller is intentionally small: for the
 * first increment the PA can list NGO groups and create a new NGO together
 * with its first administrator.
 */
@authenticate('keycloak')
@authorize({allowedRoles: ['admin']})
export class NgoOrganizationsAdminController {
  constructor(
    @inject('services.NgoOrganizationBootstrapService')
    private readonly ngoOrganizationBootstrapService: NgoOrganizationBootstrapService,
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) {}

  @get('/admin/pa/ngo-organizations', {
    responses: {
      '200': {
        description: 'List the NGO groups already provisioned in the ngo_frontoffice realm.',
      },
    },
  })
  async listOrganizations(): Promise<NgoOrganizationSummary[]> {
    this.logger.info('[NgoOrganizationsAdminController] listOrganizations');
    return this.ngoOrganizationBootstrapService.listOrganizations();
  }

  @post('/admin/pa/ngo-organizations', {
    responses: {
      '200': {
        description: 'Create the NGO group and its first ngo-admin user.',
      },
    },
  })
  async createOrganization(
    @requestBody({
      description: 'NGO organization bootstrap payload',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: [
              'displayName',
              'slug',
              'adminEmail',
              'adminFirstName',
              'adminLastName',
              'temporaryPassword',
            ],
            properties: {
              displayName: {type: 'string'},
              slug: {type: 'string'},
              adminEmail: {type: 'string'},
              adminFirstName: {type: 'string'},
              adminLastName: {type: 'string'},
              temporaryPassword: {type: 'string'},
              enabled: {type: 'boolean'},
            },
          },
        },
      },
    })
    body: CreateNgoOrganizationRequest,
  ): Promise<NgoOrganizationSummary> {
    this.logger.info('[NgoOrganizationsAdminController] createOrganization', {
      slug: body.slug,
      adminEmail: body.adminEmail,
    });

    return this.ngoOrganizationBootstrapService.createOrganizationWithAdmin(body);
  }
}
