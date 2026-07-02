import { sendMessage, sendTyping, getSocket } from './whatsapp';
import { generateIcsFile } from './CalendarService';
import {
  getRealAvailability,
  createGoogleCalendarEvent,
} from './GoogleCalendarService';
import { addDays, setHours, setMinutes, format } from 'date-fns';
import { configurationManager } from './ConfigurationManagerService';
import { WebhookService } from './WebhookService';
import sessionStateService from './SessionStateService';
import Booking from '../models/Booking';
import Session from '../models/Session';
import { agentReflectionService } from './AgentReflectionService';
import { conversionService } from './ConversionService';
import { kioskInviteService } from './KioskInviteService';
import {
  normalisePhoneDigits,
  loadPhoneMapForLids,
  normaliseLidJid,
} from './LidPhoneMappingService';
import { isLidJid } from '../utils/jid';

/** Resolve the tenant that owns a WhatsApp session (undefined if none). */
async function tenantIdForSession(sessionId: string): Promise<unknown> {
  try {
    const sess = await Session.findOne({ sessionId })
      .select('tenantId')
      .lean();
    return (sess as { tenantId?: unknown } | null)?.tenantId ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a caller's REAL phone from a chat JID for booking storage. Returns
 * digits only; never the raw '...@lid' string. Falls back to the stored
 * LID→phone mapping, then to the bare local part as a last resort.
 */
async function resolveCallerPhone(
  jid: string,
  sessionId: string,
): Promise<string> {
  const direct = normalisePhoneDigits(jid);
  if (direct) return direct;
  if (isLidJid(jid)) {
    try {
      const map = await loadPhoneMapForLids([jid], sessionId);
      const mapped =
        map.get(normaliseLidJid(jid) ?? jid) ??
        map.get(jid.replace('@lid', ''));
      if (mapped) return mapped;
    } catch (e) {
      console.error('LID→phone resolve for booking failed:', e);
    }
  }
  // Last resort: bare local part, but never with an "@lid"/"@..." suffix.
  return jid.split('@')[0] || jid;
}

// Define the stages of the booking conversation
export enum BookingInitState {
  IDLE = 'IDLE',
  AWAITING_RESPONSE = 'AWAITING_RESPONSE',
  /** User is picking a date from the next-N-days menu (D10 fix). */
  SELECTING_DATE = 'SELECTING_DATE',
  SELECTING_TIME = 'SELECTING_TIME',
}

/** How many upcoming days to offer in the date picker. */
const DATE_OFFER_DAYS = 7;

interface UserSession {
  state: BookingInitState;
  selectedDate?: Date;
  availableSlots?: number[];
  /** Ordered list of candidate dates shown to the user in the date menu. */
  availableDates?: string[]; // ISO date strings
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
    selectedDate: session.data.selectedDate
      ? new Date(session.data.selectedDate)
      : undefined,
    availableSlots: session.data.availableSlots,
    availableDates: session.data.availableDates,
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
      availableDates: session.availableDates,
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

  // FIX: Persist session state BEFORE sending the WhatsApp message. If the
  // DB write fails we abort — never send the prompt without the session state,
  // because the user's next reply would fall through to the AI with no context.
  try {
    await saveBookingSession(jid, session);
  } catch (saveErr: any) {
    console.error(
      `[BookingService] Failed to save session state for ${jid}:`,
      saveErr?.message,
    );
    // Let the caller know the flow couldn't start so it doesn't suppress the
    // AI fallback or send a misleading booking prompt.
    throw new Error(`Booking session save failed: ${saveErr?.message}`);
  }

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
  const bookingConfig =
    session.bookingConfig || (await configurationManager.getBookingConfig());
  const acceptanceKeywords = bookingConfig.acceptanceKeywords || [
    'yes',
    'ow',
    'y',
    'ok',
  ];

  // 1. Awaiting "Yes" to invitation
  if (session.state === BookingInitState.AWAITING_RESPONSE) {
    if (acceptanceKeywords.includes(cleanText)) {
      // User accepted — show a date picker for the next DATE_OFFER_DAYS days
      // instead of hard-coding "Tomorrow". This also skips today (index 0) so
      // same-day bookings don't appear without lead time.
      session.state = BookingInitState.SELECTING_DATE;
      session.bookingConfig = bookingConfig;

      const today = new Date();
      const candidateDates: string[] = [];
      for (let d = 1; d <= DATE_OFFER_DAYS; d++) {
        candidateDates.push(addDays(today, d).toISOString());
      }
      session.availableDates = candidateDates;
      await saveBookingSession(jid, session);

      // Build date menu
      let dateMenu = `📅 *Choose a Date*\n\nAvailable dates:\n\n`;
      candidateDates.forEach((iso, idx) => {
        dateMenu += `${idx + 1}️⃣ *${format(new Date(iso), 'EEEE, MMMM do')}*\n`;
      });
      dateMenu += `\nReply with the number of your preferred date.`;
      await sendMessage(jid, dateMenu, sessionId);
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

  // 2. User picks a date from the date menu
  if (session.state === BookingInitState.SELECTING_DATE) {
    const dates = session.availableDates;
    if (!dates || dates.length === 0) {
      await sessionStateService.deleteSession(jid, 'booking');
      return false;
    }
    const pick = parseInt(cleanText);
    if (isNaN(pick) || pick < 1 || pick > dates.length) {
      await sendMessage(
        jid,
        `⚠️ Please reply with the number of your preferred date (1-${dates.length}).`,
        sessionId,
      );
      return true;
    }
    const chosenDate = new Date(dates[pick - 1]);
    session.selectedDate = chosenDate;
    session.state = BookingInitState.SELECTING_TIME;
    await sendTimeSlotMenu(jid, chosenDate, session, sessionId);
    return true;
  }

  // 3. Selecting Time Slot
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

  // Fetch real availability or mock — tenant-scoped so we only subtract THIS
  // tenant's booked slots (not the whole platform's).
  const slots = await getRealAvailability(
    date,
    await tenantIdForSession(sessionId),
  );
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
  callerName?: string,
): Promise<void> {
  const sock = getSocket(sessionId);
  if (!sock) return;

  // Get booking config for dynamic values
  const bookingConfig = await configurationManager.getBookingConfig();
  const campusLocation = bookingConfig.campusLocation || 'Campus';
  const organizerName = bookingConfig.organizerName || 'Organization';
  const organizerEmail = bookingConfig.organizerEmail || 'info@example.com';
  const eventTitle = bookingConfig.eventTitle || 'Campus Visit';
  const eventDescription =
    bookingConfig.eventDescription || 'Introduction and Assessment';
  const eventDuration = bookingConfig.eventDurationHours || 1;

  // Resolve the caller's real phone (never store a raw "...@lid") and the
  // owning tenant up-front — both are needed by the guard, the save, and the
  // tenant-scoped availability.
  const callerPhone = await resolveCallerPhone(jid, sessionId);
  const bookingTenantId = await tenantIdForSession(sessionId);

  // Double-booking guard (layer B): refuse if the exact date+hour already has a
  // confirmed/pending booking. Availability already subtracts booked slots, but
  // this closes the race where two users confirm the same slot near-simultaneously.
  try {
    const dayStart = new Date(appointmentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate);
    dayEnd.setHours(23, 59, 59, 999);
    const targetHour = appointmentDate.getHours();
    const targetTimeStr = format(appointmentDate, 'HH:mm');

    // Tenant-scope the guard (legacy-tolerant) so tenant A's 10:00 booking
    // doesn't block tenant B from the same slot — bookings are per-tenant.
    const sameDayFilter: Record<string, unknown> = {
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ['confirmed', 'pending'] },
    };
    if (bookingTenantId) {
      sameDayFilter.$or = [
        { tenantId: bookingTenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    const sameDay = await Booking.find(sameDayFilter)
      .select('date time')
      .lean();

    const conflict = sameDay.some((b: any) => {
      if (typeof b.time === 'string' && /^\d{1,2}:\d{2}/.test(b.time)) {
        return b.time === targetTimeStr || parseInt(b.time.split(':')[0], 10) === targetHour;
      }
      return b.date ? new Date(b.date).getHours() === targetHour : false;
    });

    if (conflict) {
      await sendMessage(
        jid,
        `⚠️ Sorry, that time slot was just booked by someone else. Please reply *!visit* to pick another time.`,
        sessionId,
      );
      await sessionStateService.deleteSession(jid, 'booking');
      return;
    }
  } catch (guardErr) {
    // Fail open on guard errors so a transient DB issue doesn't block bookings.
    console.error('Double-booking guard check failed:', guardErr);
  }

  await sendMessage(jid, `✅ *Confirming your appointment...*`, sessionId);

  // Auto-issued kiosk voice-consult code for THIS visit — filled inside the
  // booking-save block below and appended to the confirmation message, so
  // every customer the bot books a Campus Visit for automatically gets a code
  // to talk to the AI Consulting Voice Assistant when they arrive.
  let kioskCode: string | null = null;

  try {
    // 1. Create Google Calendar Event (if credentials exist)
    const fullDescription = `${eventDescription}\n\nClient: ${
      callerName || callerPhone
    }\nPhone: ${callerPhone}\nLocation: ${campusLocation}`;
    const gcalLink = await createGoogleCalendarEvent(
      appointmentDate,
      eventTitle,
      fullDescription,
      undefined,
      eventDuration,
    );

    // 2. Generate ICS file (Backup/Personal Calendar)
    const icsContent = await generateIcsFile({
      start: appointmentDate,
      durationHours: eventDuration,
      title: eventTitle,
      description: fullDescription,
      location: campusLocation,
      organizer: { name: organizerName, email: organizerEmail },
    });

    // 3. Save booking to MongoDB
    const timeStr24 = format(appointmentDate, 'HH:mm');
    try {
      // Multi-tenant isolation: stamp the bot-created booking with the tenant
      // that owns this WhatsApp session (resolved once, above), mirroring the
      // admin POST /bookings stamping. Optional — legacy/single-tenant
      // sessions have no tenantId.
      const booking = await Booking.create({
        clientName: callerName || callerPhone,
        clientPhone: callerPhone,
        date: appointmentDate,
        time: timeStr24,
        duration: eventDuration * 60,
        type: eventTitle,
        notes: eventDescription,
        status: 'confirmed',
        sessionId,
        location: campusLocation,
        gcalLink: gcalLink || undefined,
        tenantId: bookingTenantId,
      });

      // Notify any subscribed webhooks that a booking was confirmed.
      WebhookService.triggerWebhook('booking.created', {
        id: booking._id,
        clientName: booking.clientName,
        clientPhone: booking.clientPhone,
        date: booking.date,
        time: booking.time,
        type: booking.type,
        location: booking.location,
        sessionId,
        timestamp: new Date(),
      }, bookingTenantId).catch((err) =>
        console.error('booking.created webhook trigger failed:', err),
      );

      // Outcome correlation: credit any agents that handled this user's
      // recent conversation turns. Fire-and-forget so a slow reflection
      // pass never delays the booking confirmation flow.
      agentReflectionService
        .correlateBookingOutcome(jid, booking._id, 'created')
        .catch((err) => console.error('correlateBookingOutcome failed:', err));

      // CONVERSION: a confirmed campus-visit booking is a customer-conversion
      // moment on the path to enrolment. Record + attribute (fire & forget).
      conversionService
        .recordConversion({
          phoneNumber: callerPhone,
          jid,
          kind: 'booking_created',
          bookingId: booking._id,
          sessionId,
          source: 'whatsapp',
        })
        .catch((err) => console.error('recordConversion(booking) failed:', err));

      // Auto-issue a kiosk voice-consult code tied to this visit. Best-effort
      // and awaited only so the code can be included in the confirmation below
      // (deliver:false = no duplicate WhatsApp message). Kept valid through the
      // visit day (+1 day buffer) or the default 7-day window, whichever is
      // later, so a visit booked further out still has a live code on the day.
      try {
        const visitDayEnd = new Date(appointmentDate);
        visitDayEnd.setHours(23, 59, 59, 999);
        const codeExpiry = new Date(
          Math.max(
            visitDayEnd.getTime() + 24 * 60 * 60 * 1000,
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ),
        );
        const issued = await kioskInviteService.issue({
          phone: callerPhone,
          jid,
          tenantId: bookingTenantId ? String(bookingTenantId) : undefined,
          sessionId,
          deliver: false, // included in the confirmation message below
          expiresAt: codeExpiry,
        });
        kioskCode = issued?.code || null;
      } catch (kErr) {
        console.error(
          'Kiosk code auto-issue on booking failed (non-fatal):',
          (kErr as any)?.message || kErr,
        );
      }
    } catch (err) {
      // Do NOT swallow and fall through to the "Appointment Confirmed!" message
      // below — if the booking row didn't persist, the operator has no record,
      // no webhook/conversion fired, and the slot isn't reserved, yet the
      // customer would believe they're booked. Apologise and abort instead.
      console.error('Failed to save booking to DB:', err);
      await sendMessage(
        jid,
        `❌ Sorry, there was an error reserving your slot. Please try again by replying *!visit*.`,
        sessionId,
      );
      await sessionStateService.deleteSession(jid, 'booking');
      return;
    }

    // 4. Send confirmation text with full details
    const timeStr = format(appointmentDate, 'PPpp');
    let msg =
      `🎉 *Appointment Confirmed!*\n\n` +
      `📅 *Date & Time:* ${timeStr}\n` +
      `📍 *Location:* ${campusLocation}\n` +
      `🏷️ *Type:* ${eventTitle}\n` +
      `⏱️ *Duration:* ${eventDuration} hour(s)\n` +
      `📞 *Contact:* ${callerPhone}\n`;

    if (gcalLink) {
      msg += `\n🔗 *Calendar Link:* ${gcalLink}\n`;
    }

    // Kiosk voice-consult code for the visit day (auto-issued above).
    if (kioskCode) {
      msg +=
        `\n🔢 *Voice Consult Code:* ${kioskCode}\n` +
        `${campusLocation} ශාඛාවට ආ දිනයේ, kiosk තිරයේ මෙම කේතය ඇතුළත් කර අපගේ AI උපදේශක සමඟ කතා කරන්න.\n` +
        `(When you arrive, enter this code at the kiosk to talk to our AI consultant.)\n`;
    }

    msg += `\nPlease download the attached file to add this event to your personal calendar.`;

    await sendMessage(jid, msg, sessionId);

    // 5. Send ICS file
    await sock.sendMessage(jid, {
      document: Buffer.from(icsContent),
      mimetype: 'text/calendar',
      fileName: `${organizerName.replace(/\s+/g, '-')}-Invite.ics`,
      caption: `📅 ${eventTitle} – Add to Calendar`,
    });

    // Reset session
    await sessionStateService.deleteSession(jid, 'booking');
  } catch (err) {
    console.error('Error booking appointment:', err);
    await sendMessage(
      jid,
      `❌ Sorry, there was an error reserving your slot. Please try again.`,
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
    // Parse the AI-supplied date STRICTLY as YYYY-MM-DD. The previous
    // `new Date(dateStr)` validation accepted many formats (e.g. '2026/07/05',
    // 'Jul 5 2026'), but the booking path below rebuilds the date via
    // `dateStr.split('-')` which only works for hyphenated ISO dates — a
    // non-ISO string passed validation yet produced an Invalid Date
    // (Date.UTC(NaN,…)), so finalizeBooking errored or stored garbage.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return false;
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    // Parse the calendar date as UTC so the stored hour matches the slot the
    // user picked (mirrors the admin POST /bookings convention). Parsing as
    // local then setHours could shift the day/hour across timezones.
    const date = new Date(Date.UTC(yy, mm - 1, dd));
    // Reject out-of-range components (e.g. 2026-13-40) by round-tripping.
    if (
      isNaN(date.getTime()) ||
      date.getUTCFullYear() !== yy ||
      date.getUTCMonth() !== mm - 1 ||
      date.getUTCDate() !== dd
    ) {
      return false;
    }

    const [hours, minutes] = timeStr.split(':').map(Number);
    const requestedSlot = hours;

    // Check availability — tenant-scoped so cross-tenant bookings don't
    // spuriously mark this tenant's slot as taken.
    const availableSlots = await getRealAvailability(
      date,
      await tenantIdForSession(sessionId),
    );

    if (availableSlots.includes(requestedSlot)) {
      // Success! Book it.
      const appointmentTime = new Date(Date.UTC(yy, mm - 1, dd));
      appointmentTime.setUTCHours(hours, minutes || 0, 0, 0);

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
