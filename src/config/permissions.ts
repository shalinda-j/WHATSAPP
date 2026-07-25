/**
 * Permission catalogue + role presets.
 *
 * One flat list of `area.action` keys is the single source of truth for what
 * a user may do. Everything else — the middleware gate, the admin UI's
 * permission matrix, the nav filter — reads from here, so adding a feature
 * means adding one entry rather than touching four places.
 *
 * Wildcards:
 *   '*'        every permission (super admin)
 *   'crm.*'    every permission in the `crm` area
 * Wildcards are only ever GRANTED (in a role); a check always asks for an
 * exact key.
 *
 * This module is intentionally dependency-free so it can be unit-tested and
 * imported from scripts without pulling in mongoose or express.
 */

export type PermissionKey = string;

export interface PermissionDef {
  key: PermissionKey;
  /** Human label shown in the role editor. */
  label: string;
  /** Grouping for the role editor UI (mirrors the sidebar sections). */
  group: string;
  /** Longer hint shown under the checkbox. */
  description?: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // ── Overview ──────────────────────────────────────────────────────────
  {
    key: 'dashboard.view',
    label: 'View dashboard',
    group: 'Overview',
    description: 'See the summary tiles and charts on the home page.',
  },

  // ── Communication ─────────────────────────────────────────────────────
  {
    key: 'chat.view',
    label: 'View live chat',
    group: 'Communication',
    description: 'Read customer conversations.',
  },
  {
    key: 'chat.send',
    label: 'Reply in live chat',
    group: 'Communication',
    description: 'Send messages to customers from the admin panel.',
  },
  {
    key: 'chat.export',
    label: 'Export chat numbers',
    group: 'Communication',
    description: 'Download the real-number CSV from Live Chat.',
  },
  {
    key: 'sessions.view',
    label: 'View linked devices',
    group: 'Communication',
  },
  {
    key: 'sessions.manage',
    label: 'Manage linked devices',
    group: 'Communication',
    description: 'Pair, restart, log out and delete WhatsApp sessions.',
  },
  {
    key: 'bulk.send',
    label: 'Send bulk messages',
    group: 'Communication',
    description: 'Broadcast to many recipients at once.',
  },

  // ── CRM & Sales ───────────────────────────────────────────────────────
  { key: 'crm.view', label: 'View CRM', group: 'CRM & Sales' },
  {
    key: 'crm.edit',
    label: 'Edit CRM records',
    group: 'CRM & Sales',
    description: 'Create and update contacts, deals and activities.',
  },
  {
    key: 'crm.delete',
    label: 'Delete CRM records',
    group: 'CRM & Sales',
  },
  {
    key: 'crm.export',
    label: 'Export CRM data',
    group: 'CRM & Sales',
    description: 'Download contact / lead / booking CSVs.',
  },
  { key: 'followup.view', label: 'Follow-up manager', group: 'CRM & Sales' },
  { key: 'calendar.view', label: 'Calendar & bookings', group: 'CRM & Sales' },
  {
    key: 'consulting.view',
    label: 'Consulting Assistant AI',
    group: 'CRM & Sales',
  },

  // ── AI & Automation ───────────────────────────────────────────────────
  { key: 'voice.view', label: 'View voice agent', group: 'AI & Automation' },
  {
    key: 'voice.manage',
    label: 'Configure voice agent',
    group: 'AI & Automation',
    description: 'Change TTS providers, voices and API keys.',
  },
  { key: 'forms.manage', label: 'Form builder', group: 'AI & Automation' },
  { key: 'datasets.manage', label: 'Datasets', group: 'AI & Automation' },
  { key: 'webhooks.manage', label: 'Webhooks', group: 'AI & Automation' },
  {
    key: 'knowledge.manage',
    label: 'Knowledge base',
    group: 'AI & Automation',
  },
  { key: 'workflows.manage', label: 'Workflows', group: 'AI & Automation' },

  // ── Agents ────────────────────────────────────────────────────────────
  { key: 'agents.view', label: 'View agents', group: 'Agents' },
  {
    key: 'agents.manage',
    label: 'Configure agents',
    group: 'Agents',
    description: 'Change agent modes, prompts and budgets.',
  },
  {
    key: 'agents.approve',
    label: 'Approve agent actions',
    group: 'Agents',
    description: 'Release or reject queued outbound messages.',
  },

  // ── Marketing ─────────────────────────────────────────────────────────
  { key: 'channels.manage', label: 'Channels', group: 'Marketing' },
  { key: 'campaigns.view', label: 'View campaigns', group: 'Marketing' },
  {
    key: 'campaigns.manage',
    label: 'Create & launch campaigns',
    group: 'Marketing',
  },
  { key: 'segments.manage', label: 'Segments', group: 'Marketing' },
  { key: 'content.manage', label: 'Content studio', group: 'Marketing' },
  { key: 'insights.view', label: 'Marketing insights', group: 'Marketing' },

  // ── System ────────────────────────────────────────────────────────────
  {
    key: 'users.view',
    label: 'View users',
    group: 'System',
    description: 'See the employee list and their roles.',
  },
  {
    key: 'users.manage',
    label: 'Manage users & roles',
    group: 'System',
    description:
      'Add employees, assign roles, reset passwords and edit role permissions.',
  },
  { key: 'tenants.manage', label: 'Tenants', group: 'System' },
  { key: 'audit.view', label: 'Audit log', group: 'System' },
  {
    key: 'config.manage',
    label: 'Configuration',
    group: 'System',
    description: 'AI providers, API keys and global settings.',
  },
  {
    key: 'system.manage',
    label: 'System health & maintenance',
    group: 'System',
  },
];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);
const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

/** Groups in catalogue order — drives the role editor's section order. */
export const PERMISSION_GROUPS: string[] = PERMISSIONS.reduce<string[]>(
  (groups, p) => (groups.includes(p.group) ? groups : [...groups, p.group]),
  [],
);

export function isKnownPermission(key: unknown): key is PermissionKey {
  return typeof key === 'string' && PERMISSION_KEY_SET.has(key);
}

/** Drop anything not in the catalogue; de-duplicate; keep catalogue order. */
export function sanitisePermissions(input: unknown): PermissionKey[] {
  const list = Array.isArray(input) ? input : [];
  const wanted = new Set(
    list.filter((k): k is string => typeof k === 'string').map((k) => k.trim()),
  );
  const out: PermissionKey[] = [];
  // '*' and 'area.*' are grants, not catalogue entries, so they're preserved
  // separately from the exact-key pass below.
  if (wanted.has('*')) out.push('*');
  for (const key of wanted) {
    if (key !== '*' && key.endsWith('.*')) out.push(key);
  }
  for (const key of PERMISSION_KEYS) {
    if (wanted.has(key)) out.push(key);
  }
  return out;
}

/**
 * Does a set of granted permissions satisfy `required`?
 * Handles the '*' and 'area.*' grant forms.
 */
export function grantsPermission(
  granted: readonly PermissionKey[] | undefined | null,
  required: PermissionKey,
): boolean {
  if (!granted || granted.length === 0) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const area = required.split('.')[0];
  return granted.includes(`${area}.*`);
}

/** Expand grants (including wildcards) into concrete catalogue keys. */
export function expandPermissions(
  granted: readonly PermissionKey[] | undefined | null,
): PermissionKey[] {
  if (!granted || granted.length === 0) return [];
  if (granted.includes('*')) return [...PERMISSION_KEYS];
  return PERMISSION_KEYS.filter((key) => grantsPermission(granted, key));
}

export interface RolePreset {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** System roles ship with the product and cannot be deleted. */
  isSystem: true;
  /**
   * Roles that can administer other users. Guarded separately from the
   * users.manage permission so a preset can never accidentally hand out
   * account control.
   */
  rank: number;
}

/**
 * Employee-facing role presets, seeded on boot. Operators can edit the
 * permission list of any of these (except super_admin) or add their own
 * roles on top — the presets are a starting point, not a ceiling.
 *
 * `rank` orders privilege: a user may never create or edit a user whose role
 * outranks their own, which is what stops a manager from minting an admin.
 */
export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description:
      'Full access to everything, including tenants and user management.',
    permissions: ['*'],
    isSystem: true,
    rank: 100,
  },
  {
    key: 'admin',
    name: 'Administrator',
    description:
      'Runs the whole workspace: every feature and user management, but not multi-tenant setup.',
    permissions: [
      'dashboard.view',
      'chat.*',
      'sessions.*',
      'bulk.send',
      'crm.*',
      'followup.view',
      'calendar.view',
      'consulting.view',
      'voice.*',
      'forms.manage',
      'datasets.manage',
      'webhooks.manage',
      'knowledge.manage',
      'workflows.manage',
      'agents.*',
      'channels.manage',
      'campaigns.*',
      'segments.manage',
      'content.manage',
      'insights.view',
      'users.view',
      'users.manage',
      'audit.view',
      'config.manage',
      'system.manage',
    ],
    isSystem: true,
    rank: 90,
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Oversees the team: full CRM and campaigns, chat, approvals and reporting. No system configuration.',
    permissions: [
      'dashboard.view',
      'chat.view',
      'chat.send',
      'chat.export',
      'sessions.view',
      'bulk.send',
      'crm.view',
      'crm.edit',
      'crm.delete',
      'crm.export',
      'followup.view',
      'calendar.view',
      'consulting.view',
      'voice.view',
      'forms.manage',
      'agents.view',
      'agents.approve',
      'campaigns.view',
      'campaigns.manage',
      'segments.manage',
      'content.manage',
      'insights.view',
      'users.view',
      'audit.view',
    ],
    isSystem: true,
    rank: 70,
  },
  {
    key: 'agent',
    name: 'Support Agent',
    description:
      'Front-line staff: answers customer chats and keeps CRM records up to date.',
    permissions: [
      'dashboard.view',
      'chat.view',
      'chat.send',
      'crm.view',
      'crm.edit',
      'followup.view',
      'calendar.view',
      'consulting.view',
    ],
    isSystem: true,
    rank: 40,
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description:
      'Runs campaigns, segments and content. Reads CRM but does not edit customer records.',
    permissions: [
      'dashboard.view',
      'crm.view',
      'crm.export',
      'channels.manage',
      'campaigns.view',
      'campaigns.manage',
      'segments.manage',
      'content.manage',
      'insights.view',
    ],
    isSystem: true,
    rank: 40,
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to the dashboard, chats and CRM.',
    permissions: [
      'dashboard.view',
      'chat.view',
      'crm.view',
      'followup.view',
      'calendar.view',
      'insights.view',
      'campaigns.view',
      'agents.view',
    ],
    isSystem: true,
    rank: 10,
  },
];

export const ROLE_PRESET_BY_KEY = new Map(ROLE_PRESETS.map((r) => [r.key, r]));

/** Rank for an unknown / custom role — below every built-in staff role. */
export const DEFAULT_ROLE_RANK = 20;

/**
 * Legacy role strings that predate this module. The bootstrap admin was
 * created as 'superadmin' / 'super-admin' / 'super_admin' depending on the
 * era, and everything else defaulted to 'admin'. Map them onto presets so
 * existing accounts keep working with no migration.
 */
export function normaliseRoleKey(role: unknown): string {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (value === 'superadmin' || value === 'super-admin') return 'super_admin';
  if (value === '') return 'admin';
  return value;
}
