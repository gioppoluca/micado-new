import { authenticate } from '@loopback/authentication';
import { authorize } from '@loopback/authorization';
import { inject } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { del, get, param, post, put, requestBody } from '@loopback/rest';
import {
  CreateNgoOrganizationRequest,
  NgoOrganizationBootstrapService,
  NgoOrganizationSummary,
} from '../services/ngo-organization-bootstrap.service';
import {
  CreateNgoUserInput,
  NgoUserManagementService,
  NgoUserSummaryDto,
  ReplaceNgoUserRolesInput,
} from '../services/ngo-user-management.service';
import { SecurityBindings, UserProfile } from '@loopback/security';

/**
 * PA-only bootstrap endpoints for NGO organizations.
 *
 * Authorization matrix:
 * ┌────────────────────────────────────────────────┬─────────────────────┐
 * │ Endpoint                                       │ Required role       │
 * ├────────────────────────────────────────────────┼─────────────────────┤
 * │ GET  /admin/pa/ngo-organizations               │ pa_admin            │
 * │ POST /admin/pa/ngo-organizations               │ pa_admin            │
 * │ GET  /admin/ngo/users                          │ ngo-admin           │
 * │ POST /admin/ngo/users                          │ ngo-admin           │
 * │ GET  /admin/ngo/users/:id                      │ ngo-admin           │
 * │ PUT  /admin/ngo/users/:id/roles                │ ngo-admin           │
 * │ DEL  /admin/ngo/users/:id                      │ ngo-admin           │
 * └────────────────────────────────────────────────┴─────────────────────┘
 *
 * Segregation: ngo-admin endpoints read the caller's group from the JWT
 * (via NgoUserManagementService) and scope all Keycloak queries to that
 * group, so an ngo-admin of org A can never see or touch users of org B.
 */

// ── Shared response schemas ─────────────────────────────────────────────────

const NGO_ORG_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    groupId: { type: 'string' },
    groupName: { type: 'string' },
    displayName: { type: 'string' },
    slug: { type: 'string' },
    adminUserId: { type: 'string' },
    adminEmail: { type: 'string' },
  },
};

const NGO_USER_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['id', 'roles'],
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    enabled: { type: 'boolean' },
    emailVerified: { type: 'boolean' },
    roles: { type: 'array', items: { type: 'string' } },
    groupId: { type: 'string' },
  },
};

// ── PA-scoped controller (organization bootstrap) ───────────────────────────

@authenticate('keycloak')
@authorize({ allowedRoles: ['pa_admin'] }) // was incorrectly 'admin'
export class NgoOrganizationsAdminController {
  constructor(
    @inject('services.NgoOrganizationBootstrapService')
    private readonly ngoOrganizationBootstrapService: NgoOrganizationBootstrapService,
    @inject('services.NgoUserManagementService')
    private readonly ngoUserManagementService: NgoUserManagementService,
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) { }

  // ── Organization bootstrap (PA admin only) ─────────────────────────────────

  @get('/admin/pa/ngo-organizations', {
    responses: {
      '200': {
        description: 'List NGO groups already provisioned in the ngo_frontoffice realm.',
        content: {
          'application/json': {
            schema: { type: 'array', items: NGO_ORG_RESPONSE_SCHEMA },
          },
        },
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
        content: {
          'application/json': { schema: NGO_ORG_RESPONSE_SCHEMA },
        },
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
              displayName: { type: 'string' },
              slug: { type: 'string' },
              contactEmail: { type: 'string', format: 'email' },
              adminEmail: { type: 'string', format: 'email' },
              adminFirstName: { type: 'string' },
              adminLastName: { type: 'string' },
              temporaryPassword: { type: 'string', minLength: 8 },
              enabled: { type: 'boolean' },
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

  // ── NGO user management (ngo-admin only, group-scoped) ─────────────────────
  //
  // These endpoints are intentionally on a SEPARATE path prefix (/admin/ngo/*)
  // to signal that they operate from the NGO realm perspective.  The ngo-admin
  // JWT is verified by KeycloakJwtStrategy against the ngo_frontoffice realm;
  // the service reads the caller's group from the token and restricts all
  // Keycloak queries to that group.

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @get('/admin/ngo/roles', {
    responses: {
      '200': {
        description: 'Assignable realm roles for the ngo_frontoffice realm.',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  })
  async listAssignableRoles(): Promise<{ id?: string; name: string; description?: string }[]> {
    this.logger.info('[NgoOrganizationsAdminController] listAssignableRoles');
    return this.ngoUserManagementService.listAssignableRoles();
  }

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @get('/admin/ngo/users', {
    responses: {
      '200': {
        description: 'List NGO users belonging to the caller\'s organization.',
        content: {
          'application/json': {
            schema: { type: 'array', items: NGO_USER_RESPONSE_SCHEMA },
          },
        },
      },
    },
  })
  async listNgoUsers(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
  ): Promise<NgoUserSummaryDto[]> {
    this.logger.info('[NgoOrganizationsAdminController] listNgoUsers', {
      caller: currentUser.id,
    });
    return this.ngoUserManagementService.listUsers(currentUser);
  }

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @post('/admin/ngo/users', {
    responses: {
      '200': {
        description: 'Create an NGO user inside the caller\'s organization group.',
        content: {
          'application/json': { schema: NGO_USER_RESPONSE_SCHEMA },
        },
      },
    },
  })
  async createNgoUser(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'firstName', 'lastName', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              firstName: { type: 'string', minLength: 1 },
              lastName: { type: 'string', minLength: 1 },
              password: { type: 'string', minLength: 8 },
              enabled: { type: 'boolean' },
              roleNames: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    })
    body: CreateNgoUserInput,
  ): Promise<NgoUserSummaryDto> {
    this.logger.info('[NgoOrganizationsAdminController] createNgoUser', {
      caller: currentUser.id,
      email: body.email,
    });
    return this.ngoUserManagementService.createUser(currentUser, body);
  }

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @get('/admin/ngo/users/{id}', {
    responses: {
      '200': {
        description: 'Get a single NGO user (must belong to caller\'s group).',
        content: { 'application/json': { schema: NGO_USER_RESPONSE_SCHEMA } },
      },
    },
  })
  async getNgoUser(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
    @param.path.string('id') userId: string,
  ): Promise<NgoUserSummaryDto> {
    this.logger.info('[NgoOrganizationsAdminController] getNgoUser', {
      caller: currentUser.id, userId,
    });
    return this.ngoUserManagementService.getUserById(currentUser, userId);
  }

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @put('/admin/ngo/users/{id}/roles', {
    responses: {
      '200': {
        description: 'Replace assignable roles for an NGO user.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  })
  async replaceNgoUserRoles(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
    @param.path.string('id') userId: string,
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['roleNames'],
            properties: {
              roleNames: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    })
    body: ReplaceNgoUserRolesInput,
  ): Promise<{ userId: string; roles: string[] }> {
    this.logger.info('[NgoOrganizationsAdminController] replaceNgoUserRoles', {
      caller: currentUser.id, userId, roleNames: body.roleNames,
    });
    return this.ngoUserManagementService.replaceUserRoles(currentUser, userId, body);
  }

  @authenticate('keycloak')
  @authorize({ allowedRoles: ['ngo_admin', 'ngo-admin'] })
  @del('/admin/ngo/users/{id}', {
    responses: {
      '204': { description: 'Delete an NGO user (must belong to caller\'s group).' },
    },
  })
  async deleteNgoUser(
    @inject(SecurityBindings.USER) currentUser: UserProfile,
    @param.path.string('id') userId: string,
  ): Promise<void> {
    this.logger.warn('[NgoOrganizationsAdminController] deleteNgoUser', {
      caller: currentUser.id, userId,
    });
    return this.ngoUserManagementService.deleteUser(currentUser, userId);
  }
}