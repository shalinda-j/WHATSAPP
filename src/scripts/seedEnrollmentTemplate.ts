/**
 * Enrollment Registration form-template seed — idempotent one-off script.
 *
 * Creates a single FormTemplate named "Enrollment Registration" (if absent)
 * tenant-stamped to the default tenant. This is the template that
 * `src/server/routes/kiosk.ts` (POST /enroll) resolves BY NAME to build a
 * FormSubmission out of `KioskInvite.collected`. The 12 field `id`s below are
 * the canonical flat keys the kiosk flow flattens `collected` onto:
 *
 *   fullName, mobile, nic, email, address,   (personal)
 *   course, level,                            (course.program / course.level)
 *   paid, amount, method, reference,          (payment)
 *   branch                                    (invite.branch)
 *
 * Idempotency:
 *   - Resolves the template by { name, tenantId }. If it already exists the
 *     script logs and exits WITHOUT inserting a duplicate. Re-running is a
 *     no-op the second time.
 *
 * Mongo bootstrap pattern mirrors src/scripts/migrate-tenant-id.ts (connect
 * via MONGODB_URI, ensure the default Tenant by slug, disconnect on exit).
 *
 * USAGE:
 *   npx ts-node src/scripts/seedEnrollmentTemplate.ts [--slug=default]
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate';
import type { FormField } from '../models/FormTemplate';

const TEMPLATE_NAME = 'Enrollment Registration';

/**
 * The 12 canonical fields. Field `id`s MUST match the flat keys kiosk.ts
 * flattens `KioskInvite.collected` onto when building FormSubmission data.
 */
const ENROLLMENT_FIELDS: FormField[] = [
  {
    id: 'fullName',
    type: 'text',
    label: 'Full Name',
    placeholder: 'As per NIC',
    required: true,
    order: 1,
  },
  {
    id: 'mobile',
    type: 'phone',
    label: 'Mobile Number',
    placeholder: '07XXXXXXXX',
    required: true,
    order: 2,
  },
  {
    id: 'nic',
    type: 'text',
    label: 'NIC',
    placeholder: 'National Identity Card number',
    required: true,
    order: 3,
  },
  {
    id: 'email',
    type: 'email',
    label: 'Email',
    placeholder: 'name@example.com',
    required: false,
    order: 4,
  },
  {
    id: 'address',
    type: 'textarea',
    label: 'Address',
    required: false,
    order: 5,
  },
  {
    id: 'course',
    type: 'text',
    label: 'Course / Program',
    required: true,
    order: 6,
  },
  {
    id: 'level',
    type: 'text',
    label: 'Course Level',
    required: false,
    order: 7,
  },
  {
    id: 'paid',
    type: 'select',
    label: 'Payment Confirmed',
    required: true,
    order: 8,
    options: ['Yes', 'No'],
  },
  {
    id: 'amount',
    type: 'text',
    label: 'Amount Paid',
    required: true,
    order: 9,
  },
  {
    id: 'method',
    type: 'text',
    label: 'Payment Method',
    placeholder: 'Cash / Card / Bank Transfer',
    required: true,
    order: 10,
  },
  {
    id: 'reference',
    type: 'text',
    label: 'Payment Reference',
    required: false,
    order: 11,
  },
  {
    id: 'branch',
    type: 'text',
    label: 'Branch',
    required: false,
    order: 12,
  },
];

async function ensureTenant(slug: string): Promise<mongoose.Types.ObjectId> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No mongoose db connection');
  const tenants = db.collection('tenants');
  const existing = await tenants.findOne({ slug });
  if (existing) return existing._id as mongoose.Types.ObjectId;
  const now = new Date();
  const result = await tenants.insertOne({
    slug,
    name: slug === 'default' ? 'Default Tenant' : slug,
    plan: 'free',
    status: 'active',
    brand: {
      primaryLanguage: 'si',
      timezone: 'Asia/Colombo',
    },
    budget: {
      dailyTokenCap: 1_000_000,
      monthlyCostUsdCap: 100,
      perConversationTokenCap: 8000,
    },
    createdAt: now,
    updatedAt: now,
  });
  console.log(`Created tenant '${slug}' (${result.insertedId})`);
  return result.insertedId;
}

async function main() {
  const args = process.argv.slice(2);
  const slugArg = args.find((a) => a.startsWith('--slug='));
  const slug = slugArg ? slugArg.slice('--slug='.length) : 'default';

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  const tenantId = await ensureTenant(slug);

  // Idempotency: resolve by name within the tenant. If present, do nothing.
  const existing = await FormTemplate.findOne({
    name: TEMPLATE_NAME,
    tenantId,
  }).lean();

  if (existing) {
    console.log(
      `'${TEMPLATE_NAME}' already exists (${(existing as any)._id}) for tenant ${tenantId.toString()} — no changes made.`,
    );
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const created = await FormTemplate.create({
    tenantId,
    name: TEMPLATE_NAME,
    description:
      'Kiosk enrollment registration. Built from KioskInvite.collected and resolved by name by the /enroll route.',
    isActive: true,
    isDefault: false,
    triggerMode: 'manual',
    triggerDelay: 0,
    fields: ENROLLMENT_FIELDS,
    welcomeMessage: 'Enrollment Registration',
    completionMessage: 'Registration received. Welcome aboard!',
    createdAt: now,
    updatedAt: now,
  });

  console.log(
    `Created '${TEMPLATE_NAME}' (${created._id}) for tenant ${tenantId.toString()} with ${ENROLLMENT_FIELDS.length} fields: ` +
      ENROLLMENT_FIELDS.map((f) => f.id).join(', '),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Enrollment template seed failed:', err);
  process.exit(1);
});
