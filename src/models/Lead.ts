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
  // Personal Information
  fullName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
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
  registeredAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for search and filtering
LeadSchema.index({ fullName: 'text', phoneNumber: 'text', email: 'text' });
LeadSchema.index({ jobVacancyType: 1, status: 1 });
LeadSchema.index({ interestedCountry: 1, status: 1 });
LeadSchema.index({ registeredAt: -1 });

const Lead = (mongoose as any).model('Lead', LeadSchema);

export default Lead;
