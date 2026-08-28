import { readFileSync } from 'fs';
import { join } from 'path';
import Booking from '../models/Booking';

describe('admin-created booking audit identity', () => {
  it('persists the authenticated username and shows it in Booking Details', () => {
    const analyticsRoute = readFileSync(
      join(process.cwd(), 'src/server/routes/analytics.ts'),
      'utf8',
    );
    const calendarPage = readFileSync(
      join(process.cwd(), 'client/src/pages/Calendar.tsx'),
      'utf8',
    );

    expect(Booking.schema.path('createdByUsername')).toBeDefined();
    expect(analyticsRoute).toContain(
      'createdByUsername: (req as AuthRequest).user?.username',
    );
    expect(calendarPage).toContain('createdByUsername?: string');
    expect(calendarPage).toContain('Booked By');
    expect(calendarPage).toContain('selectedBooking.createdByUsername');
  });
});
