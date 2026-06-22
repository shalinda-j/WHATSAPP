import mongoose from 'mongoose';

// Form Field Types
export type FieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'phone'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'textarea'
  | 'file';

// Form Field Schema
export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  order: number;
  options?: string[]; // For select/multiselect
  // Optional dynamic option source for select/multiselect fields. When set,
  // options are pulled from Datasets at runtime instead of the static list.
  dataSource?: 'JOB_TYPES' | 'COUNTRIES' | 'EXPERIENCE_LEVELS';
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
  defaultValue?: string;
}

// Form Template Schema
export interface IFormTemplate {
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  triggerMode: 'manual' | 'auto' | 'both'; // manual = !register, auto = after chat, both
  triggerDelay: number; // Seconds to wait before showing auto form
  fields: FormField[];
  welcomeMessage?: string;
  completionMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FormFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'text',
        'number',
        'email',
        'phone',
        'select',
        'multiselect',
        'date',
        'textarea',
        'file',
      ],
      required: true,
    },
    label: { type: String, required: true },
    placeholder: { type: String },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    options: [{ type: String }],
    dataSource: {
      type: String,
      enum: ['JOB_TYPES', 'COUNTRIES', 'EXPERIENCE_LEVELS'],
    },
    validation: {
      minLength: { type: Number },
      maxLength: { type: Number },
      min: { type: Number },
      max: { type: Number },
      pattern: { type: String },
    },
    defaultValue: { type: String },
  },
  { _id: false },
);

const FormTemplateSchema = new (mongoose as any).Schema({
  // Multi-tenancy: scoped to the tenant that authored the form. Optional
  // so legacy rows without tenantId stay visible via the route-level
  // "tenantId OR legacy" $or filter — matches the existing Lead pattern.
  tenantId: {
    type: (mongoose as any).Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  name: { type: String, required: true },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false },
  triggerMode: {
    type: String,
    enum: ['manual', 'auto', 'both'],
    default: 'manual',
  },
  triggerDelay: { type: Number, default: 10 }, // 10 seconds default
  fields: [FormFieldSchema],
  welcomeMessage: { type: String },
  completionMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Index for quick lookup
FormTemplateSchema.index({ isActive: 1, isDefault: 1 });

const FormTemplate =
  mongoose.models.FormTemplate ||
  (mongoose as any).model('FormTemplate', FormTemplateSchema);

export default FormTemplate;
