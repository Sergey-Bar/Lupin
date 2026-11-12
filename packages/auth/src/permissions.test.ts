import {
  checkPermission,
  isAdmin,
  Permission,
  ROLE_PERMISSIONS,
  scopesBeyondRole,
} from './permissions.js';

describe('checkPermission', () => {
  it('returns true when user has the required permission', () => {
    expect(checkPermission(['runs:read'], Permission.RUNS_READ)).toBe(true);
  });

  it('returns false when user does not have the required permission', () => {
    expect(checkPermission(['runs:read'], Permission.VAULT_WRITE)).toBe(false);
  });

  it('returns true for any permission when user has admin:all', () => {
    expect(checkPermission(['admin:all'], Permission.VAULT_WRITE)).toBe(true);
  });

  it('returns false when user has no permissions', () => {
    expect(checkPermission([], Permission.RUNS_READ)).toBe(false);
  });

  it('returns true when user has multiple permissions including the required one', () => {
    expect(checkPermission(['runs:read', 'vault:read'], Permission.VAULT_READ)).toBe(true);
  });

  it('returns false when user has unrelated permissions', () => {
    expect(checkPermission(['runs:read', 'vault:read'], Permission.AI_USE)).toBe(false);
  });

  it('isAdmin is true when any one granted permission is administrative, not only all of them', () => {
    // Found by mutation testing: `some` survived as `every`.
    expect(isAdmin(['runs:read', 'admin'])).toBe(true);
    expect(isAdmin(['admin:all', 'runs:read'])).toBe(true);
  });
});

describe('ROLE_PERMISSIONS and scopesBeyondRole (plan task 7)', () => {
  it('nests each role inside the one above, and never grants the admin spellings', () => {
    for (const permission of ROLE_PERMISSIONS.viewer) {
      expect(ROLE_PERMISSIONS.operator).toContain(permission);
    }
    for (const permission of ROLE_PERMISSIONS.operator) {
      expect(ROLE_PERMISSIONS.admin).toContain(permission);
    }
    expect(ROLE_PERMISSIONS.admin).not.toContain('admin');
    expect(ROLE_PERMISSIONS.admin).not.toContain('admin:all');
  });

  it('names exactly the scopes a role does not hold', () => {
    expect(scopesBeyondRole('viewer', ['runs:read'])).toEqual([]);
    expect(scopesBeyondRole('viewer', ['runs:read', 'runs:write', 'vault:read'])).toEqual([
      'runs:write',
      'vault:read',
    ]);
    expect(scopesBeyondRole('admin', ['vault:write', 'connectors:manage'])).toEqual([]);
  });
});
