import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { configurationManager } from './ConfigurationManagerService';
import { CRMService } from './CRMService';
import Lead from '../models/Lead';
import sessionStateService from './SessionStateService';

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

// Default fallback values (used if configuration is empty)
const DEFAULT_JOB_TYPES = [
  'Electrician',
  'Plumber',
  'Asphalt Worker',
  'Concrete Pump Driver',
  'Excavator Operator',
  'JCB Operator',
  'Heavy Duty Cleaner',
  'Gypsum Fixer',
  'Tile Fixer',
  'General Worker',
  'Welder',
  'Carpenter',
  'Mason',
  'Painter',
  'AC Technician',
  'Driver',
  'Security Guard',
  'Cook',
  'Cleaner',
];

const DEFAULT_COUNTRIES = [
  { code: 'IL', name: 'Israel', flag: '🇮🇱' },
  { code: 'AE', name: 'UAE (Dubai)', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: 'OTHER', name: 'Other', flag: '🌍' },
];

const DEFAULT_EXPERIENCE_LEVELS = [
  { value: '0-1', label: '0-1 years (Fresher)' },
  { value: '1-3', label: '1-3 years' },
  { value: '3-5', label: '3-5 years' },
  { value: '5-10', label: '5-10 years' },
  { value: '10+', label: '10+ years (Expert)' },
];

/**
 * Get country menu string
 */
function getCountryMenu(countries: { code: string; name: string; flag: string }[]): string {
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
  // Fetch configuration data with fallbacks
  let jobTypes = await configurationManager.getJobTypes();
  let countries = await configurationManager.getCountries();
  let experienceLevels = await configurationManager.getExperienceLevels();

  // Use defaults if configuration is empty
  if (!jobTypes || jobTypes.length === 0) {
    console.warn('⚠️ JOB_TYPES not configured, using defaults');
    jobTypes = DEFAULT_JOB_TYPES;
  }
  if (!countries || countries.length === 0) {
    console.warn('⚠️ COUNTRIES not configured, using defaults');
    countries = DEFAULT_COUNTRIES;
  }
  if (!experienceLevels || experienceLevels.length === 0) {
    console.warn('⚠️ EXPERIENCE_LEVELS not configured, using defaults');
    experienceLevels = DEFAULT_EXPERIENCE_LEVELS;
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
): Promise<boolean> {
  const session = await getLeadSession(jid);
  if (!session || session.state === LeadState.IDLE) return false;

  const cleanText = text.trim();

  // Get configuration with fallbacks
  let jobTypes = session.jobTypes || await configurationManager.getJobTypes();
  let countries = session.countries || await configurationManager.getCountries();
  let experienceLevels = session.experienceLevels || await configurationManager.getExperienceLevels();

  // Use defaults if empty
  if (!jobTypes || jobTypes.length === 0) jobTypes = DEFAULT_JOB_TYPES;
  if (!countries || countries.length === 0) countries = DEFAULT_COUNTRIES;
  if (!experienceLevels || experienceLevels.length === 0) experienceLevels = DEFAULT_EXPERIENCE_LEVELS;

  switch (session.state) {
    // Step 1: Name
    case LeadState.AWAITING_NAME:
      if (cleanText.length < 2) {
        await sendMessage(jid, `⚠️ Please enter a valid name (at least 2 characters).`, sessionId);
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
      const phone = cleanText.replace(/[^0-9]/g, '');
      if (phone.length < 9) {
        await sendMessage(jid, `⚠️ Please enter a valid phone number.`, sessionId);
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
      if (isNaN(countrySelection) || countrySelection < 1 || countrySelection > countries.length) {
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
      if (isNaN(expSelection) || expSelection < 1 || expSelection > experienceLevels.length) {
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
      if (isNaN(jobSelection) || jobSelection < 1 || jobSelection > jobTypes.length) {
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
        const cvUploadUrl = process.env.CV_UPLOAD_URL || 'https://forms.gle/your-cv-upload-form';

        await sendTyping(jid, sessionId);
        await sendMessage(
          jid,
          `📄 *CV Upload*\n\n` +
            `Please upload your CV using this link:\n` +
            `${cvUploadUrl}\n\n` +
            `After uploading, type "done" to complete registration.\n` +
            `Or type "skip" to skip for now.`,
          sessionId,
        );
        return true;
      } else if (cvChoice === 2 || cleanText.toLowerCase() === 'skip' || cleanText.toLowerCase() === 'no' || cleanText.toLowerCase().includes('no cv') || cleanText.toLowerCase().includes("don't have")) {
        // No CV or skip - proceed to save with empty cvUrl
        session.data.cvUrl = '';
        await saveLeadSession(jid, session);
        await saveLeadRegistration(jid, session, sessionId);
        return true;
      } else if (cleanText.toLowerCase() === 'done') {
        // CV uploaded - proceed to save
        session.data.cvUrl = 'uploaded';
        await saveLeadSession(jid, session);
        await saveLeadRegistration(jid, session, sessionId);
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
): Promise<void> {
  await sendTyping(jid, sessionId);

  try {
    console.log('📋 Saving lead registration:', JSON.stringify(session.data, null, 2));

    // Create lead in database
    const leadData = {
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

    console.log('📋 Lead data to save:', JSON.stringify(leadData, null, 2));

    const lead = await Lead.create(leadData);
    console.log('✅ Lead created successfully:', lead._id);

    // Also create CRM contact
    try {
      const [firstName, ...lastNameParts] = (session.data.fullName || '').split(' ');
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
        await Lead.findByIdAndUpdate(lead._id, { crmContactId: crmContact._id });
        console.log('✅ CRM contact linked:', crmContact._id);
      }
    } catch (crmError) {
      console.error('⚠️ CRM sync error (non-critical):', crmError);
      // Continue even if CRM sync fails
    }

    // Send confirmation
    const selectedCountry = session.countries?.find(
      (c) => c.name === session.data.interestedCountry
    );

    await sendMessage(
      jid,
      `🎉 *Registration Complete!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Name:* ${session.data.fullName}\n` +
        `🎂 *Age:* ${session.data.age}\n` +
        `📱 *Phone:* ${session.data.phoneNumber}\n` +
        `🌍 *Country:* ${selectedCountry?.flag || ''} ${session.data.interestedCountry}\n` +
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
export async function getLeadStats() {
  try {
    const [total, byStatus, byCountry, recent] = await Promise.all([
      Lead.countDocuments(),
      Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Lead.aggregate([{ $group: { _id: '$interestedCountry', count: { $sum: 1 } } }]),
      Lead.find().sort({ registeredAt: -1 }).limit(10).lean(),
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