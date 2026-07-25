import axios from 'axios';

// Get API URL from env or default to relative path (for same-domain deployment).
// Exported so raw-fetch call sites (FormData uploads / streaming endpoints that
// can't use the axios instance) resolve against the SAME base as every other
// request instead of hardcoding a relative path that breaks on split-domain
// deployments.
export const API_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Auth-failure responses that should end the session, as opposed to a plain
 * "you can't do that" which the calling page handles itself.
 *
 * This distinction became load-bearing with role-based permissions: a 403
 * carrying `permission_denied` is a NORMAL response for a user whose role
 * doesn't cover an endpoint. Treating every 403 as an expired session logged
 * those users straight back out — a Support Agent would sign in, land on the
 * dashboard (which fetches /api/sessions and /api/config), get a 403 from
 * both, and be bounced to the login screen as if their password were wrong.
 */
const ACCOUNT_FAILURE_CODES = new Set([
  'account_disabled',
  'account_not_found',
  'not_authenticated',
]);

/** Endpoints that run BEFORE a session exists — never force a redirect. */
const PRE_AUTH_PATHS = ['/api/auth/login', '/api/auth/setup'];

// Handle auth failures - redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? '';
    const code = error.response?.data?.error;

    // The login form shows its own message (bad credentials, disabled
    // account); redirecting from here would wipe it off the screen.
    if (PRE_AUTH_PATHS.some((p) => url.includes(p))) {
      return Promise.reject(error);
    }

    // 401 always means the token is missing/expired/invalid.
    // 403 only ends the session when the ACCOUNT is the problem; a
    // permission denial leaves the user signed in on the page they're on.
    if (status === 401 || (status === 403 && ACCOUNT_FAILURE_CODES.has(code))) {
      handleAuthFailure();
    }
    return Promise.reject(error);
  },
);

/**
 * Centralised auth-failure handler — shared by the axios interceptor and
 * by raw-fetch call sites (streaming endpoints like /api/bulk/send that
 * can't go through axios). Idempotent: safe to call repeatedly without
 * double-clearing storage or double-redirecting.
 */
let _authFailureFired = false;
export function handleAuthFailure(): void {
  if (_authFailureFired) return;
  _authFailureFired = true;
  console.log(
    'Token expired or invalid, clearing token and redirecting to login',
  );
  localStorage.removeItem('token');
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
  // Reset the latch after a tick so a later navigation back into the
  // app still triggers properly on subsequent 401s.
  setTimeout(() => {
    _authFailureFired = false;
  }, 5000);
}
