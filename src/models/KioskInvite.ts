import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * KioskInvite — a short-lived 4-digit code that lets a known WhatsApp
 * customer continue their existing chat thread on an in-branch voice kiosk.
 *
 * Lifecycle:
 *   issued    : code generated + (best-effort) delivered over WhatsApp.
 *   redeemed  : a kiosk session swapped the code for a short-lived JWT.
 *   converted : the AI conservatively detected (or an operator confirmed) a
 *               clear enrollment/commitment intent during the kiosk session.
 *   expired   : TTL reaped (the doc is physically removed once expiresAt passes).
 *
 * The kiosk userId is intentionally the customer's WhatsApp JID so the kiosk
 * reuses the same personality + knowledge base + conversation history.
 */
export type KioskInviteStatus = 'issued' | 'redeemed' | 'converted' | 'expired';

/**
 * Progressively-collected enrollment fields, captured turn-by-turn during the
 * kiosk consult. Stored as a nested sub-object so partial `$set` deep-merges
 * (e.g. `collected.personal.fullName`) update one leaf without clobbering the
 * siblings. Every field is optional — `completed` flips true only once all the
 * required leaves (personal.fullName/mobile/nic, course.program,
 * payment.paid/amount/method) are present and payment is confirmed paid.
 */
export interface IKioskCollected {
  personal?: {
    fullName?: string;
    mobile?: string;
    nic?: string;
    email?: string;
    address?: string;
  };
  course?: {
    program?: string;
    level?: string;
  };
  payment?: {
    paid?: boolean;
    amount?: string;
    method?: string;
    reference?: string;
  };
}

export interface IKioskInvite extends Document {
  tenantId?: mongoose.Types.ObjectId;
  /** Exactly 4 digits (1000–9999). */
  code: string;
  contactId?: mongoose.Types.ObjectId;
  /** The Booking this code was issued for (when issued from a visit booking). */
  bookingId?: mongoose.Types.ObjectId;
  /** Real phone (digits / +digits) when known. */
  phone?: string;
  /** The WhatsApp JID — also the kiosk userId so the thread continues. */
  jid?: string;
  /** Branch label, resolved from config (default "Pasyala"). */
  branch?: string;
  status: KioskInviteStatus;
  sessionId?: string;
  /** Progressively-collected enrollment fields (deep-merged turn-by-turn). */
  collected?: IKioskCollected;
  /** True once all required enrollment fields are captured + payment confirmed. */
  completed: boolean;
  expiresAt: Date;
  redeemedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Nested sub-schemas (no _id on sub-docs). Every leaf is optional so a partial
// `$set` of a single dotted path (e.g. `collected.personal.fullName`) merges in
// without disturbing siblings.
const KioskCollectedPersonalSchema = new Schema(
  {
    fullName: { type: String },
    mobile: { type: String },
    nic: { type: String },
    email: { type: String },
    address: { type: String },
  },
  { _id: false },
);

const KioskCollectedCourseSchema = new Schema(
  {
    program: { type: String },
    level: { type: String },
  },
  { _id: false },
);

const KioskCollectedPaymentSchema = new Schema(
  {
    paid: { type: Boolean },
    amount: { type: String },
    method: { type: String },
    reference: { type: String },
  },
  { _id: false },
);

const KioskCollectedSchema = new Schema(
  {
    personal: { type: KioskCollectedPersonalSchema },
    course: { type: KioskCollectedCourseSchema },
    payment: { type: KioskCollectedPaymentSchema },
  },
  { _id: false },
);

const KioskInviteSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    code: {
      type: String,
      required: true,
      // Exactly 4 digits.
      match: /^\d{4}$/,
    },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    phone: { type: String },
    jid: { type: String },
    // No hardcoded default here — KioskInviteService resolves the canonical
    // branch name from config so the literal lives in exactly one place.
    branch: { type: String },
    status: {
      type: String,
      enum: ['issued', 'redeemed', 'converted', 'expired'],
      default: 'issued',
      index: true,
    },
    sessionId: { type: String },
    // Progressively-collected enrollment fields. Defaults to an empty object so
    // dotted partial `$set` deep-merges always have a parent to write into.
    collected: { type: KioskCollectedSchema, default: () => ({}) },
    completed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    redeemedAt: { type: Date },
  } as any,
  { timestamps: true },
);

// Only ONE active code per value: the unique constraint applies solely to
// rows still in the `issued` state, so a code can be safely re-used once its
// previous invite is redeemed / converted / expired.
KioskInviteSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { status: 'issued' } },
);

// TTL — physically reap invites the moment they pass expiresAt.
KioskInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Admin listings read the most-recent invites per tenant.
KioskInviteSchema.index({ tenantId: 1, createdAt: -1 });

const __KioskInviteModel =
  mongoose.models.KioskInvite ||
  mongoose.model('KioskInvite', KioskInviteSchema as any);
export default __KioskInviteModel as unknown as Model<IKioskInvite>;
