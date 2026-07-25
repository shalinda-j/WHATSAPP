import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  username: string;
  passwordHash: string;
  role: string;
  tenantId?: mongoose.Types.ObjectId;
  /**
   * Role assignment. `roleKey` points at a Role document; `role` is kept as
   * the legacy free-text field (and stays in the JWT) so tokens issued before
   * this change keep resolving. New writes set both to the same value.
   */
  roleKey?: string;
  /**
   * Per-user grants layered ON TOP of the role — the "this one person also
   * needs exports" case, without inventing a whole role for it.
   */
  permissions?: string[];
  /** Disabled accounts keep their history but cannot log in. */
  status?: 'active' | 'disabled';
  fullName?: string;
  email?: string;
  jobTitle?: string;
  lastLoginAt?: Date;
  createdBy?: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const AdminSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'admin' },
    // Optional binding of an admin to a tenant. When unset the admin is treated
    // as a super-admin (full back-compat with existing single-admin / default
    // deployments where every admin can switch tenants via X-Tenant-Slug).
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: false },
    roleKey: { type: String, index: true },
    permissions: [{ type: String }],
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
    fullName: { type: String },
    email: { type: String },
    jobTitle: { type: String },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true } as any,
);

const __AdminModel =
  mongoose.models.Admin || mongoose.model('Admin', AdminSchema as any);
export default __AdminModel as unknown as mongoose.Model<IAdmin>;
