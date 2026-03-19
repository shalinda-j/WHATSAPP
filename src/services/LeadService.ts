import axios from 'axios';
import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { configurationManager } from './ConfigurationManagerService';
import { CRMService } from './CRMService';
import Lead from '../models/Lead';

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

const leadSessions = new Map<string, UserLeadSession>();

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
export function isUserInLeadFlow(jid: string): boolean {
  const session = leadSessions.get(jid);
  return session !== undefined && session.state !== LeadState.IDLE;
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
  leadSessions.set(jid, session);

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
  const session = leadSessions.get(jid);
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
      if (isNaN(age) || age < 18 || age > 65) {
        await sendMessage(
          jid,
          `⚠️ Please enter a valid age between 18 and 65.`,
          sessionId,
        );
        return true;
      }
      session.data.age = age;
      session.state = LeadState.AWAITING_PHONE;

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
      session.state = LeadState.AWAITING_CV;
      break;

    // Step 7: CV Upload
    case LeadState.AWAITING_CV:
      const cvChoice = parseInt(cleanText);
      if (cvChoice === 1) {
        // User has CV - send upload link
        const cvConfig = await configurationManager.getCompanyInfo();
        await sendTyping(jid, sessionId);
        await sendMessage(
          jid,
          `📄 *CV Upload*\n\n` +
            `Please upload your CV using this link:\n` +
            `https://forms.gle/your-cv-upload-form\n\n` +
            `After uploading, type "done" to complete registration.\n` +
            `Or type "skip" to skip for now.`,
          sessionId,
        );
        return true;
      } else if (cvChoice === 2 || cleanText.toLowerCase() === 'skip') {
        // No CV or skip - proceed to save
        await saveLeadRegistration(jid, session, sessionId);
        return true;
      } else if (cleanText.toLowerCase() === 'done') {
        // CV uploaded - proceed to save
        session.data.cvUrl = 'uploaded';
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
    // Create lead in database
    const lead = await Lead.create({
      fullName: session.data.fullName,
      age: session.data.age,
      phoneNumber: session.data.phoneNumber,
      interestedCountry: session.data.interestedCountry,
      experienceYears: session.data.experienceYears,
      jobVacancyType: session.data.jobVacancyType,
      cvUrl: session.data.cvUrl,
      status: 'new',
      source: 'whatsapp',
    });

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
        },
      });

      // Link CRM contact to lead
      if (crmContact) {
        await Lead.findByIdAndUpdate(lead._id, { crmContactId: crmContact._id });
      }
    } catch (crmError) {
      console.error('CRM sync error (non-critical):', crmError);
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
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 *Registration ID:* ${lead._id}\n\n` +
        `✅ Your application has been submitted!\n` +
        `Our team will contact you soon.\n\n` +
        `Type \`!help\` for other commands.`,
      sessionId,
    );

    // Clear session
    leadSessions.delete(jid);
  } catch (error) {
    console.error('Lead registration error:', error);
    await sendMessage(
      jid,
      `❌ Registration failed. Please try again later or contact support.\n\n` +
        `Type \`!register\` to restart.`,
      sessionId,
    );
    leadSessions.delete(jid);
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