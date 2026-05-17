import { ITenant } from '../models/Tenant';

export interface QuietHoursWindow {
  enabled?: boolean;
  startHour: number;
  endHour: number;
  timezone?: string;
}

/**
 * Returns the local hour (0-23) for the given timezone using Intl.DateTimeFormat.
 * Falls back to system-local hour if the timezone is invalid or unsupported.
 */
export function hourInZone(
  now: Date = new Date(),
  timezone?: string,
): number {
  if (!timezone) return now.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    if (hourPart === undefined) return now.getHours();
    const parsed = Number(hourPart);
    if (Number.isNaN(parsed)) return now.getHours();
    // Intl renders midnight as "24" in some locale fallbacks — normalise.
    return parsed % 24;
  } catch {
    return now.getHours();
  }
}

/**
 * Tests whether the given hour (0-23) is inside the quiet-hours window.
 * Handles wrap-around windows like 21→8.
 */
export function isHourInWindow(
  hour: number,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function isQuietHoursActive(
  window: QuietHoursWindow | undefined,
  now: Date = new Date(),
): boolean {
  if (!window || window.enabled === false) return false;
  if (
    typeof window.startHour !== 'number' ||
    typeof window.endHour !== 'number'
  ) {
    return false;
  }
  const hour = hourInZone(now, window.timezone);
  return isHourInWindow(hour, window.startHour, window.endHour);
}

/**
 * Resolves the effective quiet-hours window for a tenant: explicit
 * tenant.quietHours when enabled, with brand.timezone used as the
 * fallback zone if the window doesn't pin one itself.
 */
export function tenantQuietHours(
  tenant: Pick<ITenant, 'quietHours' | 'brand'> | null | undefined,
): QuietHoursWindow | undefined {
  const qh = tenant?.quietHours;
  if (!qh || !qh.enabled) return undefined;
  return {
    enabled: true,
    startHour: qh.startHour,
    endHour: qh.endHour,
    timezone: qh.timezone || tenant?.brand?.timezone,
  };
}
