import {test, expect, request} from '@playwright/test';

const baseURL = process.env.API_BASE_URL ?? 'http://api.localhost';
const token = process.env.E2E_TOKEN_PA_ADMIN ?? process.env.E2E_TOKEN_ADMIN ?? '';
const enabled = process.env.RUN_KEYCLOAK_PA_USERS_E2E === 'true';

async function adminApi() {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

test.describe('PA users admin API', () => {
  test.skip(!enabled, 'Set RUN_KEYCLOAK_PA_USERS_E2E=true to run against a live Keycloak realm.');

  test('GET roles -> POST user -> GET users -> PUT roles -> GET user roles -> DELETE user', async () => {
    const api = await adminApi();

    const rolesRes = await api.get('/admin/pa/roles');
    expect(rolesRes.ok()).toBeTruthy();
    const roles = (await rolesRes.json()) as Array<{name: string}>;
    const roleNames = roles.map(role => role.name);

    const email = `pa-user-${Date.now()}@example.org`;
    const selectedRoles = roleNames.slice(0, Math.min(2, roleNames.length));

    const createRes = await api.post('/admin/pa/users', {
      data: {
        email,
        firstName: 'Playwright',
        lastName: 'Tester',
        password: 'TempPwd123!',
        roleNames: selectedRoles,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {id: string; email: string; roles: string[]};
    expect(created.email).toBe(email);
    expect(created.roles.sort()).toEqual([...selectedRoles].sort());

    const listRes = await api.get('/admin/pa/users');
    expect(listRes.ok()).toBeTruthy();
    const users = (await listRes.json()) as Array<{id: string; email: string}>;
    expect(users.some(user => user.id === created.id)).toBeTruthy();

    const nextRoles = selectedRoles.length > 1 ? [selectedRoles[0]] : [];
    const replaceRes = await api.put(`/admin/pa/users/${created.id}/roles`, {
      data: {roleNames: nextRoles},
    });
    expect(replaceRes.ok()).toBeTruthy();

    const currentRolesRes = await api.get(`/admin/pa/users/${created.id}/roles`);
    expect(currentRolesRes.ok()).toBeTruthy();
    const currentRoles = (await currentRolesRes.json()) as {roles: string[]};
    expect(currentRoles.roles.sort()).toEqual([...nextRoles].sort());

    const deleteRes = await api.delete(`/admin/pa/users/${created.id}`);
    expect(deleteRes.status()).toBe(204);
  });
});
