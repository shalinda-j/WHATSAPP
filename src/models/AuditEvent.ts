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

// TTL: 365 days. Audit events accumulate forever otherwise — every
// admin POST/PUT/PATCH/DELETE writes one row. A 1-year retention
// matches typical compliance windows (SOC2 / ISO 27001) without
// requiring operators to set up an external archiver. Override via
// the AUDIT_RETENTION_DAYS env var when more or less retention is
// needed.
const AUDIT_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.AUDIT_RETENTION_DAYS || '365', 10) || 365,
);
AuditEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 },
);

const __AuditEventModel = mongoose.models.AuditEvent || mongoose.model('AuditEvent', AuditEventSchema as any);
export default __AuditEventModel as unknown as mongoose.Model<IAuditEvent>;
