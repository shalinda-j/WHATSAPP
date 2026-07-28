import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { z } from 'zod';
import Admin, { IAdmin } from '../../models/Admin';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant, tenantIdOf } from '../middleware/tenantContext';
import {
  PermissionRequest,
  loadIdentity,
  requirePermission,
} from '../middleware/permissions';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  normaliseRoleKey,
  sanitisePermissions,
} from '../../config/permissions';
import LoginEvent from '../../models/LoginEvent';
import {
  buildLoginHistoryFilter,
  describeOutcome,
  describeUserAgent,
} from '../../services/LoginHistoryService';
import { parseExportDateBoundary } from './exports';
import { toCsv, csvDownloadHeaders } from '../utils/csv';
import {
  buildIdentity,
  findRole,
  invalidatePermissionCache,
} from '../../services/PermissionService';

/**
 * Staff (employee) account management.
 *
 * Two guard rails run on every mutation and are the reason this router
 * doesn't just CRUD the Admin collection:
 *
 *   1. Rank — you can never create or modify an account whose role outranks
 *      (or, unless you're a super admin, equals) your own. Without it a
 *      Manager could hand themselves the Administrator role.
 *   2. Grant containment — you can never hand out a permission you don't
 *      hold yourself, which closes the same escalation via the per-user
 *      "extra permissions" field.
 */

const router = Router();

router.use(authenticateToken);
router.use(resolveTenant);
router.use(loadIdentity);

const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be at most 50 characters')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'Username may only contain letters, digits, ., _ and -',
  );

const CreateUserSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  roleKey: z.string().min(1, 'A role is required'),
  fullName: z.string().max(120).optional(),
  email: z
    .string()
    .email('Enter a valid email')
    .max(160)
    .optional()
    .or(z.literal('')),
  jobTitle: z.string().max(120).optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const UpdateUserSchema = z.object({
  roleKey: z.string().min(1).optional(),
  fullName: z.string().max(120).optional(),
  email: z
    .string()
    .email('Enter a valid email')
    .max(160)
    .optional()
    .or(z.literal('')),
  jobTitle: z.string().max(120).optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

type PublicUser = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  jobTitle: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  extraPermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt: Date | null;
  createdAt: Date | null;
  isSelf: boolean;
  /** False when the viewer outranks nothing — used to grey out row actions. */
  editable: boolean;
};

/** Can `actor` act on an account holding a role of `targetRank`? */
function outranks(actorRank: number, targetRank: number): boolean {
  // Super admins (rank 100) may manage peers; everyone else must be strictly
  // above the target, so a Manager can't edit another Manager's access.
  if (actorRank >= 100) return true;
  return actorRank > targetRank;
}

/**
 * Every permission the actor is missing from `wanted` — non-empty means the
 * request is trying to grant more than the actor holds.
 */
function ungrantable(actorPermissions: string[], wanted: string[]): string[] {
  const held = new Set(actorPermissions);
  return wanted.filter((key) => !held.has(key));
}

async function toPublicUser(
  admin: IAdmin,
  actorRank: number,
  actorId: string,
): Promise<PublicUser> {
  const roleKey = normaliseRoleKey(admin.roleKey || admin.role);
  const role = await findRole(
    roleKey,
    admin.tenantId ? String(admin.tenantId) : null,
  );
  const identity = buildIdentity(admin, role);
  return {
    id: String(admin._id),
    username: admin.username,
    fullName: admin.fullName ?? '',
    email: admin.email ?? '',
    jobTitle: admin.jobTitle ?? '',
    roleKey: identity.roleKey,
    roleName: identity.roleName,
    permissions: identity.permissions,
    extraPermissions: sanitisePermissions(admin.permissions),
    status: identity.status,
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt ?? null,
    isSelf: String(admin._id) === actorId,
    editable: outranks(actorRank, identity.rank),
  };
}

/**
 * GET /api/users/permissions
 * The catalogue + role list the admin UI renders its matrix from. Available
 * to anyone who can view users so the list page can label roles.
 */
router.get(
  '/permissions',
  requirePermission('users.view'),
  async (_req: PermissionRequest, res: Response) => {
    res.json({ permissions: PERMISSIONS, groups: PERMISSION_GROUPS });
  },
);

/* -------------------------------------------------------------------------
 * Login history
 * ---------------------------------------------------------------------- */

/** Shared query → filter translation for the history list, stats and CSV. */
function loginHistoryFilterFromRequest(req: PermissionRequest) {
  const actor = req.identity!;
  return buildLoginHistoryFilter({
    adminId: req.query.userId,
    username: req.query.username,
    outcome: req.query.outcome,
    failuresOnly: String(req.query.failuresOnly ?? '') === 'true',
    from: parseExportDateBoundary(req.query.from, 'start'),
    to: parseExportDateBoundary(req.query.to, 'end'),
    // Super admins (no tenant binding) see every workspace's attempts;
    // a tenant-bound operator only sees their own.
    tenantId: actor.tenantId ?? null,
  });
}

type LoginRow = {
  _id: unknown;
  adminId?: unknown;
  username: string;
  outcome: string;
  ip?: string;
  userAgent?: string;
  roleKey?: string;
  createdAt: Date;
};

function serialiseLoginRow(row: LoginRow) {
  return {
    id: String(row._id),
    userId: row.adminId ? String(row.adminId) : null,
    username: row.username,
    outcome: row.outcome,
    outcomeLabel: describeOutcome(row.outcome),
    success: row.outcome === 'success',
    ip: row.ip ?? '',
    device: describeUserAgent(row.userAgent),
    userAgent: row.userAgent ?? '',
    roleKey: row.roleKey ?? '',
    at: row.createdAt,
  };
}

/**
 * GET /api/users/login-history
 *
 * Every sign-in attempt, newest first — successes AND failures, because a
 * run of wrong-password rows against one account is the reason to have this
 * at all. Filters: ?userId= ?username= ?outcome= ?failuresOnly=true
 * ?from= ?to= with ?page= / ?limit= paging.
 *
 * The response also carries a `summary` for the SAME filter (totals, unique
 * IPs, last success) so the page's stat tiles can never disagree with the
 * table below them.
 */
router.get(
  '/login-history',
  requirePermission('users.view'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const filter = loginHistoryFilterFromRequest(req);

      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1),
        200,
      );
      const page = Math.max(
        parseInt(String(req.query.page ?? '1'), 10) || 1,
        1,
      );

      const [rows, total, stats] = await Promise.all([
        LoginEvent.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean() as unknown as Promise<LoginRow[]>,
        LoginEvent.countDocuments(filter),
        LoginEvent.aggregate([
          { $match: filter },
          {
            $group: {
              _id: null,
              successes: {
                $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
              },
              failures: {
                $sum: { $cond: [{ $ne: ['$outcome', 'success'] }, 1, 0] },
              },
              ips: { $addToSet: '$ip' },
              lastSuccess: {
                $max: {
                  $cond: [{ $eq: ['$outcome', 'success'] }, '$createdAt', null],
                },
              },
            },
          },
        ]) as unknown as Promise<
          Array<{
            successes: number;
            failures: number;
            ips: (string | null)[];
            lastSuccess: Date | null;
          }>
        >,
      ]);

      const agg = stats[0];
      res.json({
        events: rows.map(serialiseLoginRow),
        total,
        page,
        limit,
        hasMore: page * limit < total,
        summary: {
          total,
          successes: agg?.successes ?? 0,
          failures: agg?.failures ?? 0,
          uniqueIps: (agg?.ips ?? []).filter(Boolean).length,
          lastSuccess: agg?.lastSuccess ?? null,
        },
      });
    } catch (err: any) {
      console.error('GET /api/users/login-history failed:', err);
      res.status(500).json({ error: err?.message ?? 'history_failed' });
    }
  },
);

/**
 * GET /api/users/login-history.csv
 * The same filtered rows as a spreadsheet, for handing to whoever asked
 * "who was logged in on the 14th".
 */
router.get(
  '/login-history.csv',
  requirePermission('users.view'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const filter = loginHistoryFilterFromRequest(req);
      const rows = (await LoginEvent.find(filter)
        .sort({ createdAt: -1 })
        .limit(20_000)
        .lean()) as unknown as LoginRow[];

      const flat = rows.map((r) => {
        const row = serialiseLoginRow(r);
        return {
          When: row.at,
          Username: row.username,
          Outcome: row.outcomeLabel,
          Role: row.roleKey,
          IP: row.ip,
          Device: row.device,
        };
      });

      const csv = toCsv(flat, [
        'When',
        'Username',
        'Outcome',
        'Role',
        'IP',
        'Device',
      ]);
      res
        .set(
          csvDownloadHeaders(
            `login-history-${new Date().toISOString().slice(0, 10)}.csv`,
          ),
        )
        .send(csv);
    } catch (err: any) {
      console.error('GET /api/users/login-history.csv failed:', err);
      res.status(500).json({ error: err?.message ?? 'export_failed' });
    }
  },
);

/** GET /api/users — the employee list. */
router.get(
  '/',
  requirePermission('users.view'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const tenantId = tenantIdOf(req);

      // Tenant scope: a tenant-bound actor only ever sees their own staff.
      // A super admin (no tenant binding) sees everyone, which is what makes
      // the page usable on single-tenant installs where nothing is stamped.
      const filter: Record<string, unknown> = actor.tenantId
        ? {
            $or: [
              { tenantId: new mongoose.Types.ObjectId(String(actor.tenantId)) },
              { tenantId: { $exists: false } },
            ],
          }
        : {};

      const search =
        typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search) {
        const rx = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$and = [
          {
            $or: [
              { username: { $regex: rx, $options: 'i' } },
              { fullName: { $regex: rx, $options: 'i' } },
              { email: { $regex: rx, $options: 'i' } },
            ],
          },
        ];
      }

      const rows = (await Admin.find(filter)
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()) as unknown as IAdmin[];

      const users = await Promise.all(
        rows.map((row) => toPublicUser(row, actor.rank, actor.id)),
      );

      // One bounded aggregate gives the whole list its recent-activity
      // columns, instead of a per-row query. 30 days is the window the
      // employee table summarises; the Login history tab has the full detail.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const activity = (await LoginEvent.aggregate([
        {
          $match: {
            adminId: { $in: rows.map((r) => r._id) },
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: '$adminId',
            logins: {
              $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $ne: ['$outcome', 'success'] }, 1, 0] },
            },
          },
        },
      ])) as Array<{ _id: unknown; logins: number; failed: number }>;

      const byUser = new Map(
        activity.map((a) => [
          String(a._id),
          { logins: a.logins, failed: a.failed },
        ]),
      );
      const withActivity = users.map((u) => ({
        ...u,
        logins30d: byUser.get(u.id)?.logins ?? 0,
        failedLogins30d: byUser.get(u.id)?.failed ?? 0,
      }));

      res.json({
        users: withActivity,
        total: withActivity.length,
        tenantId: tenantId ?? null,
      });
    } catch (err: any) {
      console.error('GET /api/users failed:', err);
      res.status(500).json({ error: err?.message ?? 'list_failed' });
    }
  },
);

/** POST /api/users — add an employee. */
router.post(
  '/',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const parsed = CreateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_request',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const body = parsed.data;

      const roleKey = normaliseRoleKey(body.roleKey);
      const role = await findRole(roleKey, actor.tenantId ?? null);
      if (!role) {
        return res.status(400).json({ error: 'unknown_role', roleKey });
      }
      if (!outranks(actor.rank, role.rank)) {
        return res.status(403).json({
          error: 'role_outranks_actor',
          message: `You cannot assign the "${role.name}" role.`,
        });
      }

      const extras = sanitisePermissions(body.permissions);
      const denied = ungrantable(actor.permissions, extras);
      if (denied.length > 0) {
        return res.status(403).json({
          error: 'cannot_grant_unheld_permission',
          message: 'You can only grant permissions you hold yourself.',
          denied,
        });
      }

      const existing = await Admin.findOne({ username: body.username }).lean();
      if (existing) {
        return res.status(409).json({ error: 'username_taken' });
      }

      const passwordHash = await bcrypt.hash(body.password, 10);
      const created = await Admin.create({
        username: body.username,
        passwordHash,
        role: roleKey,
        roleKey,
        permissions: extras,
        status: body.status ?? 'active',
        fullName: body.fullName || undefined,
        email: body.email || undefined,
        jobTitle: body.jobTitle || undefined,
        // New staff belong to the acting admin's tenant. A super admin
        // creating a user while scoped to a tenant (X-Tenant-Slug) stamps
        // that tenant, which is what makes per-tenant staff lists work.
        tenantId: actor.tenantId
          ? new mongoose.Types.ObjectId(String(actor.tenantId))
          : (tenantIdOf(req) as mongoose.Types.ObjectId | undefined),
        createdBy: new mongoose.Types.ObjectId(actor.id),
      });

      invalidatePermissionCache(String(created._id));
      const user = await toPublicUser(
        created.toObject() as IAdmin,
        actor.rank,
        actor.id,
      );
      res.status(201).json({ user });
    } catch (err: any) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'username_taken' });
      }
      console.error('POST /api/users failed:', err);
      res.status(500).json({ error: err?.message ?? 'create_failed' });
    }
  },
);

/** PATCH /api/users/:id — change role, details, status or extra grants. */
router.patch(
  '/:id',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const parsed = UpdateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_request',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const body = parsed.data;

      const target = (await Admin.findById(
        req.params.id,
      ).lean()) as unknown as IAdmin | null;
      if (!target) return res.status(404).json({ error: 'user_not_found' });

      const currentRole = await findRole(
        normaliseRoleKey(target.roleKey || target.role),
        target.tenantId ? String(target.tenantId) : null,
      );
      const currentIdentity = buildIdentity(target, currentRole);
      if (!outranks(actor.rank, currentIdentity.rank)) {
        return res.status(403).json({
          error: 'target_outranks_actor',
          message: 'You cannot modify an account at or above your own level.',
        });
      }

      const update: Record<string, unknown> = {};

      if (body.roleKey !== undefined) {
        const roleKey = normaliseRoleKey(body.roleKey);
        const role = await findRole(roleKey, actor.tenantId ?? null);
        if (!role) return res.status(400).json({ error: 'unknown_role' });
        if (!outranks(actor.rank, role.rank)) {
          return res.status(403).json({
            error: 'role_outranks_actor',
            message: `You cannot assign the "${role.name}" role.`,
          });
        }
        update.roleKey = roleKey;
        // Keep the legacy field in step so old code paths (and freshly issued
        // JWTs) see the same role.
        update.role = roleKey;
      }

      if (body.permissions !== undefined) {
        const extras = sanitisePermissions(body.permissions);
        const denied = ungrantable(actor.permissions, extras);
        if (denied.length > 0) {
          return res.status(403).json({
            error: 'cannot_grant_unheld_permission',
            message: 'You can only grant permissions you hold yourself.',
            denied,
          });
        }
        update.permissions = extras;
      }

      if (body.status !== undefined) {
        if (String(target._id) === actor.id && body.status === 'disabled') {
          return res.status(400).json({
            error: 'cannot_disable_self',
            message: 'You cannot disable your own account.',
          });
        }
        if (body.status === 'disabled') {
          const blocker = await wouldStrandWorkspace(target);
          if (blocker) return res.status(400).json(blocker);
        }
        update.status = body.status;
      }

      if (body.fullName !== undefined) update.fullName = body.fullName;
      if (body.email !== undefined) update.email = body.email || undefined;
      if (body.jobTitle !== undefined) update.jobTitle = body.jobTitle;

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'nothing_to_update' });
      }

      await Admin.updateOne({ _id: target._id }, { $set: update });
      invalidatePermissionCache(String(target._id));

      const fresh = (await Admin.findById(
        target._id,
      ).lean()) as unknown as IAdmin;
      res.json({ user: await toPublicUser(fresh, actor.rank, actor.id) });
    } catch (err: any) {
      console.error('PATCH /api/users/:id failed:', err);
      res.status(500).json({ error: err?.message ?? 'update_failed' });
    }
  },
);

/** POST /api/users/:id/password — operator-driven password reset. */
router.post(
  '/:id/password',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const parsed = z
        .object({ password: PasswordSchema })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_password',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const target = (await Admin.findById(
        req.params.id,
      ).lean()) as unknown as IAdmin | null;
      if (!target) return res.status(404).json({ error: 'user_not_found' });

      const role = await findRole(
        normaliseRoleKey(target.roleKey || target.role),
        target.tenantId ? String(target.tenantId) : null,
      );
      const identity = buildIdentity(target, role);
      // Resetting your own password is always allowed; resetting someone
      // else's requires outranking them.
      if (
        String(target._id) !== actor.id &&
        !outranks(actor.rank, identity.rank)
      ) {
        return res.status(403).json({ error: 'target_outranks_actor' });
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      await Admin.updateOne({ _id: target._id }, { $set: { passwordHash } });
      invalidatePermissionCache(String(target._id));
      res.json({ success: true });
    } catch (err: any) {
      console.error('POST /api/users/:id/password failed:', err);
      res.status(500).json({ error: err?.message ?? 'reset_failed' });
    }
  },
);

/** DELETE /api/users/:id — remove an employee account. */
router.delete(
  '/:id',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      if (req.params.id === actor.id) {
        return res.status(400).json({
          error: 'cannot_delete_self',
          message: 'You cannot delete your own account.',
        });
      }

      const target = (await Admin.findById(
        req.params.id,
      ).lean()) as unknown as IAdmin | null;
      if (!target) return res.status(404).json({ error: 'user_not_found' });

      const role = await findRole(
        normaliseRoleKey(target.roleKey || target.role),
        target.tenantId ? String(target.tenantId) : null,
      );
      const identity = buildIdentity(target, role);
      if (!outranks(actor.rank, identity.rank)) {
        return res.status(403).json({ error: 'target_outranks_actor' });
      }

      const blocker = await wouldStrandWorkspace(target);
      if (blocker) return res.status(400).json(blocker);

      await Admin.deleteOne({ _id: target._id });
      invalidatePermissionCache(String(target._id));
      res.json({ success: true });
    } catch (err: any) {
      console.error('DELETE /api/users/:id failed:', err);
      res.status(500).json({ error: err?.message ?? 'delete_failed' });
    }
  },
);

/**
 * Refuse to remove the last account that can still administer users —
 * otherwise a workspace can be locked out of its own user management with no
 * way back in short of editing the database by hand.
 */
async function wouldStrandWorkspace(
  target: IAdmin,
): Promise<{ error: string; message: string } | null> {
  const others = (await Admin.find({
    _id: { $ne: target._id },
    status: { $ne: 'disabled' },
  })
    .limit(200)
    .lean()) as unknown as IAdmin[];

  for (const other of others) {
    const role = await findRole(
      normaliseRoleKey(other.roleKey || other.role),
      other.tenantId ? String(other.tenantId) : null,
    );
    const identity = buildIdentity(other, role);
    if (identity.permissions.includes('users.manage')) return null;
  }

  return {
    error: 'last_admin',
    message:
      'This is the only active account that can manage users. Give another account the permission first.',
  };
}

export default router;
