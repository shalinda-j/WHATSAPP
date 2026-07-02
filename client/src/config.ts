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

// Handle 401/403 responses - redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
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
