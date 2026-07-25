import {
  ROLE_PRESET_BY_KEY,
  expandPermissions,
  grantsPermission,
} from '../config/permissions';

/**
 * Guards the failure mode that shipped with the first RBAC cut: a role could
 * open a PAGE while lacking a permission that page's own API calls need, so
 * the user landed on a screen that immediately 403'd. The dashboard was the worst
 * case — it fetches /api/sessions and /api/config on mount, and the axios
 * interceptor treated the resulting 403 as an expired session, bouncing the
 * user straight back to the login screen as if their password were wrong.
 *
 * The table below records, per page, the permission that reveals it and the
 * permissions its on-mount requests need. Any role that can see the page must
 * either hold those, or the page must be coded to skip the call (noted in
 * `optional`, which documents the requirement without enforcing it).
 */
interface PageContract {
  page: string;
  /** Permission that puts the page in the nav / lets the route render. */
  opensWith: string;
  /** Permissions the page's on-mount API calls require. */
  needs: string[];
  /**
   * Calls the page makes but guards behind its own permission check, so a
   * role without them still gets a working page.
   */
  optional?: string[];
}

const PAGES: PageContract[] = [
  {
    page: 'Dashboard',
    opensWith: 'dashboard.view',
    needs: [],
    // Dashboard.tsx checks can(sessions.view) / can(config.manage) before
    // fetching, and renders the panels it is allowed to show.
    optional: ['sessions.view', 'config.manage'],
  },
  {
    page: 'Live Chat',
    opensWith: 'chat.view',
    // ChatInterface fetches the device list for its session tabs on mount.
    needs: ['chat.view', 'sessions.view'],
  },
  {
    page: 'CRM',
    opensWith: 'crm.view',
    // CRM.tsx fetches the device list for the per-device scope picker.
    needs: ['crm.view', 'sessions.view'],
  },
  {
    page: 'Linked Devices',
    opensWith: 'sessions.view',
    needs: ['sessions.view'],
  },
  {
    page: 'Users & Roles',
    opensWith: 'users.view',
    needs: ['users.view'],
  },
];

const STAFF_ROLES = [
  'super_admin',
  'admin',
  'manager',
  'agent',
  'marketing',
  'viewer',
];

describe('role → page access', () => {
  for (const roleKey of STAFF_ROLES) {
    describe(roleKey, () => {
      const preset = ROLE_PRESET_BY_KEY.get(roleKey)!;
      const held = expandPermissions(preset.permissions);

      for (const contract of PAGES) {
        const canOpen = grantsPermission(held, contract.opensWith);
        if (!canOpen) continue;

        it(`can use ${contract.page} without hitting a 403`, () => {
          for (const required of contract.needs) {
            expect({
              role: roleKey,
              page: contract.page,
              missing: required,
              held: grantsPermission(held, required),
            }).toEqual({
              role: roleKey,
              page: contract.page,
              missing: required,
              held: true,
            });
          }
        });
      }
    });
  }

  it('lets every staff role that can open a chat or CRM page read the device list', () => {
    for (const roleKey of STAFF_ROLES) {
      const held = expandPermissions(
        ROLE_PRESET_BY_KEY.get(roleKey)!.permissions,
      );
      const usesDevicePicker =
        grantsPermission(held, 'chat.view') ||
        grantsPermission(held, 'crm.view');
      if (!usesDevicePicker) continue;
      expect(`${roleKey}:${grantsPermission(held, 'sessions.view')}`).toBe(
        `${roleKey}:true`,
      );
    }
  });

  it('keeps the read-only device grant from implying device control', () => {
    for (const roleKey of ['agent', 'marketing', 'viewer']) {
      const held = expandPermissions(
        ROLE_PRESET_BY_KEY.get(roleKey)!.permissions,
      );
      expect(held).toContain('sessions.view');
      expect(held).not.toContain('sessions.manage');
    }
  });
});
