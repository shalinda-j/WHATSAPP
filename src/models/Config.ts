import mongoose, { Schema, Document } from 'mongoose';

export interface IConfig extends Document {
  key: string;
  value: string;
  description?: string;
  isProvider?: boolean;
  providerType?: string;
  apiKey?: string;
  aiModel?: string;
  usageLimit?: number;
  usageUsed?: number;
  costPerToken?: number;
  isActive?: boolean;
}

import { CryptoService } from '../services/CryptoService';

const ConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, default: '' },
    description: { type: String },
    isProvider: { type: Boolean, default: false },
    providerType: { type: String },
    apiKey: {
      type: String,
      set: (val: string) => CryptoService.encrypt(val),
      get: (val: string) => CryptoService.decrypt(val),
    },
    aiModel: { type: String },
    usageLimit: { type: Number, default: 0 },
    usageUsed: { type: Number, default: 0 },
    costPerToken: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
  } as any,
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

export default mongoose.model(
  'Config',
  ConfigSchema as any,
) as unknown as mongoose.Model<IConfig>;
