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
import { RoleAuthorizerProvider } from './auth/role.authorizer';

import { DbosComponent } from './infrastructure/dbos/dbos.component';
import { DBOS_CONFIG } from './infrastructure/dbos/dbos.config';

export { ApplicationConfig };

export class MicadoBackend extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // ── Logger ──────────────────────────────────────────────────────────────
    this.configure(LoggingBindings.COMPONENT).to({
      enableFluent: false,
      enableHttpAccessLog: true,
    });
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
    this.component(LoggingComponent);

    this.sequence(MySequence);
    this.static('/', path.join(__dirname, '../public'));

    // ── Authentication ───────────────────────────────────────────────────────
    this.component(AuthenticationComponent);
    registerAuthenticationStrategy(this, KeycloakJwtStrategy);

    // ── Authorization ────────────────────────────────────────────────────────
    // DENY by default so unannotated endpoints are never accidentally open.
    const authorizationOptions: AuthorizationOptions = {
      defaultDecision: AuthorizationDecision.DENY,
      precedence: AuthorizationDecision.DENY,
    };
    this.configure(AuthorizationBindings.COMPONENT).to(authorizationOptions);
    this.component(AuthorizationComponent);
    this.bind('authorizationProviders.role-authorizer-provider')
      .toProvider(RoleAuthorizerProvider)
      .tag(AuthorizationTags.AUTHORIZER);

    // ── OpenAPI spec ─────────────────────────────────────────────────────────
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
      security: [{ bearerAuth: [] }],
      paths: {},
    });

    // ── REST Explorer ────────────────────────────────────────────────────────
    this.configure(RestExplorerBindings.COMPONENT).to({ path: '/explorer' });
    this.component(RestExplorerComponent);

    // ── DBOS ─────────────────────────────────────────────────────────────────
    this.bind(DBOS_CONFIG).to({
      appName: process.env.DBOS_APP_NAME ?? 'micado-backend',
      systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL ?? '',
      sys_db_name: 'micado',
      systemSchema: process.env.DBOS_SYSTEM_SCHEMA_NAME ?? 'dbos',
      executorId: process.env.DBOS_EXECUTOR_ID,
      logLevel: process.env.DBOS_LOG_LEVEL ?? 'info',
    });
    this.component(DbosComponent);

    // ── Boot configuration ───────────────────────────────────────────────────
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
      // ── Service auto-discovery ────────────────────────────────────────────
      // All @injectable classes in src/services/ are automatically bound into
      // the IoC container.  The binding key is derived from the class name:
      //   GiteaTranslationExportService  → services.GiteaTranslationExportService
      //   TranslationWorkflowOrchestratorService → services.TranslationWorkflowOrchestratorService
      //   GiteaTranslationImportService  → services.GiteaTranslationImportService
      //
      // Controllers inject them via @inject('services.<ClassName>').
      services: {
        dirs: ['services'],
        extensions: ['.service.js'],
        nested: false,
      },
    };
  }
}