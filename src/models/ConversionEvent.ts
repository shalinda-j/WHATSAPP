import mongoose, { Schema, Document } from 'mongoose';

/**
 * The concrete moment a WhatsApp user turns into a customer.
 *
 *  - lead_registered : the user completed registration (admission / student
 *                      intake) — the core "normal user -> customer" event.
 *  - booking_created : the user booked a campus visit (a strong buying signal
 *                      on the path to enrolment).
 *  - fee_paid        : operator-confirmed money received — the hardest, most
 *                      honest conversion label, set from the admin panel until
 *                      an automated payment hook exists.
 */
export type ConversionKind =
  | 'lead_registered'
  | 'booking_created'
  | 'fee_paid'
  | 'enrollment';

export interface IConversionEvent extends Document {
  tenantId?: mongoose.Types.ObjectId;
  /** Real phone (digits) — the stable key the whole CRM reconciles on. */
  phoneNumber: string;
  /** Raw WhatsApp JID when the event came from a chat. */
  jid?: string;
  kind: ConversionKind;
  leadId?: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId;
  /** Money value in LKR when known (fee_paid). */
  valueLkr?: number;
  sessionId?: string;
  source: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConversionEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    phoneNumber: { type: String, required: true, index: true },
    jid: { type: String },
    kind: {
      type: String,
      enum: ['lead_registered', 'booking_created', 'fee_paid', 'enrollment'],
      required: true,
      index: true,
    },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    valueLkr: { type: Number },
    sessionId: { type: String },
    source: { type: String, default: 'whatsapp' },
    note: { type: String },
  } as any,
  { timestamps: true },
);

// Dashboards read the most-recent events per tenant; the CRM looks events up
// by phone+kind. Both paths get a covering index.
ConversionEventSchema.index({ tenantId: 1, createdAt: -1 });
ConversionEventSchema.index({ phoneNumber: 1, kind: 1, createdAt: -1 });

const __ConversionEventModel =
  mongoose.models.ConversionEvent ||
  mongoose.model('ConversionEvent', ConversionEventSchema as any);
export default __ConversionEventModel as unknown as mongoose.Model<IConversionEvent>;
