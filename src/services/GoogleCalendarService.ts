import { google } from 'googleapis';
import { resolve } from 'path';
import { existsSync } from 'fs';

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
 * Get available slots for a given date
 * (This is a simplified logic: checks specific slots against busy times)
 */
export async function getRealAvailability(date: Date): Promise<number[]> {
    const auth = getAuthClient();

    // Default slots if auth is missing (Mock Mode)
    const defaultSlots = [8, 9, 10, 11, 13, 14, 15];
    if (!auth) {
        return defaultSlots;
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
        const busyHours = new Set<number>();

        // Mark hours as busy if there's an event
        events.forEach(event => {
            if (event.start?.dateTime) {
                const start = new Date(event.start.dateTime);
                const hour = start.getHours();
                busyHours.add(hour);
            }
        });

        // Return slots that are NOT in busyHours
        return defaultSlots.filter(slot => !busyHours.has(slot));

    } catch (error) {
        console.error('❌ Failed to fetch calendar events:', error);
        return defaultSlots; // Fallback to defaults on error
    }
}

/**
 * Create a new event in Google Calendar
 */
export async function createGoogleCalendarEvent(
    start: Date,
    title: string,
    description: string,
    attendeeEmail?: string
): Promise<string | null> {
    const auth = getAuthClient();
    if (!auth) return null;

    try {
        const calendar = google.calendar({ version: 'v3', auth });

        const end = new Date(start);
        end.setHours(start.getHours() + 1); // 1 hour duration

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
