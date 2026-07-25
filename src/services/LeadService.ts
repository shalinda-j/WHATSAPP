import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { configurationManager } from './ConfigurationManagerService';
import { CRMService } from './CRMService';
import { WebhookService } from './WebhookService';
import Lead from '../models/Lead';
import Session from '../models/Session';
import Tenant from '../models/Tenant';
import sessionStateService from './SessionStateService';
import { conversionService } from './ConversionService';
import { normalisePhoneDigits } from './LidPhoneMappingService';

/**
 * Resolve the tenant a WhatsApp-captured lead belongs to. Preference order:
 *   1. the tenant that owns the WhatsApp Session (explicit)
 *   2. the caller-supplied defaultTenantId (index.ts module-level default)
 *   3. the `default` tenant looked up from Mongo (single-tenant deployments)
 *
 * Cached so we don't hit Mongo on every registration. Returning a real
 * tenantId (instead of leaving the field undefined) keeps the lead visible to
 * the tenant-scoped CRM/Leads list AND correctly isolated once >1 tenant
 * exists. Best-effort — returns undefined if no tenant can be resolved, in
 * which case the lead is still created (the list read is legacy-tolerant).
 */
let cachedDefaultTenantId: string | null = null;
async function resolveLeadTenantId(
  sessionTenantId?: unknown,
  defaultTenantId?: string,
): Promise<unknown | undefined> {
  if (sessionTenantId) return sessionTenantId;
  if (defaultTenantId) return defaultTenantId;
  if (cachedDefaultTenantId) return cachedDefaultTenantId;
  try {
    const t = await Tenant.findOne({ slug: 'default' }).select('_id').lean();
    const id = (t as { _id?: unknown } | null)?._id;
    if (id) {
      cachedDefaultTenantId = String(id);
      return cachedDefaultTenantId;
    }
  } catch {
    /* tenant lookup is best-effort — lead is still created without it */
  }
  return undefined;
}

// Extended Lead Data Interface
interface LeadData {
  fullName?: string;
  age?: number;
  phoneNumber?: string;
  address?: string;
  email?: string;
  interestedCountry?: string;
  experienceYears?: string;
  jobVacancyType?: string;
  cvUrl?: string;
}

// Registration States
enum LeadState {
  IDLE = 'IDLE',
  AWAITING_NAME = 'AWAITING_NAME',
  AWAITING_AGE = 'AWAITING_AGE',
  AWAITING_PHONE = 'AWAITING_PHONE',
  AWAITING_COUNTRY = 'AWAITING_COUNTRY',
  AWAITING_EXPERIENCE = 'AWAITING_EXPERIENCE',
  AWAITING_JOB_TYPE = 'AWAITING_JOB_TYPE',
  AWAITING_CV = 'AWAITING_CV',
  COMPLETED = 'COMPLETED',
}

interface UserLeadSession {
  state: LeadState;
  data: LeadData;
  jobTypes?: string[];
  countries?: { code: string; name: string; flag: string }[];
  experienceLevels?: { value: string; label: string }[];
}

// Session TTL: 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;

// NO HARDCODED DEFAULT VALUES
// All values must be configured via Admin Panel > Datasets

/**
 * Get country menu string
 */
function getCountryMenu(
  countries: { code: string; name: string; flag: string }[],
): string {
  return countries.map((c, i) => `${i + 1}. ${c.flag} ${c.name}`).join('\n');
}

/**
 * Get experience level menu string
 */
function getExperienceMenu(levels: { value: string; label: string }[]): string {
  return levels.map((e, i) => `${i + 1}. ${e.label}`).join('\n');
}

/**
 * Get job types menu string
 */
function getJobTypeMenu(jobTypes: string[]): string {
  return jobTypes.map((job, i) => `${i + 1}. ${job}`).join('\n');
}

/**
 * Check if user is in lead registration flow
 */
export async function isUserInLeadFlow(jid: string): Promise<boolean> {
  return sessionStateService.hasSession(jid, 'lead');
}

/**
 * Get lead session
 */
async function getLeadSession(jid: string): Promise<UserLeadSession | null> {
  const session = await sessionStateService.getSession(jid, 'lead');
  if (!session) return null;

  return {
    state: session.state.state as LeadState,
    data: session.data.leadData || {},
    jobTypes: session.data.jobTypes,
    countries: session.data.countries,
    experienceLevels: session.data.experienceLevels,
  };
}

/**
 * Save lead session
 */
async function saveLeadSession(
  jid: string,
  session: UserLeadSession,
): Promise<void> {
  await sessionStateService.setSession(
    jid,
    'lead',
    { state: session.state },
    {
      leadData: session.data,
      jobTypes: session.jobTypes,
      countries: session.countries,
      experienceLevels: session.experienceLevels,
    },
    SESSION_TTL_MS,
  );
}

/**
 * Start the enhanced lead registration flow
 */
export async function startLeadRegistration(
  jid: string,
  sessionId: string,
): Promise<void> {
  // FIX C7: Wrap config fetches in try-catch so a momentary DB timeout
  // doesn't crash the message handler — customer gets a clear error message.
  let jobTypes: string[];
  let countries: { code: string; name: string; flag: string }[];
  let experienceLevels: { value: string; label: string }[];

  try {
    jobTypes = await configurationManager.getJobTypes();
    countries = await configurationManager.getCountries();
    experienceLevels = await configurationManager.getExperienceLevels();
  } catch (configErr) {
    console.error('❌ [LeadService] Config fetch failed:', configErr);
    await sendMessage(
      jid,
      '⚠️ Registration service is temporarily unavailable. Please try again in a moment.',
      sessionId,
    );
    return;
  }

  // Validate configuration
  if (!jobTypes || jobTypes.length === 0) {
    await sendMessage(
      jid,
      '⚠️ Registration is currently unavailable. Job types not configured.\n\nPlease contact support.',
      sessionId,
    );
    return;
  }

  if (!countries || countries.length === 0) {
    await sendMessage(
      jid,
      '⚠️ Registration is currently unavailable. Countries not configured.\n\nPlease contact support.',
      sessionId,
    );
    return;
  }

  if (!experienceLevels || experienceLevels.length === 0) {
    await sendMessage(
      jid,
      '⚠️ Registration is currently unavailable. Experience levels not configured.\n\nPlease contact support.',
      sessionId,
    );
    return;
  }

  const session: UserLeadSession = {
    state: LeadState.AWAITING_NAME,
    data: { phoneNumber: jid.split('@')[0] },
    jobTypes,
    countries,
    experienceLevels,
  };

  await saveLeadSession(jid, session);

  await sendTyping(jid, sessionId);
  await sendMessage(
    jid,
    `📝 *Job Registration Form*\n\n` +
      `Welcome! Let's register you for job opportunities abroad.\n\n` +
      `*Step 1 of 7*\n` +
      `Please enter your **Full Name**:\n` +
      `(e.g., John Smith)`,
    sessionId,
  );
}

/**
 * Handle messages during lead registration flow
 */
export async function handleLeadMessage(
  jid: string,
  text: string,
  sessionId: string,
  defaultTenantId?: string,
): Promise<boolean> {
  const session = await getLeadSession(jid);
  if (!session || session.state === LeadState.IDLE) return false;

  const cleanText = text.trim();

  // Get configuration from session (stored during startLeadRegistration)
  const jobTypes = session.jobTypes || [];
  const countries = session.countries || [];
  const experienceLevels = session.experienceLevels || [];

  // Validate configuration exists
  if (
    jobTypes.length === 0 ||
    countries.length === 0 ||
    experienceLevels.length === 0
  ) {
    await sendMessage(
      jid,
      '⚠️ Registration session is invalid. Please type `!register` to start again.',
      sessionId,
    );
    await sessionStateService.deleteSession(jid, 'lead');
    return true;
  }

  switch (session.state) {
    // Step 1: Name
    case LeadState.AWAITING_NAME:
      if (cleanText.length < 2) {
        await sendMessage(
          jid,
          `⚠️ Please enter a valid name (at least 2 characters).`,
          sessionId,
        );
        return true;
      }
      session.data.fullName = cleanText;
      session.state = LeadState.AWAITING_AGE;
      await saveLeadSession(jid, session);

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Name: *${cleanText}*\n\n` +
          `*Step 2 of 7*\n` +
          `Please enter your **Age**:\n` +
          `(e.g., 25)`,
        sessionId,
      );
      break;

    // Step 2: Age
    case LeadState.AWAITING_AGE:
      const age = parseInt(cleanText);
      // Extended age range: 18-70 (was 18-65)
      if (isNaN(age) || age < 18 || age > 70) {
        await sendMessage(
          jid,
          `⚠️ Please enter a valid age between 18 and 70.`,
          sessionId,
        );
        return true;
      }
      session.data.age = age;
      session.state = LeadState.AWAITING_PHONE;
      await saveLeadSession(jid, session);

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Age: *${age}*\n\n` +
          `*Step 3 of 7*\n` +
          `Please enter your **Phone Number**:\n` +
          `(e.g., 0771234567)`,
        sessionId,
      );
      break;

    // Step 3: Phone Number
    case LeadState.AWAITING_PHONE:
      // Normalise to full country-code form ('0771234567' -> '94771234567')
      // with the shared helper. Storing the raw local form broke autonomous
      // follow-ups (invalid JID '0771234567@s.whatsapp.net'), opt-out suffix
      // matching, and lead-by-JID reconciliation downstream.
      const phone = normalisePhoneDigits(cleanText);
      if (!phone) {
        await sendMessage(
          jid,
          `⚠️ Please enter a valid phone number.`,
          sessionId,
        );
        return true;
      }
      session.data.phoneNumber = phone;
      session.state = LeadState.AWAITING_COUNTRY;
      await saveLeadSession(jid, session);

      const countryMenu = getCountryMenu(countries);
      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Phone: *${phone}*\n\n` +
          `*Step 4 of 7*\n` +
          `Select your **Preferred Country** for work:\n\n` +
          `${countryMenu}\n\n` +
          `Reply with the number (1-${countries.length})`,
        sessionId,
      );
      break;

    // Step 4: Country Selection
    case LeadState.AWAITING_COUNTRY:
      const countrySelection = parseInt(cleanText);
      if (
        isNaN(countrySelection) ||
        countrySelection < 1 ||
        countrySelection > countries.length
      ) {
        await sendMessage(
          jid,
          `⚠️ Invalid selection. Please reply with a number between 1 and ${countries.length}.`,
          sessionId,
        );
        return true;
      }
      const selectedCountry = countries[countrySelection - 1];
      session.data.interestedCountry = selectedCountry.name;
      await saveLeadSession(jid, session);

      const expMenu = getExperienceMenu(experienceLevels);
      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Country: *${selectedCountry.flag} ${selectedCountry.name}*\n\n` +
          `*Step 5 of 7*\n` +
          `Select your **Experience Level**:\n\n` +
          `${expMenu}\n\n` +
          `Reply with the number (1-${experienceLevels.length})`,
        sessionId,
      );
      session.state = LeadState.AWAITING_EXPERIENCE;
      await saveLeadSession(jid, session);
      break;

    // Step 5: Experience
    case LeadState.AWAITING_EXPERIENCE:
      const expSelection = parseInt(cleanText);
      if (
        isNaN(expSelection) ||
        expSelection < 1 ||
        expSelection > experienceLevels.length
      ) {
        await sendMessage(
          jid,
          `⚠️ Invalid selection. Please reply with a number between 1 and ${experienceLevels.length}.`,
          sessionId,
        );
        return true;
      }
      const selectedExp = experienceLevels[expSelection - 1];
      session.data.experienceYears = selectedExp.value;
      await saveLeadSession(jid, session);

      const jobMenu = getJobTypeMenu(jobTypes);
      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Experience: *${selectedExp.label}*\n\n` +
          `*Step 6 of 7*\n` +
          `Select your **Job Category**:\n\n` +
          `${jobMenu}\n\n` +
          `Reply with the number (1-${jobTypes.length})`,
        sessionId,
      );
      session.state = LeadState.AWAITING_JOB_TYPE;
      await saveLeadSession(jid, session);
      break;

    // Step 6: Job Type
    case LeadState.AWAITING_JOB_TYPE:
      const jobSelection = parseInt(cleanText);
      if (
        isNaN(jobSelection) ||
        jobSelection < 1 ||
        jobSelection > jobTypes.length
      ) {
        await sendMessage(
          jid,
          `⚠️ Invalid selection. Please reply with a number between 1 and ${jobTypes.length}.`,
          sessionId,
        );
        return true;
      }
      session.data.jobVacancyType = jobTypes[jobSelection - 1];
      session.state = LeadState.AWAITING_CV;
      await saveLeadSession(jid, session);

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Job Category: *${session.data.jobVacancyType}*\n\n` +
          `*Step 7 of 7*\n` +
          `Do you have a **CV/Resume** to upload?\n\n` +
          `1. ✅ Yes, I have a CV\n` +
          `2. ❌ No, I don't have one\n\n` +
          `Reply with 1 or 2`,
        sessionId,
      );
      break;

    // Step 7: CV Upload
    case LeadState.AWAITING_CV:
      const cvChoice = parseInt(cleanText);
      if (cvChoice === 1) {
        // User has CV - send upload link (configurable via admin panel)
        const companyInfo = await configurationManager.getCompanyInfo();
        const cvUploadUrl = process.env.CV_UPLOAD_URL?.trim();

        await sendTyping(jid, sessionId);
        if (cvUploadUrl) {
          await sendMessage(
            jid,
            `📄 *CV Upload*\n\n` +
              `Please upload your CV using this link:\n` +
              `${cvUploadUrl}\n\n` +
              `After uploading, type "done" to complete registration.\n` +
              `Or type "skip" to skip for now.`,
            sessionId,
          );
        } else {
          // No upload link configured — NEVER send the old dead placeholder
          // 'https://forms.gle/your-cv-upload-form'. Guide the user without a
          // link (offer email if the company profile has one).
          const email = companyInfo?.email
            ? `\nOr email it to ${companyInfo.email}.`
            : '';
          await sendMessage(
            jid,
            `📄 *CV Upload*\n\n` +
              `Please bring your CV with you when you visit us.${email}\n\n` +
              `Type "done" when you're ready, or "skip" to skip for now.`,
            sessionId,
          );
        }
        return true;
      } else if (
        cvChoice === 2 ||
        cleanText.toLowerCase() === 'skip' ||
        cleanText.toLowerCase() === 'no' ||
        cleanText.toLowerCase().includes('no cv') ||
        cleanText.toLowerCase().includes("don't have")
      ) {
        // No CV or skip - proceed to save with empty cvUrl
        session.data.cvUrl = '';
        await saveLeadSession(jid, session);
        await saveLeadRegistration(jid, session, sessionId, defaultTenantId);
        return true;
      } else if (cleanText.toLowerCase() === 'done') {
        // CV uploaded - proceed to save
        session.data.cvUrl = 'uploaded';
        await saveLeadSession(jid, session);
        await saveLeadRegistration(jid, session, sessionId, defaultTenantId);
        return true;
      } else {
        await sendMessage(
          jid,
          `⚠️ Please reply with:\n• 1 - I have a CV\n• 2 - I don't have a CV\n• "done" - CV uploaded\n• "skip" - Skip for now`,
          sessionId,
        );
        return true;
      }
  }

  return true;
}

/**
 * Save lead registration to database
 */
async function saveLeadRegistration(
  jid: string,
  session: UserLeadSession,
  sessionId: string,
  defaultTenantId?: string,
): Promise<void> {
  await sendTyping(jid, sessionId);

  try {
    console.log(
      '📋 Saving lead registration:',
      JSON.stringify(session.data, null, 2),
    );

    // Resolve the owning tenant from the WhatsApp session so the lead is
    // tenant-attributable and the downstream webhook only fans out to THIS
    // tenant's endpoints (not every tenant's). Optional — legacy/single-tenant
    // sessions have no tenantId and fall back to the legacy-tolerant scope.
    const sess = await Session.findOne({ sessionId })
      .select('tenantId')
      .lean<{ tenantId?: unknown }>();
    // BUGFIX: the WhatsApp Session upsert doesn't stamp tenantId, so
    // sess.tenantId is almost always undefined. Fall back to the process
    // default tenant (threaded from index.ts) and finally to a `default`
    // tenant lookup, so every WhatsApp-captured lead is tenant-attributed
    // and lands under the tenant the CRM/Leads dashboard reads.
    const leadTenantId = await resolveLeadTenantId(
      sess?.tenantId,
      defaultTenantId,
    );

    // Create lead in database
    const leadData: Record<string, unknown> = {
      fullName: session.data.fullName,
      age: session.data.age,
      phoneNumber: session.data.phoneNumber,
      interestedCountry: session.data.interestedCountry,
      experienceYears: session.data.experienceYears,
      jobVacancyType: session.data.jobVacancyType,
      cvUrl: session.data.cvUrl || '',
      status: 'new',
      source: 'whatsapp',
    };
    if (leadTenantId) leadData.tenantId = leadTenantId;

    console.log('📋 Lead data to save:', JSON.stringify(leadData, null, 2));

    const lead = await Lead.create(leadData);
    console.log('✅ Lead created successfully:', lead._id);

    // CONVERSION: a completed registration IS the user→customer (admission /
    // student) moment. Record it and credit any recent campaign (fire & forget).
    conversionService
      .recordConversion({
        phoneNumber: session.data.phoneNumber,
        jid,
        kind: 'lead_registered',
        leadId: lead._id,
        sessionId,
        source: 'whatsapp',
      })
      .catch((err) => console.error('recordConversion(lead) failed:', err));

    // Notify any subscribed webhooks that a new lead was captured.
    // Fire-and-forget so a slow/failing webhook never blocks registration.
    WebhookService.triggerWebhook(
      'lead.created',
      {
        id: lead._id,
        name: session.data.fullName,
        phone: session.data.phoneNumber,
        country: session.data.interestedCountry,
        jobType: session.data.jobVacancyType,
        sessionId,
        timestamp: new Date(),
      },
      leadTenantId,
    ).catch((err) =>
      console.error('lead.created webhook trigger failed:', err),
    );

    // Also create CRM contact
    try {
      const [firstName, ...lastNameParts] = (session.data.fullName || '').split(
        ' ',
      );
      const lastName = lastNameParts.join(' ') || '';

      const crmContact = await CRMService.createContact({
        firstName,
        lastName,
        phone: session.data.phoneNumber,
        type: 'lead',
        source: 'whatsapp',
        whatsappNumber: session.data.phoneNumber,
        customFields: {
          age: session.data.age?.toString(),
          interestedCountry: session.data.interestedCountry,
          experience: session.data.experienceYears,
          jobType: session.data.jobVacancyType,
          leadId: lead._id.toString(),
          hasCV: session.data.cvUrl ? 'yes' : 'no',
        },
      });

      // Link CRM contact to lead
      if (crmContact) {
        await Lead.findByIdAndUpdate(lead._id, {
          crmContactId: crmContact._id,
        });
        console.log('✅ CRM contact linked:', crmContact._id);

        // Connect the funnel to the CRM pipeline: a registered lead IS a deal
        // (stage 'new') + a logged activity, so the Deals / Activities /
        // Dashboard tabs fill from real bot activity instead of staying empty.
        // Fire-and-forget — never block registration on it.
        const dealTitle = `${session.data.fullName || 'WhatsApp lead'}${
          session.data.jobVacancyType ? ` – ${session.data.jobVacancyType}` : ''
        }`;
        const scope = leadTenantId ? { tenantId: leadTenantId } : {};
        CRMService.createDeal({
          title: dealTitle,
          description: session.data.interestedCountry
            ? `Country: ${session.data.interestedCountry}`
            : undefined,
          stage: 'new',
          contact: crmContact._id,
          sessionId,
          ...scope,
        }).catch((e) => console.error('auto-createDeal failed:', e));
        CRMService.createActivity({
          type: 'whatsapp',
          title: 'Registered via WhatsApp',
          description: dealTitle,
          contact: crmContact._id,
          status: 'completed',
          sessionId,
          ...scope,
        }).catch((e) => console.error('auto-createActivity failed:', e));
      }
    } catch (crmError) {
      console.error('⚠️ CRM sync error (non-critical):', crmError);
      // Continue even if CRM sync fails
    }

    // Send confirmation
    const selectedCountry = session.countries?.find(
      (c) => c.name === session.data.interestedCountry,
    );

    await sendMessage(
      jid,
      `🎉 *Registration Complete!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Name:* ${session.data.fullName}\n` +
        `🎂 *Age:* ${session.data.age}\n` +
        `📱 *Phone:* ${session.data.phoneNumber}\n` +
        `🌍 *Country:* ${selectedCountry?.flag || ''} ${
          session.data.interestedCountry
        }\n` +
        `⏱️ *Experience:* ${session.data.experienceYears} years\n` +
        `💼 *Job:* ${session.data.jobVacancyType}\n` +
        `📄 *CV:* ${session.data.cvUrl ? 'Uploaded' : 'Not provided'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 *Registration ID:* ${lead._id}\n\n` +
        `✅ Your application has been submitted!\n` +
        `Our team will contact you soon.\n\n` +
        `Type \`!help\` for other commands.`,
      sessionId,
    );

    // Clear session
    await sessionStateService.deleteSession(jid, 'lead');
  } catch (error: any) {
    console.error('❌ Lead registration error:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);

    await sendMessage(
      jid,
      `❌ Registration failed. Please try again later or contact support.\n\n` +
        `Type \`!register\` to restart.`,
      sessionId,
    );
    await sessionStateService.deleteSession(jid, 'lead');
  }
}

/**
 * Get lead statistics (for admin dashboard)
 */
export async function getLeadStats(tenantId?: string) {
  try {
    // Scope every count / aggregation / listing to the tenant when a
    // tenantId is supplied. Without this filter a tenant's dashboard could
    // surface counts across all tenants. No arg = legacy global behaviour.
    const tenantFilter: Record<string, unknown> = tenantId ? { tenantId } : {};

    const [total, byStatus, byCountry, recent] = await Promise.all([
      Lead.countDocuments(tenantFilter),
      Lead.aggregate([
        { $match: tenantFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: tenantFilter },
        { $group: { _id: '$interestedCountry', count: { $sum: 1 } } },
      ]),
      Lead.find(tenantFilter).sort({ registeredAt: -1 }).limit(10).lean(),
    ]);

    return {
      total,
      byStatus: byStatus.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      byCountry: byCountry.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      recent,
    };
  } catch (error) {
    console.error('Error fetching lead stats:', error);
    return { total: 0, byStatus: {}, byCountry: {}, recent: [] };
  }
}

/**
 * Get active lead session count
 */
export async function getActiveSessionCount(): Promise<number> {
  return sessionStateService.getSessionCount('lead');
}
