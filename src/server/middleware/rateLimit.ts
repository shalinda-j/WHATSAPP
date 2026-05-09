import { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory rate limiting middleware
 * For production, consider using express-rate-limit with Redis store
 */

interface RateLimitEntry {
  count: number;
  firstRequest: number;
  blockedUntil: number;
}

// Store for rate limit tracking
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

// Cleanup interval to prevent memory leaks
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_STORE_SIZE = 10000;

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize cleanup interval
 */
function initializeCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour max age

    // Remove old entries
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.firstRequest > maxAge) {
        rateLimitStore.delete(key);
      }
    }

    // If store is still too large, remove oldest entries
    if (rateLimitStore.size > MAX_STORE_SIZE) {
      const keysToDelete = Array.from(rateLimitStore.keys())
        .slice(0, rateLimitStore.size - MAX_STORE_SIZE);
      for (const key of keysToDelete) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Create a rate limiting middleware
 * @param options Rate limit configuration
 */
export function rateLimit(options: {
  windowMs?: number;      // Time window in milliseconds (default: 60 seconds)
  max?: number;           // Max requests per window (default: 100)
  message?: string;       // Custom error message
  keyGenerator?: (req: Request) => string; // Custom key generator
}) {
  const {
    windowMs = 60 * 1000, // 1 minute default
    max = 100,            // 100 requests per minute default
    message = 'Too many requests, please try again later',
    keyGenerator = (req: Request) => {
      // Use IP address + path as key
      const forwarded = req.headers['x-forwarded-for'];
      const ip = req.ip || (Array.isArray(forwarded) ? forwarded[0] : forwarded) || 'unknown';
      const path = req.path;
      return `${ip}:${path}`;
    }
  } = options;

  // Initialize cleanup on first use
  initializeCleanup();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();

    const entry = rateLimitStore.get(key);

    if (!entry) {
      // First request
      rateLimitStore.set(key, {
        count: 1,
        firstRequest: now,
        blockedUntil: 0,
      });
      return next();
    }

    // Check if blocked
    if (entry.blockedUntil > now) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.setHeader('X-RateLimit-Limit', max.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(entry.blockedUntil).toISOString());
      res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter,
      });
      return;
    }

    // Check if window has expired
    if (now - entry.firstRequest > windowMs) {
      // Reset window
      entry.count = 1;
      entry.firstRequest = now;
      entry.blockedUntil = 0;
      return next();
    }

    // Increment count
    entry.count++;

    // Check if limit exceeded
    if (entry.count > max) {
      // Block for remainder of window + additional penalty
      const blockDuration = windowMs + (30 * 1000); // Extra 30s penalty
      entry.blockedUntil = now + blockDuration;

      const retryAfter = Math.ceil(blockDuration / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.setHeader('X-RateLimit-Limit', max.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(entry.blockedUntil).toISOString());
      res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter,
      });
      return;
    }

    // Set headers for transparency
    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', (max - entry.count).toString());
    res.setHeader('X-RateLimit-Reset', new Date(entry.firstRequest + windowMs).toISOString());

    next();
  };
}

/**
 * Strict rate limit for sensitive endpoints (e.g., auth, registration)
 * 20 requests per minute per IP
 */
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many requests. Please wait before trying again.',
});

/**
 * Standard rate limit for public endpoints
 * 100 requests per minute per IP
 */
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Rate limit exceeded. Please slow down.',
});

/**
 * Lenient rate limit for high-traffic endpoints
 * 300 requests per minute per IP
 */
export const lenientRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Rate limit exceeded. Please wait and try again.',
});

/**
 * Cleanup on shutdown
 */
export function shutdownRateLimiter(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  rateLimitStore.clear();
}