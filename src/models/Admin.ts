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

export default mongoose.model(
  'Admin',
  AdminSchema as any,
) as unknown as mongoose.Model<IAdmin>;
