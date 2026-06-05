import mongoose from 'mongoose';

// Form Submission Schema
export interface IFormSubmission {
  formId: mongoose.Types.ObjectId;
  phoneNumber: string;
  whatsappJid?: string;
  data: Record<string, any>;
  status: 'new' | 'reviewed' | 'contacted' | 'converted';
  notes?: string;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
}

const FormSubmissionSchema = new (mongoose as any).Schema({
  // Multi-tenancy: scoped to the tenant of the form being submitted.
  // Optional so legacy submissions captured before tenants existed
  // remain visible via the route-level $or filter.
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormTemplate',
    required: true,
  },
  phoneNumber: { type: String, required: true, index: true },
  whatsappJid: { type: String },
  data: { type: Map, of: mongoose.Schema.Types.Mixed, required: true },
  status: {
    type: String,
    enum: ['new', 'reviewed', 'contacted', 'converted'],
    default: 'new',
    index: true,
  },
  notes: { type: String },
  submittedAt: { type: Date, default: Date.now, index: true },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
});

// Indexes
FormSubmissionSchema.index({ formId: 1, submittedAt: -1 });
FormSubmissionSchema.index({ phoneNumber: 1, status: 1 });
FormSubmissionSchema.index({ tenantId: 1, submittedAt: -1 });

const FormSubmission =
  mongoose.models.FormSubmission ||
  (mongoose as any).model('FormSubmission', FormSubmissionSchema);

export default FormSubmission;
