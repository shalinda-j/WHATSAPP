import mongoose, { Schema, Document } from 'mongoose';

/**
 * A named bundle of permissions that can be assigned to staff accounts.
 *
 * The presets in src/config/permissions.ts are seeded into this collection on
 * boot so operators can edit them (and add their own) from the admin UI
 * without a deploy. `isSystem` roles cannot be deleted — removing 'admin'
 * out from under every account that references it would lock people out.
 */
export interface IRole extends Document {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  /**
   * True once an operator has edited a built-in role's permissions. The boot
   * seeder refreshes un-customised system roles so a release that adds a new
   * permission reaches existing installs, and leaves customised ones alone so
   * it never undoes somebody's deliberate change.
   */
  customised?: boolean;
  /**
   * Privilege ordering. A user can never create or modify an account whose
   * role outranks their own, which is what prevents a manager from minting
   * an administrator for themselves.
   */
  rank: number;
  tenantId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema(
  {
    // Stable machine key ('manager'); what Admin.roleKey references.
    key: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    permissions: [{ type: String }],
    isSystem: { type: Boolean, default: false },
    customised: { type: Boolean, default: false },
    rank: { type: Number, default: 20 },
    // Custom roles belong to a tenant; seeded system roles are global (unset)
    // so every tenant shares one definition of 'admin'.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
  },
  { timestamps: true } as any,
);

// One role per key per tenant. Sparse-free on purpose: the seeded system
// roles have tenantId undefined, which Mongo treats as a distinct value, so
// they occupy the (key, null) slot and per-tenant custom roles sit alongside.
RoleSchema.index({ key: 1, tenantId: 1 }, { unique: true });

export default mongoose.model(
  'Role',
  RoleSchema as any,
) as unknown as mongoose.Model<IRole>;
