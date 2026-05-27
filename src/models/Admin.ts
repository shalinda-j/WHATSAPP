import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  username: string;
  passwordHash: string;
  role: string;
}

const AdminSchema = new Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'admin' },
} as any);

const __AdminModel =
  mongoose.models.Admin || mongoose.model('Admin', AdminSchema as any);
export default __AdminModel as unknown as mongoose.Model<IAdmin>;
