/**
 * Permission keys the frontend gates on.
 *
 * This is a deliberately small mirror of the backend catalogue
 * (src/config/permissions.ts) — only the keys the UI branches on. The full
 * catalogue with labels and groups is FETCHED from
 * `GET /api/users/permissions` for the role editor, so there is exactly one
 * place to add a permission when a new feature lands: the backend file.
 *
 * The nav filter and route guards here are convenience only. Every one of
 * these is also enforced server-side, so hiding a link is a UX affordance,
 * never the security boundary.
 */
export const PERM = {
  dashboard: 'dashboard.view',
  chatView: 'chat.view',
  chatSend: 'chat.send',
  chatExport: 'chat.export',
  sessionsView: 'sessions.view',
  sessionsManage: 'sessions.manage',
  bulkSend: 'bulk.send',
  crmView: 'crm.view',
  crmEdit: 'crm.edit',
  crmExport: 'crm.export',
  followup: 'followup.view',
  calendar: 'calendar.view',
  consulting: 'consulting.view',
  voiceView: 'voice.view',
  voiceManage: 'voice.manage',
  forms: 'forms.manage',
  datasets: 'datasets.manage',
  webhooks: 'webhooks.manage',
  agentsView: 'agents.view',
  agentsManage: 'agents.manage',
  agentsApprove: 'agents.approve',
  channels: 'channels.manage',
  campaignsView: 'campaigns.view',
  campaignsManage: 'campaigns.manage',
  segments: 'segments.manage',
  content: 'content.manage',
  insights: 'insights.view',
  usersView: 'users.view',
  usersManage: 'users.manage',
  tenants: 'tenants.manage',
  audit: 'audit.view',
  config: 'config.manage',
  system: 'system.manage',
} as const;

export type PermissionKey = (typeof PERM)[keyof typeof PERM] | string;

/**
 * Does a granted list satisfy `required`? Mirrors grantsPermission() on the
 * backend, including the '*' and 'area.*' wildcard grant forms — /api/auth/me
 * returns them already expanded, but a wildcard could still arrive from an
 * older server, and treating it correctly is cheaper than a version check.
 */
export function hasPermission(
  granted: readonly string[] | null | undefined,
  required: PermissionKey,
): boolean {
  if (!granted || granted.length === 0) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  const area = String(required).split('.')[0];
  return granted.includes(`${area}.*`);
}
