import mongoose from 'mongoose';

// Contact Schema - CRM Contact Management
const ContactSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
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
      'other',
    ],
    default: 'other',
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'churned'],
    default: 'active',
  },
  whatsappOptIn: { type: Boolean, default: true },
  whatsappNumber: { type: String },
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
  firstName: 'text',
  lastName: 'text',
  email: 'text',
  phone: 'text',
  company: 'text',
});
ContactSchema.index({ type: 1, status: 1 });

// Deal Schema - Sales Pipeline Management
const DealSchema = new mongoose.Schema({
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
