import mongoose, { Schema, Document } from 'mongoose';
import { Channel } from '../types/agent';
import { CryptoService } from '../services/CryptoService';

/**
 * Encrypt/decrypt every value in a credentials map at rest. Applied via the
 * Mongoose getter/setter below so adapters and routes keep reading/writing
 * plain `{ botToken, apiKey, ... }` while MongoDB only ever holds ciphertext.
 * CryptoService.encrypt is idempotent (skips already-encrypted values) and
 * decrypt returns the input unchanged for plaintext — so legacy rows that were
 * stored before encryption keep working and get encrypted on next save.
 */
function encryptCredentials(
  creds: Record<string, string> | undefined | null,
): Record<string, string> {
  if (!creds || typeof creds !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    out[k] = typeof v === 'string' ? (CryptoService.encrypt(v) ?? v) : v;
  }
  return out;
}

function decryptCredentials(
  creds: Record<string, string> | undefined | null,
): Record<string, string> {
  if (!creds || typeof creds !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    out[k] = typeof v === 'string' ? (CryptoService.decrypt(v) ?? v) : v;
  }
  return out;
}

export interface IChannelConnection extends Document {
  tenantId: mongoose.Types.ObjectId;
  channel: Channel;
  /** Human label so operators can distinguish multiple connections per channel. */
  label: string;
  /** Channel-specific credentials — every secret encrypted via CryptoService. */
  credentials: Record<string, string>;
  /** Connection-level metadata — page IDs, account IDs, webhook tokens. */
  config: Record<string, unknown>;
  /**
   * Which agents are allowed to handle inbound messages on this connection.
   * Empty array = every registered agent eligible (legacy default). Otherwise
   * the orchestrator filters its agent pool to this allowlist for this
   * specific channel/account.
   */
  agentBindings: string[];
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
    credentials: {
      type: Schema.Types.Mixed,
      default: {},
      // Encrypt secrets at rest; decrypt transparently on read.
      set: encryptCredentials,
      get: decryptCredentials,
    },
    config: { type: Schema.Types.Mixed, default: {} },
    agentBindings: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'active', 'failed', 'disconnected'],
      default: 'pending',
      index: true,
    },
    lastError: { type: String },
    lastConnectedAt: { type: Date },
  } as any,
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } },
);

ChannelConnectionSchema.index({ tenantId: 1, channel: 1 });

const __ChannelConnectionModel =
  mongoose.models.ChannelConnection ||
  mongoose.model('ChannelConnection', ChannelConnectionSchema as any);
export default __ChannelConnectionModel as unknown as mongoose.Model<IChannelConnection>;
