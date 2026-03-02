import { BootMixin } from '@loopback/boot';
import { ApplicationConfig } from '@loopback/core';
import { RestExplorerBindings, RestExplorerComponent } from '@loopback/rest-explorer';
import { RepositoryMixin } from '@loopback/repository';
import { RestApplication } from '@loopback/rest';
import { ServiceMixin } from '@loopback/service-proxy';
import { AuthenticationComponent, registerAuthenticationStrategy } from '@loopback/authentication';
import { AuthorizationBindings, AuthorizationComponent, AuthorizationDecision, AuthorizationOptions, AuthorizationTags } from '@loopback/authorization';
import { LoggingComponent, LoggingBindings } from '@loopback/logging';
import path from 'path';
import { MySequence } from './sequence';
import { KeycloakJwtStrategy } from './auth/keycloak.strategy';
import { format } from 'winston';
import {RoleAuthorizerProvider} from './auth/role.authorizer';


export { ApplicationConfig };

export class MicadoBackend extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // LOGGER
    this.configure(LoggingBindings.COMPONENT).to({
      enableFluent: false,
      enableHttpAccessLog: true,
    });
    // Configure winston logger level and format
    this.configure(LoggingBindings.WINSTON_LOGGER).to({
      level: process.env.LOG_LEVEL ?? 'info',
      format: format.combine(
        format.colorize(),
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }),
      ),
    });

    // Registra LOGGER
    this.component(LoggingComponent);

    this.sequence(MySequence);
    this.static('/', path.join(__dirname, '../public'));


    // Authentication
    this.component(AuthenticationComponent);
    registerAuthenticationStrategy(this, KeycloakJwtStrategy);

    // Authorization — without this component @authorize() decorators have no
    // voter and LoopBack defaults to DENY for every request, producing 403
    // even when the token is valid and the user has the correct roles.
    const authorizationOptions: AuthorizationOptions = {
      // DENY by default so unannotated endpoints are never accidentally open.
      defaultDecision: AuthorizationDecision.DENY,
      // When multiple voters respond, require all to ALLOW (fail-closed).
      precedence: AuthorizationDecision.DENY,
    };

    this.configure(AuthorizationBindings.COMPONENT).to(authorizationOptions);
    this.component(AuthorizationComponent);
    this.bind('authorizationProviders.role-authorizer-provider').toProvider(RoleAuthorizerProvider).tag(AuthorizationTags.AUTHORIZER);;

    this.api({
      openapi: '3.0.0',
      info: {
        title: 'Micado API',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
      paths: {},
    });

    // REST Explorer
    this.configure(RestExplorerBindings.COMPONENT).to({ path: '/explorer' });
    this.component(RestExplorerComponent);

    this.projectRoot = __dirname;
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
      repositories: {
        dirs: ['repositories'],
        extensions: ['.repository.js'],
        nested: true,
      },
      datasources: {
        dirs: ['datasources'],
        extensions: ['.datasource.js'],
        nested: true,
      },
    };
  }
}