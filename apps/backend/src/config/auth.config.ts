export type DummyAuthConfig = {
    disableKeycloak: boolean;
    dummySub: string;
    dummyUsername: string;
    dummyRoles: string[];
};

export function readDummyAuthConfig(): DummyAuthConfig {
    const disableKeycloak =
        (process.env.AUTH_DISABLE_KEYCLOAK ?? 'false').toLowerCase() === 'true';

    const dummySub = process.env.AUTH_DUMMY_SUB?.trim() || 'test-user';
    const dummyUsername =
        process.env.AUTH_DUMMY_USERNAME?.trim() || 'test.user';
    const dummyRoles = (process.env.AUTH_DUMMY_ROLES?.trim() || 'pa_admin')
        .split(',')
        .map(role => role.trim())
        .filter(Boolean);

    if (
        disableKeycloak &&
        (process.env.NODE_ENV?.toLowerCase() === 'production' ||
            process.env.APP_ENV?.toLowerCase() === 'production')
    ) {
        throw new Error(
            'AUTH_DISABLE_KEYCLOAK=true is not allowed in production environments.',
        );
    }

    return {
        disableKeycloak,
        dummySub,
        dummyUsername,
        dummyRoles,
    };
}