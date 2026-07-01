import { google } from 'googleapis';
import { resolve } from 'path';
import { existsSync } from 'fs';
import Booking from '../models/Booking';

// Constants
const CREDENTIALS_PATH = resolve(__dirname, '../../google-credentials.json'); // Expected in project root
const CALENDAR_ID = 'primary'; // Or specific calendar ID
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Initialize Google Calendar Auth
 */
function getAuthClient() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.warn('⚠️ google-credentials.json not found. Using mock mode.');
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: SCOPES,
  });

  return auth;
}

/**
 * Hours that already have a confirmed/pending booking in our own DB for the
 * given calendar day. Prevents double-booking even when Google Calendar is in
 * mock mode (no credentials) or the event was created only in MongoDB.
 */
async function getBookedHoursFromDb(date: Date): Promise<Set<number>> {
  const booked = new Set<number>();
  try {
    // Use UTC day bounds. Booking dates are commonly stored as date-only
    // (UTC midnight), so local setHours() on a non-UTC host would shift the
    // window and either miss same-day bookings or pull in adjacent days.
    const dayStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    );
    const dayEnd = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    const bookings = await Booking.find({
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ['confirmed', 'pending'] },
    })
      .select('date time')
      .lean();

    for (const b of bookings) {
      let hour: number | undefined;
      if (typeof b.time === 'string' && /^\d{1,2}:\d{2}/.test(b.time)) {
        hour = parseInt(b.time.split(':')[0], 10);
      } else if (b.date) {
        hour = new Date(b.date).getHours();
      }
      if (typeof hour === 'number' && !isNaN(hour)) {
        booked.add(hour);
      }
    }
  } catch (err) {
    // On DB error, fail open (don't block bookings) but log it.
    console.error('❌ Failed to load booked hours from DB:', err);
  }
  return booked;
}

/**
 * Get available slots for a given date
 * (This is a simplified logic: checks specific slots against busy times)
 */
export async function getRealAvailability(date: Date): Promise<number[]> {
  const auth = getAuthClient();

  // Default slots if auth is missing (Mock Mode)
  const defaultSlots = [8, 9, 10, 11, 13, 14, 15];

  // Always subtract slots already taken by our own confirmed/pending bookings
  // so we never offer a slot that's already booked (double-booking guard).
  const dbBooked = await getBookedHoursFromDb(date);

  if (!auth) {
    return defaultSlots.filter((slot) => !dbBooked.has(slot));
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });

    // Define start and end of the work day (8 AM to 5 PM)
    const timeMin = new Date(date);
    timeMin.setHours(8, 0, 0, 0);

    const timeMax = new Date(date);
    timeMax.setHours(17, 0, 0, 0);

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const busyHours = new Set<number>(dbBooked);

    // Mark hours as busy if there's an event
    events.forEach((event) => {
      if (event.start?.dateTime) {
        const start = new Date(event.start.dateTime);
        const hour = start.getHours();
        busyHours.add(hour);
      }
    });

    // Return slots that are NOT in busyHours
    return defaultSlots.filter((slot) => !busyHours.has(slot));
  } catch (error) {
    console.error('❌ Failed to fetch calendar events:', error);
    // Even on calendar error, still honour our own DB bookings.
    return defaultSlots.filter((slot) => !dbBooked.has(slot));
  }
}

/**
 * Create a new event in Google Calendar
 */
export async function createGoogleCalendarEvent(
  start: Date,
  title: string,
  description: string,
  attendeeEmail?: string,
  durationHours = 1,
): Promise<string | null> {
  const auth = getAuthClient();
  if (!auth) return null;

  try {
    const calendar = google.calendar({ version: 'v3', auth });

    // Event end = start + configured duration (defaults to 1 hour).
    const end = new Date(start.getTime() + durationHours * 3600_000);

    const event = {
      summary: title,
      description: description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
    });

    console.log('✅ Event created in Google Calendar:', response.data.htmlLink);
    return response.data.htmlLink || null;
  } catch (error) {
    console.error('❌ Failed to create Google Calendar event:', error);
    return null;
  }
}
