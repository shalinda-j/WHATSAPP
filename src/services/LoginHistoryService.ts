import mongoose from 'mongoose';
import LoginEvent, { LoginOutcome } from '../models/LoginEvent';
import { clientIpFromRequest } from './ipAllowlist';

/**
 * Sign-in history: recording attempts, and turning a raw user-agent into
 * something an operator can read at a glance.
 */

export const LOGIN_OUTCOMES: LoginOutcome[] = [
  'success',
  'invalid_password',
  'unknown_user',
  'account_disabled',
];

export function isLoginOutcome(value: unknown): value is LoginOutcome {
  return (
    typeof value === 'string' && LOGIN_OUTCOMES.includes(value as LoginOutcome)
  );
}

/**
 * Best-effort "Chrome on Windows" label for a user-agent string.
 *
 * Deliberately a small hand-rolled matcher rather than a UA-parsing
 * dependency: the history table only needs enough to spot "that login came
 * from a phone, not her laptop", and a wrong-but-plausible label from a
 * 200KB library would be no more useful than this. Order matters — Edge and
 * Opera both claim to be Chrome, and Chrome claims to be Safari.
 */
export function describeUserAgent(ua: string | undefined | null): string {
  const value = typeof ua === 'string' ? ua.trim() : '';
  if (!value) return 'Unknown device';

  const browser = /\bEdg[e]?\//i.test(value)
    ? 'Edge'
    : /\bOPR\/|\bOpera\//i.test(value)
      ? 'Opera'
      : /\bSamsungBrowser\//i.test(value)
        ? 'Samsung Internet'
        : /\bFirefox\//i.test(value)
          ? 'Firefox'
          : /\bChrome\//i.test(value)
            ? 'Chrome'
            : /\bSafari\//i.test(value)
              ? 'Safari'
              : /\bcurl\//i.test(value)
                ? 'curl'
                : /\bPostmanRuntime\//i.test(value)
                  ? 'Postman'
                  : '';

  const os = /\bWindows NT\b/i.test(value)
    ? 'Windows'
    : /\biPhone\b/i.test(value)
      ? 'iPhone'
      : /\biPad\b/i.test(value)
        ? 'iPad'
        : /\bAndroid\b/i.test(value)
          ? 'Android'
          : /\bMac OS X\b|\bMacintosh\b/i.test(value)
            ? 'macOS'
            : /\bLinux\b/i.test(value)
              ? 'Linux'
              : '';

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  // Nothing recognised: show a trimmed prefix rather than an empty cell, so
  // the operator can still eyeball an unusual client.
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}

/** Human-facing label for an outcome — shared by the API and the CSV. */
export function describeOutcome(outcome: LoginOutcome | string): string {
  switch (outcome) {
    case 'success':
      return 'Signed in';
    case 'invalid_password':
      return 'Wrong password';
    case 'unknown_user':
      return 'Unknown username';
    case 'account_disabled':
      return 'Account disabled';
    default:
      return String(outcome);
  }
}

export interface RecordLoginInput {
  username: string;
  outcome: LoginOutcome;
  adminId?: unknown;
  roleKey?: string;
  tenantId?: unknown;
  req?: {
    headers?: Record<string, unknown>;
    ip?: string;
    socket?: { remoteAddress?: string };
  };
}

/**
 * Persist one attempt. Fire-and-forget by design: a failure to write history
 * must never stop somebody signing in, so every error is swallowed after
 * being logged.
 */
export async function recordLoginAttempt(
  input: RecordLoginInput,
): Promise<void> {
  try {
    const ua = input.req?.headers?.['user-agent'];
    await LoginEvent.create({
      username: String(input.username ?? '').slice(0, 120),
      outcome: input.outcome,
      ...(input.adminId
        ? { adminId: new mongoose.Types.ObjectId(String(input.adminId)) }
        : {}),
      ...(input.roleKey ? { roleKey: input.roleKey } : {}),
      ...(input.tenantId
        ? { tenantId: new mongoose.Types.ObjectId(String(input.tenantId)) }
        : {}),
      ip: input.req ? clientIpFromRequest(input.req) : undefined,
      userAgent: typeof ua === 'string' ? ua.slice(0, 400) : undefined,
    });
  } catch (err) {
    console.error('Failed to record login attempt:', err);
  }
}

export interface LoginHistoryQuery {
  adminId?: unknown;
  username?: unknown;
  outcome?: unknown;
  from?: Date | null;
  to?: Date | null;
  tenantId?: string | null;
  /** true = only failures, for the "show me the noise" toggle. */
  failuresOnly?: boolean;
}

/** Escape regex metacharacters so a username search can't inject a pattern. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile the history filter panel into a Mongo query. Pure, so the scoping
 * rules are unit-testable without a database.
 */
export function buildLoginHistoryFilter(
  params: LoginHistoryQuery,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  const adminId = params.adminId ? String(params.adminId) : '';
  if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
    filter.adminId = new mongoose.Types.ObjectId(adminId);
  }

  const username =
    typeof params.username === 'string' ? params.username.trim() : '';
  if (username) {
    filter.username = { $regex: escapeRegex(username), $options: 'i' };
  }

  if (params.failuresOnly) {
    filter.outcome = { $ne: 'success' };
  } else if (isLoginOutcome(params.outcome)) {
    filter.outcome = params.outcome;
  }

  if (params.from || params.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.$gte = params.from;
    if (params.to) range.$lte = params.to;
    filter.createdAt = range;
  }

  // Tenant scope, legacy-tolerant: rows written before the field existed (or
  // by an unknown-user attempt, which has no tenant) must still be visible to
  // the workspace they happened in.
  const tenantId = params.tenantId ? String(params.tenantId) : '';
  if (tenantId && mongoose.Types.ObjectId.isValid(tenantId)) {
    filter.$or = [
      { tenantId: new mongoose.Types.ObjectId(tenantId) },
      { tenantId: { $exists: false } },
      { tenantId: null },
    ];
  }

  return filter;
}
