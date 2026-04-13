import {authenticate} from '@loopback/authentication';
import {authorize} from '@loopback/authorization';
import {inject} from '@loopback/core';
import {LoggingBindings, WinstonLogger} from '@loopback/logging';
import {
  del,
  get,
  getModelSchemaRef,
  param,
  post,
  put,
  requestBody,
} from '@loopback/rest';
import {
  CreatePaUserInput,
  PaAssignableRoleDto,
  PaUserManagementService,
  PaUserSummaryDto,
  ReplacePaUserRolesInput,
} from '../services/pa-user-management.service';

const PA_USER_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['id', 'roles'],
  properties: {
    id: {type: 'string'},
    username: {type: 'string'},
    email: {type: 'string'},
    firstName: {type: 'string'},
    lastName: {type: 'string'},
    enabled: {type: 'boolean'},
    emailVerified: {type: 'boolean'},
    roles: {
      type: 'array',
      items: {type: 'string'},
    },
  },
};

const PA_ROLE_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    id: {type: 'string'},
    name: {type: 'string'},
    description: {type: 'string'},
  },
};

@authenticate('keycloak')
@authorize({allowedRoles: ['pa_admin']})
export class PaUsersAdminController {
  constructor(
    @inject('services.PaUserManagementService')
    private readonly paUserManagementService: PaUserManagementService,
    @inject(LoggingBindings.WINSTON_LOGGER)
    private readonly logger: WinstonLogger,
  ) {}

  @get('/admin/pa/users', {
    responses: {
      '200': {
        description: 'PA users from Keycloak realm pa_frontoffice',
        content: {
          'application/json': {
            schema: {type: 'array', items: PA_USER_RESPONSE_SCHEMA},
          },
        },
      },
    },
  })
  async listUsers(): Promise<PaUserSummaryDto[]> {
    this.logger.info('[PaUsersAdminController.listUsers]');
    return this.paUserManagementService.listUsers();
  }

  @get('/admin/pa/roles', {
    responses: {
      '200': {
        description: 'Assignable PA realm roles from Keycloak',
        content: {
          'application/json': {
            schema: {type: 'array', items: PA_ROLE_RESPONSE_SCHEMA},
          },
        },
      },
    },
  })
  async listAssignableRoles(): Promise<PaAssignableRoleDto[]> {
    this.logger.info('[PaUsersAdminController.listAssignableRoles]');
    return this.paUserManagementService.listAssignableRoles();
  }

  @get('/admin/pa/users/{id}/roles', {
    responses: {
      '200': {
        description: 'Current realm roles assigned to a PA user',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId', 'roles'],
              properties: {
                userId: {type: 'string'},
                roles: {type: 'array', items: {type: 'string'}},
              },
            },
          },
        },
      },
    },
  })
  async getUserRoles(
    @param.path.string('id') userId: string,
  ): Promise<{userId: string; roles: string[]}> {
    this.logger.info('[PaUsersAdminController.getUserRoles]', {userId});
    return {
      userId,
      roles: await this.paUserManagementService.getUserRoles(userId),
    };
  }

  @post('/admin/pa/users', {
    responses: {
      '200': {
        description: 'Create a PA user in Keycloak',
        content: {
          'application/json': {
            schema: PA_USER_RESPONSE_SCHEMA,
          },
        },
      },
    },
  })
  async createUser(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'firstName', 'lastName', 'password'],
            properties: {
              email: {type: 'string', format: 'email'},
              firstName: {type: 'string', minLength: 1},
              lastName: {type: 'string', minLength: 1},
              password: {type: 'string', minLength: 8},
              enabled: {type: 'boolean'},
              roleNames: {type: 'array', items: {type: 'string'}},
            },
          },
        },
      },
    })
    body: CreatePaUserInput,
  ): Promise<PaUserSummaryDto> {
    this.logger.info('[PaUsersAdminController.createUser]', {
      email: body.email,
      roleNames: body.roleNames,
    });
    return this.paUserManagementService.createUser(body);
  }

  @put('/admin/pa/users/{id}/roles', {
    responses: {
      '200': {
        description: 'Replace all assignable roles of a PA user',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId', 'roles'],
              properties: {
                userId: {type: 'string'},
                roles: {type: 'array', items: {type: 'string'}},
              },
            },
          },
        },
      },
    },
  })
  async replaceUserRoles(
    @param.path.string('id') userId: string,
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['roleNames'],
            properties: {
              roleNames: {type: 'array', items: {type: 'string'}},
            },
          },
        },
      },
    })
    body: ReplacePaUserRolesInput,
  ): Promise<{userId: string; roles: string[]}> {
    this.logger.info('[PaUsersAdminController.replaceUserRoles]', {
      userId,
      roleNames: body.roleNames,
    });
    return this.paUserManagementService.replaceUserRoles(userId, body);
  }

  @del('/admin/pa/users/{id}', {
    responses: {
      '204': {
        description: 'Delete a PA user from Keycloak',
      },
    },
  })
  async deleteUser(
    @param.path.string('id') userId: string,
  ): Promise<void> {
    this.logger.warn('[PaUsersAdminController.deleteUser]', {userId});
    await this.paUserManagementService.deleteUser(userId);
  }
}
