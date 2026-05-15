import mongoose, { Schema, Document } from 'mongoose';
import { Channel } from '../types/agent';

export interface IChannelConnection extends Document {
  tenantId: mongoose.Types.ObjectId;
  channel: Channel;
  /** Human label so operators can distinguish multiple connections per channel. */
  label: string;
  /** Channel-specific credentials — every secret encrypted via CryptoService. */
  credentials: Record<string, string>;
  /** Connection-level metadata — page IDs, account IDs, webhook tokens. */
  config: Record<string, unknown>;
  status: 'pending' | 'active' | 'failed' | 'disconnected';
  lastError?: string;
  lastConnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelConnectionSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    channel: { type: String, required: true, index: true },
    label: { type: String, required: true },
    credentials: { type: Schema.Types.Mixed, default: {} },
    config: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'active', 'failed', 'disconnected'],
      default: 'pending',
      index: true,
    },
    lastError: { type: String },
    lastConnectedAt: { type: Date },
  } as any,
  { timestamps: true },
);

ChannelConnectionSchema.index({ tenantId: 1, channel: 1 });

export default mongoose.model(
  'ChannelConnection',
  ChannelConnectionSchema as any,
) as unknown as mongoose.Model<IChannelConnection>;
