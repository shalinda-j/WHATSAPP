import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { generateIcsFile } from './CalendarService';
import {
  getRealAvailability,
  createGoogleCalendarEvent,
} from './GoogleCalendarService';
import { addDays, setHours, setMinutes, format } from 'date-fns';
import { configurationManager } from './ConfigurationManagerService';
import sessionStateService from './SessionStateService';

// Define the stages of the booking conversation
export enum BookingInitState {
  IDLE = 'IDLE',
  AWAITING_RESPONSE = 'AWAITING_RESPONSE',
  SELECTING_TIME = 'SELECTING_TIME',
}

interface UserSession {
  state: BookingInitState;
  selectedDate?: Date;
  availableSlots?: number[];
  bookingConfig?: any;
}

// Session TTL: 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Check if user is currently in a booking flow
 */
export async function isUserInBookingSession(jid: string): Promise<boolean> {
  const session = await sessionStateService.getSession(jid, 'booking');
  return session !== null && session.state.state !== BookingInitState.IDLE;
}

/**
 * Get booking session
 */
async function getBookingSession(jid: string): Promise<UserSession | null> {
  const session = await sessionStateService.getSession(jid, 'booking');
  if (!session) return null;

  return {
    state: session.state.state as BookingInitState,
    selectedDate: session.data.selectedDate ? new Date(session.data.selectedDate) : undefined,
    availableSlots: session.data.availableSlots,
    bookingConfig: session.data.bookingConfig,
  };
}

/**
 * Save booking session
 */
async function saveBookingSession(
  jid: string,
  session: UserSession,
): Promise<void> {
  await sessionStateService.setSession(
    jid,
    'booking',
    { state: session.state },
    {
      selectedDate: session.selectedDate?.toISOString(),
      availableSlots: session.availableSlots,
      bookingConfig: session.bookingConfig,
    },
    SESSION_TTL_MS,
  );
}

/**
 * Start the booking flow for a user
 */
export async function startBookingFlow(
  jid: string,
  sessionId: string,
): Promise<void> {
  const bookingConfig = await configurationManager.getBookingConfig();
  const session: UserSession = {
    state: BookingInitState.AWAITING_RESPONSE,
    bookingConfig,
  };

  await saveBookingSession(jid, session);

  await sendTyping(jid, sessionId);
  await sendMessage(
    jid,
    `👋 *Campus Visit Invitation*\n\n` +
      `We would like to invite you to visit our campus for an introduction and skill assessment.\n\n` +
      `Would you like to schedule a visit now?\n` +
      `(Reply *Yes* to proceed)`,
    sessionId,
  );
}

/**
 * Handle incoming messages for users in the booking flow
 * Returns true if the message was consumed, false if it should propagate
 */
export async function handleBookingMessage(
  jid: string,
  text: string,
  sessionId: string,
): Promise<boolean> {
  const session = await getBookingSession(jid);
  if (!session || session.state === BookingInitState.IDLE) return false;

  const cleanText = text.trim().toLowerCase();

  // Get booking config (from session cache or fetch new)
  const bookingConfig = session.bookingConfig || await configurationManager.getBookingConfig();
  const acceptanceKeywords = bookingConfig.acceptanceKeywords || ['yes', 'ow', 'y', 'ok'];

  // 1. Awaiting "Yes" to invitation
  if (session.state === BookingInitState.AWAITING_RESPONSE) {
    if (acceptanceKeywords.includes(cleanText)) {
      // User accepted, show slots
      session.state = BookingInitState.SELECTING_TIME;
      session.bookingConfig = bookingConfig;

      // For MVP, offer slots for "Tomorrow"
      const tomorrow = addDays(new Date(), 1);
      session.selectedDate = tomorrow;

      await saveBookingSession(jid, session);
      await sendTimeSlotMenu(jid, tomorrow, session, sessionId);
      return true;
    } else {
      // User rejected or said something else
      await sessionStateService.deleteSession(jid, 'booking');
      await sendMessage(
        jid,
        `👍 No problem. You can schedule a visit later using \`!visit\`.`,
        sessionId,
      );
      return true;
    }
  }

  // 2. Selecting Time Slot
  if (session.state === BookingInitState.SELECTING_TIME) {
    if (!session.availableSlots) {
      await sessionStateService.deleteSession(jid, 'booking');
      return false;
    }

    const selection = parseInt(cleanText);
    // User must reply with 1..N based on availableSlots length
    if (
      isNaN(selection) ||
      selection < 1 ||
      selection > session.availableSlots.length
    ) {
      await sendMessage(
        jid,
        `⚠️ Please reply with the number of your preferred time (1-${session.availableSlots.length}).`,
        sessionId,
      );
      return true;
    }

    // Get the actual hour from the list
    const selectedHour = session.availableSlots[selection - 1];

    if (session.selectedDate) {
      const appointmentTime = setMinutes(
        setHours(session.selectedDate, selectedHour),
        0,
      );
      await finalizeBooking(jid, appointmentTime, sessionId);
    }

    return true;
  }

  return false;
}

async function sendTimeSlotMenu(
  jid: string,
  date: Date,
  session: UserSession,
  sessionId: string,
): Promise<void> {
  const dateStr = format(date, 'EEEE, MMMM do');

  // Fetch real availability or mock
  const slots = await getRealAvailability(date);
  session.availableSlots = slots;

  if (slots.length === 0) {
    await sendMessage(
      jid,
      `📅 Sorry, we have no available slots for ${dateStr}.`,
      sessionId,
    );
    await sessionStateService.deleteSession(jid, 'booking');
    return;
  }

  // Save updated session with available slots
  await saveBookingSession(jid, session);

  // Build menu string
  let menu = `🗓️ *Select a Time*\nAvailable slots for ${dateStr}:\n\n`;
  slots.forEach((hour, index) => {
    // Simple hour formatting (8 -> 08:00 AM)
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour;
    menu += `${index + 1}️⃣ *${displayHour}:00 ${ampm}*\n`;
  });

  menu += `\nReply with the number (e.g., "1") to book.`;

  await sendMessage(jid, menu, sessionId);
}

async function finalizeBooking(
  jid: string,
  appointmentDate: Date,
  sessionId: string,
): Promise<void> {
  const sock = getSocket(sessionId);
  if (!sock) return;

  // Get booking config for dynamic values
  const bookingConfig = await configurationManager.getBookingConfig();
  const campusLocation = bookingConfig.campusLocation || 'Campus';
  const organizerName = bookingConfig.organizerName || 'Organization';
  const organizerEmail = bookingConfig.organizerEmail || 'info@example.com';
  const eventTitle = bookingConfig.eventTitle || 'Campus Visit';
  const eventDescription = bookingConfig.eventDescription || 'Introduction and Assessment';
  const eventDuration = bookingConfig.eventDurationHours || 1;

  await sendMessage(jid, `✅ *Confirming your appointment...*`, sessionId);

  try {
    // 1. Create Google Calendar Event (if credentials exist)
    const gcalLink = await createGoogleCalendarEvent(
      appointmentDate,
      eventTitle,
      eventDescription,
    );

    // 2. Generate ICS file (Backup/Personal Calendar)
    const icsContent = await generateIcsFile({
      start: appointmentDate,
      durationHours: eventDuration,
      title: eventTitle,
      description: eventDescription,
      location: campusLocation,
      organizer: { name: organizerName, email: organizerEmail },
    });

    // Send confirmation text
    const timeStr = format(appointmentDate, 'PPpp');
    let msg =
      `🎉 *Appointment Confirmed!*\n\n` +
      `📅 Time: ${timeStr}\n` +
      `📍 Location: ${campusLocation}\n\n`;

    if (gcalLink) {
      // Keep it simple for WhatsApp, maybe don't flood with links if we send the ICS
    }

    msg += `Please download the attached file to add this to your calendar.`;

    await sendMessage(jid, msg, sessionId);

    // Send ICS file
    await sock.sendMessage(jid, {
      document: Buffer.from(icsContent),
      mimetype: 'text/calendar',
      fileName: `${organizerName.replace(/\s+/g, '-')}-Invite.ics`,
      caption: '📅 Add to Calendar',
    });

    // Reset session
    await sessionStateService.deleteSession(jid, 'booking');
  } catch (err) {
    console.error('Error booking appointment:', err);
    await sendMessage(
      jid,
      `❌ Sorry, there was an error reserving your slot.`,
      sessionId,
    );
    // Clear session on error to prevent stuck state
    await sessionStateService.deleteSession(jid, 'booking');
  }
}

/**
 * Handle a specific date request from natural language
 */
export async function handleSpecificDateRequest(
  jid: string,
  dateStr: string,
  timeStr: string,
  sessionId: string,
): Promise<boolean> {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const requestedSlot = hours;

    // Check availability
    const availableSlots = await getRealAvailability(date);

    if (availableSlots.includes(requestedSlot)) {
      // Success! Book it.
      const appointmentTime = new Date(date);
      appointmentTime.setHours(hours, minutes, 0, 0);

      await finalizeBooking(jid, appointmentTime, sessionId);
      return true;
    } else {
      // Not available
      const dateDisplay = format(date, 'MMMM do');
      let msg = `⚠️ Sorry, *${timeStr}* on ${dateDisplay} is not available.\n\n`;

      if (availableSlots.length > 0) {
        msg +=
          `Available slots on that day:\n` +
          availableSlots
            .map((h) => {
              const ampm = h >= 12 ? 'PM' : 'AM';
              const displayH = h > 12 ? h - 12 : h;
              return `• ${displayH}:00 ${ampm}`;
            })
            .join('\n');
      } else {
        msg += `We are fully booked on ${dateDisplay}.`;
      }

      await sendMessage(jid, msg, sessionId);
      return true;
    }
  } catch (e) {
    console.error('Error handling specific date:', e);
    return false;
  }
}

/**
 * Get active booking session count
 */
export async function getActiveSessionCount(): Promise<number> {
  return sessionStateService.getSessionCount('booking');
}