import axios from 'axios';
import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { configurationManager } from './ConfigurationManagerService';

interface LeadData {
  fullName?: string;
  phoneNumber?: string;
  address?: string;
  email?: string;
  jobVacancyType?: string;
}

enum LeadState {
  IDLE = 'IDLE',
  AWAITING_NAME = 'AWAITING_NAME',
  AWAITING_PHONE = 'AWAITING_PHONE',
  AWAITING_ADDRESS = 'AWAITING_ADDRESS',
  AWAITING_JOB_TYPE = 'AWAITING_JOB_TYPE',
  COMPLETED = 'COMPLETED',
}

interface UserLeadSession {
  state: LeadState;
  data: LeadData;
  jobTypes?: string[]; // Cache job types for this session
}

const leadSessions = new Map<string, UserLeadSession>();

// Default job types (fallback)
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
];

/**
 * Get job types menu string
 */
async function getJobTypeMenu(jobTypes: string[]): Promise<string> {
  return jobTypes.map((job, i) => `${i + 1}. ${job}`).join('\n');
}

export function isUserInLeadFlow(jid: string): boolean {
  const session = leadSessions.get(jid);
  return session !== undefined && session.state !== LeadState.IDLE;
}

export async function startLeadRegistration(
  jid: string,
  sessionId: string,
): Promise<void> {
  // Fetch job types from config
  const jobTypes = await configurationManager.getJobTypes();

  const session: UserLeadSession = {
    state: LeadState.AWAITING_NAME,
    data: { phoneNumber: jid.split('@')[0] },
    jobTypes,
  };
  leadSessions.set(jid, session);

  await sendTyping(jid, sessionId);
  await sendMessage(
    jid,
    `📝 *Registration Form*\n\n` +
      `Please provide the following information:\n\n` +
      `*1. Your Full Name:*\n` +
      `(Reply with your name)`,
    sessionId,
  );
}

export async function handleLeadMessage(
  jid: string,
  text: string,
  sessionId: string,
): Promise<boolean> {
  const session = leadSessions.get(jid);
  if (!session || session.state === LeadState.IDLE) return false;

  const cleanText = text.trim();
  // Use cached job types or fetch new ones
  const jobTypes = session.jobTypes || await configurationManager.getJobTypes();

  switch (session.state) {
    case LeadState.AWAITING_NAME:
      session.data.fullName = cleanText;
      session.state = LeadState.AWAITING_PHONE;

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Name: *${cleanText}*\n\n` +
          `*2. Your Phone Number:*\n` +
          `(Reply with your phone number)`,
        sessionId,
      );
      break;

    case LeadState.AWAITING_PHONE:
      session.data.phoneNumber = cleanText.replace(/[^0-9]/g, '');
      session.state = LeadState.AWAITING_ADDRESS;

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Phone: *${session.data.phoneNumber}*\n\n` +
          `*3. Your Address:*\n` +
          `(Reply with your address)`,
        sessionId,
      );
      break;

    case LeadState.AWAITING_ADDRESS:
      session.data.address = cleanText;
      session.state = LeadState.AWAITING_JOB_TYPE;
      session.jobTypes = jobTypes; // Cache for later use

      const jobMenu = await getJobTypeMenu(jobTypes);

      await sendTyping(jid, sessionId);
      await sendMessage(
        jid,
        `✅ Address recorded.\n\n` +
          `*4. Select Job Vacancy:*\n\n` +
          `${jobMenu}\n\n` +
          `Reply with the number (1-${jobTypes.length})`,
        sessionId,
      );
      break;

    case LeadState.AWAITING_JOB_TYPE:
      const selection = parseInt(cleanText);
      if (isNaN(selection) || selection < 1 || selection > jobTypes.length) {
        await sendMessage(
          jid,
          `⚠️ Invalid selection. Please reply with a number between 1 and ${jobTypes.length}`,
          sessionId,
        );
        return true;
      }

      session.data.jobVacancyType = jobTypes[selection - 1];

      await sendTyping(jid, sessionId);

      try {
        const response = await axios.post(
          `${
            process.env.API_BASE_URL || 'http://localhost:8080'
          }/api/leads/register`,
          {
            fullName: session.data.fullName,
            phoneNumber: session.data.phoneNumber,
            address: session.data.address,
            jobVacancyType: session.data.jobVacancyType,
          },
        );

        if (response.data.success) {
          await sendMessage(
            jid,
            `🎉 *Registration Complete!*\n\n` +
              `✅ Name: ${session.data.fullName}\n` +
              `✅ Phone: ${session.data.phoneNumber}\n` +
              `✅ Job: ${session.data.jobVacancyType}\n\n` +
              `📋 Your registration ID: ${response.data.leadId}\n\n` +
              `We will contact you soon!\n\n` +
              `Type \`!help\` for other commands.`,
            sessionId,
          );
        }
      } catch (error) {
        console.error('Lead registration error:', error);
        await sendMessage(
          jid,
          `❌ Registration failed. Please try again later or contact support.`,
          sessionId,
        );
      }

      leadSessions.delete(jid);
      return true;
  }

  return true;
}

function cleanName(name: string): string {
  return name
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}