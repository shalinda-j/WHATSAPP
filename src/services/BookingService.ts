import { sendMessage, sendTyping, getSenderJid, getSocket } from './whatsapp';
import { generateIcsFile } from './CalendarService';
import { getRealAvailability, createGoogleCalendarEvent } from './GoogleCalendarService';
import { addDays, setHours, setMinutes, format } from 'date-fns';

// Define the stages of the booking conversation
export enum BookingInitState {
    IDLE = 'IDLE',
    AWAITING_RESPONSE = 'AWAITING_RESPONSE',
    SELECTING_TIME = 'SELECTING_TIME',
}

interface UserSession {
    state: BookingInitState;
    selectedDate?: Date;
    availableSlots?: number[]; // Store the slots we offered
}

// In-memory session store (Map<Jid, Session>)
const sessions = new Map<string, UserSession>();

const CAMPUS_LOCATION = 'JCETI Campus, No 33, Main Street, Colombo';
const ORGANIZER = { name: 'Jayalath Institute', email: 'info@jayalath.com' };

/**
 * Check if user is currently in a booking flow
 */
export function isUserInBookingSession(jid: string): boolean {
    const session = sessions.get(jid);
    return session !== undefined && session.state !== BookingInitState.IDLE;
}

/**
 * Start the booking flow for a user
 */
export async function startBookingFlow(jid: string, sessionId: string): Promise<void> {
    const session: UserSession = { state: BookingInitState.AWAITING_RESPONSE };
    sessions.set(jid, session);

    await sendTyping(jid, sessionId);
    await sendMessage(
        jid,
        `👋 *Campus Visit Invitation*\n\n` +
        `We would like to invite you to visit our campus for an introduction and skill assessment.\n\n` +
        `Would you like to schedule a visit now?\n` +
        `(Reply *Yes* to proceed)`,
        sessionId
    );
}

/**
 * Handle incoming messages for users in the booking flow
 * Returns true if the message was consumed, false if it should propagate
 */
export async function handleBookingMessage(jid: string, text: string, sessionId: string): Promise<boolean> {
    const session = sessions.get(jid);
    if (!session || session.state === BookingInitState.IDLE) return false;

    const cleanText = text.trim().toLowerCase();

    // 1. Awaiting "Yes" to invitation
    if (session.state === BookingInitState.AWAITING_RESPONSE) {
        if (['yes', 'ow', 'y', 'ok'].includes(cleanText)) {
            // User accepted, show slots
            session.state = BookingInitState.SELECTING_TIME;

            // For MVP, offer slots for "Tomorrow"
            // Ensure we don't offer Sat/Sun if closed, but for now simple +1 day
            const tomorrow = addDays(new Date(), 1);
            session.selectedDate = tomorrow;

            await sendTimeSlotMenu(jid, tomorrow, session, sessionId);
            return true;
        } else {
            // User rejected or said something else
            sessions.delete(jid);
            await sendMessage(jid, `👍 No problem. You can schedule a visit later using \`!visit\`.`, sessionId);
            return true;
        }
    }

    // 2. Selecting Time Slot
    if (session.state === BookingInitState.SELECTING_TIME) {
        if (!session.availableSlots) {
            sessions.delete(jid);
            return false;
        }

        const selection = parseInt(cleanText);
        // User must reply with 1..N based on availableSlots length
        if (isNaN(selection) || selection < 1 || selection > session.availableSlots.length) {
            await sendMessage(jid, `⚠️ Please reply with the number of your preferred time (1-${session.availableSlots.length}).`, sessionId);
            return true;
        }

        // Get the actual hour from the list
        const selectedHour = session.availableSlots[selection - 1];

        if (session.selectedDate) {
            const appointmentTime = setMinutes(setHours(session.selectedDate, selectedHour), 0);
            await finalizeBooking(jid, appointmentTime, sessionId);
        }

        return true;
    }

    return false;
}

async function sendTimeSlotMenu(jid: string, date: Date, session: UserSession, sessionId: string): Promise<void> {
    const dateStr = format(date, 'EEEE, MMMM do');

    // Fetch real availability or mock
    const slots = await getRealAvailability(date);
    session.availableSlots = slots;

    if (slots.length === 0) {
        await sendMessage(jid, `📅 Sorry, we have no available slots for ${dateStr}.`, sessionId);
        sessions.delete(jid);
        return;
    }

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

async function finalizeBooking(jid: string, appointmentDate: Date, sessionId: string): Promise<void> {
    const sock = getSocket(sessionId);
    if (!sock) return;

    await sendMessage(jid, `✅ *Confirming your appointment...*`, sessionId);

    try {
        const title = 'Campus Visit - Jayalath Institute';
        const desc = 'Introduction and Skill Assessment';

        // 1. Create Google Calendar Event (if credentials exist)
        const gcalLink = await createGoogleCalendarEvent(appointmentDate, title, desc);

        // 2. Generate ICS file (Backup/Personal Calendar)
        const icsContent = await generateIcsFile({
            start: appointmentDate,
            durationHours: 1,
            title: title,
            description: desc,
            location: CAMPUS_LOCATION,
            organizer: ORGANIZER
        });

        // Send confirmation text
        const timeStr = format(appointmentDate, 'PPpp');
        let msg = `🎉 *Appointment Confirmed!*\n\n` +
            `📅 Time: ${timeStr}\n` +
            `📍 Location: ${CAMPUS_LOCATION}\n\n`;

        if (gcalLink) {
            // Keep it simple for WhatsApp, maybe don't flood with links if we send the ICS
        }

        msg += `Please download the attached file to add this to your calendar.`;

        await sendMessage(jid, msg, sessionId);

        // Send ICS file
        await sock.sendMessage(jid, {
            document: Buffer.from(icsContent),
            mimetype: 'text/calendar',
            fileName: 'Jayalath-Invite.ics',
            caption: '📅 Add to Calendar'
        });

        // Reset session
        sessions.delete(jid);

    } catch (err) {
        console.error('Error booking appointment:', err);
        await sendMessage(jid, `❌ Sorry, there was an error reserving your slot.`, sessionId);
    }
}


/**
 * Handle a specific date request from natural language
 */
export async function handleSpecificDateRequest(jid: string, dateStr: string, timeStr: string, sessionId: string): Promise<boolean> {
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
                msg += `Available slots on that day:\n` +
                    availableSlots.map(h => {
                        const ampm = h >= 12 ? 'PM' : 'AM';
                        const displayH = h > 12 ? h - 12 : h;
                        return `• ${displayH}:00 ${ampm}`;
                    }).join('\n');
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
