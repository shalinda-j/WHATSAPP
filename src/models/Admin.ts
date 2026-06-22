import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  username: string;
  passwordHash: string;
  role: string;
  tenantId?: mongoose.Types.ObjectId;
}

const AdminSchema = new Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'admin' },
  // Optional binding of an admin to a tenant. When unset the admin is treated
  // as a super-admin (full back-compat with existing single-admin / default
  // deployments where every admin can switch tenants via X-Tenant-Slug).
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: false },
} as any);

const __AdminModel =
  mongoose.models.Admin || mongoose.model('Admin', AdminSchema as any);
export default __AdminModel as unknown as mongoose.Model<IAdmin>;
