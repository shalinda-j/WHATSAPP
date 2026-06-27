import axios from 'axios';
import type { AxiosInstance } from 'axios';

/**
 * Kiosk API client — a SEPARATE axios instance from the shared admin `api`
 * in src/config.ts. The kiosk is a PUBLIC branch terminal, so this instance:
 *   - attaches the short-lived kiosk JWT via the `x-kiosk-token` header
 *     (sessionStorage key "kioskToken"), NOT the admin Authorization bearer.
 *   - does NOT redirect to /login on 401/403 (there is no admin login here;
 *     a 401 just means the kiosk session expired and the page handles it).
 *
 * baseURL matches the shared admin api (src/config.ts): VITE_API_URL or ''.
 */

const KIOSK_TOKEN_KEY = 'kioskToken';

// Mirror the admin api baseURL so both hit the same backend origin.
const API_URL = import.meta.env.VITE_API_URL || '';

const kioskApi: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the kiosk token (when present) as x-kiosk-token. No admin bearer.
kioskApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(KIOSK_TOKEN_KEY);
  if (token) {
    config.headers['x-kiosk-token'] = token;
  }
  return config;
});

// NOTE: intentionally NO response interceptor that redirects to /login.
// The kiosk is a public terminal; callers handle 401/expiry themselves.

/** Store the kiosk session token for subsequent kiosk requests. */
export function setKioskToken(token: string): void {
  sessionStorage.setItem(KIOSK_TOKEN_KEY, token);
}

/** Remove the kiosk session token (e.g. on "End session"). */
export function clearKioskToken(): void {
  sessionStorage.removeItem(KIOSK_TOKEN_KEY);
}

export default kioskApi;
