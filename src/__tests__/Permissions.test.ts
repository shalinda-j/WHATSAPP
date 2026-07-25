import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  ROLE_PRESETS,
  ROLE_PRESET_BY_KEY,
  expandPermissions,
  grantsPermission,
  isKnownPermission,
  normaliseRoleKey,
  sanitisePermissions,
} from '../config/permissions';
import { buildIdentity, identityCan } from '../services/PermissionService';

// Minimal Admin-shaped fixture — buildIdentity only reads these fields.
const makeAdmin = (overrides: Record<string, unknown> = {}): any => ({
  _id: 'admin-1',
  username: 'nimal',
  role: 'agent',
  roleKey: 'agent',
  permissions: [],
  status: 'active',
  tenantId: 'tenant-1',
  ...overrides,
});

describe('permission catalogue', () => {
  it('has unique keys in area.action form', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('lists every group used by a permission, in catalogue order', () => {
    expect(PERMISSION_GROUPS.length).toBeGreaterThan(0);
    for (const p of PERMISSIONS) {
      expect(PERMISSION_GROUPS).toContain(p.group);
    }
    expect(new Set(PERMISSION_GROUPS).size).toBe(PERMISSION_GROUPS.length);
  });

  it('recognises catalogue keys and rejects invented ones', () => {
    expect(isKnownPermission('crm.view')).toBe(true);
    expect(isKnownPermission('crm.destroy_everything')).toBe(false);
    expect(isKnownPermission(42)).toBe(false);
  });
});

describe('sanitisePermissions', () => {
  it('drops unknown keys and de-duplicates', () => {
    expect(
      sanitisePermissions(['crm.view', 'crm.view', 'nope.nope', '', 7]),
    ).toEqual(['crm.view']);
  });

  it('keeps the wildcard grant forms', () => {
    const out = sanitisePermissions(['*', 'crm.*', 'chat.view']);
    expect(out).toContain('*');
    expect(out).toContain('crm.*');
    expect(out).toContain('chat.view');
  });

  it('returns an empty list for junk input', () => {
    expect(sanitisePermissions(null)).toEqual([]);
    expect(sanitisePermissions('crm.view')).toEqual([]);
  });
});

describe('grantsPermission', () => {
  it('matches an exact grant', () => {
    expect(grantsPermission(['crm.view'], 'crm.view')).toBe(true);
    expect(grantsPermission(['crm.view'], 'crm.edit')).toBe(false);
  });

  it('honours the global wildcard', () => {
    expect(grantsPermission(['*'], 'system.manage')).toBe(true);
  });

  it('honours an area wildcard but does not leak across areas', () => {
    expect(grantsPermission(['crm.*'], 'crm.delete')).toBe(true);
    expect(grantsPermission(['crm.*'], 'chat.send')).toBe(false);
  });

  it('is false for an empty or missing grant list', () => {
    expect(grantsPermission([], 'crm.view')).toBe(false);
    expect(grantsPermission(undefined, 'crm.view')).toBe(false);
  });
});

describe('expandPermissions', () => {
  it('turns the global wildcard into the whole catalogue', () => {
    expect(expandPermissions(['*'])).toEqual(PERMISSION_KEYS);
  });

  it('expands an area wildcard to that area only', () => {
    const expanded = expandPermissions(['chat.*']);
    expect(expanded).toContain('chat.view');
    expect(expanded).toContain('chat.send');
    expect(expanded.every((k) => k.startsWith('chat.'))).toBe(true);
  });

  it('returns concrete keys only — never a wildcard', () => {
    expect(expandPermissions(['crm.*', 'chat.view'])).not.toContain('crm.*');
  });
});

describe('role presets', () => {
  it('only grant permissions that exist in the catalogue', () => {
    for (const preset of ROLE_PRESETS) {
      const expanded = expandPermissions(preset.permissions);
      for (const key of expanded) {
        expect(isKnownPermission(key)).toBe(true);
      }
      // A preset that expands to nothing would silently lock its holders out.
      expect(expanded.length).toBeGreaterThan(0);
    }
  });

  it('order staff by privilege, with super admin on top', () => {
    const rank = (key: string) => ROLE_PRESET_BY_KEY.get(key)!.rank;
    expect(rank('super_admin')).toBeGreaterThan(rank('admin'));
    expect(rank('admin')).toBeGreaterThan(rank('manager'));
    expect(rank('manager')).toBeGreaterThan(rank('agent'));
    expect(rank('agent')).toBeGreaterThan(rank('viewer'));
  });

  it('keeps user management away from non-admin roles', () => {
    for (const key of ['manager', 'agent', 'marketing', 'viewer']) {
      const preset = ROLE_PRESET_BY_KEY.get(key)!;
      expect(expandPermissions(preset.permissions)).not.toContain(
        'users.manage',
      );
    }
    expect(
      expandPermissions(ROLE_PRESET_BY_KEY.get('admin')!.permissions),
    ).toContain('users.manage');
  });

  it('never gives a support agent destructive or system access', () => {
    const agent = expandPermissions(
      ROLE_PRESET_BY_KEY.get('agent')!.permissions,
    );
    for (const denied of [
      'crm.delete',
      'system.manage',
      'config.manage',
      'tenants.manage',
      'bulk.send',
    ]) {
      expect(agent).not.toContain(denied);
    }
    expect(agent).toContain('chat.send');
  });

  it('keeps the viewer role read-only', () => {
    const viewer = expandPermissions(
      ROLE_PRESET_BY_KEY.get('viewer')!.permissions,
    );
    for (const key of viewer) {
      expect(key.endsWith('.view')).toBe(true);
    }
  });
});

describe('normaliseRoleKey', () => {
  it('folds every legacy super-admin spelling onto one key', () => {
    expect(normaliseRoleKey('superadmin')).toBe('super_admin');
    expect(normaliseRoleKey('super-admin')).toBe('super_admin');
    expect(normaliseRoleKey('SUPER_ADMIN')).toBe('super_admin');
  });

  it('defaults an empty role to admin', () => {
    expect(normaliseRoleKey('')).toBe('admin');
    expect(normaliseRoleKey(undefined)).toBe('admin');
  });

  it('passes custom keys through untouched', () => {
    expect(normaliseRoleKey('branch_lead')).toBe('branch_lead');
  });
});

describe('buildIdentity', () => {
  const agentRole = {
    key: 'agent',
    name: 'Support Agent',
    permissions: ROLE_PRESET_BY_KEY.get('agent')!.permissions,
    rank: 40,
  };

  it('resolves the role permissions', () => {
    const identity = buildIdentity(makeAdmin(), agentRole);
    expect(identity.roleKey).toBe('agent');
    expect(identity.roleName).toBe('Support Agent');
    expect(identity.rank).toBe(40);
    expect(identity.permissions).toContain('chat.send');
    expect(identity.permissions).not.toContain('system.manage');
  });

  it('layers per-user extras on top of the role', () => {
    const identity = buildIdentity(
      makeAdmin({ permissions: ['crm.export'] }),
      agentRole,
    );
    expect(identity.permissions).toContain('crm.export');
    expect(identity.permissions).toContain('chat.send');
  });

  it('ignores extras that are not real permissions', () => {
    const identity = buildIdentity(
      makeAdmin({ permissions: ['not.real'] }),
      agentRole,
    );
    expect(identity.permissions).not.toContain('not.real');
  });

  it('treats a legacy admin with no tenant and no roleKey as super admin', () => {
    const identity = buildIdentity(
      makeAdmin({ roleKey: undefined, role: 'admin', tenantId: undefined }),
      null,
    );
    expect(identity.rank).toBe(100);
    expect(identity.permissions).toEqual(PERMISSION_KEYS);
  });

  it('does NOT promote a tenant-bound legacy admin', () => {
    const identity = buildIdentity(
      makeAdmin({ roleKey: undefined, role: 'admin', tenantId: 'tenant-1' }),
      null,
    );
    expect(identity.rank).not.toBe(100);
    expect(identity.permissions).not.toContain('tenants.manage');
  });

  it('falls back to the in-code preset when no role document exists', () => {
    const identity = buildIdentity(makeAdmin({ roleKey: 'manager' }), null);
    expect(identity.roleName).toBe('Manager');
    expect(identity.permissions).toContain('campaigns.manage');
  });

  it('prefers the stored role document over the preset', () => {
    const identity = buildIdentity(makeAdmin({ roleKey: 'agent' }), {
      key: 'agent',
      name: 'Front Desk',
      permissions: ['chat.view'],
      rank: 30,
    });
    expect(identity.roleName).toBe('Front Desk');
    expect(identity.permissions).toEqual(['chat.view']);
  });

  it('marks a disabled account and strips its access at the check', () => {
    const identity = buildIdentity(
      makeAdmin({ status: 'disabled' }),
      agentRole,
    );
    expect(identity.status).toBe('disabled');
    // The permission list is still resolved (the UI shows what they'd have),
    // but every check must fail while the account is suspended.
    expect(identity.permissions).toContain('chat.view');
    expect(identityCan(identity, 'chat.view')).toBe(false);
  });
});

describe('identityCan', () => {
  const identity = buildIdentity(makeAdmin(), {
    key: 'agent',
    name: 'Support Agent',
    permissions: ['chat.view', 'crm.*'],
    rank: 40,
  });

  it('accepts held permissions, including via an area wildcard', () => {
    expect(identityCan(identity, 'chat.view')).toBe(true);
    expect(identityCan(identity, 'crm.delete')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(identityCan(identity, 'system.manage')).toBe(false);
    expect(identityCan(null, 'chat.view')).toBe(false);
    expect(identityCan(undefined, 'chat.view')).toBe(false);
  });
});
