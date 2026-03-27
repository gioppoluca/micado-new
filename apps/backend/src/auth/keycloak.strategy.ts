import { AuthenticationStrategy } from '@loopback/authentication';
import { Request } from '@loopback/rest';
import { UserProfile, securityId } from '@loopback/security';
import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import { inject, injectable } from '@loopback/core';
import { LoggingBindings, WinstonLogger } from '@loopback/logging';
import { readDummyAuthConfig } from '../config/auth.config';

// Cache JWKS instances keyed by jwksUri so the remote key set is not
// re-fetched on every request (jose caches keys internally per instance).
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJWKS(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksCache.has(jwksUri)) {
    jwksCache.set(jwksUri, createRemoteJWKSet(new URL(jwksUri)));
  }
  return jwksCache.get(jwksUri)!;
}

@injectable()
export class KeycloakJwtStrategy implements AuthenticationStrategy {
  name = 'keycloak';

  constructor(
    @inject(LoggingBindings.WINSTON_LOGGER)
    private logger: WinstonLogger,
  ) { }

  async authenticate(request: Request): Promise<UserProfile | undefined> {
    const authConfig = readDummyAuthConfig();
    if (authConfig.disableKeycloak) {
      this.logger.info('Keycloak authentication is DISABLED. Dummy authentication is active.');
    }
    if (authConfig.disableKeycloak) {
      return this.buildDummyUserProfile(request, authConfig);
    }
    // ── 1. Extract token ────────────────────────────────────────────────────
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.info('[AUTH] Missing Authorization header', {
        method: request.method,
        path: request.path,
      });
      return undefined;
    }

    if (!authHeader.startsWith('Bearer ')) {
      this.logger.info('[AUTH] Authorization header is not Bearer', {
        method: request.method,
        path: request.path,
      });
      return undefined;
    }

    const token = authHeader.substring(7);

    // ── 2. Decode (without verification) for diagnostics ───────────────────
    // This lets us log exactly what the token claims before we attempt
    // verification, which is essential for diagnosing iss/aud mismatches.
    let rawClaims: Record<string, unknown> = {};
    try {
      rawClaims = decodeJwt(token) as Record<string, unknown>;
    } catch {
      this.logger.warn('[AUTH] Token is not a valid JWT — cannot decode', {
        method: request.method,
        path: request.path,
        tokenPrefix: token.substring(0, 20) + '...',
      });
      return undefined;
    }

    this.logger.info('[AUTH] Incoming token claims (unverified)', {
      method: request.method,
      path: request.path,
      origin: request.headers.origin ?? request.headers.referer ?? '(none)',
      iss: rawClaims['iss'],
      aud: rawClaims['aud'],
      sub: rawClaims['sub'],
      azp: rawClaims['azp'],
      exp: rawClaims['exp']
        ? new Date((rawClaims['exp'] as number) * 1000).toISOString()
        : undefined,
      realm_access: rawClaims['realm_access'],
    });

    // ── 3. Config ───────────────────────────────────────────────────────────
    const allowedRealms =
      (process.env.KEYCLOAK_ALLOWED_REALMS ?? 'migrants').split(',').map(r => r.trim());

    // KEYCLOAK_INTERNAL_BASE: where the backend fetches the JWKS from.
    // Inside Docker this is the internal service name, e.g. http://keycloak:8080
    const jwksBase =
      process.env.KEYCLOAK_INTERNAL_BASE ?? 'http://keycloak:8080';

    // KEYCLOAK_ISSUER_BASE: the issuer value the token actually contains.
    // This is the public URL the browser used to obtain the token, e.g.
    // http://keycloak.localhost — it is often different from jwksBase in
    // Docker Compose setups.
    // Falls back to jwksBase when both networks share the same hostname.
    const issuerBase =
      process.env.KEYCLOAK_ISSUER_BASE ?? jwksBase;

    const expectedAudience =
      process.env.KEYCLOAK_EXPECTED_AUDIENCE ?? 'micado-backend';

    this.logger.info('[AUTH] Starting verification', {
      allowedRealms,
      jwksBase,
      issuerBase,
      expectedAudience,
    });

    // ── 4. Try each realm ───────────────────────────────────────────────────
    for (const realm of allowedRealms) {
      // JWKS is fetched from the internal Docker hostname (reachable by backend)
      const jwksUri = `${jwksBase}/realms/${realm}/protocol/openid-connect/certs`;
      // Issuer must match what is in the token (the public hostname)
      const expectedIssuer = `${issuerBase}/realms/${realm}`;

      this.logger.info('[AUTH] Trying realm', {
        realm,
        expectedIssuer,
        jwksUri,
        tokenIss: rawClaims['iss'],
        issuerMatch: rawClaims['iss'] === expectedIssuer,
      });

      try {
        const JWKS = getJWKS(jwksUri);

        const { payload } = await jwtVerify(token, JWKS, {
          issuer: expectedIssuer,
          audience: expectedAudience,
        });

        this.logger.info('[AUTH] JWT verified successfully', {
          realm,
          iss: payload.iss,
          aud: payload.aud,
          sub: payload.sub,
          preferred_username: payload.preferred_username,
          roles: (payload as any).realm_access?.roles,
        });
        const rolesArray = Array.isArray((payload as any).realm_access?.roles) ? (payload as any).realm_access?.roles : [];
        this.logger.info('[AUTH] Extracted roles',
          rolesArray,
        );

        return {
          [securityId]: payload.sub as string,
          id: payload.sub,
          name: (payload.preferred_username as string) ?? 'unknown',
          // Extra fields consumed by buildActorStamp() for audit columns.
          // LB4 UserProfile accepts arbitrary extra properties.
          displayName: (payload['name'] as string | undefined)
            ?? (payload.preferred_username as string)
            ?? 'unknown',
          realm,   // the realm variable from the for-loop above
          roles: rolesArray,
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.info('[AUTH] JWT verification failed', {
          realm,
          expectedIssuer,
          jwksUri,
          error: message,
          // Surface the specific mismatch so it is immediately actionable:
          hint: message.includes('iss')
            ? `Token iss="${String(rawClaims['iss'])}" — set KEYCLOAK_ISSUER_BASE to match`
            : message.includes('aud')
              ? `Token aud="${JSON.stringify(rawClaims['aud'])}" — set KEYCLOAK_EXPECTED_AUDIENCE to match`
              : message.includes('key')
                ? `No matching key in JWKS — check KEYCLOAK_INTERNAL_BASE points to the correct Keycloak instance`
                : undefined,
        });
      }
    }

    this.logger.info('[AUTH] No realm matched. Authentication failed.', {
      tokenIss: rawClaims['iss'],
      tokenAud: rawClaims['aud'],
      triedRealms: allowedRealms,
      triedIssuers: allowedRealms.map(r => `${issuerBase}/realms/${r}`),
    });

    return undefined;
  }

  private buildDummyUserProfile(
    request: Request,
    authConfig: ReturnType<typeof readDummyAuthConfig>,
  ): UserProfile {
    const requestedRolesHeader = request.headers['x-test-roles'];
    const requestedUsernameHeader = request.headers['x-test-username'];
    const requestedSubHeader = request.headers['x-test-sub'];

    const roles =
      typeof requestedRolesHeader === 'string' && requestedRolesHeader.trim()
        ? requestedRolesHeader
          .split(',')
          .map(role => role.trim())
          .filter(Boolean)
        : authConfig.dummyRoles;

    const username =
      typeof requestedUsernameHeader === 'string' &&
        requestedUsernameHeader.trim()
        ? requestedUsernameHeader.trim()
        : authConfig.dummyUsername;

    const sub =
      typeof requestedSubHeader === 'string' && requestedSubHeader.trim()
        ? requestedSubHeader.trim()
        : authConfig.dummySub;

    return {
      [securityId]: sub,
      id: sub,
      name: username,
      username,
      sub,
      roles,
      authMode: 'dummy',
    };
  }
}