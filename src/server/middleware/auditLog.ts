import { Request, Response, NextFunction } from 'express';
import AuditEvent from '../../models/AuditEvent';
import { AuthRequest } from './auth';

const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACT_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'oldpassword',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'refreshtoken',
  'access_token',
  'webhooksecret',
  'encryptionkey',
]);
const MAX_BODY_BYTES = 4 * 1024;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[depth-limit]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return value;
}

function summariseBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  try {
    const sanitised = redact(body) as Record<string, unknown>;
    const serialised = JSON.stringify(sanitised);
    if (serialised.length <= MAX_BODY_BYTES) return sanitised;
    return { _truncated: true, snippet: serialised.slice(0, MAX_BODY_BYTES) };
  } catch {
    return { _summariseError: true };
  }
}

/**
 * Records mutating admin API calls to the AuditEvent collection so the
 * operator can answer "who changed what, when". Reads (GET/HEAD) are
 * intentionally skipped — they don't change state and would 10x the
 * collection size for no audit value. Sensitive fields in the request
 * body (passwords, tokens, secrets) are redacted before persistence.
 *
 * Failures are swallowed: a broken audit pipeline must never reject a
 * legitimate API call. The write happens after the response is sent so
 * latency is unaffected.
 */
export function auditLog(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!TRACKED_METHODS.has(req.method)) {
    return next();
  }
  // Skip the audit/read endpoint to avoid recursive noise.
  if (req.path.startsWith('/api/audit')) {
    return next();
  }

  const start = Date.now();
  const requestSummary = summariseBody(req.body);

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const authReq = req as AuthRequest & { tenant?: { _id: unknown } };
    const adminUsername = authReq.user?.username;
    const adminId = authReq.user?.id;
    const tenantId = authReq.tenant?._id;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    void AuditEvent.create({
      tenantId: tenantId as any,
      adminId: adminId as any,
      adminUsername,
      method: req.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
      ip,
      userAgent,
      durationMs,
      requestSummary,
      errorMessage:
        res.statusCode >= 400 ? `http_${res.statusCode}` : undefined,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('auditLog: failed to persist event:', message);
    });
  });

  next();
}
