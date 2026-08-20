import {createHash} from 'node:crypto';

function decodeJwtPayload(token) {
  const [, payload] = token.split('.');
  if (!payload) throw new Error('Keycloak returned a value that is not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

export function logAccessTokenEvidence(token) {
  const claims = decodeJwtPayload(token);
  const fingerprint = createHash('sha256').update(token).digest('hex');
  const expiresAt = claims.exp ? new Date(claims.exp * 1000).toISOString() : 'not provided';
  const roles = claims.realm_access?.roles ?? [];

  console.log(`[MICADO][KEYCLOAK] Token SHA-256: ${fingerprint}`);
  console.log(`[MICADO][KEYCLOAK] Token issuer: ${claims.iss ?? 'not provided'}`);
  console.log(`[MICADO][KEYCLOAK] Token subject: ${claims.sub ?? 'not provided'}`);
  console.log(`[MICADO][KEYCLOAK] Token expires: ${expiresAt}`);
  console.log(`[MICADO][KEYCLOAK] Token roles: ${roles.join(', ') || 'none'}`);
  console.log(`[MICADO][KEYCLOAK] ACCESS TOKEN: ${token}`);
  console.warn('[MICADO][KEYCLOAK] WARNING: the complete bearer token is present in this development log.');

  return claims;
}
