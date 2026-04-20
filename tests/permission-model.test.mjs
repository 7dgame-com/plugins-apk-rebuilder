import test from 'node:test';
import assert from 'node:assert/strict';

const { PLUGIN_ACTIONS, getPermissionSnapshot, isRoleAllowed } = await import('../dist/shared/permissions.js');

test('permission snapshot derives internal capabilities from roles', () => {
  const user = getPermissionSnapshot(['user']);
  assert.deepEqual(
    user,
    {
      roles: ['user'],
      canRead: true,
      canRun: true,
      canAdmin: false,
      canManageStandardPackage: false,
      canCheckTools: false,
    },
  );

  const admin = getPermissionSnapshot(['admin']);
  assert.equal(admin.canRead, true);
  assert.equal(admin.canRun, true);
  assert.equal(admin.canAdmin, true);
  assert.equal(admin.canManageStandardPackage, true);
  assert.equal(admin.canCheckTools, true);
});

test('root role bypasses all plugin action checks', () => {
  assert.equal(isRoleAllowed(['root'], PLUGIN_ACTIONS.read), true);
  assert.equal(isRoleAllowed(['root'], PLUGIN_ACTIONS.run), true);
  assert.equal(isRoleAllowed(['root'], PLUGIN_ACTIONS.admin), true);
});
