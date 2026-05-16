import mongoose from 'mongoose';

// Contact Schema - CRM Contact Management
const ContactSchema = new mongoose.Schema({
  // Multi-tenancy: every CRM doc is scoped to the tenant that created it.
  // Legacy docs (created before this field existed) have it undefined; the
  // list endpoints match those via $or so existing data doesn't vanish.
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  // Combined name field for simpler frontend access
  name: { type: String, required: true },
  // Separate name fields for detailed views
  firstName: { type: String },
  lastName: { type: String },
  email: { type: String },
  phone: { type: String },
  company: { type: String },
  position: { type: String },
  type: {
    type: String,
    enum: ['lead', 'prospect', 'customer', 'partner', 'vendor'],
    default: 'lead',
  },
  source: {
    type: String,
    enum: [
      'website',
      'whatsapp',
      'referral',
      'social_media',
      'cold_call',
      'event',
      'manual',
      'other',
    ],
    default: 'other',
  },
  // Updated status enum to match FollowUp frontend expectations
  status: {
    type: String,
    enum: [
      'new',
      'contacted',
      'interested',
      'not_interested',
      'converted',
      'follow_up',
      'active',
      'inactive',
      'churned',
    ],
    default: 'new',
  },
  // Priority for follow-up management
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  // Follow-up scheduling
  nextFollowUp: { type: Date },
  lastContact: { type: Date },
  whatsappOptIn: { type: Boolean, default: true },
  whatsappNumber: { type: String },
  // Alias for whatsappNumber (frontend uses whatsappId)
  whatsappId: { type: String },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },
  tags: [{ type: String }],
  customFields: { type: Map, of: String },
  notes: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  lastContactedAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
} as any);

ContactSchema.index({
  name: 'text',
  firstName: 'text',
  lastName: 'text',
  email: 'text',
  phone: 'text',
  company: 'text',
});
ContactSchema.index({ type: 1, status: 1 });
ContactSchema.index({ nextFollowUp: 1 });
ContactSchema.index({ priority: 1 });
// Campaign launch + follow-up resolve contacts by phone via an $or across
// these three columns. Sparse so contacts with no phone field don't bloat
// the index. Drops the per-contact lookup from a collection scan to an
// index hit even at 100k+ contacts.
ContactSchema.index({ phone: 1 }, { sparse: true });
ContactSchema.index({ whatsappNumber: 1 }, { sparse: true });
ContactSchema.index({ whatsappId: 1 }, { sparse: true });
// Campaign launches frequently filter out opted-out contacts. Without
// this index the filter triggers a collection scan on every send.
ContactSchema.index({ whatsappOptIn: 1 });

// Pre-save hook to auto-sync fields
ContactSchema.pre('save', function () {
  // Auto-populate name from firstName/lastName if not provided
  if (!this.name && (this.firstName || this.lastName)) {
    this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  // Auto-populate firstName/lastName from name if not provided
  if (this.name && !this.firstName) {
    const parts = this.name.split(' ');
    this.firstName = parts[0];
    if (parts.length > 1) {
      this.lastName = parts.slice(1).join(' ');
    }
  }
  // Sync whatsappId and whatsappNumber
  if (this.whatsappId && !this.whatsappNumber) {
    this.whatsappNumber = this.whatsappId;
  }
  if (this.whatsappNumber && !this.whatsappId) {
    this.whatsappId = this.whatsappNumber;
  }
  // Update updatedAt timestamp
  this.updatedAt = new Date();
});

// Deal Schema - Sales Pipeline Management
const DealSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  title: { type: String, required: true },
  description: String,
  value: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  stage: {
    type: String,
    enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'],
    default: 'new',
  },
  probability: { type: Number, min: 0, max: 100, default: 10 },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  expectedCloseDate: Date,
  actualCloseDate: Date,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  lostReason: {
    type: String,
    enum: [
      'budget',
      'timing',
      'competition',
      'no_response',
      'not_interested',
      'other',
    ],
  },
  lostNotes: String,
  products: [
    {
      name: String,
      quantity: { type: Number, default: 1 },
      price: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
} as any);

DealSchema.index({ stage: 1 });

// Activity Schema - Tasks, Calls, Meetings, Emails
const ActivitySchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  type: {
    type: String,
    enum: ['call', 'meeting', 'email', 'whatsapp', 'task', 'note'],
    required: true,
  },
  title: { type: String, required: true },
  description: String,
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  deal: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal' },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  dueDate: Date,
  completedAt: Date,
  duration: Number,
  outcome: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
} as any);

// Pipeline Stage Schema
const PipelineStageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  order: { type: Number, default: 0 },
  color: { type: String, default: '#6366f1' },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
} as any);

// Create models
const Contact: any =
  mongoose.models.Contact || (mongoose.model as any)('Contact', ContactSchema);
const Deal: any =
  mongoose.models.Deal || (mongoose.model as any)('Deal', DealSchema);
const Activity: any =
  mongoose.models.Activity ||
  (mongoose.model as any)('Activity', ActivitySchema);
const PipelineStage: any =
  mongoose.models.PipelineStage ||
  (mongoose.model as any)('PipelineStage', PipelineStageSchema);

export { Contact, Deal, Activity, PipelineStage };
export default { Contact, Deal, Activity, PipelineStage };
