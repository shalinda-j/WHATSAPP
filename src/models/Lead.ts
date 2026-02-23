import mongoose from 'mongoose';

const QualificationSchema = new (mongoose as any).Schema({
  documentType: { type: String, default: 'other' },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  fileSize: { type: Number },
  extractedText: { type: String },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const LeadSchema = new (mongoose as any).Schema({
  fullName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  address: { type: String, required: true },
  email: { type: String },
  jobVacancyType: { type: String, required: true, index: true },
  qualifications: [QualificationSchema],
  status: { 
    type: String, 
    enum: ['new', 'reviewed', 'contacted', 'accepted', 'rejected'], 
    default: 'new',
    index: true 
  },
  notes: { type: String },
  registeredAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

LeadSchema.index({ fullName: 'text', phoneNumber: 'text', email: 'text' });
LeadSchema.index({ jobVacancyType: 1, status: 1 });

const Lead = (mongoose as any).model('Lead', LeadSchema);

export default Lead;
