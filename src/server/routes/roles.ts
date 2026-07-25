import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Admin from '../../models/Admin';
import Role, { IRole } from '../../models/Role';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import {
  PermissionRequest,
  loadIdentity,
  requirePermission,
} from '../middleware/permissions';
import {
  DEFAULT_ROLE_RANK,
  ROLE_PRESETS,
  expandPermissions,
  normaliseRoleKey,
  sanitisePermissions,
} from '../../config/permissions';
import { invalidatePermissionCache } from '../../services/PermissionService';

/**
 * Role management — the "what can this job title do" half of the feature.
 *
 * System roles (the seeded presets) can have their permission list edited but
 * never deleted or re-keyed: accounts reference roles by key, so deleting one
 * would silently strip access from everyone holding it.
 */

const router = Router();

router.use(authenticateToken);
router.use(resolveTenant);
router.use(loadIdentity);

const RoleKeySchema = z
  .string()
  .min(2)
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Role key must be lowercase letters, digits and underscores',
  );

const CreateRoleSchema = z.object({
  key: RoleKeySchema,
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).default([]),
  rank: z.number().int().min(1).max(99).optional(),
});

const UpdateRoleSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).optional(),
  rank: z.number().int().min(1).max(99).optional(),
});

type PublicRole = {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  effectivePermissions: string[];
  rank: number;
  isSystem: boolean;
  userCount: number;
  /** False when the role is at or above the viewer's own level. */
  editable: boolean;
};

function outranks(actorRank: number, targetRank: number): boolean {
  if (actorRank >= 100) return true;
  return actorRank > targetRank;
}

/** GET /api/roles — every role visible to this tenant, with usage counts. */
router.get(
  '/',
  requirePermission('users.view'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const tenantClause: Record<string, unknown> = actor.tenantId
        ? {
            $or: [
              { tenantId: new mongoose.Types.ObjectId(String(actor.tenantId)) },
              { tenantId: { $exists: false } },
            ],
          }
        : {};

      let rows = (await Role.find(tenantClause)
        .sort({ rank: -1 })
        .lean()) as unknown as IRole[];

      // Fresh install / seeder hasn't run: fall back to the in-code presets so
      // the UI is never an empty page.
      if (rows.length === 0) {
        rows = ROLE_PRESETS.map(
          (p) =>
            ({
              _id: p.key,
              key: p.key,
              name: p.name,
              description: p.description,
              permissions: p.permissions,
              isSystem: true,
              rank: p.rank,
            }) as unknown as IRole,
        );
      }

      const counts = new Map<string, number>();
      const admins = (await Admin.find(
        {},
        { role: 1, roleKey: 1 },
      ).lean()) as Array<{ role?: string; roleKey?: string }>;
      for (const a of admins) {
        const key = normaliseRoleKey(a.roleKey || a.role);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const roles: PublicRole[] = rows.map((r) => ({
        id: String(r._id),
        key: r.key,
        name: r.name,
        description: r.description ?? '',
        permissions: Array.isArray(r.permissions) ? r.permissions : [],
        effectivePermissions: expandPermissions(r.permissions),
        rank: typeof r.rank === 'number' ? r.rank : DEFAULT_ROLE_RANK,
        isSystem: Boolean(r.isSystem),
        userCount: counts.get(r.key) ?? 0,
        editable: outranks(
          actor.rank,
          typeof r.rank === 'number' ? r.rank : DEFAULT_ROLE_RANK,
        ),
      }));

      res.json({ roles });
    } catch (err: any) {
      console.error('GET /api/roles failed:', err);
      res.status(500).json({ error: err?.message ?? 'list_failed' });
    }
  },
);

/** POST /api/roles — define a custom role for this tenant. */
router.post(
  '/',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const parsed = CreateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_request',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const body = parsed.data;

      const permissions = sanitisePermissions(body.permissions);
      const held = new Set(actor.permissions);
      const denied = expandPermissions(permissions).filter(
        (key) => !held.has(key),
      );
      if (denied.length > 0) {
        return res.status(403).json({
          error: 'cannot_grant_unheld_permission',
          message: 'A role cannot grant permissions you do not hold yourself.',
          denied,
        });
      }

      // A new role must sit strictly below the creator, so nobody can define
      // a role that outranks them and then assign it to themselves.
      const rank = Math.min(
        body.rank ?? DEFAULT_ROLE_RANK,
        actor.rank >= 100 ? 99 : actor.rank - 1,
      );
      if (rank < 1) {
        return res.status(403).json({
          error: 'rank_too_low',
          message: 'Your role cannot create roles.',
        });
      }

      const tenantId = actor.tenantId
        ? new mongoose.Types.ObjectId(String(actor.tenantId))
        : undefined;

      const clash = await Role.findOne({
        key: body.key,
        ...(tenantId ? { tenantId } : { tenantId: { $exists: false } }),
      }).lean();
      if (clash) return res.status(409).json({ error: 'role_key_taken' });

      const created = await Role.create({
        key: body.key,
        name: body.name,
        description: body.description,
        permissions,
        rank,
        isSystem: false,
        ...(tenantId ? { tenantId } : {}),
      });

      invalidatePermissionCache();
      res.status(201).json({
        role: {
          id: String(created._id),
          key: created.key,
          name: created.name,
          description: created.description ?? '',
          permissions: created.permissions,
          effectivePermissions: expandPermissions(created.permissions),
          rank: created.rank,
          isSystem: false,
          userCount: 0,
          editable: true,
        },
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'role_key_taken' });
      }
      console.error('POST /api/roles failed:', err);
      res.status(500).json({ error: err?.message ?? 'create_failed' });
    }
  },
);

/** PATCH /api/roles/:id — edit a role's permissions or label. */
router.patch(
  '/:id',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const parsed = UpdateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_request',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const body = parsed.data;

      const role = (await Role.findById(
        req.params.id,
      ).lean()) as unknown as IRole | null;
      if (!role) return res.status(404).json({ error: 'role_not_found' });

      const currentRank =
        typeof role.rank === 'number' ? role.rank : DEFAULT_ROLE_RANK;
      if (!outranks(actor.rank, currentRank)) {
        return res.status(403).json({
          error: 'role_outranks_actor',
          message: 'You cannot edit a role at or above your own level.',
        });
      }
      // The super-admin role is the workspace's recovery hatch — editing its
      // permissions could lock everyone out of everything.
      if (role.key === 'super_admin') {
        return res.status(403).json({
          error: 'role_locked',
          message: 'Super Admin cannot be edited.',
        });
      }

      const update: Record<string, unknown> = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.description !== undefined) update.description = body.description;
      if (body.rank !== undefined) {
        if (!outranks(actor.rank, body.rank)) {
          return res.status(403).json({ error: 'rank_outranks_actor' });
        }
        update.rank = body.rank;
      }
      if (body.permissions !== undefined) {
        const permissions = sanitisePermissions(body.permissions);
        const held = new Set(actor.permissions);
        const denied = expandPermissions(permissions).filter(
          (key) => !held.has(key),
        );
        if (denied.length > 0) {
          return res.status(403).json({
            error: 'cannot_grant_unheld_permission',
            message:
              'A role cannot grant permissions you do not hold yourself.',
            denied,
          });
        }
        update.permissions = permissions;
        // Mark the role as operator-owned so the boot seeder stops refreshing
        // it from the preset and can never undo this edit on the next deploy.
        update.customised = true;
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'nothing_to_update' });
      }

      await Role.updateOne({ _id: role._id }, { $set: update });
      // Any account holding this role has different permissions now.
      invalidatePermissionCache();

      const fresh = (await Role.findById(role._id).lean()) as unknown as IRole;
      res.json({
        role: {
          id: String(fresh._id),
          key: fresh.key,
          name: fresh.name,
          description: fresh.description ?? '',
          permissions: fresh.permissions,
          effectivePermissions: expandPermissions(fresh.permissions),
          rank: fresh.rank,
          isSystem: Boolean(fresh.isSystem),
          editable: true,
        },
      });
    } catch (err: any) {
      console.error('PATCH /api/roles/:id failed:', err);
      res.status(500).json({ error: err?.message ?? 'update_failed' });
    }
  },
);

/** DELETE /api/roles/:id — custom roles only, and only when unused. */
router.delete(
  '/:id',
  requirePermission('users.manage'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const actor = req.identity!;
      const role = (await Role.findById(
        req.params.id,
      ).lean()) as unknown as IRole | null;
      if (!role) return res.status(404).json({ error: 'role_not_found' });

      if (role.isSystem) {
        return res.status(400).json({
          error: 'system_role',
          message:
            'Built-in roles cannot be deleted — edit their permissions instead.',
        });
      }
      const currentRank =
        typeof role.rank === 'number' ? role.rank : DEFAULT_ROLE_RANK;
      if (!outranks(actor.rank, currentRank)) {
        return res.status(403).json({ error: 'role_outranks_actor' });
      }

      const inUse = await Admin.countDocuments({
        $or: [{ roleKey: role.key }, { role: role.key }],
      });
      if (inUse > 0) {
        return res.status(400).json({
          error: 'role_in_use',
          message: `${inUse} account(s) still use this role. Move them to another role first.`,
        });
      }

      await Role.deleteOne({ _id: role._id });
      invalidatePermissionCache();
      res.json({ success: true });
    } catch (err: any) {
      console.error('DELETE /api/roles/:id failed:', err);
      res.status(500).json({ error: err?.message ?? 'delete_failed' });
    }
  },
);

export default router;
