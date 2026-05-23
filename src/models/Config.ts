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
  monthlyBudget?: number;
  isActive?: boolean;
  // Monthly cycle tracking
  usagePeriodStart?: Date;
  lastResetAt?: Date;
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
    monthlyBudget: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
    usagePeriodStart: { type: Date, default: null },
    lastResetAt: { type: Date, default: null },
  } as any,
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

const __ConfigModel = mongoose.models.Config || mongoose.model('Config', ConfigSchema as any);
export default __ConfigModel as unknown as mongoose.Model<IConfig>;
