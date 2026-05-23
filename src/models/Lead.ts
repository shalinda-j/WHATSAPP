import mongoose from 'mongoose';

const QualificationSchema = new (mongoose as any).Schema(
  {
    documentType: { type: String, default: 'other' },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number },
    extractedText: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const LeadSchema = new (mongoose as any).Schema({
  // Multi-tenancy: scoped to the tenant that captured the lead. Legacy
  // rows without this field are surfaced via $or in the listing query so
  // a fresh tenantId migration doesn't hide existing data.
  tenantId: {
    type: (mongoose as any).Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  // WhatsApp session that captured this lead. Lets the CRM filter by
  // device (Primary Phone / Support Phone / etc) the same way the chat
  // UI does. Legacy leads without this field show under "All devices".
  sessionId: { type: String, index: true },
  // Personal Information
  fullName: { type: String, required: true },
  // phoneNumber is the primary key for CRM reconciliation: LeadQualifier
  // agent + FollowUpScheduler + auto-registration all do `Lead.findOne({
  // phoneNumber })`. Without an index those queries hit COLLSCAN every
  // inbound message → linear cost in lead count.
  phoneNumber: { type: String, required: true, index: true },
  email: { type: String },
  address: { type: String },

  // NEW: Additional Fields
  age: { type: Number },
  interestedCountry: { type: String, index: true },
  experienceYears: { type: String }, // Changed to String to support ranges like "0-1", "1-3"
  cvUrl: { type: String },
  cvFileName: { type: String },
  cvUploadedAt: { type: Date },

  // Job Information
  jobVacancyType: { type: String, required: true, index: true },
  qualifications: [QualificationSchema],

  // Status Tracking
  status: {
    type: String,
    enum: [
      'new',
      'reviewed',
      'contacted',
      'interviewed',
      'accepted',
      'rejected',
    ],
    default: 'new',
    index: true,
  },
  notes: { type: String },

  // CRM Integration
  crmContactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },

  // Metadata
  source: {
    type: String,
    enum: ['whatsapp', 'website', 'referral', 'manual'],
    default: 'whatsapp',
  },
  // Auto-applied tags from the IntentClassifierService (e.g. 'intent:booking_request',
  // 'intent:pricing_question') so the CRM and segment rule engine can
  // filter by inbound conversation signals without a separate scan.
  tags: { type: [String], default: [], index: true },
  registeredAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for search and filtering
LeadSchema.index({ fullName: 'text', phoneNumber: 'text', email: 'text' });
LeadSchema.index({ jobVacancyType: 1, status: 1 });
LeadSchema.index({ interestedCountry: 1, status: 1 });
LeadSchema.index({ registeredAt: -1 });
// FollowUpScheduler queries dormant leads by status + updatedAt range and
// sorts by updatedAt. Without this compound index the lookup degenerated
// to a collection scan on bigger datasets.
LeadSchema.index({ status: 1, updatedAt: 1 });

const Lead = mongoose.models.Lead || (mongoose as any).model('Lead', LeadSchema);

export default Lead;
