import mongoose from 'mongoose';

export interface ILidPhoneMapping {
  sessionId?: string;
  lidJid: string;
  phoneJid: string;
  phone: string;
  source: 'message' | 'phone_number_share' | 'chat_metadata' | 'manual';
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const LidPhoneMappingSchema = new mongoose.Schema<ILidPhoneMapping>({
  sessionId: { type: String, index: true },
  lidJid: { type: String, required: true, index: true },
  phoneJid: { type: String, required: true, index: true },
  phone: { type: String, required: true, index: true },
  source: {
    type: String,
    enum: ['message', 'phone_number_share', 'chat_metadata', 'manual'],
    required: true,
  },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

LidPhoneMappingSchema.index({ sessionId: 1, lidJid: 1 });
LidPhoneMappingSchema.index({ lidJid: 1, lastSeenAt: -1 });

const __LidPhoneMappingModel =
  mongoose.models.LidPhoneMapping ||
  mongoose.model('LidPhoneMapping', LidPhoneMappingSchema as any);
export default __LidPhoneMappingModel as unknown as mongoose.Model<ILidPhoneMapping>;
