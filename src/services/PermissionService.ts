import mongoose from 'mongoose';
import Admin, { IAdmin } from '../models/Admin';
import Role, { IRole } from '../models/Role';
import {
  DEFAULT_ROLE_RANK,
  PermissionKey,
  ROLE_PRESETS,
  ROLE_PRESET_BY_KEY,
  expandPermissions,
  grantsPermission,
  normaliseRoleKey,
  sanitisePermissions,
} from '../config/permissions';

/**
 * Resolves what a signed-in account is actually allowed to do.
 *
 * Permissions are resolved PER REQUEST from the database, never baked into
 * the JWT. That costs one (cached) lookup but means revoking someone's
 * access takes effect on their next click instead of whenever their 24h
 * token happens to expire — which is the whole point of having the feature.
 */

export interface RoleSummary {
  key: string;
  name: string;
  permissions: string[];
  rank: number;
}

export interface ResolvedIdentity {
  id: string;
  username: string;
  roleKey: string;
  roleName: string;
  rank: number;
  /** Concrete catalogue keys, wildcards already expanded. */
  permissions: PermissionKey[];
  status: 'active' | 'disabled';
  tenantId?: string;
  fullName?: string;
  email?: string;
  jobTitle?: string;
}

/**
 * Short-lived cache so a burst of requests from one page load doesn't re-read
 * the admin + role every time. Deliberately tiny: long enough to absorb a
 * page's parallel API calls, short enough that a permission change is visible
 * almost immediately. Any write through the users/roles API also invalidates
 * it explicitly, so the TTL only covers changes made outside the app.
 */
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: ResolvedIdentity | null }>();

export function invalidatePermissionCache(adminId?: string): void {
  if (adminId) cache.delete(String(adminId));
  else cache.clear();
}

/**
 * Seed the built-in roles. Idempotent — safe to run on every boot.
 *
 * A role the operator has never edited is refreshed from the preset, so a
 * release that adds a permission (or a new feature area) reaches installs
 * that were seeded by an earlier version. Once someone edits a built-in
 * role the `customised` flag is set and the seeder stops touching its
 * permissions — an upgrade must never silently undo a deliberate change.
 */
export async function ensureSystemRoles(): Promise<void> {
  for (const preset of ROLE_PRESETS) {
    const existing = (await Role.findOne({
      key: preset.key,
      tenantId: { $exists: false },
    }).lean()) as unknown as IRole | null;

    if (!existing) {
      await Role.create({
        key: preset.key,
        name: preset.name,
        description: preset.description,
        permissions: preset.permissions,
        isSystem: true,
        rank: preset.rank,
        customised: false,
      });
      continue;
    }

    const update: Record<string, unknown> = {
      isSystem: true,
      rank: preset.rank,
    };
    if (!existing.customised) {
      update.name = preset.name;
      update.description = preset.description;
      update.permissions = preset.permissions;
    }
    await Role.updateOne({ _id: existing._id }, { $set: update });
  }
  invalidatePermissionCache();
}

/**
 * Look up a role by key, preferring a tenant's own override of a system role.
 * Falls back to the in-code preset when the collection has no row yet (fresh
 * install, or Mongo unavailable at boot) so permissions never silently
 * collapse to "nothing".
 */
export async function findRole(
  roleKey: string,
  tenantId?: string | null,
): Promise<RoleSummary | null> {
  const key = normaliseRoleKey(roleKey);
  const clauses: Record<string, unknown>[] = [
    { key, tenantId: { $exists: false } },
  ];
  const scopedTenant =
    tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))
      ? new mongoose.Types.ObjectId(String(tenantId))
      : null;
  if (scopedTenant) clauses.push({ key, tenantId: scopedTenant });

  let doc: IRole | null = null;
  try {
    const rows = (await Role.find({ $or: clauses }).lean()) as unknown as
      IRole[] | null;
    const list = rows ?? [];
    // A tenant's own row wins over the shared system row.
    doc =
      list.find((r) => r.tenantId && String(r.tenantId) === String(tenantId)) ??
      list[0] ??
      null;
  } catch {
    doc = null;
  }

  if (doc) {
    return {
      key: doc.key,
      name: doc.name,
      permissions: Array.isArray(doc.permissions) ? doc.permissions : [],
      rank: typeof doc.rank === 'number' ? doc.rank : DEFAULT_ROLE_RANK,
    };
  }

  const preset = ROLE_PRESET_BY_KEY.get(key);
  return preset
    ? {
        key: preset.key,
        name: preset.name,
        permissions: preset.permissions,
        rank: preset.rank,
      }
    : null;
}

/**
 * Fold an account and its role into the effective identity.
 *
 * Back-compat, in order:
 *   1. `roleKey` when set (the field this feature introduces).
 *   2. Otherwise the legacy free-text `role`, normalised — an account created
 *      as 'superadmin' years ago still resolves to Super Admin.
 *   3. An account with NO tenantId and NO roleKey is treated as a super
 *      admin, matching the pre-existing requireSuperAdmin() rule. Without
 *      this every legacy single-admin deployment would lose access the
 *      moment this ships.
 */
export function buildIdentity(
  admin: IAdmin,
  role: RoleSummary | null,
): ResolvedIdentity {
  const roleKey = normaliseRoleKey(admin.roleKey || admin.role);
  const legacySuperAdmin = !admin.tenantId && !admin.roleKey;
  const preset = ROLE_PRESET_BY_KEY.get(roleKey);

  // A legacy account whose free-text `role` matches no preset and has no role
  // document (a hand-edited database, or a value from before this feature)
  // falls back to Administrator rather than to nothing — locking an existing
  // operator out of their own panel on upgrade would be the worse failure.
  // An account with an explicit `roleKey` fails closed instead: that role was
  // chosen deliberately, and if it was since deleted, no access is correct.
  const fallback =
    !admin.roleKey && !role && !preset
      ? (ROLE_PRESET_BY_KEY.get('admin')?.permissions ?? [])
      : [];

  const granted: string[] = legacySuperAdmin
    ? ['*']
    : (role?.permissions ?? preset?.permissions ?? fallback);
  const extra = sanitisePermissions(admin.permissions);

  return {
    id: String(admin._id),
    username: admin.username,
    roleKey,
    roleName: role?.name ?? preset?.name ?? roleKey,
    rank: legacySuperAdmin
      ? 100
      : (role?.rank ?? preset?.rank ?? DEFAULT_ROLE_RANK),
    permissions: expandPermissions([...granted, ...extra]),
    status: admin.status === 'disabled' ? 'disabled' : 'active',
    tenantId: admin.tenantId ? String(admin.tenantId) : undefined,
    fullName: admin.fullName,
    email: admin.email,
    jobTitle: admin.jobTitle,
  };
}

/** Load + resolve an account by id (cached). Returns null when it's gone. */
export async function resolveIdentity(
  adminId: string,
): Promise<ResolvedIdentity | null> {
  const cacheKey = String(adminId);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let admin: IAdmin | null = null;
  try {
    admin = (await Admin.findById(adminId).lean()) as unknown as IAdmin | null;
  } catch {
    admin = null;
  }

  let value: ResolvedIdentity | null = null;
  if (admin) {
    const roleKey = normaliseRoleKey(admin.roleKey || admin.role);
    const role = await findRole(
      roleKey,
      admin.tenantId ? String(admin.tenantId) : null,
    );
    value = buildIdentity(admin, role);
  }

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Does this identity hold `required`? Disabled accounts hold nothing. */
export function identityCan(
  identity: ResolvedIdentity | null | undefined,
  required: PermissionKey,
): boolean {
  if (!identity) return false;
  if (identity.status === 'disabled') return false;
  return grantsPermission(identity.permissions, required);
}
