import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditEvent extends Document {
  tenantId?: mongoose.Types.ObjectId;
  adminId?: mongoose.Types.ObjectId;
  adminUsername?: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  statusCode: number;
  ip?: string;
  userAgent?: string;
  durationMs: number;
  requestSummary?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: Date;
}

const AuditEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'Admin', index: true },
    adminUsername: { type: String },
    method: {
      type: String,
      enum: ['POST', 'PUT', 'PATCH', 'DELETE'],
      required: true,
    },
    path: { type: String, required: true, index: true },
    statusCode: { type: Number, required: true },
    ip: { type: String },
    userAgent: { type: String },
    durationMs: { type: Number, required: true },
    requestSummary: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
  } as any,
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditEventSchema.index({ tenantId: 1, createdAt: -1 });
AuditEventSchema.index({ adminId: 1, createdAt: -1 });
AuditEventSchema.index({ createdAt: -1 });

export default mongoose.model(
  'AuditEvent',
  AuditEventSchema as any,
) as unknown as mongoose.Model<IAuditEvent>;
