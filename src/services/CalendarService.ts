import { createEvent, EventAttributes } from 'ics';
import { addHours } from 'date-fns';

export interface AppointmentDetails {
  start: Date;
  durationHours: number;
  title: string;
  description: string;
  location: string;
  organizer: { name: string; email: string };
}

/**
 * Generates an ICS file content string for the given appointment.
 */
export async function generateIcsFile(
  details: AppointmentDetails,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = details.start;
    // ics library expects [year, month, day, hour, minute]
    // Note: month in ics is 1-indexed (1=Jan), Date.getMonth is 0-indexed.
    const startArray: [number, number, number, number, number] = [
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate(),
      start.getHours(),
      start.getMinutes(),
    ];

    const event: EventAttributes = {
      start: startArray,
      duration: { hours: details.durationHours, minutes: 0 },
      title: details.title,
      description: details.description,
      location: details.location,
      organizer: details.organizer,
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
    };

    createEvent(event, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    });
  });
}
